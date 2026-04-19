"""INDmoney screenshot parser: extract stock data from OCR text.

Approach: Find all (Qty, Avg) pairs in the text, then look backwards from each
Qty line to find the stock name. This avoids false stock name detection splitting blocks.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SKIP_NAMES = {
    "us stocks", "my stocks", "watchlist", "explore", "rewards", "sip",
    "orders", "invested", "current value", "market value",
    "indstocks", "myind", "funds", "insta plus", "insta", "plus",
    "hr", "ry", "sm", "s stocks",
}


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        cleaned = re.sub(r"[$,]", "", s.strip())
        cleaned = re.sub(r"(\d+)\s+(\d{1,2})$", r"\1.\2", cleaned)
        return float(cleaned)
    except (ValueError, AttributeError):
        return None


def _is_valid_stock_name(line: str) -> bool:
    """Check if a line could be a stock name (used for backward search from Qty)."""
    s = line.strip()
    if not s or len(s) <= 2:
        return False
    low = s.lower()
    if low in SKIP_NAMES:
        return False
    if any(skip in low for skip in ["invite your", "when they join", "pull down",
                                     "indstocks", "myind", "insta plus",
                                     "watchlist", "rewards", "us stocks"]):
        return False
    # Must have 2+ consecutive letters
    if not re.search(r"[A-Za-z]{2,}", s):
        return False
    # Skip number-like lines
    if re.match(r"^[\d.,]+\s*Qty", s, re.IGNORECASE):
        return False
    if re.match(r"(?:Avg|Ava)[:\s]", s, re.IGNORECASE):
        return False
    if re.match(r"^\$[\d,.]+", s):
        return False
    if re.match(r"^[+-]?[\d.]+%$", s):
        return False
    # Skip all-caps single words (OCR garbage like TREASMENT, SPDR, CW)
    if re.match(r"^[A-Z]{1,10}$", s):
        return False
    # Skip very short lines that are likely fragments
    if len(s) <= 4:
        return False
    # A real stock name should have at least one space or be long enough
    # Single words like "CoreWeave", "Adobe", "Sprouts" are fragments
    # Real names: "Credo Technology Group", "Fortinet Inc", "Novo Nordisk A/S"
    # Exception: names ending with common suffixes
    if " " not in s and not s.endswith(("...", ".")):
        return False
    return True


def _clean_stock_name(name: str) -> str:
    name = re.sub(r"^[Tt]r\)\s*", "", name)
    name = re.sub(r"^[i@&mМЯ]\s+", "", name)
    # Remove trailing "L..." or similar OCR artifacts
    name = re.sub(r"\s+[A-Z]\.{2,}$", "", name)
    return name.strip()


def parse_indmoney(text: str) -> list[dict]:
    """Parse INDmoney screenshot OCR text.
    
    Strategy: find all Qty lines, then for each Qty find the nearest Avg line
    below it, and the nearest stock name above it.
    """
    if not text or len(text.strip()) < 20:
        return []

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]

    # Step 1: Find all Qty line positions
    qty_positions = []
    for i, line in enumerate(lines):
        m = re.match(r"([\d.]+)\s*Qty", line, re.IGNORECASE)
        if m:
            qty_positions.append((i, _clean_number(m.group(1))))

    if not qty_positions:
        logger.warning("No Qty lines found")
        return []

    stocks = []
    for qty_idx, qty_val in qty_positions:
        if not qty_val:
            continue

        # Step 2: Find Avg within next 10 lines after Qty
        avg_val = None
        for j in range(qty_idx + 1, min(qty_idx + 10, len(lines))):
            m = re.match(r"(?:Avg|Ava)[:\s]*\$?([\d,. ]+)", lines[j], re.IGNORECASE)
            if m:
                avg_val = _clean_number(m.group(1))
                break

        if not avg_val:
            logger.warning("No Avg found near Qty at line %d", qty_idx)
            continue

        # Step 3: Look backwards from Qty to find stock name
        stock_name = None
        for j in range(qty_idx - 1, max(qty_idx - 5, -1), -1):
            if _is_valid_stock_name(lines[j]):
                stock_name = _clean_stock_name(lines[j])
                break

        if not stock_name:
            logger.warning("No stock name found before Qty at line %d", qty_idx)
            continue

        stocks.append({
            "stock_name": stock_name,
            "symbol": "UNKNOWN",
            "quantity": qty_val,
            "avg_buy_price": avg_val,
        })

    logger.info("Parsed %d stocks from INDmoney", len(stocks))
    return stocks

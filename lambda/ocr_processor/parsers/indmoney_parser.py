"""INDmoney screenshot parser: extract stock data from OCR text.

Extracts only: stock_name, symbol, quantity, avg_buy_price
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SKIP_PATTERNS = {
    "us stocks", "my stocks", "watchlist", "explore", "rewards", "sip",
    "orders", "invested", "current value", "market value",
    "indstocks", "myind", "funds", "insta plus", "insta", "plus",
    "hr", "ry", "sm",
}

# Known non-stock short words that OCR picks up
SKIP_EXACT = {"t", "a", "i", "m", "x", "spdr", "drip", "etf", "inc", "ltd", "adr"}


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        return float(re.sub(r"[$,\s]", "", s))
    except (ValueError, AttributeError):
        return None


def _is_stock_name(line: str) -> bool:
    s = line.strip()
    if not s or len(s) <= 4:
        return False
    low = s.lower()
    if low in SKIP_PATTERNS or low in SKIP_EXACT:
        return False
    if any(skip in low for skip in ["invite your", "when they join", "pull down",
                                     "indstocks", "myind", "insta plus"]):
        return False
    if not re.search(r"[A-Za-z]{2,}", s):
        return False
    if re.match(r"^[\d.,]+\s*Qty", s, re.IGNORECASE):
        return False
    if re.match(r"Avg[:\s]", s, re.IGNORECASE):
        return False
    if re.match(r"^\$[\d,.]+", s):
        return False
    if re.match(r"^[\d.]+%$", s):
        return False
    # Skip lines that are all uppercase and <= 5 chars (likely ticker symbols, not names)
    if re.match(r"^[A-Z]{1,5}$", s):
        return False
    return True


def _clean_stock_name(name: str) -> str:
    name = re.sub(r"^[Tt]r\)\s*", "", name)
    name = re.sub(r"^[i@&mМЯ]\s+", "", name)
    return name.strip()


def _make_symbol(name: str) -> str:
    return "UNKNOWN"


def parse_indmoney(text: str) -> list[dict]:
    """Parse INDmoney screenshot OCR text. Returns list of {stock_name, symbol, quantity, avg_buy_price}."""
    if not text or len(text.strip()) < 20:
        return []

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
    stock_indices = [i for i, line in enumerate(lines) if _is_stock_name(line)]
    if not stock_indices:
        return []

    stocks: list[dict] = []
    for idx, start in enumerate(stock_indices):
        end = stock_indices[idx + 1] if idx + 1 < len(stock_indices) else len(lines)
        block = lines[start:end]
        name = _clean_stock_name(block[0])

        qty: Optional[float] = None
        avg: Optional[float] = None

        for line in block[1:]:
            m = re.match(r"([\d.]+)\s*Qty", line, re.IGNORECASE)
            if m:
                qty = _clean_number(m.group(1))
                continue
            m = re.match(r"Avg[:\s]*\$?([\d,.]+)", line, re.IGNORECASE)
            if m:
                avg = _clean_number(m.group(1))
                continue

        if not qty or not avg:
            # Try scanning further — sometimes Qty/Avg are in the next "false" block
            # Look ahead up to 8 more lines past the block end
            for line in lines[end:min(end + 8, len(lines))]:
                if _is_stock_name(line):
                    break
                if not qty:
                    m = re.match(r"([\d.]+)\s*Qty", line, re.IGNORECASE)
                    if m:
                        qty = _clean_number(m.group(1))
                        continue
                if not avg:
                    m = re.match(r"Avg[:\s]*\$?([\d,.]+)", line, re.IGNORECASE)
                    if m:
                        avg = _clean_number(m.group(1))
                        continue

        if not qty or not avg:
            logger.warning("Missing qty/avg for '%s', skipping", name)
            continue

        stocks.append({
            "stock_name": name,
            "symbol": _make_symbol(name),
            "quantity": qty,
            "avg_buy_price": avg,
        })

    logger.info("Parsed %d stocks from INDmoney", len(stocks))
    return stocks

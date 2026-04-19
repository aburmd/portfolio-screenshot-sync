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
}


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        return float(re.sub(r"[$,\s]", "", s))
    except (ValueError, AttributeError):
        return None


def _is_stock_name(line: str) -> bool:
    if not line or len(line.strip()) <= 2:
        return False
    low = line.lower().strip()
    if low in SKIP_PATTERNS or any(s in low for s in ["invite your", "when they join"]):
        return False
    if not re.search(r"[A-Za-z]{2,}", line):
        return False
    if re.match(r"^[\d.,]+\s*Qty", line, re.IGNORECASE):
        return False
    if re.match(r"Avg[:\s]", line, re.IGNORECASE):
        return False
    if re.match(r"^\$[\d,.]+", line):
        return False
    if re.match(r"^[\d.]+%$", line):
        return False
    return True


def _clean_stock_name(name: str) -> str:
    name = re.sub(r"^[Tt]r\)\s*", "", name)
    name = re.sub(r"^[i@&mМЯ]\s+", "", name)
    return name.strip()


def _make_symbol(name: str) -> str:
    """Placeholder — returns UNKNOWN. Real symbol comes from DDB lookup."""
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
            continue

        stocks.append({
            "stock_name": name,
            "symbol": _make_symbol(name),
            "quantity": qty,
            "avg_buy_price": avg,
        })

    return stocks

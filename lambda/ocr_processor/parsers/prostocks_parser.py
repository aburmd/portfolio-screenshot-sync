"""ProStocks screenshot parser: extract Indian stock data from OCR text.

ProStocks shows a holdings table with columns:
  Instrument | Qty | Avg.Cost | LTP | Cur.Val | UnPnl | Net Change | DayChange

Instrument format: SYMBOLNAME-EQ NSE [qty sometimes on same line]
All values in INR.

Strategy: Find lines matching "SYMBOL-EQ NSE" pattern, then extract qty and avg_cost
from the following lines (or same line if merged).
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        cleaned = re.sub(r"[₹~`¥,\s]", "", s.strip())
        cleaned = re.sub(r"(\d+)\s+(\d{1,2})$", r"\1.\2", cleaned)
        return float(cleaned)
    except (ValueError, AttributeError):
        return None


def _extract_symbol(instrument: str) -> Optional[str]:
    """Extract symbol from instrument name like 'ZYDUSLIFE-EQ NSE' or 'HINDUNILVR-EQ NSE 11'."""
    m = re.match(r"([A-Z][A-Z0-9]+)-(?:EQ|FO)\s+(?:NSE|BSE)", instrument)
    if m:
        return m.group(1)
    return None


def parse_prostocks(text: str) -> list[dict]:
    """Parse ProStocks screenshot OCR text.
    
    Returns list of {stock_name, symbol, quantity, avg_buy_price, currency}.
    """
    if not text or len(text.strip()) < 20:
        return []

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]

    stocks = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Match instrument line: SYMBOL-EQ NSE [optional qty on same line]
        m = re.match(r"([A-Z][A-Z0-9]+-(?:EQ|FO)\s+(?:NSE|BSE))\s*(\d+)?$", line)
        if not m:
            # Also match with qty merged: "HINDUNILVR-EQ NSE 11"
            m = re.match(r"([A-Z][A-Z0-9]+-(?:EQ|FO)\s+(?:NSE|BSE))\s*(\d+)", line)

        if m:
            instrument = m.group(1)
            symbol = _extract_symbol(instrument)
            if not symbol:
                i += 1
                continue

            # Qty might be on same line or next lines
            qty_on_line = m.group(2) if m.group(2) else None
            qty = int(qty_on_line) if qty_on_line else None
            avg = None

            # Scan next lines for qty (if not on same line) and avg_cost
            # Pattern: qty is a small integer, avg_cost is a decimal number
            # The table order after instrument is: Qty, Avg.Cost, LTP, Cur.Val, ...
            numbers_found = []
            for j in range(i + 1, min(i + 8, len(lines))):
                nxt = lines[j].strip()

                # Stop if we hit another instrument line
                if re.match(r"[A-Z][A-Z0-9]+-(?:EQ|FO)\s+(?:NSE|BSE)", nxt):
                    break

                # Skip non-data lines
                if nxt.lower() in ("delivery", "margin pledge", "search"):
                    continue
                if re.match(r"^[~`¥]", nxt):
                    continue
                if re.match(r"^\d+\s*@", nxt):  # order details like "11 @ 2240.40"
                    continue
                if re.match(r"^[+-]?\d+\.\d+\s*\(", nxt):  # day change like "-0.50 (-0.02 %)"
                    continue
                if re.match(r"^[+-]?\d+\.\d+%$", nxt):  # percentage
                    continue

                # Try to extract a number
                val = _clean_number(nxt)
                if val is not None:
                    numbers_found.append(val)

            # Assign numbers: first is qty (if not already), second is avg_cost
            if qty is None and numbers_found:
                qty = int(numbers_found[0]) if numbers_found[0] == int(numbers_found[0]) else None
                numbers_found = numbers_found[1:] if qty else numbers_found

            if numbers_found:
                avg = numbers_found[0]  # First remaining number is avg_cost

            if qty and avg:
                stock_name = symbol  # Use symbol as name for ProStocks
                stocks.append({
                    "stock_name": stock_name,
                    "symbol": symbol,
                    "quantity": float(qty),
                    "avg_buy_price": avg,
                    "currency": "INR",
                })

        i += 1

    logger.info("Parsed %d stocks from ProStocks", len(stocks))
    return stocks

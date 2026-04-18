"""INDmoney screenshot parser: extract stock data from OCR text."""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Common INDmoney field patterns
RUPEE_PATTERN = r"[₹Rs.]*\s*([\d,]+\.?\d*)"
PERCENT_PATTERN = r"([+-]?\d+\.?\d*)\s*%"


def _clean_number(s: str) -> Optional[float]:
    """Remove commas and convert to float."""
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _extract_stock_name(lines: list[str]) -> Optional[str]:
    """Extract stock name — typically the first prominent text line."""
    for line in lines:
        line = line.strip()
        # Skip empty, numeric-only, or very short lines
        if not line or len(line) < 3:
            continue
        # Skip lines that are purely numbers/symbols
        if re.match(r"^[\d₹%.,+\-\s]+$", line):
            continue
        # Skip common UI labels
        skip_labels = ["invested", "current", "returns", "p&l", "total", "qty",
                        "shares", "avg", "buy", "sell", "nse", "bse", "overview"]
        if line.lower() in skip_labels:
            continue
        return line
    return None


def _extract_field(text: str, labels: list[str], pattern: str = RUPEE_PATTERN) -> Optional[float]:
    """Extract a numeric field that follows one of the given labels."""
    for label in labels:
        match = re.search(rf"{label}\s*[:\-]?\s*{pattern}", text, re.IGNORECASE)
        if match:
            return _clean_number(match.group(1))
    return None


def parse_indmoney(text: str) -> list[dict]:
    """Parse INDmoney screenshot OCR text into structured stock records.

    Returns a list of dicts, each representing one stock. Typically one
    stock per screenshot, but handles multi-stock views too.
    """
    if not text or len(text.strip()) < 10:
        logger.warning("OCR text too short to parse: %d chars", len(text))
        return []

    lines = text.strip().split("\n")
    stock_name = _extract_stock_name(lines)

    if not stock_name:
        logger.warning("Could not extract stock name from OCR text")
        return []

    # Extract fields from full text
    quantity = _extract_field(text, ["qty", "quantity", "shares", "no. of shares"])
    avg_buy_price = _extract_field(text, ["avg", "average", "avg. price", "buy price", "avg buy"])
    current_price = _extract_field(text, ["current price", "ltp", "market price", "cmp"])
    invested_amount = _extract_field(text, ["invested", "total invested", "investment"])
    current_value = _extract_field(text, ["current", "current value", "market value", "present value"])
    pnl = _extract_field(text, ["returns", "p&l", "profit", "gain", "total returns"])

    # Extract P&L percentage
    pnl_pct_match = re.search(PERCENT_PATTERN, text)
    pnl_percentage = float(pnl_pct_match.group(1)) if pnl_pct_match else None

    # Derive missing fields where possible
    if quantity and avg_buy_price and not invested_amount:
        invested_amount = round(quantity * avg_buy_price, 2)
    if quantity and current_price and not current_value:
        current_value = round(quantity * current_price, 2)
    if invested_amount and current_value and not pnl:
        pnl = round(current_value - invested_amount, 2)
    if pnl and invested_amount and not pnl_percentage and invested_amount != 0:
        pnl_percentage = round((pnl / invested_amount) * 100, 2)

    # Build symbol from stock name (basic heuristic — can be improved with NSE mapping)
    symbol = re.sub(r"[^A-Za-z0-9]", "", stock_name.upper())[:20]

    stock = {
        "stock_name": stock_name,
        "symbol": symbol,
    }

    # Only include fields that were successfully extracted
    if quantity is not None:
        stock["quantity"] = quantity
    if avg_buy_price is not None:
        stock["avg_buy_price"] = avg_buy_price
    if current_price is not None:
        stock["current_price"] = current_price
    if invested_amount is not None:
        stock["invested_amount"] = invested_amount
    if current_value is not None:
        stock["current_value"] = current_value
    if pnl is not None:
        stock["pnl"] = pnl
    if pnl_percentage is not None:
        stock["pnl_percentage"] = pnl_percentage

    logger.info("Parsed stock: %s (%s)", stock_name, symbol)
    return [stock]

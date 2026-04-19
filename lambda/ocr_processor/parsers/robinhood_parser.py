"""Robinhood screenshot parser: extract stock data from OCR text.

Robinhood requires two screenshots of the same stocks:
  View A (Market Value): SYMBOL → $market_value → qty shares
  View B (Total Return %): SYMBOL → return% → qty shares

Calculation:
  current_price = market_value / qty  (from View A)
  avg_buy_price = current_price / (1 + return_pct/100)  (combining A + B)

Parser auto-detects view type. Lambda stores partial data in DDB.
When both views are uploaded, avg_buy_price gets calculated.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        return float(re.sub(r"[$,\s]", "", s))
    except (ValueError, AttributeError):
        return None


def _is_symbol(line: str) -> bool:
    s = line.strip()
    return bool(re.match(r"^[A-Z]{1,5}$", s))


def _detect_view(lines: list[str]) -> str:
    """Detect view type: 'market_value' (has $amounts) or 'return_pct' (has %values)."""
    pct_count = sum(1 for l in lines if re.match(r"^[+-][\d.]+%$", l.strip()))
    dollar_count = sum(1 for l in lines if re.match(r"^\$[\d,.]+$", l.strip()))
    return "return_pct" if pct_count > dollar_count else "market_value"


def parse_robinhood(text: str) -> list[dict]:
    """Parse a single Robinhood screenshot view.

    Returns stocks with:
      market_value view: {symbol, quantity, current_price, avg_buy_price=0}
      return_pct view:   {symbol, quantity, return_pct, avg_buy_price=0}

    The handler/frontend merges both views to calculate avg_buy_price.
    """
    if not text or len(text.strip()) < 20:
        return []

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]

    # Filter UI chrome
    skip = {"investing", "retirement", "custodial", "credit card",
            "pull down to explore", "your", "promony", "mym", "x", "1", "m"}
    filtered = []
    for l in lines:
        if l.lower() in skip:
            continue
        if re.match(r"^\d+:\d+", l):
            continue
        if re.match(r"^[/.]+", l):
            continue
        filtered.append(l)

    view = _detect_view(filtered)
    logger.info("Robinhood view: %s", view)

    stocks = []
    i = 0
    while i < len(filtered):
        line = filtered[i]

        if _is_symbol(line):
            symbol = line
            qty = None
            value = None  # dollar amount or percentage

            for j in range(i + 1, min(i + 5, len(filtered))):
                nxt = filtered[j].strip()
                if _is_symbol(nxt):
                    break

                # Qty: "0.571884 shares"
                qty_m = re.match(r"([\d.]+)\s*shares?", nxt, re.IGNORECASE)
                if qty_m and qty is None:
                    qty = _clean_number(qty_m.group(1))
                    continue

                if view == "market_value":
                    # Dollar: "$55.64"
                    val_m = re.match(r"^\$([\d,.]+)$", nxt)
                    if val_m and value is None:
                        value = _clean_number(val_m.group(1))
                        continue
                else:
                    # Percentage: "-14.40%"
                    pct_m = re.match(r"^([+-]?[\d.]+)%$", nxt)
                    if pct_m and value is None:
                        value = _clean_number(pct_m.group(1))
                        continue

            if qty and qty > 0:
                stock = {
                    "symbol": symbol,
                    "stock_name": symbol,
                    "quantity": qty,
                    "avg_buy_price": 0,
                    "robinhood_view": view,
                }
                if view == "market_value" and value is not None:
                    stock["current_price"] = round(value / qty, 2)
                    stock["market_value"] = value
                elif view == "return_pct" and value is not None:
                    stock["return_pct"] = value

                stocks.append(stock)

        i += 1

    logger.info("Parsed %d stocks from Robinhood %s view", len(stocks), view)
    return stocks

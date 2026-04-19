"""Webull screenshot parser: extract stock data from OCR text.

Textract block pattern per stock:
  SYMBOL           ← ticker (all caps, 1-5 chars)
  mkt_value [DRIP] ← market value (ignore DRIP label)
  +/-pnl           ← P&L dollar (ignore)
  last_price       ← current price (ignore)
  stock_name       ← full name
  quantity         ← fractional shares
  +/-pnl%          ← P&L percentage (ignore)
  $avg_price       ← avg buy price (has $ prefix)

Extracts only: symbol, stock_name, quantity, avg_buy_price
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SKIP_LINES = {
    "stocks &", "options", "mkt value/", "qty", "open p&l", "last",
    "/avg price", "individual cash", "assets", "p&l", "orders",
    "transfers", "history", "ai position", "ai position analvsis",
    "ai position analysis", "position analysis", "watchlists", "markets",
    "account", "feeds", "menu", "try", "&", "—",
}


def _clean_number(s: str) -> Optional[float]:
    if not s:
        return None
    try:
        return float(re.sub(r"[$,\s]", "", s))
    except (ValueError, AttributeError):
        return None


def _is_symbol(line: str) -> bool:
    """Check if line is a stock ticker symbol (1-5 uppercase letters)."""
    s = line.strip()
    if s in ("DRIP",):  # Known non-symbol uppercase words
        return False
    return bool(re.match(r"^[A-Z]{1,5}$", s))


def parse_webull(text: str) -> list[dict]:
    """Parse Webull screenshot OCR text. Returns list of {stock_name, symbol, quantity, avg_buy_price}."""
    if not text or len(text.strip()) < 20:
        return []

    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]

    # Filter out UI chrome
    filtered = []
    for line in lines:
        if line.lower() in SKIP_LINES:
            continue
        if re.match(r"^\d+:\d+", line):  # timestamp like "8:05 00"
            continue
        if re.match(r"^\d+%$", line):  # battery like "46%"
            continue
        filtered.append(line)

    # Find symbol positions
    symbol_indices = [i for i, line in enumerate(filtered) if _is_symbol(line)]
    if not symbol_indices:
        logger.warning("No stock symbols found in Webull OCR text")
        return []

    stocks: list[dict] = []

    for idx, start in enumerate(symbol_indices):
        end = symbol_indices[idx + 1] if idx + 1 < len(symbol_indices) else len(filtered)
        block = filtered[start:end]

        if len(block) < 5:
            continue

        symbol = block[0].strip()

        # Find qty (small decimal < 100, no $ prefix, no +/- prefix)
        # Find avg_buy_price (has $ prefix)
        # Find stock_name (contains letters, not a number)
        qty = None
        avg = None
        stock_name = None

        for line in block[1:]:
            # Avg buy price: "$206.90"
            if line.startswith("$"):
                val = _clean_number(line)
                if val is not None:
                    avg = val
                continue

            # Skip P&L lines (start with + or -)
            if re.match(r"^[+-]", line):
                continue

            # Skip market value / last price lines with DRIP
            if "DRIP" in line:
                # Could have qty on same line? No — DRIP is on mkt_value line
                continue

            # Stock name: has 2+ letters, not purely numeric
            if re.search(r"[A-Za-z]{2,}", line) and not re.match(r"^[\d.,]+$", line):
                # Skip UI chrome that leaked into block
                if any(w in line.lower() for w in ["position", "analysis", "analvsis", "watchlist", "market", "account", "feed", "menu", "order", "transfer", "history"]):
                    continue
                stock_name = line
                continue

            # Remaining numbers: qty is typically < 10 (fractional), others are prices > 10
            val = _clean_number(line)
            if val is not None:
                if val < 10 and qty is None:
                    qty = val
                # else: market value or last price — ignore

        if not qty or not avg:
            logger.warning("Missing qty/avg for %s, skipping", symbol)
            continue

        stocks.append({
            "stock_name": stock_name or symbol,
            "symbol": symbol,
            "quantity": qty,
            "avg_buy_price": avg,
        })

    return stocks

"""Symbol lookup: resolve stock_name → ticker symbol via DDB symbol-map table.

DDB Table: portfolio-symbol-map-{env}
  PK: stock_name (lowercase, trimmed)
  Attributes: symbol, exchange (NSE/BSE/NASDAQ/etc.)

If stock_name not found, returns None so caller can flag as UNKNOWN.
"""
import os
import logging

import boto3

logger = logging.getLogger(__name__)
ddb = boto3.resource("dynamodb")

SYMBOL_MAP_TABLE = os.environ.get("SYMBOL_MAP_TABLE", "")


def lookup_symbol(stock_name: str) -> str | None:
    """Look up ticker symbol by stock_name. Returns None if not found."""
    if not SYMBOL_MAP_TABLE:
        logger.warning("SYMBOL_MAP_TABLE not configured")
        return None

    table = ddb.Table(SYMBOL_MAP_TABLE)
    key = stock_name.strip().lower()

    try:
        resp = table.get_item(Key={"stock_name": key})
        item = resp.get("Item")
        if item:
            return item.get("symbol")
    except Exception as e:
        logger.exception("Symbol lookup failed for '%s': %s", stock_name, e)

    return None


def resolve_symbols(stocks: list[dict]) -> list[dict]:
    """Resolve symbols for a list of parsed stocks. Sets symbol=UNKNOWN if not found."""
    for stock in stocks:
        name = stock.get("stock_name", "")
        symbol = lookup_symbol(name)
        if symbol:
            stock["symbol"] = symbol
        else:
            stock["symbol"] = "UNKNOWN"
            logger.warning("No symbol mapping for '%s' — flagged as UNKNOWN", name)
    return stocks

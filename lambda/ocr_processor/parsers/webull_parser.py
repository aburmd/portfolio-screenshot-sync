"""Webull screenshot parser: extract stock data from OCR text.

TODO: Implement after sample Webull screenshot is provided.
Expected to extract: stock_name, quantity, avg_buy_price (same as INDmoney parser output).
"""
import logging

logger = logging.getLogger(__name__)


def parse_webull(text: str) -> list[dict]:
    """Parse Webull screenshot OCR text. Placeholder — needs sample screenshot."""
    logger.warning("Webull parser not yet implemented")
    return []

"""Parser router: detect broker from OCR text and route to correct parser."""
import logging
from typing import Optional

from parsers.indmoney_parser import parse_indmoney

logger = logging.getLogger(__name__)

# Registry: broker_key → parser function
PARSER_REGISTRY = {
    "indmoney": parse_indmoney,
    # Future:
    # "robinhood": parse_robinhood,
    # "webull": parse_webull,
    # "fidelity": parse_fidelity,
}

# Detection patterns: (substring_in_text, broker_key)
BROKER_DETECTION_PATTERNS = [
    ("indmoney", "indmoney"),
    ("ind money", "indmoney"),
    ("INDmoney", "indmoney"),
    # Future:
    # ("robinhood", "robinhood"),
    # ("webull", "webull"),
    # ("fidelity", "fidelity"),
]


def detect_broker(text: str, s3_key: str = "") -> Optional[str]:
    """Detect broker from OCR text content or S3 key path."""
    text_lower = text.lower()

    # Check S3 key for broker hints (e.g., uploads/{user}/indmoney_*.png)
    key_lower = s3_key.lower()
    for pattern, broker in BROKER_DETECTION_PATTERNS:
        if pattern.lower() in key_lower:
            return broker

    # Check OCR text
    for pattern, broker in BROKER_DETECTION_PATTERNS:
        if pattern.lower() in text_lower:
            return broker

    # Default to indmoney for now (primary use case)
    logger.warning("Could not detect broker, defaulting to indmoney")
    return "indmoney"


def route_and_parse(text: str, s3_key: str = "") -> list[dict]:
    """Detect broker and parse OCR text into structured stock data."""
    broker = detect_broker(text, s3_key)
    parser = PARSER_REGISTRY.get(broker)

    if not parser:
        logger.error("No parser registered for broker: %s", broker)
        return []

    logger.info("Routing to %s parser", broker)
    return parser(text)

"""Parser router: route to correct parser based on platform."""
import logging
from typing import Optional

from parsers.indmoney_parser import parse_indmoney
from parsers.webull_parser import parse_webull
from parsers.robinhood_parser import parse_robinhood

logger = logging.getLogger(__name__)

PARSER_REGISTRY = {
    "indmoney": parse_indmoney,
    "webull": parse_webull,
    "robinhood": parse_robinhood,
    # "fidelity": parse_fidelity,
}


def detect_broker(text: str, s3_key: str = "") -> Optional[str]:
    """Detect broker from S3 key path or OCR text. Fallback only."""
    key_lower = s3_key.lower()
    for broker in PARSER_REGISTRY:
        if broker in key_lower:
            return broker

    text_lower = text.lower()
    for broker in PARSER_REGISTRY:
        if broker in text_lower:
            return broker

    return "unknown"


def route_and_parse(text: str, s3_key: str = "", platform: str = "") -> list[dict]:
    """Route to correct parser based on platform. Falls back to auto-detect."""
    broker = platform.lower() if platform else detect_broker(text, s3_key)
    parser = PARSER_REGISTRY.get(broker)

    if not parser:
        # Try auto-detect if explicit platform has no parser
        detected = detect_broker(text, s3_key)
        parser = PARSER_REGISTRY.get(detected)

    if not parser:
        logger.warning("No parser for platform '%s', using indmoney as default", broker)
        parser = parse_indmoney

    logger.info("Routing to %s parser", broker)
    return parser(text)

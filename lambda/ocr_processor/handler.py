"""Lambda handler: S3 upload trigger → Textract OCR → DynamoDB upsert."""
import json
import os
import logging
from datetime import datetime, timezone

from ocr.engine import extract_text_from_s3
from parsers.parser_router import detect_broker, route_and_parse
from common.ddb_utils import upsert_portfolio_item, update_upload_status
from common.symbol_lookup import resolve_symbols

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SCREENSHOTS_BUCKET = os.environ.get("SCREENSHOTS_BUCKET", "")
PORTFOLIO_TABLE = os.environ.get("PORTFOLIO_TABLE", "")
UPLOADS_TABLE = os.environ.get("UPLOADS_TABLE", "")


def lambda_handler(event: dict, context) -> dict:
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        logger.info("Processing s3://%s/%s", bucket, key)

        parts = key.split("/")
        if len(parts) < 3 or parts[0] != "uploads":
            logger.warning("Unexpected key format: %s", key)
            continue

        user_id = parts[1]
        upload_id = f"{user_id}_{parts[-1]}_{datetime.now(timezone.utc).isoformat()}"

        try:
            update_upload_status(UPLOADS_TABLE, upload_id, user_id, key, "PROCESSING")

            raw_text = extract_text_from_s3(bucket, key)
            logger.info("Textract extracted %d chars", len(raw_text))

            platform = detect_broker(raw_text, key)
            stocks = route_and_parse(raw_text, key)
            stocks = resolve_symbols(stocks)
            logger.info("Parsed %d stocks from %s", len(stocks), platform)

            for stock in stocks:
                upsert_portfolio_item(PORTFOLIO_TABLE, user_id, stock, platform)

            update_upload_status(UPLOADS_TABLE, upload_id, user_id, key, "COMPLETED",
                                 extracted_stocks=len(stocks))

        except Exception as e:
            logger.exception("Failed processing %s: %s", key, e)
            update_upload_status(UPLOADS_TABLE, upload_id, user_id, key, "FAILED")

    return {"statusCode": 200, "body": json.dumps("OK")}

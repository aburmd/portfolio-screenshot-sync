"""Lambda handler: S3 upload trigger → OCR → DynamoDB upsert."""
import json
import os
import logging
from datetime import datetime, timezone

import boto3

from ocr.engine import extract_text_from_image
from parsers.parser_router import route_and_parse
from common.ddb_utils import upsert_portfolio_item, update_upload_status

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

SCREENSHOTS_BUCKET = os.environ.get("SCREENSHOTS_BUCKET", "")
PORTFOLIO_TABLE = os.environ.get("PORTFOLIO_TABLE", "")
UPLOADS_TABLE = os.environ.get("UPLOADS_TABLE", "")


def lambda_handler(event: dict, context) -> dict:
    """Process S3 event: download image, OCR, parse, upsert to DynamoDB."""
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        logger.info("Processing s3://%s/%s", bucket, key)

        # Extract user_id from key: uploads/{user_id}/{filename}
        parts = key.split("/")
        if len(parts) < 3 or parts[0] != "uploads":
            logger.warning("Unexpected key format: %s", key)
            continue

        user_id = parts[1]
        upload_id = f"{user_id}_{parts[-1]}_{datetime.now(timezone.utc).isoformat()}"

        try:
            update_upload_status(UPLOADS_TABLE, upload_id, user_id, key, "PROCESSING")

            # Download image from S3
            tmp_path = f"/tmp/{parts[-1]}"
            s3.download_file(bucket, key, tmp_path)

            # OCR
            raw_text = extract_text_from_image(tmp_path)
            logger.info("OCR extracted %d chars", len(raw_text))

            # Parse extracted text into structured stock data
            stocks = route_and_parse(raw_text, key)
            logger.info("Parsed %d stocks", len(stocks))

            # Upsert each stock to DynamoDB
            for stock in stocks:
                stock["source_image"] = key
                stock["last_updated"] = datetime.now(timezone.utc).isoformat()
                upsert_portfolio_item(PORTFOLIO_TABLE, user_id, stock)

            update_upload_status(
                UPLOADS_TABLE, upload_id, user_id, key, "COMPLETED",
                extracted_stocks=len(stocks),
            )
            logger.info("Done: %d stocks upserted for user %s", len(stocks), user_id)

        except Exception as e:
            logger.exception("Failed processing %s: %s", key, e)
            update_upload_status(UPLOADS_TABLE, upload_id, user_id, key, "FAILED")

    return {"statusCode": 200, "body": json.dumps("OK")}

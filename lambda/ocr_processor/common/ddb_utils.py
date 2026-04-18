"""DynamoDB utility functions for portfolio and upload operations."""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

import boto3

logger = logging.getLogger(__name__)
ddb = boto3.resource("dynamodb")


def _to_decimal(val) -> Optional[Decimal]:
    """Convert float/int to Decimal for DynamoDB."""
    if val is None:
        return None
    return Decimal(str(val))


def upsert_portfolio_item(table_name: str, user_id: str, stock: dict) -> None:
    """Upsert a stock record in the portfolio table. PK=user_id, SK=symbol."""
    table = ddb.Table(table_name)
    item = {
        "user_id": user_id,
        "symbol": stock["symbol"],
        "stock_name": stock.get("stock_name", ""),
        "last_updated": stock.get("last_updated", datetime.now(timezone.utc).isoformat()),
        "source_image": stock.get("source_image", ""),
    }

    # Add numeric fields as Decimal
    for field in ["quantity", "avg_buy_price", "current_price",
                  "invested_amount", "current_value", "pnl", "pnl_percentage"]:
        val = _to_decimal(stock.get(field))
        if val is not None:
            item[field] = val

    table.put_item(Item=item)
    logger.info("Upserted %s for user %s", stock["symbol"], user_id)


def update_upload_status(
    table_name: str,
    upload_id: str,
    user_id: str,
    s3_key: str,
    status: str,
    extracted_stocks: int = 0,
) -> None:
    """Create or update an upload tracking record."""
    table = ddb.Table(table_name)
    table.put_item(Item={
        "upload_id": upload_id,
        "user_id": user_id,
        "s3_key": s3_key,
        "ocr_status": status,
        "extracted_stocks": extracted_stocks,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Upload %s status: %s", upload_id, status)

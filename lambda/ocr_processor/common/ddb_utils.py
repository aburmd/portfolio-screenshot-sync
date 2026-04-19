"""DynamoDB utility functions."""
import logging
from datetime import datetime, timezone
from decimal import Decimal

import boto3

logger = logging.getLogger(__name__)
ddb = boto3.resource("dynamodb")


def upsert_portfolio_item(table_name: str, user_id: str, stock: dict, platform: str) -> None:
    """Upsert a stock record. PK=user_id, SK=stock_name (always unique per stock)."""
    table = ddb.Table(table_name)
    stock_name = stock["stock_name"]
    symbol = stock.get("symbol", "UNKNOWN")

    table.put_item(Item={
        "user_id": user_id,
        "stock_name": stock_name,
        "symbol": symbol,
        "quantity": Decimal(str(stock["quantity"])),
        "avg_buy_price": Decimal(str(stock["avg_buy_price"])),
        "platform_name": platform,
        "uploaded_date": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Upserted %s (%s) for user %s", stock_name, symbol, user_id)


def update_upload_status(table_name: str, upload_id: str, user_id: str,
                         s3_key: str, status: str, extracted_stocks: int = 0) -> None:
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

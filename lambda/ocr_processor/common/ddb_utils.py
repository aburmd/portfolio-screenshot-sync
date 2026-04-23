"""DynamoDB utility functions."""
import logging
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)
ddb = boto3.resource("dynamodb")


def upsert_portfolio_item(table_name: str, user_id: str, stock: dict, platform: str) -> None:
    """Upsert a stock record. PK=user_id, SK=stock_name.
    
    Dedup: if symbol is known (not UNKNOWN), find any existing record with the
    same symbol for this user and delete it before inserting — prevents duplicates
    from OCR variations like 'Adobe Systems Incorporat.' vs 'Adobe Systems Incorporated'.
    """
    table = ddb.Table(table_name)
    stock_name = stock["stock_name"]
    symbol = stock.get("symbol", "UNKNOWN")

    # Dedup by symbol: if known symbol, remove any existing entry with same symbol but different name
    if symbol != "UNKNOWN":
        resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
        for existing in resp.get("Items", []):
            if existing.get("symbol") == symbol and existing["stock_name"] != stock_name:
                table.delete_item(Key={"user_id": user_id, "stock_name": existing["stock_name"]})
                logger.info("Dedup: deleted old entry '%s' for symbol %s", existing["stock_name"], symbol)

    item = {
        "user_id": user_id,
        "stock_name": stock_name,
        "symbol": symbol,
        "quantity": Decimal(str(stock["quantity"])),
        "avg_buy_price": Decimal(str(stock["avg_buy_price"])),
        "platform_name": platform,
        "currency": stock.get("currency", "USD"),
        "uploaded_date": datetime.now(timezone.utc).isoformat(),
    }

    # Store current_price if provided (from Robinhood market_value view or manual edit)
    if stock.get("current_price"):
        item["current_price"] = Decimal(str(stock["current_price"]))

    # Robinhood merge: if this is a return_pct view, look up existing record for current_price
    if stock.get("robinhood_view") == "return_pct" and stock.get("return_pct") is not None:
        existing = _get_portfolio_item(table_name, user_id, stock_name)
        if existing and existing.get("current_price"):
            cur_price = float(existing["current_price"])
            return_pct = stock["return_pct"]
            avg = cur_price / (1 + return_pct / 100)
            item["avg_buy_price"] = Decimal(str(round(avg, 2)))
            item["current_price"] = existing["current_price"]
            logger.info("Robinhood merge: %s cur=%.2f ret=%.2f%% -> avg=%.2f",
                        symbol, cur_price, return_pct, avg)
        else:
            logger.warning("Robinhood return view for %s but no market_value data yet", symbol)

    # Robinhood merge: if this is market_value view and existing has return_pct pending
    if stock.get("robinhood_view") == "market_value" and stock.get("current_price"):
        existing = _get_portfolio_item(table_name, user_id, stock_name)
        if existing and existing.get("return_pct") is not None:
            return_pct = float(existing["return_pct"])
            cur_price = stock["current_price"]
            avg = cur_price / (1 + return_pct / 100)
            item["avg_buy_price"] = Decimal(str(round(avg, 2)))
            logger.info("Robinhood merge (reverse): %s cur=%.2f ret=%.2f%% -> avg=%.2f",
                        symbol, cur_price, return_pct, avg)

    # Store return_pct temporarily for merge
    if stock.get("return_pct") is not None:
        item["return_pct"] = Decimal(str(stock["return_pct"]))

    # For Robinhood: use update_item to avoid overwriting fields from the other view
    if stock.get("robinhood_view"):
        update_expr = "SET symbol=:sym, quantity=:qty, platform_name=:plat, currency=:cur, uploaded_date=:dt"
        expr_vals = {
            ":sym": item["symbol"],
            ":qty": item["quantity"],
            ":plat": item["platform_name"],
            ":cur": item.get("currency", "USD"),
            ":dt": item["uploaded_date"],
        }
        if stock.get("robinhood_view") == "market_value" and stock.get("current_price"):
            update_expr += ", current_price=:cp"
            expr_vals[":cp"] = Decimal(str(stock["current_price"]))
            if stock.get("market_value"):
                update_expr += ", market_value=:mv"
                expr_vals[":mv"] = Decimal(str(stock["market_value"]))
        if stock.get("return_pct") is not None:
            update_expr += ", return_pct=:rp"
            expr_vals[":rp"] = Decimal(str(stock["return_pct"]))
        if item.get("avg_buy_price") and float(item["avg_buy_price"]) > 0:
            update_expr += ", avg_buy_price=:avg"
            expr_vals[":avg"] = item["avg_buy_price"]

        table.update_item(
            Key={"user_id": user_id, "stock_name": stock_name},
            UpdateExpression=update_expr,
            ExpressionAttributeValues=expr_vals,
        )
        logger.info("Updated (Robinhood %s) %s (%s) for user %s", stock.get("robinhood_view"), stock_name, symbol, user_id)
        return

    table.put_item(Item=item)
    logger.info("Upserted %s (%s) for user %s", stock_name, symbol, user_id)


def _get_portfolio_item(table_name: str, user_id: str, stock_name: str) -> dict | None:
    """Get a single portfolio item."""
    table = ddb.Table(table_name)
    resp = table.get_item(Key={"user_id": user_id, "stock_name": stock_name})
    return resp.get("Item")


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

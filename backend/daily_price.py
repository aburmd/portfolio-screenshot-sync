"""Scheduled Lambda: capture daily closing prices for all users' stocks.
Triggered by EventBridge at 8 PM EST (1 AM UTC) Mon-Fri.
"""
import os
from datetime import date
from decimal import Decimal

import boto3
import yfinance as yf
from boto3.dynamodb.conditions import Key

REGION = os.environ.get("AWS_REGION", "us-west-1")
PORTFOLIO_TABLE = os.environ.get("PORTFOLIO_TABLE", "portfolio-holdings-dev")
DAILY_PRICES_TABLE = os.environ.get("DAILY_PRICES_TABLE", "portfolio-daily-prices-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


def handler(event, context):
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    dp_table = ddb.Table(DAILY_PRICES_TABLE)
    today = date.today().isoformat()

    # Scan all holdings (all users)
    items = []
    resp = holdings_table.scan()
    items.extend(resp.get("Items", []))
    while resp.get("LastEvaluatedKey"):
        resp = holdings_table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))

    # Skip cache records and UNKNOWN symbols
    items = [i for i in items if i["user_id"] != "__cache__" and i.get("symbol", "UNKNOWN") != "UNKNOWN"]

    # Collect unique symbols by currency
    usd_syms = set()
    inr_syms = set()
    for item in items:
        sym = item["symbol"]
        if item.get("currency") == "INR":
            inr_syms.add(sym)
        else:
            usd_syms.add(sym)

    # Fetch prices in batch
    all_yf = list(usd_syms) + [f"{s}.NS" for s in inr_syms]
    prices = {}
    if all_yf:
        try:
            tickers = yf.Tickers(" ".join(all_yf))
            for sym in usd_syms:
                try:
                    info = tickers.tickers[sym].fast_info
                    prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
                except Exception:
                    pass
            for sym in inr_syms:
                try:
                    info = tickers.tickers[f"{sym}.NS"].fast_info
                    prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
                except Exception:
                    pass
        except Exception as e:
            print(f"Yahoo Finance batch fetch failed: {e}")

    # Write daily records — aggregate by (user_id, symbol) to avoid duplicate keys
    from collections import defaultdict
    agg = defaultdict(lambda: {"qty": 0, "currency": "USD", "platform": "unknown"})
    for item in items:
        sym = item["symbol"]
        if sym == "WALLETBALANCE":
            continue
        price = prices.get(sym)
        if not price:
            continue
        qty = float(item.get("quantity", 0))
        if qty <= 0:
            continue
        key = (item["user_id"], sym)
        agg[key]["qty"] += qty
        agg[key]["currency"] = item.get("currency", "USD")
        agg[key]["platform"] = item.get("platform_name", "unknown")

    written = 0
    with dp_table.batch_writer() as batch:
        for (uid, sym), data in agg.items():
            price = prices.get(sym, 0)
            batch.put_item(Item={
                "user_id": uid,
                "symbol_date": f"{sym}#{today}",
                "symbol": sym,
                "date": today,
                "close_price": Decimal(str(price)),
                "quantity": Decimal(str(round(data["qty"], 6))),
                "currency": data["currency"],
                "platform": data["platform"],
                "value": Decimal(str(round(data["qty"] * price, 2))),
            })
            written += 1

    users = len(set(i["user_id"] for i in items))
    print(f"Daily price capture: {users} users, {len(prices)} symbols priced, {written} records written")
    return {"users": users, "symbols": len(prices), "records": written}

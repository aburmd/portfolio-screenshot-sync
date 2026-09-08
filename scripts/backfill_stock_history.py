"""Backfill stock OHLC history into portfolio-stock-history-dev.

Pulls max available history from Yahoo Finance (up to 20+ years).
Loads most recent 5000 daily records per stock into DDB.
If Yahoo has less than 5000, loads whatever is available.

Usage:
  python scripts/backfill_stock_history.py --symbol CRDO --market US   # single stock
  python scripts/backfill_stock_history.py --market US                  # all US stocks
  python scripts/backfill_stock_history.py --market IN                  # all India stocks
  python scripts/backfill_stock_history.py --dry-run --symbol CRDO      # preview only
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf

REGION = "us-west-1"
HISTORY_TABLE = "portfolio-stock-history-dev"
INDEX_TABLE = "portfolio-index-constituents-dev"
DAILY_CAP = 5000

ddb = boto3.resource("dynamodb", region_name=REGION)


def get_all_symbols(market):
    table = ddb.Table(INDEX_TABLE)
    symbols = {}
    indexes = ["SP500", "NASDAQ100", "CUSTOM_US"] if market == "US" else ["NIFTY500", "CUSTOM_IN"]
    for index_name in indexes:
        resp = table.query(KeyConditionExpression=Key("index_name").eq(index_name))
        for item in resp.get("Items", []):
            symbols[item["symbol"]] = item.get("sector", "")
    return symbols


def get_existing_dates(history_table, pk):
    """Return set of daily SK dates already in DDB for this stock."""
    existing = set()
    kwargs = {
        "KeyConditionExpression": Key("market_symbol").eq(pk) & Key("date").begins_with("2"),
        "ProjectionExpression": "#d",
        "ExpressionAttributeNames": {"#d": "date"},
    }
    while True:
        resp = history_table.query(**kwargs)
        for item in resp.get("Items", []):
            existing.add(item["date"])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return existing


def backfill_symbol(sym, market, dry_run=False, overwrite=False):
    yf_sym = f"{sym}.NS" if market == "IN" else sym
    history_table = ddb.Table(HISTORY_TABLE)
    pk = f"{market}#{sym}"

    try:
        t = yf.Ticker(yf_sym)
        hist = t.history(period="max")
    except Exception as e:
        print(f"  {sym}: yfinance error — {e}")
        return 0

    if hist is None or hist.empty:
        print(f"  {sym}: no data from yfinance")
        return 0

    if len(hist) > DAILY_CAP:
        hist = hist.iloc[-DAILY_CAP:]

    existing_dates = get_existing_dates(history_table, pk)
    rows = []
    for idx, row in hist.iterrows():
        date_str = idx.strftime("%Y-%m-%d")
        if date_str in existing_dates and not overwrite:
            continue
        try:
            item = {
                "market_symbol": pk,
                "date": date_str,
                "open": Decimal(str(round(float(row["Open"]), 2))),
                "high": Decimal(str(round(float(row["High"]), 2))),
                "low": Decimal(str(round(float(row["Low"]), 2))),
                "close": Decimal(str(round(float(row["Close"]), 2))),
                "volume": Decimal(str(int(row["Volume"]))),
            }
            rows.append(item)
        except Exception:
            continue

    if dry_run:
        print(f"  {sym}: {len(hist)} yf rows, {len(existing_dates)} existing, {len(rows)} to write (dry-run)")
        return len(rows)

    # Batch write
    written = 0
    with history_table.batch_writer() as batch:
        for item in rows:
            batch.put_item(Item=item)
            written += 1

    # Update AGG record with long-term lookbacks
    all_dates = sorted(existing_dates | {r["date"] for r in rows})
    total = len(all_dates)
    agg = {"market_symbol": pk, "date": "AGG", "last_updated": datetime.now(timezone.utc).isoformat()}
    close_series = {idx.strftime("%Y-%m-%d"): float(row["Close"]) for idx, row in hist.iterrows()}

    for key, trading_days in {"close_1d": 1, "close_3d": 3, "close_1w": 5, "close_3w": 15,
                               "close_1m": 22, "close_3m": 66, "close_6m": 132,
                               "close_1y": 252, "close_3y": 756, "close_5y": 1260}.items():
        if total > trading_days:
            ref_date = all_dates[-(trading_days + 1)]
            # Try from yfinance hist first, else fetch from DDB
            if ref_date in close_series:
                agg[key] = Decimal(str(round(close_series[ref_date], 2)))
            else:
                ref_item = history_table.get_item(Key={"market_symbol": pk, "date": ref_date}).get("Item")
                if ref_item and ref_item.get("close"):
                    agg[key] = ref_item["close"]

    history_table.put_item(Item=agg)
    print(f"  {sym}: {len(hist)} yf rows, {len(existing_dates)} existing, {written} written, AGG updated ({total} total daily)")
    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", help="Single symbol to backfill")
    parser.add_argument("--market", default="US", choices=["US", "IN"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing records (use to add volume to old records)")
    args = parser.parse_args()

    if args.symbol:
        symbols = {args.symbol: ""}
    else:
        print(f"Loading {args.market} index symbols...")
        symbols = get_all_symbols(args.market)
        print(f"Found {len(symbols)} symbols")

    total_written = 0
    for i, (sym, _) in enumerate(symbols.items()):
        if len(symbols) > 1 and (i + 1) % 50 == 0:
            print(f"[{i+1}/{len(symbols)}] written so far: {total_written}")
        written = backfill_symbol(sym, args.market, dry_run=args.dry_run, overwrite=args.overwrite)
        total_written += written

    print(f"\nDone. Total records written: {total_written}")


if __name__ == "__main__":
    main()

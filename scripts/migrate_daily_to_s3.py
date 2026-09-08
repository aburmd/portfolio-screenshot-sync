"""Migrate daily OHLCV records from DDB (portfolio-stock-history-dev) to S3 Parquet.

S3 path: ohlcv/{market}/{symbol}/daily.parquet
- Exactly 5000 rows max (trim oldest if more)
- Non-destructive: DDB records are NOT deleted
- Skips symbols that already have an up-to-date S3 file (unless --overwrite)

Usage:
  python scripts/migrate_daily_to_s3.py --market US
  python scripts/migrate_daily_to_s3.py --market IN
  python scripts/migrate_daily_to_s3.py --symbol CRDO --market US
  python scripts/migrate_daily_to_s3.py --dry-run --market US
"""

import argparse
import io
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import pandas as pd

REGION        = "us-west-1"
HISTORY_TABLE = "portfolio-stock-history-dev"
INDEX_TABLE   = "portfolio-index-constituents-dev"
S3_BUCKET     = "portfolio-screenshots-dev"   # reuse existing bucket (ohlcv/ prefix)
DAILY_CAP     = 5000

ddb = boto3.resource("dynamodb", region_name=REGION)
s3  = boto3.client("s3", region_name=REGION)


def get_all_symbols(market):
    table   = ddb.Table(INDEX_TABLE)
    symbols = {}
    indexes = ["SP500", "NASDAQ100", "CUSTOM_US"] if market == "US" else ["NIFTY500", "CUSTOM_IN"]
    for index_name in indexes:
        resp = table.query(KeyConditionExpression=Key("index_name").eq(index_name))
        for item in resp.get("Items", []):
            symbols[item["symbol"]] = item.get("sector", "")
    return symbols


def fetch_daily_from_ddb(market, symbol):
    """Return list of daily OHLCV dicts sorted oldest→newest."""
    table = ddb.Table(HISTORY_TABLE)
    pk    = f"{market}#{symbol}"
    rows  = []

    kwargs = {
        "KeyConditionExpression": Key("market_symbol").eq(pk) & Key("date").begins_with("2"),
        "ProjectionExpression": "#d, #o, high, low, #c, volume",
        "ExpressionAttributeNames": {"#d": "date", "#o": "open", "#c": "close"},
    }
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            rows.append({
                "date":   item["date"],
                "open":   float(item["open"])   if item.get("open")   else None,
                "high":   float(item["high"])   if item.get("high")   else None,
                "low":    float(item["low"])    if item.get("low")    else None,
                "close":  float(item["close"])  if item.get("close")  else None,
                "volume": int(item["volume"])   if item.get("volume") else 0,
            })
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    rows.sort(key=lambda x: x["date"])
    return rows


def s3_key(market, symbol):
    return f"ohlcv/{market}/{symbol}/daily.parquet"


def s3_file_exists(market, symbol):
    try:
        s3.head_object(Bucket=S3_BUCKET, Key=s3_key(market, symbol))
        return True
    except s3.exceptions.ClientError:
        return False
    except Exception:
        return False


def write_parquet_to_s3(market, symbol, rows):
    """Trim to DAILY_CAP, write as Parquet to S3."""
    if len(rows) > DAILY_CAP:
        rows = rows[-DAILY_CAP:]

    df  = pd.DataFrame(rows)
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, engine="pyarrow")
    buf.seek(0)

    s3.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key(market, symbol),
        Body=buf.getvalue(),
        ContentType="application/octet-stream",
    )
    return len(rows)


def migrate_symbol(market, symbol, dry_run=False, overwrite=False):
    rows = fetch_daily_from_ddb(market, symbol)
    if not rows:
        print(f"  {symbol}: no daily records in DDB — skip")
        return 0

    if not overwrite and s3_file_exists(market, symbol):
        print(f"  {symbol}: S3 file exists — skip (use --overwrite to force)")
        return 0

    n = min(len(rows), DAILY_CAP)
    if dry_run:
        print(f"  {symbol}: {len(rows)} DDB rows → would write {n} rows to s3://{S3_BUCKET}/{s3_key(market, symbol)}")
        return n

    written = write_parquet_to_s3(market, symbol, rows)
    print(f"  {symbol}: {len(rows)} DDB rows → {written} rows written to S3")
    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol",    help="Single symbol to migrate")
    parser.add_argument("--market",    default="US", choices=["US", "IN"])
    parser.add_argument("--dry-run",   action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing S3 files")
    args = parser.parse_args()

    if args.symbol:
        symbols = {args.symbol: ""}
    else:
        print(f"Loading {args.market} index symbols...")
        symbols = get_all_symbols(args.market)
        print(f"Found {len(symbols)} symbols")

    total = 0
    for i, (sym, _) in enumerate(symbols.items()):
        if len(symbols) > 1 and (i + 1) % 50 == 0:
            print(f"[{i+1}/{len(symbols)}] rows written so far: {total}")
        total += migrate_symbol(args.market, sym, dry_run=args.dry_run, overwrite=args.overwrite)

    print(f"\nDone. Total rows written: {total}")


if __name__ == "__main__":
    main()

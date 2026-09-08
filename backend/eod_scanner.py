"""EOD Scanner Lambda.

For each daily_enabled symbol in portfolio-universe-dev:
  1. Fetch today's OHLCV bar from yfinance
  2. Read existing S3 csv.gz, append new row, trim to 5000, write back
  3. Update DDB AGG record with latest close + long-term lookbacks

Triggered by EventBridge after market close:
  US:  1:00 AM UTC Tue-Sat  (8 PM EST Mon-Fri)
  IN:  2:30 PM UTC Mon-Fri  (8 PM IST)

Event payload: {"market": "US"} or {"market": "IN"}
"""

import csv
import gzip
import io
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf

REGION        = os.environ.get("AWS_REGION", "us-west-1")
UNIVERSE_TABLE = os.environ.get("UNIVERSE_TABLE", "portfolio-universe-dev")
HISTORY_TABLE  = os.environ.get("STOCK_HISTORY_TABLE", "portfolio-stock-history-dev")
OHLCV_BUCKET   = os.environ.get("SCREENSHOTS_BUCKET", "portfolio-screenshots-dev")
DAILY_CAP      = 5000

ddb = boto3.resource("dynamodb", region_name=REGION)
s3  = boto3.client("s3", region_name=REGION)

FIELDNAMES = ["date", "open", "high", "low", "close", "volume"]

# Long-term AGG lookback trading-day offsets
AGG_LOOKBACKS = {
    "close_1d": 1, "close_3d": 3, "close_1w": 5, "close_3w": 15,
    "close_1m": 22, "close_3m": 66, "close_6m": 132,
    "close_1y": 252, "close_3y": 756, "close_5y": 1260,
}


# ── S3 helpers ────────────────────────────────────────────────────────────────

def _s3_key(market, symbol):
    return f"ohlcv/{market}/{symbol}/daily.csv.gz"


def _read_s3(market, symbol):
    """Read existing csv.gz from S3. Returns list of row dicts (oldest→newest)."""
    try:
        obj = s3.get_object(Bucket=OHLCV_BUCKET, Key=_s3_key(market, symbol))
        with gzip.open(io.BytesIO(obj["Body"].read()), "rt") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _write_s3(market, symbol, rows):
    """Write rows as csv.gz to S3."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        writer = csv.DictWriter(
            io.TextIOWrapper(gz, write_through=True),
            fieldnames=FIELDNAMES,
        )
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    s3.put_object(
        Bucket=OHLCV_BUCKET,
        Key=_s3_key(market, symbol),
        Body=buf.getvalue(),
        ContentType="application/gzip",
    )


# ── DDB AGG helper ────────────────────────────────────────────────────────────

def _update_agg(market, symbol, rows):
    """Recompute AGG record from the full rows list and write to DDB."""
    table = ddb.Table(HISTORY_TABLE)
    pk    = f"{market}#{symbol}"
    total = len(rows)
    agg   = {
        "market_symbol": pk,
        "date": "AGG",
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    for key, offset in AGG_LOOKBACKS.items():
        if total > offset:
            ref_close = rows[-(offset + 1)]["close"]
            if ref_close:
                agg[key] = Decimal(str(round(float(ref_close), 2)))
    table.put_item(Item=agg)


# ── Universe query ────────────────────────────────────────────────────────────

def _get_daily_symbols(market):
    table = ddb.Table(UNIVERSE_TABLE)
    symbols = []
    kwargs = {"KeyConditionExpression": Key("market").eq(market)}
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            if item.get("daily_enabled"):
                symbols.append(item["symbol"])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return symbols


# ── Per-symbol update ─────────────────────────────────────────────────────────

def _process_symbol(market, symbol):
    yf_sym = f"{symbol}.NS" if market == "IN" else symbol
    try:
        hist = yf.Ticker(yf_sym).history(period="2d")
    except Exception as e:
        print(f"  {symbol}: yfinance error — {e}")
        return False

    if hist is None or hist.empty:
        print(f"  {symbol}: no data")
        return False

    # Use the last row (most recent trading day)
    idx = hist.index[-1]
    row = hist.iloc[-1]
    today_str = idx.strftime("%Y-%m-%d")

    new_row = {
        "date":   today_str,
        "open":   round(float(row["Open"]),   2),
        "high":   round(float(row["High"]),   2),
        "low":    round(float(row["Low"]),    2),
        "close":  round(float(row["Close"]),  2),
        "volume": int(row["Volume"]),
    }

    # Read existing, skip if today already present
    rows = _read_s3(market, symbol)
    if rows and rows[-1]["date"] == today_str:
        return False  # already written today

    rows.append(new_row)

    # Trim to cap
    if len(rows) > DAILY_CAP:
        rows = rows[-DAILY_CAP:]

    _write_s3(market, symbol, rows)
    _update_agg(market, symbol, rows)
    return True


# ── Lambda handler ────────────────────────────────────────────────────────────

def handler(event, context):
    market = event.get("market", "US").upper()
    print(f"=== EOD Scanner: {market} ===")

    symbols = _get_daily_symbols(market)
    print(f"daily_enabled symbols: {len(symbols)}")

    updated, skipped, errors = 0, 0, 0
    for i, sym in enumerate(symbols):
        if (i + 1) % 100 == 0:
            print(f"  [{i+1}/{len(symbols)}] updated={updated} skipped={skipped} errors={errors}")
        try:
            if _process_symbol(market, sym):
                updated += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  {sym}: unexpected error — {e}")
            errors += 1

    print(f"EOD Scanner done: {updated} updated, {skipped} skipped, {errors} errors")
    return {"market": market, "updated": updated, "skipped": skipped, "errors": errors}

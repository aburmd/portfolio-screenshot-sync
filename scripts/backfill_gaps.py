"""Backfill missing daily bars for all daily_enabled symbols.

Always fetches last 30 days from yfinance and fills any holes in S3.
This handles gaps in the middle (not just missing tail bars).
"""
import csv
import gzip
import io
import time
from datetime import date, timedelta

import boto3
import yfinance as yf

REGION         = "us-west-1"
UNIVERSE_TABLE = "portfolio-universe-dev"
OHLCV_BUCKET   = "portfolio-screenshots-dev"
DAILY_CAP      = 5000
FIELDNAMES     = ["date", "open", "high", "low", "close", "volume"]

ddb = boto3.resource("dynamodb", region_name=REGION)
s3  = boto3.client("s3", region_name=REGION)

yesterday   = (date.today() - timedelta(days=1)).isoformat()
fetch_start = (date.today() - timedelta(days=30)).isoformat()


def _s3_key(market, symbol):
    return f"ohlcv/{market}/{symbol}/daily.csv.gz"


def _read_s3(market, symbol):
    try:
        obj = s3.get_object(Bucket=OHLCV_BUCKET, Key=_s3_key(market, symbol))
        with gzip.open(io.BytesIO(obj["Body"].read()), "rt") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


def _write_s3(market, symbol, rows):
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


def _get_all_symbols():
    table = ddb.Table(UNIVERSE_TABLE)
    symbols = []
    kwargs = {}
    while True:
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            if item.get("daily_enabled"):
                symbols.append((item["market"], item["symbol"]))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return symbols


def backfill(market, symbol):
    rows = _read_s3(market, symbol)
    existing = {r["date"] for r in rows}

    yf_sym = f"{symbol}.NS" if market == "IN" else symbol
    try:
        hist = yf.Ticker(yf_sym).history(start=fetch_start, end=date.today().isoformat())
    except Exception as e:
        return f"error: {e}"

    if hist is None or hist.empty:
        return "no_data"

    added = 0
    for idx, row in hist.iterrows():
        d = idx.strftime("%Y-%m-%d")
        if d not in existing and d <= yesterday:
            rows.append({
                "date":   d,
                "open":   round(float(row["Open"]),   2),
                "high":   round(float(row["High"]),   2),
                "low":    round(float(row["Low"]),    2),
                "close":  round(float(row["Close"]),  2),
                "volume": int(row["Volume"]),
            })
            added += 1

    if added == 0:
        return "skip"

    rows.sort(key=lambda r: r["date"])
    if len(rows) > DAILY_CAP:
        rows = rows[-DAILY_CAP:]
    _write_s3(market, symbol, rows)
    return f"+{added}"


def main():
    symbols = _get_all_symbols()
    total = len(symbols)
    print(f"Backfilling {total} symbols (checking last 30 days for gaps, up to {yesterday})...")

    updated = skipped = errors = 0
    for i, (market, sym) in enumerate(symbols, 1):
        result = backfill(market, sym)
        if result == "skip":
            skipped += 1
        elif result.startswith("+"):
            updated += 1
            print(f"  [{i}/{total}] {market}:{sym} {result} bars")
        else:
            errors += 1
            print(f"  [{i}/{total}] {market}:{sym} ⚠ {result}")

        if i % 50 == 0:
            print(f"--- [{i}/{total}] updated={updated} skipped={skipped} errors={errors} ---")
        time.sleep(0.1)

    print(f"\nDone: {updated} updated, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()

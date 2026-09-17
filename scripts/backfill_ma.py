"""
Backfill MA50/MA150/MA200 into all S3 OHLCV csv.gz files.

Reads each file, computes MAs, rewrites with new columns.
Run once: python scripts/backfill_ma.py [--market US|IN]
"""
import argparse
import csv
import gzip
import io
import sys
import boto3
from boto3.dynamodb.conditions import Key
from concurrent.futures import ThreadPoolExecutor, as_completed

REGION         = "us-west-1"
BUCKET         = "portfolio-screenshots-dev"
UNIVERSE_TABLE = "portfolio-universe-dev"
FIELDNAMES     = ["date", "open", "high", "low", "close", "volume", "ma50", "ma150", "ma200"]

s3  = boto3.client("s3", region_name=REGION)
ddb = boto3.resource("dynamodb", region_name=REGION)


def get_symbols(market):
    table = ddb.Table(UNIVERSE_TABLE)
    symbols, kwargs = [], {"KeyConditionExpression": Key("market").eq(market)}
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            if item.get("daily_enabled"):
                symbols.append(item["symbol"])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return symbols


def compute_mas(rows):
    closes = [float(r["close"]) for r in rows]
    for i, r in enumerate(rows):
        r["ma50"]  = round(sum(closes[i-49:i+1])  / 50,  2) if i >= 49  else ""
        r["ma150"] = round(sum(closes[i-149:i+1]) / 150, 2) if i >= 149 else ""
        r["ma200"] = round(sum(closes[i-199:i+1]) / 200, 2) if i >= 199 else ""


def process(market, symbol):
    key = f"ohlcv/{market}/{symbol}/daily.csv.gz"
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        with gzip.open(io.BytesIO(obj["Body"].read()), "rt") as f:
            rows = list(csv.DictReader(f))
    except Exception as e:
        return symbol, f"read error: {e}"

    if not rows:
        return symbol, "empty"

    compute_mas(rows)

    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        writer = csv.DictWriter(
            io.TextIOWrapper(gz, write_through=True),
            fieldnames=FIELDNAMES, extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    s3.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue(), ContentType="application/gzip")
    return symbol, "ok"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", default="US")
    args = parser.parse_args()
    market = args.market.upper()

    symbols = get_symbols(market)
    print(f"{market}: {len(symbols)} symbols to backfill")

    ok = errors = 0
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(process, market, sym): sym for sym in symbols}
        for i, fut in enumerate(as_completed(futures), 1):
            sym, status = fut.result()
            if status == "ok":
                ok += 1
            else:
                errors += 1
                print(f"  {sym}: {status}")
            if i % 100 == 0:
                print(f"  [{i}/{len(symbols)}] ok={ok} errors={errors}")

    print(f"Done: {ok} ok, {errors} errors")


if __name__ == "__main__":
    main()

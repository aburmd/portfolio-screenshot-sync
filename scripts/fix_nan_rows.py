"""
Fix bad nan rows in S3 OHLCV files:
1. Remove any trailing rows where close is nan/empty
2. Re-fetch missing dates from yfinance (Sep 17 + Sep 18)
3. Recompute MAs and write back

Run: python3 scripts/fix_nan_rows.py
"""
import boto3, gzip, io, csv, math, sys
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

REGION  = "us-west-1"
BUCKET  = "portfolio-screenshots-dev"
FIELDNAMES = ["date", "open", "high", "low", "close", "volume", "ma50", "ma150", "ma200"]

s3  = boto3.client("s3", region_name=REGION)
ddb = boto3.resource("dynamodb", region_name=REGION)


def get_symbols():
    from boto3.dynamodb.conditions import Key
    table = ddb.Table("portfolio-universe-dev")
    symbols, kwargs = [], {"KeyConditionExpression": Key("market").eq("US")}
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            if item.get("daily_enabled"):
                symbols.append(item["symbol"])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return symbols


def is_bad(row):
    v = row.get("close", "")
    if not v or v in ("nan", "NaN", ""):
        return True
    try:
        return math.isnan(float(v))
    except:
        return True


def compute_mas(rows):
    import math
    closes = []
    for r in rows:
        try:
            v = float(r["close"])
            closes.append(v if not math.isnan(v) else None)
        except (ValueError, TypeError):
            closes.append(None)
    for i, r in enumerate(rows):
        c = closes[i]
        if c is None:
            r["ma50"] = r["ma150"] = r["ma200"] = ""
            continue
        for period, col in [(50, "ma50"), (150, "ma150"), (200, "ma200")]:
            if i >= period - 1:
                window = [v for v in closes[i-period+1:i+1] if v is not None]
                r[col] = round(sum(window) / len(window), 2) if len(window) == period else ""
            else:
                r[col] = ""


def write_s3(symbol, rows):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        writer = csv.DictWriter(
            io.TextIOWrapper(gz, write_through=True),
            fieldnames=FIELDNAMES, extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
    buf.seek(0)
    s3.put_object(Bucket=BUCKET, Key=f"ohlcv/US/{symbol}/daily.csv.gz",
                  Body=buf.getvalue(), ContentType="application/gzip")


def process(symbol):
    import yfinance as yf

    key = f"ohlcv/US/{symbol}/daily.csv.gz"
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        rows = list(csv.DictReader(gzip.open(io.BytesIO(obj["Body"].read()), "rt")))
    except:
        return symbol, "s3_missing"

    # Strip trailing nan rows
    while rows and is_bad(rows[-1]):
        rows.pop()

    if not rows:
        return symbol, "all_nan"

    # Find what dates we need to fill up to yesterday
    last_date = rows[-1]["date"]
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    if last_date >= yesterday:
        # MAs already good, just recompute to be safe
        compute_mas(rows)
        write_s3(symbol, rows)
        return symbol, "ok_no_fetch"

    # Fetch missing bars from yfinance
    try:
        hist = yf.Ticker(symbol).history(start=last_date, end=date.today().isoformat())
    except Exception as e:
        return symbol, f"yf_error:{e}"

    if hist is not None and not hist.empty:
        existing = {r["date"] for r in rows}
        for idx, row in hist.iterrows():
            d = idx.strftime("%Y-%m-%d")
            if d in existing or d > yesterday:
                continue
            close_val = float(row["Close"])
            if math.isnan(close_val) or close_val <= 0:
                continue
            rows.append({
                "date":   d,
                "open":   round(float(row["Open"]),   2),
                "high":   round(float(row["High"]),   2),
                "low":    round(float(row["Low"]),    2),
                "close":  round(close_val,            2),
                "volume": int(row["Volume"]),
            })
        rows.sort(key=lambda r: r["date"])

    compute_mas(rows)
    write_s3(symbol, rows)
    return symbol, f"fixed→{rows[-1]['date']}"


def main():
    symbols = get_symbols()
    print(f"Processing {len(symbols)} symbols...")

    ok = errors = 0
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(process, sym): sym for sym in symbols}
        for i, fut in enumerate(as_completed(futures), 1):
            sym, status = fut.result()
            if "error" in status or "missing" in status or "nan" in status:
                errors += 1
                print(f"  {sym}: {status}")
            else:
                ok += 1
            if i % 100 == 0:
                print(f"  [{i}/{len(symbols)}] ok={ok} errors={errors}")

    print(f"\nDone: {ok} ok, {errors} errors")


if __name__ == "__main__":
    main()

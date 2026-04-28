"""Earnings Screener Lambda.

Scheduled daily after market close (US + India).
1. Fetch earnings calendar from Alpha Vantage
2. Filter to stocks in our index universe (S&P 500, Nasdaq 100, Nifty 500)
3. For ALL stocks that reported in last 7 days: get price change, basic fundamentals
4. Store in DDB — UI applies filters (drop %, P/E, op income, etc.)
5. Track cumulative drop for 7 days post-earnings, then expire
"""

import os
import json
import csv
import io
import base64
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf
import requests

REGION = os.environ.get("AWS_REGION", "us-west-1")
SCREENER_TABLE = os.environ.get("SCREENER_TABLE", "portfolio-screener-dev")
INDEX_TABLE = os.environ.get("INDEX_CONSTITUENTS_TABLE", "portfolio-index-constituents-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


def get_api_key(provider):
    ssm = boto3.client("ssm", region_name="us-east-1")
    resp = ssm.get_parameter(Name="/portfolio/api-credentials", WithDecryption=True)
    creds = json.loads(base64.b64decode(resp["Parameter"]["Value"]))
    return creds[provider]["api_key"]


def refresh_index_constituents(market):
    table = ddb.Table(INDEX_TABLE)
    fmp_key = get_api_key("fmp")
    now = datetime.now(timezone.utc).isoformat()

    if market == "US":
        for index_name, endpoint in [("SP500", "sp500-constituent"), ("NASDAQ100", "nasdaq-constituent")]:
            resp = requests.get(f"https://financialmodelingprep.com/stable/{endpoint}?apikey={fmp_key}", timeout=15)
            data = resp.json()
            if not isinstance(data, list) or not data:
                print(f"  {index_name}: no data from FMP")
                continue
            with table.batch_writer() as batch:
                for item in data:
                    batch.put_item(Item={
                        "index_name": index_name, "symbol": item["symbol"],
                        "name": item.get("name", ""), "sector": item.get("sector", ""),
                        "updated_at": now,
                    })
            print(f"  {index_name}: {len(data)} constituents stored")
    else:
        resp = table.query(KeyConditionExpression=Key("index_name").eq("NIFTY500"), Limit=1)
        if resp.get("Items"):
            print("  NIFTY500: already populated")
        else:
            print("  NIFTY500: not populated")


def get_index_symbols(market):
    table = ddb.Table(INDEX_TABLE)
    symbols = {}
    indexes = ["SP500", "NASDAQ100"] if market == "US" else ["NIFTY500"]
    for index_name in indexes:
        resp = table.query(KeyConditionExpression=Key("index_name").eq(index_name))
        for item in resp.get("Items", []):
            symbols[item["symbol"]] = {
                "name": item.get("name", ""),
                "sector": item.get("sector", ""),
            }
    return symbols


def get_earnings_this_week(av_key):
    resp = requests.get(
        f"https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={av_key}",
        timeout=30,
    )
    reader = csv.DictReader(io.StringIO(resp.text))
    today = date.today()
    week_ago = today - timedelta(days=7)
    earnings = {}
    for row in reader:
        report_date = row.get("reportDate", "")
        if not report_date:
            continue
        try:
            rd = date.fromisoformat(report_date)
        except ValueError:
            continue
        if week_ago <= rd <= today:
            sym = row.get("symbol", "")
            if sym:
                earnings[sym] = {
                    "report_date": report_date,
                    "name": row.get("name", ""),
                    "estimate": row.get("estimate", ""),
                    "currency": row.get("currency", "USD"),
                }
    return earnings


def scan_stock(sym, earnings_info, market):
    """Get price change and basic fundamentals for one stock."""
    yf_sym = f"{sym}.NS" if market == "IN" else sym
    min_price = 50 if market == "IN" else 5

    try:
        t = yf.Ticker(yf_sym)
        info = t.info or {}

        current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
        if current_price < min_price:
            return None

        # Pre-earnings price
        report_date = date.fromisoformat(earnings_info["report_date"])
        hist = yf.download(yf_sym, start=(report_date - timedelta(days=5)).isoformat(),
                           end=report_date.isoformat(), progress=False, auto_adjust=True)
        if hist is None or hist.empty:
            return None
        if hasattr(hist.columns, "levels") and len(hist.columns.levels) > 1:
            hist.columns = hist.columns.droplevel(1)
        pre_price = float(hist["Close"].iloc[-1])
        if hasattr(pre_price, "item"):
            pre_price = pre_price.item()
        if pre_price <= 0:
            return None

        drop_pct = round((current_price - pre_price) / pre_price * 100, 2)

        return {
            "symbol": sym,
            "yf_symbol": yf_sym,
            "name": earnings_info.get("name") or info.get("longName") or info.get("shortName", sym),
            "sector": info.get("sector", ""),
            "report_date": earnings_info["report_date"],
            "estimate": earnings_info.get("estimate", ""),
            "pre_earnings_price": round(pre_price, 2),
            "current_price": round(current_price, 2),
            "day_drop": drop_pct,
            "cumulative_drop": drop_pct,
            "forward_pe": round(info["forwardPE"], 2) if info.get("forwardPE") else None,
            "trailing_pe": round(info["trailingPE"], 2) if info.get("trailingPE") else None,
            "market_cap": info.get("marketCap", 0),
            "operating_margins": round(info["operatingMargins"] * 100, 2) if info.get("operatingMargins") else None,
            "revenue_growth": round(info["revenueGrowth"] * 100, 2) if info.get("revenueGrowth") else None,
            "earnings_growth": round(info["earningsGrowth"] * 100, 2) if info.get("earningsGrowth") else None,
            "currency": "INR" if market == "IN" else "USD",
        }
    except Exception as e:
        print(f"  ❌ {sym}: {str(e)[:60]}")
        return None


def store_results(results, market):
    table = ddb.Table(SCREENER_TABLE)
    today = date.today()
    now = datetime.now(timezone.utc).isoformat()

    # Load existing
    existing_resp = table.query(KeyConditionExpression=Key("market").eq(market))
    existing = {item["symbol"]: item for item in existing_resp.get("Items", [])}

    # Expire entries older than 7 days from earnings
    for sym, item in existing.items():
        rd = item.get("report_date", "")
        try:
            if rd and (today - date.fromisoformat(rd)).days > 7:
                table.delete_item(Key={"market": market, "symbol": sym})
                print(f"  Expired: {sym}")
        except ValueError:
            pass

    # Store/update
    stored = 0
    for r in results:
        sym = r["symbol"]
        ex = existing.get(sym)
        if ex:
            # Update cumulative drop from original pre-earnings price
            pre = float(ex.get("pre_earnings_price", r["pre_earnings_price"]))
            if pre > 0:
                r["cumulative_drop"] = round((r["current_price"] - pre) / pre * 100, 2)
            r["pre_earnings_price"] = pre
            r["first_seen"] = ex.get("first_seen", today.isoformat())
        else:
            r["first_seen"] = today.isoformat()

        item = {"market": market, "symbol": sym, "last_updated": now}
        for k, v in r.items():
            if v is None:
                continue
            if isinstance(v, float):
                item[k] = Decimal(str(round(v, 6)))
            elif isinstance(v, int):
                item[k] = Decimal(str(v))
            else:
                item[k] = v
        table.put_item(Item=item)
        stored += 1

    print(f"  Stored {stored} results for {market}")


def update_existing_prices(market):
    """Update cumulative drops for existing entries (no new earnings to scan)."""
    table = ddb.Table(SCREENER_TABLE)
    existing_resp = table.query(KeyConditionExpression=Key("market").eq(market))
    updated = 0
    for item in existing_resp.get("Items", []):
        sym = item["symbol"]
        try:
            yf_sym = f"{sym}.NS" if market == "IN" else sym
            t = yf.Ticker(yf_sym)
            info = t.info or {}
            cp = info.get("currentPrice") or info.get("regularMarketPrice") or 0
            pre = float(item.get("pre_earnings_price", 0))
            if cp > 0 and pre > 0:
                cum_drop = round((cp - pre) / pre * 100, 2)
                table.update_item(
                    Key={"market": market, "symbol": sym},
                    UpdateExpression="SET current_price = :cp, cumulative_drop = :cd, last_updated = :lu",
                    ExpressionAttributeValues={
                        ":cp": Decimal(str(round(cp, 2))),
                        ":cd": Decimal(str(cum_drop)),
                        ":lu": datetime.now(timezone.utc).isoformat(),
                    },
                )
                updated += 1
        except Exception:
            pass
    print(f"  Updated {updated} existing entries for {market}")


def handler(event, context):
    market = event.get("market", "US")
    print(f"=== Earnings Screener: {market} ===")

    # Step 1: Ensure index constituents loaded
    index_symbols = get_index_symbols(market)
    if not index_symbols:
        print("No index constituents, refreshing...")
        refresh_index_constituents(market)
        index_symbols = get_index_symbols(market)
    print(f"Index universe: {len(index_symbols)} symbols")

    # Step 2: Get earnings calendar
    av_key = get_api_key("alpha_vantage")
    all_earnings = get_earnings_this_week(av_key)
    print(f"Earnings in last 7 days: {len(all_earnings)} total")

    # Step 3: Filter to our universe
    to_scan = {sym: info for sym, info in all_earnings.items() if sym in index_symbols}
    print(f"In our universe: {len(to_scan)} stocks to scan")

    if not to_scan:
        update_existing_prices(market)
        return {"market": market, "scanned": 0, "stored": 0}

    # Step 4: Scan all stocks
    results = []
    for i, (sym, info) in enumerate(to_scan.items()):
        print(f"  [{i+1}/{len(to_scan)}] {sym}...", end="")
        r = scan_stock(sym, info, market)
        if r:
            results.append(r)
            print(f" drop={r['day_drop']}%")
        else:
            print(" skipped")

    print(f"Scanned: {len(to_scan)}, stored: {len(results)}")

    # Step 5: Store
    store_results(results, market)

    # Step 6: Update existing entries not in this scan
    update_existing_prices(market)

    return {"market": market, "scanned": len(to_scan), "stored": len(results)}

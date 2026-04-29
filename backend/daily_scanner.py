"""Daily Stock Scanner Lambda.

Single daily scan for all index stocks. Stores EVERYTHING in portfolio-screener-dev.
All other features read from DDB only.

Schedule:
  US (S&P 500 + Nasdaq 100): 8 PM EST = 1:00 AM UTC (Mon-Fri)
  India (Nifty 500): 8 PM IST = 2:30 PM UTC (Mon-Fri)
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


def refresh_index_constituents(market):
    table = ddb.Table(INDEX_TABLE)
    fmp_key = get_api_key("fmp")
    now = datetime.now(timezone.utc).isoformat()
    if market == "US":
        for index_name, endpoint in [("SP500", "sp500-constituent"), ("NASDAQ100", "nasdaq-constituent")]:
            resp = requests.get(f"https://financialmodelingprep.com/stable/{endpoint}?apikey={fmp_key}", timeout=15)
            data = resp.json()
            if isinstance(data, list) and data:
                with table.batch_writer() as batch:
                    for item in data:
                        batch.put_item(Item={"index_name": index_name, "symbol": item["symbol"],
                            "name": item.get("name", ""), "sector": item.get("sector", ""), "updated_at": now})
                print(f"  {index_name}: {len(data)} constituents")
    else:
        try:
            resp = requests.get("https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv",
                timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code == 200:
                reader = csv.DictReader(io.StringIO(resp.text))
                rows = list(reader)
                with table.batch_writer() as batch:
                    for row in rows:
                        sym = row.get("Symbol", "").strip()
                        if sym:
                            batch.put_item(Item={"index_name": "NIFTY500", "symbol": sym,
                                "name": row.get("Company Name", "").strip(),
                                "sector": row.get("Industry", "").strip(), "updated_at": now})
                print(f"  NIFTY500: {len(rows)} constituents")
        except Exception as e:
            print(f"  NIFTY500: error {e}")


def scan_stock(sym, market, index_info):
    """Fetch ALL data for one stock in TWO calls: info + history."""
    yf_sym = f"{sym}.NS" if market == "IN" else sym
    min_price = 50 if market == "IN" else 5

    try:
        t = yf.Ticker(yf_sym)
        info = t.info or {}

        price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
        if price < min_price:
            return None

        # MAs from history
        hist = t.history(period="1y")
        ma50 = ma150 = ma200 = ma200_slope = high_52w = low_52w = None
        if hist is not None and len(hist) >= 50:
            close = hist["Close"]
            ma50 = round(float(close.rolling(50).mean().iloc[-1]), 2)
            if len(close) >= 150:
                ma150 = round(float(close.rolling(150).mean().iloc[-1]), 2)
            if len(close) >= 200:
                ma200 = round(float(close.rolling(200).mean().iloc[-1]), 2)
                if len(close) >= 222:
                    prev = float(close.rolling(200).mean().iloc[-22])
                    if prev > 0:
                        ma200_slope = round((ma200 - prev) / prev * 100, 2)
            high_52w = round(float(close.max()), 2)
            low_52w = round(float(close.min()), 2)

        # Trend signals
        trend_score = 0
        ma_aligned = False
        ma200_up = False
        near_high = False
        above_low = False

        if ma50 and ma150 and ma200:
            if price > ma50 > ma150 > ma200:
                trend_score += 1
                ma_aligned = True
        if ma200_slope is not None and ma200_slope > 0:
            trend_score += 1
            ma200_up = True
        pct_from_high = round((price - high_52w) / high_52w * 100, 2) if high_52w and high_52w > 0 else None
        pct_from_low = round((price - low_52w) / low_52w * 100, 2) if low_52w and low_52w > 0 else None
        if pct_from_high is not None and pct_from_high >= -25:
            near_high = True
        if pct_from_low is not None and pct_from_low >= 30:
            above_low = True
        if near_high and above_low:
            trend_score += 1

        return {
            "name": index_info.get("name") or info.get("longName") or info.get("shortName", sym),
            "sector": index_info.get("sector") or info.get("sector", ""),
            "industry": info.get("industry", ""),
            "currency": "INR" if market == "IN" else "USD",
            "current_price": round(price, 2),
            "previous_close": round(info["previousClose"], 2) if info.get("previousClose") else None,
            "ma50": ma50, "ma150": ma150, "ma200": ma200, "ma200_slope": ma200_slope,
            "high_52w": high_52w, "low_52w": low_52w,
            "pct_from_high": pct_from_high, "pct_from_low": pct_from_low,
            "trend_score": trend_score, "ma_aligned": ma_aligned,
            "ma200_up": ma200_up, "near_high": near_high, "above_low": above_low,
            "operating_margins": round(info["operatingMargins"] * 100, 2) if info.get("operatingMargins") else None,
            "revenue_growth": round(info["revenueGrowth"] * 100, 2) if info.get("revenueGrowth") else None,
            "earnings_growth": round(info["earningsGrowth"] * 100, 2) if info.get("earningsGrowth") else None,
            "forward_pe": round(info["forwardPE"], 2) if info.get("forwardPE") else None,
            "trailing_pe": round(info["trailingPE"], 2) if info.get("trailingPE") else None,
            "forward_eps": round(info["forwardEps"], 4) if info.get("forwardEps") else None,
            "trailing_eps": round(info["trailingEps"], 4) if info.get("trailingEps") else None,
            "market_cap": info.get("marketCap", 0),
        }
    except Exception:
        return None


def store_stock(table, market, sym, data, now):
    """Store complete stock record. Preserves earnings data from earnings screener."""
    item = {"market": market, "symbol": sym, "last_updated": now}

    # Preserve earnings fields if they exist
    try:
        existing = table.get_item(Key={"market": market, "symbol": sym}).get("Item")
        if existing:
            for field in ["report_date", "pre_earnings_price", "day_drop",
                          "cumulative_drop", "estimate", "first_seen"]:
                if field in existing:
                    item[field] = existing[field]
    except Exception:
        pass

    for k, v in data.items():
        if v is None:
            continue
        if isinstance(v, bool):
            item[k] = v
        elif isinstance(v, float):
            item[k] = Decimal(str(round(v, 6)))
        elif isinstance(v, int):
            item[k] = Decimal(str(v))
        else:
            item[k] = v

    table.put_item(Item=item)


def handler(event, context):
    market = event.get("market", "US")
    print(f"=== Daily Stock Scanner: {market} ===")

    index_symbols = get_index_symbols(market)
    if not index_symbols:
        print("No index constituents, refreshing...")
        refresh_index_constituents(market)
        index_symbols = get_index_symbols(market)
    print(f"Index universe: {len(index_symbols)} symbols")

    table = ddb.Table(SCREENER_TABLE)
    now = datetime.now(timezone.utc).isoformat()
    scanned = 0
    total = len(index_symbols)

    for i, (sym, info) in enumerate(index_symbols.items()):
        if (i + 1) % 100 == 0:
            print(f"  [{i+1}/{total}] scanned={scanned}")

        data = scan_stock(sym, market, info)
        if data:
            store_stock(table, market, sym, data, now)
            scanned += 1

    print(f"Daily Stock Scanner complete: {scanned}/{total} updated")
    return {"market": market, "scanned": scanned, "total": total}

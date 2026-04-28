"""Earnings Dip Screener Lambda.

Scheduled daily after market close (US + India).
1. Fetch earnings calendar from Alpha Vantage
2. Filter stocks in our index universe (S&P 500, Nasdaq 100, Nifty 500)
3. Check price drop >= 6% from pre-earnings price
4. Check operating income positive (current + next year)
5. Check revenue growth positive
6. Store qualifying stocks in DDB, track cumulative drop for 7 days
"""

import os
import json
import csv
import io
import base64
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal
from collections import defaultdict

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf
import requests

REGION = os.environ.get("AWS_REGION", "us-west-1")
SCREENER_TABLE = os.environ.get("SCREENER_TABLE", "portfolio-screener-dev")
INDEX_TABLE = os.environ.get("INDEX_CONSTITUENTS_TABLE", "portfolio-index-constituents-dev")
FUNDAMENTALS_TABLE = os.environ.get("FUNDAMENTALS_TABLE", "portfolio-fundamentals-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


def get_api_key(provider):
    ssm = boto3.client("ssm", region_name="us-east-1")
    resp = ssm.get_parameter(Name="/portfolio/api-credentials", WithDecryption=True)
    creds = json.loads(base64.b64decode(resp["Parameter"]["Value"]))
    return creds[provider]["api_key"]


def refresh_index_constituents(market):
    """Refresh index constituent lists from FMP. Called weekly or on first run."""
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
        # Nifty 500 — FMP doesn't have it, check if already populated
        resp = table.query(KeyConditionExpression=Key("index_name").eq("NIFTY500"), Limit=1)
        if resp.get("Items"):
            print("  NIFTY500: already populated")
        else:
            print("  NIFTY500: not populated — needs manual upload or static list")


def get_index_symbols(market):
    """Get all symbols for a market from DDB."""
    table = ddb.Table(INDEX_TABLE)
    symbols = set()
    if market == "US":
        for index_name in ["SP500", "NASDAQ100"]:
            resp = table.query(KeyConditionExpression=Key("index_name").eq(index_name))
            for item in resp.get("Items", []):
                symbols.add(item["symbol"])
    else:
        resp = table.query(KeyConditionExpression=Key("index_name").eq("NIFTY500"))
        for item in resp.get("Items", []):
            symbols.add(item["symbol"])
    return symbols


def get_earnings_this_week(av_key, market):
    """Get stocks that reported earnings in the last 7 days from Alpha Vantage."""
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


def scan_stocks(symbols_to_scan, market):
    """For each symbol, check price drop, fundamentals, and return qualifying stocks."""
    today = date.today()
    min_price = 50 if market == "IN" else 5
    results = []

    for sym, earnings_info in symbols_to_scan.items():
        try:
            yf_sym = f"{sym}.NS" if market == "IN" else sym
            t = yf.Ticker(yf_sym)
            info = t.info or {}

            # Price filter
            current_price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
            if current_price < min_price:
                continue

            # Get pre-earnings price (close on day before earnings)
            report_date = date.fromisoformat(earnings_info["report_date"])
            pre_date = report_date - timedelta(days=1)
            # Fetch 5 days before earnings to handle weekends
            hist = yf.download(yf_sym, start=(report_date - timedelta(days=5)).isoformat(),
                               end=report_date.isoformat(), progress=False, auto_adjust=True)
            if hist is None or hist.empty:
                continue
            if hasattr(hist.columns, "levels") and len(hist.columns.levels) > 1:
                hist.columns = hist.columns.droplevel(1)
            pre_earnings_price = float(hist["Close"].iloc[-1])
            if hasattr(pre_earnings_price, "item"):
                pre_earnings_price = pre_earnings_price.item()

            if pre_earnings_price <= 0:
                continue

            # Calculate drops
            day_drop = (current_price - pre_earnings_price) / pre_earnings_price
            cumulative_drop = day_drop  # same on first day, updated on subsequent days

            # Must drop at least 6%
            if day_drop > -0.06:
                continue

            # Operating income check (current + next year)
            op_income_cy = None
            op_income_ny = None
            revenue_growth = None
            forward_pe = info.get("forwardPE")
            market_cap = info.get("marketCap", 0)

            try:
                inc = t.income_stmt
                if inc is not None and not inc.empty:
                    cols = sorted(inc.columns)
                    if "Operating Income" in inc.index:
                        latest = inc.loc["Operating Income", cols[-1]]
                        if latest == latest:
                            op_income_cy = float(latest)
                    if "Total Revenue" in inc.index and len(cols) >= 2:
                        rev_latest = inc.loc["Total Revenue", cols[-1]]
                        rev_prev = inc.loc["Total Revenue", cols[-2]]
                        if rev_latest == rev_latest and rev_prev == rev_prev and float(rev_prev) > 0:
                            revenue_growth = (float(rev_latest) - float(rev_prev)) / float(rev_prev)

                # Forward operating income from estimates
                ee = t.earnings_estimate
                re_ = t.revenue_estimate
                op_margin = info.get("operatingMargins", 0) or 0
                if ee is not None and not ee.empty and "+1y" in ee.index:
                    est_rev = None
                    if re_ is not None and not re_.empty and "+1y" in re_.index and "avg" in re_.columns:
                        est_rev = float(re_.loc["+1y", "avg"])
                    if est_rev and op_margin:
                        op_income_ny = est_rev * op_margin
            except Exception:
                pass

            # Filter: operating income must be positive for both years
            if op_income_cy is None or op_income_cy <= 0:
                continue
            if op_income_ny is not None and op_income_ny <= 0:
                continue

            # Filter: revenue growth must be positive
            if revenue_growth is not None and revenue_growth <= 0:
                continue

            results.append({
                "symbol": sym,
                "yf_symbol": yf_sym,
                "name": earnings_info.get("name") or info.get("longName") or info.get("shortName", sym),
                "report_date": earnings_info["report_date"],
                "pre_earnings_price": round(pre_earnings_price, 2),
                "current_price": round(current_price, 2),
                "day_drop": round(day_drop * 100, 2),
                "cumulative_drop": round(cumulative_drop * 100, 2),
                "op_income_cy": round(op_income_cy, 0) if op_income_cy else None,
                "op_income_ny": round(op_income_ny, 0) if op_income_ny else None,
                "revenue_growth": round(revenue_growth * 100, 2) if revenue_growth is not None else None,
                "forward_pe": round(forward_pe, 2) if forward_pe else None,
                "market_cap": market_cap,
                "currency": "INR" if market == "IN" else "USD",
            })
            print(f"  ✅ {sym}: drop={day_drop*100:.1f}% op_cy={op_income_cy:.0f} mktcap={market_cap}")

        except Exception as e:
            print(f"  ❌ {sym}: {str(e)[:80]}")
            continue

    return results


def store_results(results, market):
    """Store/update screener results in DDB. Update cumulative drop for existing entries."""
    table = ddb.Table(SCREENER_TABLE)
    today = date.today().isoformat()
    now = datetime.now(timezone.utc).isoformat()

    # Load existing entries for this market
    existing_resp = table.query(KeyConditionExpression=Key("market").eq(market))
    existing = {item["symbol"]: item for item in existing_resp.get("Items", [])}

    # Expire entries older than 7 days from earnings
    for sym, item in existing.items():
        report_date = item.get("report_date", "")
        if report_date:
            try:
                rd = date.fromisoformat(report_date)
                if (date.today() - rd).days > 7:
                    table.delete_item(Key={"market": market, "symbol": sym})
                    print(f"  Expired: {sym} (reported {report_date})")
            except ValueError:
                pass

    # Store new results
    for r in results:
        sym = r["symbol"]
        existing_entry = existing.get(sym)

        if existing_entry:
            # Update cumulative drop
            pre_price = float(existing_entry.get("pre_earnings_price", r["pre_earnings_price"]))
            if pre_price > 0:
                r["cumulative_drop"] = round((r["current_price"] - pre_price) / pre_price * 100, 2)
            r["pre_earnings_price"] = pre_price
            r["first_seen"] = existing_entry.get("first_seen", today)
        else:
            r["first_seen"] = today

        item = {"market": market, "symbol": sym, "last_updated": now}
        for k, v in r.items():
            if v is None:
                continue
            item[k] = Decimal(str(v)) if isinstance(v, float) else (Decimal(str(v)) if isinstance(v, int) and k != "symbol" else v)
        table.put_item(Item=item)

    print(f"  Stored {len(results)} results for {market}")


def handler(event, context):
    market = event.get("market", "US")
    print(f"=== Earnings Dip Screener: {market} ===")

    # Step 1: Ensure index constituents are loaded
    index_symbols = get_index_symbols(market)
    if not index_symbols:
        print("No index constituents found, refreshing...")
        refresh_index_constituents(market)
        index_symbols = get_index_symbols(market)
    print(f"Index universe: {len(index_symbols)} symbols")

    # Step 2: Get earnings calendar
    av_key = get_api_key("alpha_vantage")
    all_earnings = get_earnings_this_week(av_key, market)
    print(f"Earnings reported in last 7 days: {len(all_earnings)} total")

    # Step 3: Filter to our universe
    symbols_to_scan = {sym: info for sym, info in all_earnings.items() if sym in index_symbols}
    print(f"In our universe: {len(symbols_to_scan)} stocks to scan")

    if not symbols_to_scan:
        # Still update cumulative drops for existing entries
        table = ddb.Table(SCREENER_TABLE)
        existing_resp = table.query(KeyConditionExpression=Key("market").eq(market))
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
            except Exception:
                pass
        print("No new earnings to scan, updated existing entries")
        return {"market": market, "scanned": 0, "qualifying": 0}

    # Step 4: Scan stocks
    results = scan_stocks(symbols_to_scan, market)
    print(f"Qualifying stocks: {len(results)}")

    # Step 5: Store results
    store_results(results, market)

    return {"market": market, "scanned": len(symbols_to_scan), "qualifying": len(results)}

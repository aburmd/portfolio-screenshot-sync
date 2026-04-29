"""Moving Average Scanner Lambda.

Scheduled daily after market close (same as screener).
Fetches 200 days of prices for all index stocks, computes 50/150/200 MA,
stores trend signals in DDB.
"""

import os
import json
import base64
from datetime import date, timedelta, datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf

REGION = os.environ.get("AWS_REGION", "us-west-1")
SCREENER_TABLE = os.environ.get("SCREENER_TABLE", "portfolio-screener-dev")
INDEX_TABLE = os.environ.get("INDEX_CONSTITUENTS_TABLE", "portfolio-index-constituents-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


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


def compute_ma_signals(sym, market):
    """Fetch 1 year of prices, compute MAs and trend signals."""
    yf_sym = f"{sym}.NS" if market == "IN" else sym
    min_price = 50 if market == "IN" else 5

    try:
        t = yf.Ticker(yf_sym)
        hist = t.history(period="1y")
        if hist is None or len(hist) < 200:
            hist = t.history(period="2y")
        if hist is None or len(hist) < 50:
            return None

        if hasattr(hist.columns, "levels") and len(hist.columns.levels) > 1:
            hist.columns = hist.columns.droplevel(1)

        close = hist["Close"]
        current_price = float(close.iloc[-1])
        if current_price < min_price:
            return None

        # Compute MAs
        ma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None
        ma150 = float(close.rolling(150).mean().iloc[-1]) if len(close) >= 150 else None
        ma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

        # 200MA slope: compare current 200MA vs 22 trading days ago (~1 month)
        ma200_slope = None
        if len(close) >= 222:
            ma200_prev = float(close.rolling(200).mean().iloc[-22])
            if ma200_prev > 0:
                ma200_slope = round((ma200 - ma200_prev) / ma200_prev * 100, 2)

        # 52-week high/low
        high_52w = float(close.max())
        low_52w = float(close.min())
        pct_from_high = round((current_price - high_52w) / high_52w * 100, 2) if high_52w > 0 else None
        pct_from_low = round((current_price - low_52w) / low_52w * 100, 2) if low_52w > 0 else None

        # Trend score (Mark Minervini template)
        trend_score = 0
        ma_aligned = False

        # Check 1: Price > 50MA > 150MA > 200MA
        if ma50 and ma150 and ma200:
            if current_price > ma50 > ma150 > ma200:
                trend_score += 1
                ma_aligned = True

        # Check 2: 200MA trending up
        ma200_up = False
        if ma200_slope is not None and ma200_slope > 0:
            trend_score += 1
            ma200_up = True

        # Check 3: Price within 25% of 52-week high AND > 30% above 52-week low
        near_high = False
        above_low = False
        if pct_from_high is not None and pct_from_high >= -25:
            near_high = True
        if pct_from_low is not None and pct_from_low >= 30:
            above_low = True
        if near_high and above_low:
            trend_score += 1

        return {
            "current_price": round(current_price, 2),
            "ma50": round(ma50, 2) if ma50 else None,
            "ma150": round(ma150, 2) if ma150 else None,
            "ma200": round(ma200, 2) if ma200 else None,
            "ma200_slope": ma200_slope,
            "high_52w": round(high_52w, 2),
            "low_52w": round(low_52w, 2),
            "pct_from_high": pct_from_high,
            "pct_from_low": pct_from_low,
            "trend_score": trend_score,
            "ma_aligned": ma_aligned,
            "ma200_up": ma200_up,
            "near_high": near_high,
            "above_low": above_low,
            "operating_margins": round(info.get("operatingMargins", 0) * 100, 2) if info.get("operatingMargins") else None,
            "revenue_growth": round(info.get("revenueGrowth", 0) * 100, 2) if info.get("revenueGrowth") else None,
            "forward_pe": round(info["forwardPE"], 2) if info.get("forwardPE") else None,
            "market_cap": info.get("marketCap", 0),
        }
    except Exception as e:
        return None


def handler(event, context):
    market = event.get("market", "US")
    print(f"=== MA Scanner: {market} ===")

    index_symbols = get_index_symbols(market)
    if not index_symbols:
        print("No index constituents found")
        return {"market": market, "scanned": 0}

    print(f"Index universe: {len(index_symbols)} symbols")

    table = ddb.Table(SCREENER_TABLE)
    now = datetime.now(timezone.utc).isoformat()
    scanned = 0
    updated = 0

    for i, (sym, info) in enumerate(index_symbols.items()):
        if (i + 1) % 100 == 0:
            print(f"  [{i+1}/{len(index_symbols)}] scanned, {updated} updated")

        signals = compute_ma_signals(sym, market)
        if not signals:
            continue
        scanned += 1

        # Update existing screener record or create MA-only record
        existing = table.get_item(Key={"market": market, "symbol": sym}).get("Item")


        if existing:
            # Build update: SET non-None values, REMOVE None values
            field_map = {
                "ma50": signals["ma50"], "ma150": signals["ma150"], "ma200": signals["ma200"],
                "ma200_slope": signals["ma200_slope"], "high_52w": signals["high_52w"],
                "low_52w": signals["low_52w"], "pct_from_high": signals["pct_from_high"],
                "pct_from_low": signals["pct_from_low"], "trend_score": signals["trend_score"],
                "ma_aligned": signals["ma_aligned"], "ma200_up": signals["ma200_up"],
                "near_high": signals["near_high"], "above_low": signals["above_low"],
                "ma_updated": now,
                "operating_margins": signals.get("operating_margins"),
                "revenue_growth": signals.get("revenue_growth"),
                "forward_pe": signals.get("forward_pe"),
                "market_cap": signals.get("market_cap"),
            }
            set_parts = []
            remove_parts = []
            expr_vals = {}
            for attr, val in field_map.items():
                key = f":{attr.replace('_', '')}"
                if val is not None:
                    set_parts.append(f"{attr}={key}")
                    if isinstance(val, bool):
                        expr_vals[key] = val
                    elif isinstance(val, (int, float)):
                        expr_vals[key] = Decimal(str(val))
                    else:
                        expr_vals[key] = val
                else:
                    remove_parts.append(attr)

            update_expr = "SET " + ", ".join(set_parts)
            if remove_parts:
                update_expr += " REMOVE " + ", ".join(remove_parts)

            table.update_item(
                Key={"market": market, "symbol": sym},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_vals,
            )
        else:
            item = {
                "market": market, "symbol": sym,
                "name": info.get("name", ""), "sector": info.get("sector", ""),
                "ma_updated": now,
            }
            for k, v in signals.items():
                if v is None:
                    continue
                if isinstance(v, bool):
                    item[k] = v
                elif isinstance(v, (int, float)):
                    item[k] = Decimal(str(v))
                else:
                    item[k] = v
            table.put_item(Item=item)

        updated += 1

    print(f"MA Scanner complete: {scanned} scanned, {updated} updated")
    return {"market": market, "scanned": scanned, "updated": updated}

"""Buy/Sell Zone computation from OHLCV history."""

import os
from decimal import Decimal
from datetime import date, timedelta
from collections import defaultdict

import boto3
from boto3.dynamodb.conditions import Key

REGION = os.environ.get("AWS_REGION", "us-west-1")
HISTORY_TABLE = os.environ.get("STOCK_HISTORY_TABLE", "portfolio-stock-history-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


# ── helpers ──────────────────────────────────────────────────────────────────

def _f(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch_ohlcv(market, symbol):
    """Return all daily OHLCV records + AGG from DDB, sorted oldest→newest."""
    table = ddb.Table(HISTORY_TABLE)
    pk = f"{market}#{symbol}"

    resp = table.query(KeyConditionExpression=Key("market_symbol").eq(pk))
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = table.query(
            KeyConditionExpression=Key("market_symbol").eq(pk),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    agg = None
    daily = []
    for item in items:
        d = item.get("date", "")
        if d == "AGG":
            agg = {k: _f(v) if hasattr(v, "is_finite") else v for k, v in item.items()}
        elif d[:1].isdigit():  # daily records start with year digit
            daily.append({
                "date": d,
                "open":   _f(item.get("open")),
                "high":   _f(item.get("high")),
                "low":    _f(item.get("low")),
                "close":  _f(item.get("close")),
                "volume": int(item["volume"]) if item.get("volume") else 0,
            })

    daily.sort(key=lambda x: x["date"])
    return daily, agg


def _window_records(daily, months):
    """Return records from the last N months."""
    cutoff = (date.today() - timedelta(days=months * 30)).isoformat()
    return [r for r in daily if r["date"] >= cutoff]


def _cluster_zones(values, prices, bucket_pct=0.015, min_touches=3):
    """
    Cluster a list of (price, volume_contribution) into zones.
    Returns list of {price_level, touch_count, vol_sum}.
    """
    if not values:
        return []

    price_range = max(p for p, _ in values) - min(p for p, _ in values)
    if price_range <= 0:
        return []

    bucket_size = price_range * bucket_pct
    buckets = defaultdict(lambda: {"touches": 0, "vol": 0.0, "prices": []})

    for price, vol in values:
        key = round(price / bucket_size) * bucket_size
        buckets[key]["touches"] += 1
        buckets[key]["vol"] += vol
        buckets[key]["prices"].append(price)

    zones = []
    for key, data in buckets.items():
        if data["touches"] >= min_touches:
            zones.append({
                "price_level": round(sum(data["prices"]) / len(data["prices"]), 2),
                "touch_count": data["touches"],
                "vol_sum": data["vol"],
            })
    return zones


def _vol_at_zone(zone_price, records, bucket_pct=0.015):
    """
    Uniform distribution approximation: distribute daily volume across
    the day's high-low range, sum the portion overlapping the zone bucket.
    """
    total_vol = sum(r["volume"] for r in records) or 1
    zone_half = zone_price * bucket_pct / 2
    zone_lo = zone_price - zone_half
    zone_hi = zone_price + zone_half

    vol_sum = 0.0
    for r in records:
        hi, lo, vol = r["high"] or 0, r["low"] or 0, r["volume"] or 0
        day_range = hi - lo
        if day_range <= 0 or vol <= 0:
            continue
        overlap = max(0, min(hi, zone_hi) - max(lo, zone_lo))
        vol_sum += vol * overlap / day_range

    return round(vol_sum / total_vol * 100, 4)  # as % of total period volume


def _cagr(current, past_price, years):
    if not current or not past_price or past_price <= 0 or years <= 0:
        return None
    try:
        return round((current / past_price) ** (1 / years) - 1, 4)
    except (TypeError, ZeroDivisionError):
        return None


# ── main compute ─────────────────────────────────────────────────────────────

def compute_zones(symbol, market, base_pos=0.5, max_pos=3.0):
    """
    Compute buy/sell zones for a stock.
    Returns dict with buy_zones, sell_zones, cagr_summary, current_price.
    """
    market = market.upper()
    symbol = symbol.upper()

    daily, agg = _fetch_ohlcv(market, symbol)
    if not daily or not agg:
        return None

    current_price = agg.get("current_price") or (daily[-1]["close"] if daily else None)
    if not current_price:
        return None

    # ── CAGR ─────────────────────────────────────────────────────────────────
    cagr_1y = _cagr(current_price, agg.get("close_1y"), 1)
    cagr_3y = _cagr(current_price, agg.get("close_3y"), 3)
    cagr_5y = _cagr(current_price, agg.get("close_5y"), 5)
    available = [c for c in [cagr_1y, cagr_3y, cagr_5y] if c is not None]
    avg_cagr = round(sum(available) / len(available), 4) if available else None

    # ── QQQ gate ─────────────────────────────────────────────────────────────
    qqq_agg = None
    try:
        resp = ddb.Table(HISTORY_TABLE).get_item(Key={"market_symbol": "US#QQQ", "date": "AGG"})
        qqq_agg = resp.get("Item")
    except Exception:
        pass

    qqq_avg_cagr = None
    if qqq_agg:
        qc1 = _cagr(_f(qqq_agg.get("current_price")), _f(qqq_agg.get("close_1y")), 1)
        qc3 = _cagr(_f(qqq_agg.get("current_price")), _f(qqq_agg.get("close_3y")), 3)
        qc5 = _cagr(_f(qqq_agg.get("current_price")), _f(qqq_agg.get("close_5y")), 5)
        qa = [c for c in [qc1, qc3, qc5] if c is not None]
        qqq_avg_cagr = round(sum(qa) / len(qa), 4) if qa else None

    # ── windows ──────────────────────────────────────────────────────────────
    w6m  = _window_records(daily, 6)
    w12m = _window_records(daily, 12)
    w24m = _window_records(daily, 24)
    windows = {"6M": w6m, "12M": w12m, "24M": w24m}

    # Use 24M as primary window for zone detection
    primary = w24m if len(w24m) >= 30 else (w12m if len(w12m) >= 30 else w6m)
    if not primary:
        return None

    period_hh = max(r["high"] for r in primary if r["high"])
    period_ll = min(r["low"]  for r in primary if r["low"])

    # 1Y low as deepest buy zone boundary
    low_1y = min(r["low"] for r in w12m if r["low"]) if w12m else period_ll

    # ── zone detection per window ─────────────────────────────────────────────
    buy_zone_windows  = defaultdict(set)   # price_level → set of windows confirming
    sell_zone_windows = defaultdict(set)

    for wname, wrecs in windows.items():
        if len(wrecs) < 10:
            continue
        lows  = [(r["low"],  r["volume"]) for r in wrecs if r["low"]]
        highs = [(r["high"], r["volume"]) for r in wrecs if r["high"]]

        for z in _cluster_zones(lows,  wrecs):
            if z["price_level"] >= low_1y:  # only above 1Y low
                buy_zone_windows[round(z["price_level"], 2)].add(wname)

        for z in _cluster_zones(highs, wrecs):
            sell_zone_windows[round(z["price_level"], 2)].add(wname)

    # ── build buy zones ───────────────────────────────────────────────────────
    raw_buy = []
    for price_level, wins in buy_zone_windows.items():
        level_count = len(wins)
        vol_pct = _vol_at_zone(price_level, primary)
        pct_from_hh = round((price_level - period_hh) / period_hh * 100, 2)
        potential_gain = round((current_price - price_level) / price_level * 100, 2) if price_level < current_price else 0
        cagr_qualified = avg_cagr is not None and potential_gain >= avg_cagr * 100
        raw_buy.append({
            "price_level": price_level,
            "touch_count": max(len(wins) * 3, 3),
            "level_count": level_count,
            "vol_pct": vol_pct,
            "pct_from_hh": pct_from_hh,
            "cagr_qualified": cagr_qualified,
            "in_zone_now": abs(current_price - price_level) / price_level <= 0.015,
        })

    # Sort high→low (nearest first), filter below 1Y low
    raw_buy.sort(key=lambda x: -x["price_level"])
    raw_buy = [z for z in raw_buy if z["price_level"] >= low_1y]

    # QQQ gate: first buy must be at or below gate_price
    qqq_gate_price = None
    if qqq_avg_cagr:
        qqq_gate_price = round(period_hh * (1 - 0.80 * qqq_avg_cagr), 2)
        for z in raw_buy:
            z["qqq_gate_qualified"] = z["price_level"] <= qqq_gate_price
    else:
        for z in raw_buy:
            z["qqq_gate_qualified"] = True

    # ── position sizing ───────────────────────────────────────────────��───────
    qualified = [z for z in raw_buy if z["cagr_qualified"] and z["qqq_gate_qualified"]]
    n = len(qualified)

    if n > 0:
        max_vol = max(z["vol_pct"] for z in qualified) or 1
        max_raw = max(
            (i * (qualified[i]["vol_pct"] / max_vol))
            for i in range(1, n)
        ) if n > 1 else 1

        for i, z in enumerate(qualified):
            if i == 0:
                z["total_target_pct"] = base_pos
            elif i == n - 1:
                z["total_target_pct"] = max_pos
            else:
                rel_vol = z["vol_pct"] / max_vol
                raw = i * rel_vol
                z["total_target_pct"] = round(base_pos + (raw / max_raw) * (max_pos - base_pos), 2)

        # 50% missed entry rule
        for z in qualified:
            if z["in_zone_now"] and z["total_target_pct"] >= 2 * base_pos:
                z["adjusted_target_pct"] = round(z["total_target_pct"] / 2, 2)
                z["reserved_pct"] = z["adjusted_target_pct"]
            else:
                z["adjusted_target_pct"] = z["total_target_pct"]
                z["reserved_pct"] = 0

    # ── build sell zones ──────────────────────────────────────────────────────
    raw_sell = []
    for price_level, wins in sell_zone_windows.items():
        if price_level <= current_price:
            continue  # only above current price
        level_count = len(wins)
        vol_pct = _vol_at_zone(price_level, primary)
        pct_from_ll = round((price_level - period_ll) / period_ll * 100, 2)
        raw_sell.append({
            "price_level": price_level,
            "touch_count": max(len(wins) * 3, 3),
            "level_count": level_count,
            "vol_pct": vol_pct,
            "pct_from_ll": pct_from_ll,
        })

    raw_sell.sort(key=lambda x: x["price_level"])  # low→high

    # Sell zone sizing (mirrored from buy)
    ns = len(raw_sell)
    if ns > 0:
        max_vol_s = max(z["vol_pct"] for z in raw_sell) or 1
        max_raw_s = max(
            (i * (raw_sell[i]["vol_pct"] / max_vol_s))
            for i in range(1, ns)
        ) if ns > 1 else 1

        for i, z in enumerate(raw_sell):
            if i == ns - 1:
                z["total_target_pct"] = 0.0   # final exit
                z["note"] = "final exit = HH x (1 + 0.8 x QQQ_CAGR)"
            elif i == ns - 2:
                z["total_target_pct"] = 0.25  # residual hold
                z["note"] = "just below HH"
            else:
                rel_vol = z["vol_pct"] / max_vol_s
                raw = (ns - 1 - i) * rel_vol  # deeper = higher remaining
                z["total_target_pct"] = round(
                    0.25 + (raw / max_raw_s) * (max_pos - 0.25), 2
                ) if max_raw_s > 0 else max_pos

    # Final sell price
    final_sell_price = None
    if qqq_avg_cagr:
        # Use 12M HH if stock delivered avg CAGR in last 12M, else 24M HH
        hh_12m = max((r["high"] for r in w12m if r["high"]), default=None)
        hh_24m = max((r["high"] for r in w24m if r["high"]), default=None)
        close_1y = agg.get("close_1y")
        if close_1y and avg_cagr and (current_price / close_1y - 1) >= avg_cagr:
            hh_ref = hh_12m or hh_24m
            final_sell_window = "12M"
        else:
            hh_ref = hh_24m or hh_12m
            final_sell_window = "24M"
        if hh_ref:
            final_sell_price = round(hh_ref * (1 + 0.80 * qqq_avg_cagr), 2)
            if raw_sell:
                raw_sell[-1]["price_level"] = final_sell_price
    else:
        final_sell_window = "24M"

    return {
        "symbol": symbol,
        "market": market,
        "current_price": current_price,
        "period_hh": period_hh,
        "period_ll": period_ll,
        "low_1y": low_1y,
        "buy_zones": qualified,
        "sell_zones": raw_sell,
        "cagr_summary": {
            "cagr_1y": round(cagr_1y * 100, 2) if cagr_1y else None,
            "cagr_3y": round(cagr_3y * 100, 2) if cagr_3y else None,
            "cagr_5y": round(cagr_5y * 100, 2) if cagr_5y else None,
            "avg_cagr": round(avg_cagr * 100, 2) if avg_cagr else None,
            "qqq_avg_cagr": round(qqq_avg_cagr * 100, 2) if qqq_avg_cagr else None,
            "qqq_gate_price": qqq_gate_price,
            "final_sell_price": final_sell_price,
            "final_sell_window": final_sell_window,
        },
        "base_pos": base_pos,
        "max_pos": max_pos,
    }

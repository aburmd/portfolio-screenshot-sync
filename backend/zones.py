"""Buy/Sell Zone computation from OHLCV history."""

import os
from datetime import date, timedelta
from collections import defaultdict
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

REGION        = os.environ.get("AWS_REGION", "us-west-1")
HISTORY_TABLE = os.environ.get("STOCK_HISTORY_TABLE", "portfolio-stock-history-dev")
SCREENER_TABLE = os.environ.get("SCREENER_TABLE", "portfolio-screener-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)


# ── helpers ───────────────────────────────────────────────────────────────────

def _f(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cagr(current, past_price, years):
    if not current or not past_price or past_price <= 0 or years <= 0:
        return None
    try:
        return round((current / past_price) ** (1 / years) - 1, 4)
    except (TypeError, ZeroDivisionError):
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

    agg   = None
    daily = []
    for item in items:
        d = item.get("date", "")
        if d == "AGG":
            agg = {k: _f(v) if hasattr(v, "is_finite") or isinstance(v, Decimal) else v
                   for k, v in item.items()}
        elif d[:1].isdigit():
            daily.append({
                "date":   d,
                "open":   _f(item.get("open")),
                "high":   _f(item.get("high")),
                "low":    _f(item.get("low")),
                "close":  _f(item.get("close")),
                "volume": int(item["volume"]) if item.get("volume") else 0,
            })

    daily.sort(key=lambda x: x["date"])
    return daily, agg


def _get_current_price(market, symbol, daily, agg):
    """Get current price: last daily close (most reliable) → screener → AGG."""
    # 1. Last daily close — always fresh from daily scanner backfill
    if daily:
        p = _f(daily[-1].get("close"))
        if p and p > 0:
            return p
    # 2. Screener table
    try:
        resp = ddb.Table(SCREENER_TABLE).get_item(
            Key={"market": market, "symbol": symbol})
        item = resp.get("Item")
        if item and item.get("current_price"):
            return _f(item["current_price"])
    except Exception:
        pass
    # 3. AGG field
    return _f(agg.get("current_price")) if agg else None


def _get_qqq_cagr():
    """Get QQQ avg CAGR from history table (last daily close + AGG)."""
    try:
        hist_table = ddb.Table(HISTORY_TABLE)
        # Current price from last daily record
        resp = hist_table.query(
            KeyConditionExpression=Key("market_symbol").eq("US#QQQ"),
            ScanIndexForward=False, Limit=5,
        )
        qqq_price = None
        for item in resp.get("Items", []):
            d = item.get("date", "")
            if d[:1].isdigit() and item.get("close"):
                qqq_price = _f(item["close"])
                break
        if not qqq_price:
            return None
        # Historical closes from AGG
        resp2 = hist_table.get_item(Key={"market_symbol": "US#QQQ", "date": "AGG"})
        agg = resp2.get("Item", {})
        qc1 = _cagr(qqq_price, _f(agg.get("close_1y")), 1)
        qc3 = _cagr(qqq_price, _f(agg.get("close_3y")), 3)
        qc5 = _cagr(qqq_price, _f(agg.get("close_5y")), 5)
        qa  = [c for c in [qc1, qc3, qc5] if c is not None]
        return round(sum(qa) / len(qa), 4) if qa else None
    except Exception:
        return None


def _window_records(daily, months):
    cutoff = (date.today() - timedelta(days=months * 30)).isoformat()
    return [r for r in daily if r["date"] >= cutoff]


def _cluster_zones(price_vol_list, bucket_size, min_touches=3):
    """
    Cluster (price, volume) pairs into zones using fixed bucket_size.
    bucket_size = % of current price (e.g. 3% of $170 = $5.10 per bucket).
    Returns list of {price_level, touch_count, vol_sum}.
    """
    if not price_vol_list:
        return []

    buckets = defaultdict(lambda: {"touches": 0, "vol": 0.0, "prices": []})
    for price, vol in price_vol_list:
        key = round(price / bucket_size) * bucket_size
        buckets[key]["touches"] += 1
        buckets[key]["vol"]     += vol
        buckets[key]["prices"].append(price)

    return [
        {
            "price_level": round(sum(d["prices"]) / len(d["prices"]), 2),
            "touch_count": d["touches"],
            "vol_sum":     d["vol"],
        }
        for d in buckets.values()
        if d["touches"] >= min_touches
    ]


def _vol_at_zone(zone_price, records, bucket_size):
    """Uniform distribution: portion of daily volume overlapping zone bucket."""
    total_vol = sum(r["volume"] for r in records) or 1
    zone_half = bucket_size / 2
    zone_lo   = zone_price - zone_half
    zone_hi   = zone_price + zone_half

    vol_sum = 0.0
    for r in records:
        hi, lo, vol = r["high"] or 0, r["low"] or 0, r["volume"] or 0
        day_range = hi - lo
        if day_range <= 0 or vol <= 0:
            continue
        overlap  = max(0, min(hi, zone_hi) - max(lo, zone_lo))
        vol_sum += vol * overlap / day_range

    return round(vol_sum / total_vol * 100, 4)


# ── main compute ──────────────────────────────────────────────────────────────

def compute_zones(symbol, market, base_pos=0.5, max_pos=3.0,
                  max_buy_zones=5, max_sell_zones=5):
    market = market.upper()
    symbol = symbol.upper()

    daily, agg = _fetch_ohlcv(market, symbol)
    if not daily or not agg:
        return None

    current_price = _get_current_price(market, symbol, daily, agg)
    if not current_price:
        return None

    # Bucket size = 3% of current price (fixed, not % of range)
    bucket_size = round(current_price * 0.03, 2)

    # ── CAGR ─────────────────────────────────────────────────────────────────
    cagr_1y = _cagr(current_price, _f(agg.get("close_1y")), 1)
    cagr_3y = _cagr(current_price, _f(agg.get("close_3y")), 3)
    cagr_5y = _cagr(current_price, _f(agg.get("close_5y")), 5)
    available = [c for c in [cagr_1y, cagr_3y, cagr_5y] if c is not None]
    avg_cagr  = round(sum(available) / len(available), 4) if available else None

    # ── QQQ gate ─────────────────────────────────────────────────────────────
    qqq_avg_cagr  = _get_qqq_cagr()
    qqq_gate_price = None

    # ── windows ──────────────────────────────────────────────────────────────
    w6m  = _window_records(daily, 6)
    w12m = _window_records(daily, 12)
    w24m = _window_records(daily, 24)
    windows = {"6M": w6m, "12M": w12m, "24M": w24m}

    primary = w24m if len(w24m) >= 30 else (w12m if len(w12m) >= 30 else w6m)
    if not primary:
        return None

    period_hh = max(r["high"] for r in primary if r["high"])
    period_ll = min(r["low"]  for r in primary if r["low"])
    low_1y    = min(r["low"]  for r in w12m if r["low"]) if w12m else period_ll

    # ── zone detection: count touches per window ──────────────────────────────
    # buy_zone_windows[price_level] = set of window names that confirm it
    buy_zone_windows  = defaultdict(set)
    sell_zone_windows = defaultdict(set)

    for wname, wrecs in windows.items():
        if len(wrecs) < 10:
            continue
        lows  = [(r["low"],  r["volume"]) for r in wrecs if r["low"]]
        highs = [(r["high"], r["volume"]) for r in wrecs if r["high"]]

        for z in _cluster_zones(lows,  bucket_size):
            if z["price_level"] >= low_1y:
                buy_zone_windows[round(z["price_level"], 2)].add(wname)

        for z in _cluster_zones(highs, bucket_size):
            sell_zone_windows[round(z["price_level"], 2)].add(wname)


    # ── merge nearby zones ───────────────────────────────────────────────────────────────────
    def _merge_nearby(zone_dict):
        """Within 2x bucket_size keep the strongest zone, discard weaker ones."""
        prices = sorted(zone_dict.keys())
        merged = {}
        skip   = set()
        for i, p in enumerate(prices):
            if p in skip:
                continue
            group = [p]
            for j in range(i + 1, len(prices)):
                if prices[j] - group[0] <= bucket_size * 2:
                    group.append(prices[j])
                    skip.add(prices[j])
                else:
                    break
            # Keep strongest: most window confirmations, break ties by higher price
            best = max(group, key=lambda x: (len(zone_dict[x]), x))
            merged[best] = zone_dict[best]
        return merged

    buy_zone_windows  = _merge_nearby(buy_zone_windows)
    sell_zone_windows = _merge_nearby(sell_zone_windows)

    # ── build buy zones ───────────────────────────────────────────────────────
    raw_buy = []
    for price_level, wins in buy_zone_windows.items():
        level_count    = len(wins)
        vol_pct        = _vol_at_zone(price_level, primary, bucket_size)
        pct_from_hh    = round((price_level - period_hh) / period_hh * 100, 2)
        potential_gain = round((period_hh - price_level) / price_level * 100, 2)
        cagr_qualified = avg_cagr is not None and potential_gain >= avg_cagr * 100
        raw_buy.append({
            "price_level":   price_level,
            "touch_count":   level_count * 3,
            "level_count":   level_count,
            "vol_pct":       vol_pct,
            "pct_from_hh":   pct_from_hh,
            "cagr_qualified": cagr_qualified,
            "in_zone_now":   abs(current_price - price_level) / price_level <= 0.03,
        })

    # Sort high→low (nearest first), exclude below 1Y low and above current price
    raw_buy.sort(key=lambda x: -x["price_level"])
    raw_buy = [z for z in raw_buy if z["price_level"] >= low_1y and z["price_level"] < current_price]

    # QQQ gate
    if qqq_avg_cagr:
        qqq_gate_price = round(period_hh * (1 - 0.80 * qqq_avg_cagr), 2)
        for z in raw_buy:
            z["qqq_gate_qualified"] = z["price_level"] <= qqq_gate_price
    else:
        for z in raw_buy:
            z["qqq_gate_qualified"] = True

    # ── select best N zones with minimum spacing ───────────────────────────
    def _select_zones(zones, max_n, sort_key_fn, min_gap):
        """Pick best max_n zones sorted by quality, enforcing min_gap between them."""
        # Sort by quality: level_count desc, then vol_pct desc
        candidates = sorted(zones, key=sort_key_fn, reverse=True)
        selected = []
        for z in candidates:
            # Check min gap against already selected zones
            too_close = any(
                abs(z["price_level"] - s["price_level"]) < min_gap
                for s in selected
            )
            if not too_close:
                selected.append(z)
            if len(selected) >= max_n:
                break
        return selected

    # Min gap = 2 buckets between zones
    min_gap = bucket_size * 2
    quality_key = lambda z: (z["level_count"], z["vol_pct"])

    # ── position sizing ───────────────────────────────────────────────────────
    qualified_all = [z for z in raw_buy if z["cagr_qualified"] and z["qqq_gate_qualified"]]
    qualified = _select_zones(qualified_all, max_buy_zones, quality_key, min_gap)
    # Re-sort high→low (nearest first) after selection
    qualified.sort(key=lambda x: -x["price_level"])
    n = len(qualified)

    if n > 0:
        max_vol = max(z["vol_pct"] for z in qualified) or 1
        max_raw = max(
            i * (qualified[i]["vol_pct"] / max_vol)
            for i in range(1, n)
        ) if n > 1 else 1

        for i, z in enumerate(qualified):
            if i == 0:
                z["total_target_pct"] = base_pos
            elif i == n - 1:
                z["total_target_pct"] = max_pos
            else:
                rel_vol = z["vol_pct"] / max_vol
                raw     = i * rel_vol
                z["total_target_pct"] = round(
                    base_pos + (raw / max_raw) * (max_pos - base_pos), 2)

        # 50% missed entry rule
        for z in qualified:
            if z["in_zone_now"] and z["total_target_pct"] >= 2 * base_pos:
                z["adjusted_target_pct"] = round(z["total_target_pct"] / 2, 2)
                z["reserved_pct"]        = z["adjusted_target_pct"]
            else:
                z["adjusted_target_pct"] = z["total_target_pct"]
                z["reserved_pct"]        = 0

    # ── build sell zones ──────────────────────────────────────────────────────
    raw_sell = []
    for price_level, wins in sell_zone_windows.items():
        if price_level <= current_price:
            continue
        level_count = len(wins)
        vol_pct     = _vol_at_zone(price_level, primary, bucket_size)
        pct_from_ll = round((price_level - period_ll) / period_ll * 100, 2)
        raw_sell.append({
            "price_level": price_level,
            "touch_count": level_count * 3,
            "level_count": level_count,
            "vol_pct":     vol_pct,
            "pct_from_ll": pct_from_ll,
        })

    raw_sell.sort(key=lambda x: x["price_level"])  # low→high

    # Select best N sell zones spread across full range (current_price → HH)
    # Use dynamic gap so zones distribute evenly, not cluster near current price
    sell_range = period_hh - current_price
    sell_min_gap = max(min_gap, sell_range / (max_sell_zones + 1))
    raw_sell = _select_zones(raw_sell, max_sell_zones, quality_key, sell_min_gap)
    raw_sell.sort(key=lambda x: x["price_level"])

    # Sell zone sizing
    ns = len(raw_sell)
    if ns > 0:
        max_vol_s = max(z["vol_pct"] for z in raw_sell) or 1
        max_raw_s = max(
            i * (raw_sell[i]["vol_pct"] / max_vol_s)
            for i in range(1, ns)
        ) if ns > 1 else 1

        for i, z in enumerate(raw_sell):
            if i == ns - 1:
                z["total_target_pct"] = 0.0
                z["note"] = "final exit = HH x (1 + 0.8 x QQQ_CAGR)"
            elif i == ns - 2:
                z["total_target_pct"] = 0.25
                z["note"] = "just below HH"
            else:
                # trim_to decreases as price rises: nearest sell = max_pos, highest = 0.25
                rel_vol = z["vol_pct"] / max_vol_s
                rank = ns - 2 - i  # 0 at second-to-last, ns-2 at first
                raw = rank * rel_vol
                z["total_target_pct"] = round(
                    0.25 + (raw / max_raw_s) * (max_pos - 0.25), 2
                ) if max_raw_s > 0 else max_pos
                # Cap at max_pos
                z["total_target_pct"] = min(z["total_target_pct"], max_pos)

    # Final sell price
    final_sell_price  = None
    final_sell_window = "24M"
    if qqq_avg_cagr:
        hh_12m = max((r["high"] for r in w12m if r["high"]), default=None)
        hh_24m = max((r["high"] for r in w24m if r["high"]), default=None)
        close_1y = _f(agg.get("close_1y"))
        if close_1y and avg_cagr and (current_price / close_1y - 1) >= avg_cagr:
            hh_ref = hh_12m or hh_24m
            final_sell_window = "12M"
        else:
            hh_ref = hh_24m or hh_12m
        if hh_ref:
            final_sell_price = round(hh_ref * (1 + 0.80 * qqq_avg_cagr), 2)
            if raw_sell:
                raw_sell[-1]["price_level"] = final_sell_price

    return {
        "symbol":        symbol,
        "market":        market,
        "current_price": current_price,
        "period_hh":     period_hh,
        "period_ll":     period_ll,
        "low_1y":        low_1y,
        "bucket_size":   bucket_size,
        "buy_zones":     qualified,
        "sell_zones":    raw_sell,
        "cagr_summary": {
            "cagr_1y":          round(cagr_1y * 100, 2) if cagr_1y else None,
            "cagr_3y":          round(cagr_3y * 100, 2) if cagr_3y else None,
            "cagr_5y":          round(cagr_5y * 100, 2) if cagr_5y else None,
            "avg_cagr":         round(avg_cagr * 100, 2) if avg_cagr else None,
            "qqq_avg_cagr":     round(qqq_avg_cagr * 100, 2) if qqq_avg_cagr else None,
            "qqq_gate_price":   qqq_gate_price,
            "final_sell_price": final_sell_price,
            "final_sell_window": final_sell_window,
        },
        "base_pos": base_pos,
        "max_pos":  max_pos,
        "max_buy_zones":  max_buy_zones,
        "max_sell_zones": max_sell_zones,
    }

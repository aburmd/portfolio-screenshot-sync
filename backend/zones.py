"""Buy/Sell Zone computation using Fibonacci retracement + touch point analysis."""

import os
from datetime import date, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

REGION         = os.environ.get("AWS_REGION", "us-west-1")
HISTORY_TABLE  = os.environ.get("STOCK_HISTORY_TABLE", "portfolio-stock-history-dev")
SCREENER_TABLE = os.environ.get("SCREENER_TABLE", "portfolio-screener-dev")

ddb = boto3.resource("dynamodb", region_name=REGION)

# Fibonacci levels in priority order (rank 1 = strongest signal)
FIB_LEVELS   = [0.618, 0.236, 0.786, 0.500, 0.382]
FIB_PRIORITY = {f: i + 1 for i, f in enumerate(FIB_LEVELS)}


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
    pk    = f"{market}#{symbol}"

    resp  = table.query(KeyConditionExpression=Key("market_symbol").eq(pk))
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = table.query(
            KeyConditionExpression=Key("market_symbol").eq(pk),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    agg, daily = None, []
    for item in items:
        d = item.get("date", "")
        if d == "AGG":
            agg = {k: _f(v) if isinstance(v, Decimal) else v for k, v in item.items()}
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
    if daily:
        p = _f(daily[-1].get("close"))
        if p and p > 0:
            return p
    try:
        resp = ddb.Table(SCREENER_TABLE).get_item(Key={"market": market, "symbol": symbol})
        item = resp.get("Item")
        if item and item.get("current_price"):
            return _f(item["current_price"])
    except Exception:
        pass
    return _f(agg.get("current_price")) if agg else None


def _get_qqq_cagr():
    """Get QQQ avg CAGR from history table."""
    try:
        hist_table = ddb.Table(HISTORY_TABLE)
        resp = hist_table.query(
            KeyConditionExpression=Key("market_symbol").eq("US#QQQ"),
            ScanIndexForward=False, Limit=5,
        )
        qqq_price = None
        for item in resp.get("Items", []):
            if item.get("date", "")[:1].isdigit() and item.get("close"):
                qqq_price = _f(item["close"])
                break
        if not qqq_price:
            return None
        resp2 = hist_table.get_item(Key={"market_symbol": "US#QQQ", "date": "AGG"})
        agg   = resp2.get("Item", {})
        cagrs = [c for c in [
            _cagr(qqq_price, _f(agg.get("close_1y")), 1),
            _cagr(qqq_price, _f(agg.get("close_3y")), 3),
            _cagr(qqq_price, _f(agg.get("close_5y")), 5),
        ] if c is not None]
        return round(sum(cagrs) / len(cagrs), 4) if cagrs else None
    except Exception:
        return None


def _window_records(daily, months):
    cutoff = (date.today() - timedelta(days=months * 30)).isoformat()
    return [r for r in daily if r["date"] >= cutoff]


def _buy_fib_bands(hh, ll, n_levels):
    """
    Buy zones: fib retracement levels from HH downward (support below current price).
    fib_price = HH - fib × (HH - LL)
    Band boundaries = midpoints between adjacent fib prices.
    """
    all_fibs = sorted(
        [(f, round(hh - f * (hh - ll), 4)) for f in FIB_LEVELS],
        key=lambda x: -x[1]  # high→low
    )
    prices_only = [hh] + [fp for _, fp in all_fibs] + [ll]
    bands = []
    for i, (fib_ratio, fib_price) in enumerate(all_fibs):
        band_hi = round((prices_only[i] + fib_price) / 2, 4)
        band_lo = round((fib_price + prices_only[i + 2]) / 2, 4)
        bands.append({
            "fib": fib_ratio, "fib_price": fib_price,
            "band_lo": band_lo, "band_hi": band_hi,
            "priority": FIB_PRIORITY[fib_ratio],
        })
    return sorted(bands, key=lambda x: x["priority"])[:n_levels]


def _sell_fib_bands(hh, ll, n_levels):
    """
    Sell zones: fib extension levels from LL upward through and beyond HH.
    fib_price = LL + fib × (HH - LL)  — mirrors buy side upward.
    Extensions beyond HH use ratios > 1.0: 1.236, 1.382, 1.500, 1.618, 1.786.
    Combined pool of retracement (near HH) + extension levels gives zones above current price.
    """
    price_range = hh - ll
    # Retracement levels near/above current: LL + fib*(HH-LL) for fib in FIB_LEVELS
    # Extension levels beyond HH: LL + ext*(HH-LL) for ext in [1.236,1.382,1.500,1.618,1.786]
    ext_levels = [1.236, 1.382, 1.500, 1.618, 1.786]
    all_levels = (
        [(f, round(ll + f * price_range, 4)) for f in FIB_LEVELS] +
        [(e, round(ll + e * price_range, 4)) for e in ext_levels]
    )
    # Sort low→high, assign bands as midpoints between adjacent levels
    all_levels.sort(key=lambda x: x[1])
    prices_only = [ll] + [fp for _, fp in all_levels] + [ll + 2 * price_range]
    bands = []
    for i, (fib_ratio, fib_price) in enumerate(all_levels):
        band_lo = round((prices_only[i] + fib_price) / 2, 4)
        band_hi = round((fib_price + prices_only[i + 2]) / 2, 4)
        # Priority: use FIB_PRIORITY for base levels, ext levels get priority 6-10
        if fib_ratio in FIB_PRIORITY:
            priority = FIB_PRIORITY[fib_ratio]
        else:
            priority = 5 + ext_levels.index(fib_ratio) + 1
        bands.append({
            "fib": fib_ratio, "fib_price": fib_price,
            "band_lo": band_lo, "band_hi": band_hi,
            "priority": priority,
        })
    return sorted(bands, key=lambda x: x["priority"])[:n_levels]


def _count_touches(records, band_lo, band_hi, zone_type):
    """
    Count candle touches within [band_lo, band_hi].
    touch = any of O/H/L/C falls within the band.
    total_touches = candle count.
    primary_touches tiebreaker:
      buy  → High touches (price recovered up through level = confirmed support)
      sell → Low touches  (price dipped down to level = confirmed resistance)
    """
    total, primary = 0, 0
    for r in records:
        o, h, l, c = r.get("open"), r.get("high"), r.get("low"), r.get("close")
        touched = any(v is not None and band_lo <= v <= band_hi for v in [o, h, l, c])
        if touched:
            total += 1
            if zone_type == "buy" and h is not None and band_lo <= h <= band_hi:
                primary += 1
            elif zone_type == "sell" and l is not None and band_lo <= l <= band_hi:
                primary += 1
    return total, primary


def _best_touch_price(records, band_lo, band_hi, zone_type):
    """
    Most-representative price within the band:
      buy  → median of High values (price recovered up to here)
      sell → median of Low values  (price dipped down to here)
    Falls back to None if no primary touches.
    """
    prices = []
    for r in records:
        v = r.get("high") if zone_type == "buy" else r.get("low")
        if v is not None and band_lo <= v <= band_hi:
            prices.append(v)
    if not prices:
        return None
    prices.sort()
    return round(prices[len(prices) // 2], 2)


def _vol_pct(zone_price, band_lo, band_hi, records):
    """Volume at zone as % of total period volume (uniform distribution)."""
    total_vol = sum(r["volume"] for r in records) or 1
    vol_sum   = 0.0
    for r in records:
        hi, lo, vol = r.get("high") or 0, r.get("low") or 0, r.get("volume") or 0
        day_range = hi - lo
        if day_range <= 0 or vol <= 0:
            continue
        overlap  = max(0, min(hi, band_hi) - max(lo, band_lo))
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

    # ── CAGR ─────────────────────────────────────────────────────────────────
    cagr_1y   = _cagr(current_price, _f(agg.get("close_1y")), 1)
    cagr_3y   = _cagr(current_price, _f(agg.get("close_3y")), 3)
    cagr_5y   = _cagr(current_price, _f(agg.get("close_5y")), 5)
    available = [c for c in [cagr_1y, cagr_3y, cagr_5y] if c is not None]
    avg_cagr  = round(sum(available) / len(available), 4) if available else None

    # ── QQQ gate ─────────────────────────────────────────────────────────────
    qqq_avg_cagr   = _get_qqq_cagr()
    qqq_gate_price = None

    # ── windows ──────────────────────────────────────────────────────────────
    w6m  = _window_records(daily, 6)
    w12m = _window_records(daily, 12)
    w24m = _window_records(daily, 24)

    primary = w24m if len(w24m) >= 30 else (w12m if len(w12m) >= 30 else w6m)
    if not primary:
        return None

    period_hh = max(r["high"] for r in primary if r["high"])
    period_ll = min(r["low"]  for r in primary if r["low"])

    # ── Fibonacci bands ───────────────────────────────────────────────────────
    buy_bands  = _buy_fib_bands(period_hh, period_ll, max_buy_zones)
    sell_bands = _sell_fib_bands(period_hh, period_ll, max_sell_zones)

    # ── QQQ gate price ────────────────────────────────────────────────────────
    if qqq_avg_cagr:
        qqq_gate_price = round(period_hh * (1 - 0.80 * qqq_avg_cagr), 2)

    # ── BUILD BUY ZONES ───────────────────────────────────────────────────────
    # Only fib levels below current price qualify as buy zones
    buy_zones = []
    for band in buy_bands:
        if band["fib_price"] >= current_price:
            continue  # above current price → not a buy zone

        # Find best touch count across 6M → 12M → 24M (most touches wins)
        best_total, best_primary, best_records = 0, 0, w6m
        for wrecs in [w6m, w12m, w24m]:
            if len(wrecs) < 10:
                continue
            t, p = _count_touches(wrecs, band["band_lo"], band["band_hi"], "buy")
            if t > best_total or (t == best_total and p > best_primary):
                best_total, best_primary, best_records = t, p, wrecs

        zone_price = _best_touch_price(best_records, band["band_lo"], band["band_hi"], "buy")
        if zone_price is None:
            zone_price = band["fib_price"]  # fallback to theoretical fib level

        vol_pct     = _vol_pct(zone_price, band["band_lo"], band["band_hi"], primary)
        pct_from_hh = round((zone_price - period_hh) / period_hh * 100, 2)

        # QQQ gate: first buy zone (priority 1 = 0.618) must be at or below gate
        qqq_ok = True
        if band["priority"] == 1 and qqq_gate_price:
            qqq_ok = zone_price <= qqq_gate_price

        buy_zones.append({
            "price_level":       zone_price,
            "fib":               band["fib"],
            "fib_price":         band["fib_price"],
            "priority":          band["priority"],
            "touch_count":       best_total,
            "primary_touches":   best_primary,
            "vol_pct":           vol_pct,
            "pct_from_hh":       pct_from_hh,
            "qqq_gate_qualified": qqq_ok,
            "in_zone_now":       band["band_lo"] <= current_price <= band["band_hi"],
        })

    # Sort high→low (nearest first)
    buy_zones.sort(key=lambda x: -x["price_level"])

    # ── position sizing (buy) ─────────────────────────────────────────────────
    n = len(buy_zones)
    if n > 0:
        max_vol = max(z["vol_pct"] for z in buy_zones) or 1
        max_raw = max(
            i * (buy_zones[i]["vol_pct"] / max_vol) for i in range(1, n)
        ) if n > 1 else 1

        for i, z in enumerate(buy_zones):
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
        for z in buy_zones:
            if z["in_zone_now"] and z["total_target_pct"] >= 2 * base_pos:
                z["adjusted_target_pct"] = round(z["total_target_pct"] / 2, 2)
                z["reserved_pct"]        = z["adjusted_target_pct"]
            else:
                z["adjusted_target_pct"] = z["total_target_pct"]
                z["reserved_pct"]        = 0

    # ── BUILD SELL ZONES ──────────────────────────────────────────────────────
    # Only fib levels above current price qualify as sell zones
    raw_sell = []
    for band in sell_bands:
        if band["fib_price"] <= current_price:
            continue  # below or at current price → skip

        best_total, best_primary, best_records = 0, 0, w6m
        for wrecs in [w6m, w12m, w24m]:
            if len(wrecs) < 10:
                continue
            t, p = _count_touches(wrecs, band["band_lo"], band["band_hi"], "sell")
            if t > best_total or (t == best_total and p > best_primary):
                best_total, best_primary, best_records = t, p, wrecs

        zone_price = _best_touch_price(best_records, band["band_lo"], band["band_hi"], "sell")
        if zone_price is None:
            zone_price = band["fib_price"]

        vol_pct     = _vol_pct(zone_price, band["band_lo"], band["band_hi"], primary)
        pct_from_ll = round((zone_price - period_ll) / period_ll * 100, 2)

        raw_sell.append({
            "price_level":     zone_price,
            "fib":             band["fib"],
            "fib_price":       band["fib_price"],
            "priority":        band["priority"],
            "touch_count":     best_total,
            "primary_touches": best_primary,
            "vol_pct":         vol_pct,
            "pct_from_ll":     pct_from_ll,
        })

    raw_sell.sort(key=lambda x: x["price_level"])  # low→high

    # ── sell zone sizing ──────────────────────────────────────────────────────
    ns = len(raw_sell)
    if ns > 0:
        max_vol_s = max(z["vol_pct"] for z in raw_sell) or 1
        max_raw_s = max(
            i * (raw_sell[i]["vol_pct"] / max_vol_s) for i in range(1, ns)
        ) if ns > 1 else 1

        for i, z in enumerate(raw_sell):
            if i == ns - 1:
                z["total_target_pct"] = 0.0
                z["note"] = "final exit = HH x (1 + 0.8 x QQQ_CAGR)"
            elif i == ns - 2:
                z["total_target_pct"] = 0.25
                z["note"] = "just below HH"
            else:
                rel_vol = z["vol_pct"] / max_vol_s
                rank    = ns - 2 - i
                raw     = rank * rel_vol
                z["total_target_pct"] = min(
                    round(0.25 + (raw / max_raw_s) * (max_pos - 0.25), 2)
                    if max_raw_s > 0 else max_pos,
                    max_pos
                )

    # ── final sell price ──────────────────────────────────────────────────────
    final_sell_price  = None
    final_sell_window = "24M"
    if qqq_avg_cagr:
        hh_12m   = max((r["high"] for r in w12m if r["high"]), default=None)
        hh_24m   = max((r["high"] for r in w24m if r["high"]), default=None)
        close_1y = _f(agg.get("close_1y"))
        if close_1y and avg_cagr and (current_price / close_1y - 1) >= avg_cagr:
            hh_ref, final_sell_window = hh_12m or hh_24m, "12M"
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
        "buy_zones":     buy_zones,
        "sell_zones":    raw_sell,
        "cagr_summary": {
            "cagr_1y":           round(cagr_1y  * 100, 2) if cagr_1y  else None,
            "cagr_3y":           round(cagr_3y  * 100, 2) if cagr_3y  else None,
            "cagr_5y":           round(cagr_5y  * 100, 2) if cagr_5y  else None,
            "avg_cagr":          round(avg_cagr * 100, 2) if avg_cagr else None,
            "qqq_avg_cagr":      round(qqq_avg_cagr * 100, 2) if qqq_avg_cagr else None,
            "qqq_gate_price":    qqq_gate_price,
            "final_sell_price":  final_sell_price,
            "final_sell_window": final_sell_window,
        },
        "base_pos":       base_pos,
        "max_pos":        max_pos,
        "max_buy_zones":  max_buy_zones,
        "max_sell_zones": max_sell_zones,
    }

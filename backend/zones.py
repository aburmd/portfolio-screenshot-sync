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
    """Same fib retracement levels as buy, returned for filtering above current price."""
    return _buy_fib_bands(hh, ll, n_levels)


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
                  max_buy_zones=5, max_sell_zones=5, hh_trim_pct=0.25, current_holding_pct=0.0):
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
    # skipped_count = fib levels that were buy candidates but current price already
    # passed through them (fib_price >= current_price from the full band list).
    # This offsets the sizing so remaining zones are treated as later in the ladder.
    total_buy_bands = len([b for b in buy_bands if b["fib_price"] < period_hh])  # all 5 (or max_buy_zones)
    skipped_count   = sum(1 for b in buy_bands if b["fib_price"] >= current_price)

    n = len(buy_zones)
    if n > 0:
        max_vol = max(z["vol_pct"] for z in buy_zones) or 1
        # total ladder size = skipped + remaining; size each zone as if it's
        # at position (skipped + i) in a full (skipped + n) zone ladder
        total_n = skipped_count + n
        max_raw = max(
            (skipped_count + i) * (buy_zones[i]["vol_pct"] / max_vol)
            for i in range(1, n)
        ) if n > 1 else (skipped_count + 1)

        for i, z in enumerate(buy_zones):
            ladder_pos = skipped_count + i  # position in full ladder
            if i == n - 1:  # last remaining zone always gets max_pos
                z["total_target_pct"] = max_pos
            else:
                rel_vol = z["vol_pct"] / max_vol
                raw     = ladder_pos * rel_vol
                z["total_target_pct"] = min(round(
                    base_pos + (raw / max_raw) * (max_pos - base_pos), 2), max_pos)

        # 50% missed entry rule: only applies when no meaningful position held yet
        # If current_holding_pct >= base_pos, user already has a position — skip rule
        for z in buy_zones:
            if z["in_zone_now"] and z["total_target_pct"] >= 2 * base_pos and current_holding_pct < base_pos:
                z["adjusted_target_pct"] = round(z["total_target_pct"] / 2, 2)
                z["reserved_pct"]        = z["adjusted_target_pct"]
            else:
                z["adjusted_target_pct"] = z["total_target_pct"]
                z["reserved_pct"]        = 0

    # ── BUILD SELL ZONES ──────────────────────────────────────────────────────
    # Fib levels above current price + 2 fixed zones (near HH + final exit)
    raw_sell = []
    for band in sell_bands:
        if band["fib_price"] <= current_price:
            continue  # below current price → buy side, skip

        # Touch counting: tiebreaker = Low touches (price dipped to resistance)
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

    # Always append 2 fixed zones
    # 1) Near HH → trim to hh_trim_pct (configurable per stock, default 0.25%)
    raw_sell.append({
        "price_level": period_hh,
        "fib": None, "fib_price": period_hh,
        "priority": 99, "touch_count": 0, "primary_touches": 0,
        "vol_pct": 0.0,
        "pct_from_ll": round((period_hh - period_ll) / period_ll * 100, 2),
        "total_target_pct": hh_trim_pct,
        "note": "just below HH",
    })
    # 2) Final exit above HH — uses stock's own avg CAGR (not QQQ)
    final_sell_price  = None
    final_sell_window = "24M"
    if avg_cagr:
        hh_12m   = max((r["high"] for r in w12m if r["high"]), default=None)
        hh_24m   = max((r["high"] for r in w24m if r["high"]), default=None)
        close_1y = _f(agg.get("close_1y"))
        if close_1y and (current_price / close_1y - 1) >= avg_cagr:
            hh_ref, final_sell_window = hh_12m or hh_24m, "12M"
        else:
            hh_ref = hh_24m or hh_12m
        if hh_ref:
            final_sell_price = round(hh_ref * (1 + 0.80 * avg_cagr), 2)
    raw_sell.append({
        "price_level": final_sell_price or round(period_hh * (1 + 0.80 * (avg_cagr or 0.20)), 2),
        "fib": None, "fib_price": None,
        "priority": 100, "touch_count": 0, "primary_touches": 0,
        "vol_pct": 0.0,
        "pct_from_ll": round(((final_sell_price or period_hh) - period_ll) / period_ll * 100, 2),
        "total_target_pct": 0.0,
        "note": "final exit = HH x (1 + 0.8 x stock_avg_CAGR)",
    })

    # ── sell zone sizing: trim-to % ladder downward from holding → hh_trim_pct ──
    # total_target_pct = what % of portfolio to KEEP after trimming at that level
    # anchor = current_holding_pct if user already holds, else base_pos
    # nearest sell zone → keep anchor, furthest intermediate → keep hh_trim_pct
    # vol-weighted: higher vol = trim more aggressively (keep less)
    intermediate = [z for z in raw_sell if z.get("note") is None]
    ns = len(intermediate)
    if ns > 0:
        max_vol_s = max(z["vol_pct"] for z in intermediate) or 1
        hi = current_holding_pct if current_holding_pct > 0 else base_pos
        lo = hh_trim_pct
        for i, z in enumerate(intermediate):
            t       = i / (ns - 1) if ns > 1 else 0.0
            rel_vol = z["vol_pct"] / max_vol_s
            z["total_target_pct"] = round(hi - t * (hi - lo) * rel_vol, 2)

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
            "hh_trim_pct":       hh_trim_pct,
        },
        "base_pos":       base_pos,
        "max_pos":        max_pos,
        "current_holding_pct": current_holding_pct,
        "max_buy_zones":  max_buy_zones,
        "max_sell_zones": max_sell_zones,
    }

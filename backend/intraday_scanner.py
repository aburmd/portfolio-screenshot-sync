"""Intraday Scanner Lambda.

Triggered every 1 minute by EventBridge during market hours.
For each min1_enabled symbol in portfolio-universe-dev:
  1. Fetch latest 1-min bar from yfinance
  2. Check if price entered a buy/sell zone → SES alert (with cooldown)
  3. Every 5th minute (minute % 5 == 0): write 5-min bar to DDB intraday table (TTL=EOD)

Event payload: {"market": "US"} or {"market": "IN"}

Market hours (EventBridge rules in CDK):
  US:  13:30–20:00 UTC Mon-Fri  (9:30 AM–4:00 PM EST)
  IN:  03:45–10:00 UTC Mon-Fri  (9:15 AM–3:30 PM IST)
"""

import os
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
import yfinance as yf

REGION           = os.environ.get("AWS_REGION", "us-west-1")
UNIVERSE_TABLE   = os.environ.get("UNIVERSE_TABLE", "portfolio-universe-dev")
HISTORY_TABLE    = os.environ.get("STOCK_HISTORY_TABLE", "portfolio-stock-history-dev")
INTRADAY_TABLE   = os.environ.get("INTRADAY_TABLE", "portfolio-intraday-dev")
TRIGGERS_TABLE      = os.environ.get("TRIGGERS_TABLE",      "portfolio-triggers-dev")
SUBSCRIPTIONS_TABLE = os.environ.get("SUBSCRIPTIONS_TABLE", "portfolio-subscriptions-dev")
ALERT_FROM_EMAIL    = os.environ.get("ALERT_FROM_EMAIL",     "")
COGNITO_POOL_ID     = os.environ.get("COGNITO_USER_POOL_ID", "")

# Alert cooldown: don't re-alert same symbol+zone within this many minutes
ALERT_COOLDOWN_MIN = 60

ddb      = boto3.resource("dynamodb", region_name=REGION)
ses      = boto3.client("ses", region_name="us-east-1")
cognito  = boto3.client("cognito-idp", region_name=REGION)


# ── Universe query ────────────────────────────────────────────────────────────

def _get_intraday_symbols(market):
    table = ddb.Table(UNIVERSE_TABLE)
    symbols = []
    kwargs = {"KeyConditionExpression": Key("market").eq(market)}
    while True:
        resp = table.query(**kwargs)
        for item in resp.get("Items", []):
            if item.get("min1_enabled"):
                symbols.append(item["symbol"])
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return symbols


# ── AGG fetch (buy/sell zone boundaries) ─────────────────────────────────────

def _get_agg(market, symbol):
    try:
        resp = ddb.Table(HISTORY_TABLE).get_item(
            Key={"market_symbol": f"{market}#{symbol}", "date": "AGG"}
        )
        item = resp.get("Item")
        if not item:
            return None
        return {k: float(v) if isinstance(v, Decimal) else v for k, v in item.items()}
    except Exception:
        return None


# ── User email lookup ─────────────────────────────────────────────────────────

def _get_user_email(user_id: str) -> str | None:
    """Look up user's email from Cognito by username (user_id)."""
    if not COGNITO_POOL_ID:
        return None
    try:
        resp = cognito.admin_get_user(UserPoolId=COGNITO_POOL_ID, Username=user_id)
        attrs = {a["Name"]: a["Value"] for a in resp.get("UserAttributes", [])}
        return attrs.get("email")
    except Exception:
        return None


# ── Trigger check ─────────────────────────────────────────────────────────────

def _get_subscriber_emails(sub_type):
    """Return all emails subscribed to sub_type."""
    from boto3.dynamodb.conditions import Key as _Key
    try:
        resp = ddb.Table(SUBSCRIPTIONS_TABLE).query(
            KeyConditionExpression=_Key("sub_type").eq(sub_type)
        )
        return [item["email"] for item in resp.get("Items", []) if item.get("email")]
    except Exception as e:
        print(f"  subscriptions query error: {e}")
        return []


def _check_triggers(market: str, symbol: str, price: float):
    """
    Query all active triggers for this market+symbol via GSI.
    For each trigger:
      - direction="below": fire if price <= trigger_price
      - direction="above": fire if price >= trigger_price
    On fire:
      - broadcast="self"        -> email only to the trigger creator
      - broadcast="subscribers" -> email to all price-alert-users subscribers
      - repeat=False -> mark status="fired" (once only)
      - repeat=True  -> leave status="active" (fires every time)
    """
    from boto3.dynamodb.conditions import Key as _Key
    table = ddb.Table(TRIGGERS_TABLE)

    resp = table.query(
        IndexName="market-symbol-index",
        KeyConditionExpression=_Key("market_symbol").eq(f"{market}#{symbol}") & _Key("status").eq("active"),
    )
    for trigger in resp.get("Items", []):
        tp        = float(trigger["trigger_price"])
        dirn      = trigger.get("direction", "below")
        fired     = (dirn == "below" and price <= tp) or (dirn == "above" and price >= tp)
        if not fired:
            continue

        user_id   = trigger["user_id"]
        tid       = trigger["trigger_id"]

        # GSI is eventually consistent — confirm trigger still exists in base table
        check = table.get_item(Key={"user_id": user_id, "trigger_id": tid}).get("Item")
        if not check or check.get("status") != "active":
            continue

        note      = trigger.get("note", "")
        repeat    = trigger.get("repeat", False)
        broadcast = trigger.get("broadcast", "self")

        if broadcast == "subscribers":
            emails = _get_subscriber_emails("price-alert-users")
            for email in emails:
                _send_trigger_alert(symbol, market, price, tp, dirn, note, email)
        else:
            email = _get_user_email(user_id)
            _send_trigger_alert(symbol, market, price, tp, dirn, note, email)

        if not repeat:
            table.update_item(
                Key={"user_id": user_id, "trigger_id": tid},
                UpdateExpression="SET #s = :fired",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":fired": "fired"},
            )


def _send_trigger_alert(symbol, market, price, trigger_price, direction, note, to_email):
    arrow = "↓" if direction == "below" else "↑"
    subject = f"[TRIGGER {arrow}] {symbol} ({market}) hit {trigger_price:.2f} — now {price:.2f}"
    body_lines = [
        f"Your price trigger for {symbol} ({market}) was hit.",
        f"",
        f"  Trigger price : {trigger_price:.2f} ({direction})",
        f"  Current price : {price:.2f}",
    ]
    if note:
        body_lines.append(f"  Note          : {note}")
    body = "\n".join(body_lines)

    if not ALERT_FROM_EMAIL or not to_email:
        print(f"  TRIGGER ALERT (no SES): {subject}")
        return
    try:
        ses.send_email(
            Source=ALERT_FROM_EMAIL,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": body}},
            },
        )
        print(f"  TRIGGER ALERT sent to {to_email}: {subject}")
    except Exception as e:
        print(f"  TRIGGER ALERT failed for {symbol}: {e}")



def _check_zone(price, agg):
    """
    Simple zone check using AGG lookback prices as reference levels.
    Returns (zone_type, zone_label) or (None, None).

    Buy zone: price <= close_1m (1-month low reference) — entered support
    Sell zone: price >= close_1y * 1.10 — near 1-year high territory

    This is a lightweight check; full Fibonacci zone compute is in zones.py.
    The intraday Lambda uses AGG only (no S3 read) to stay fast.
    """
    if not agg:
        return None, None

    close_1m = agg.get("close_1m")
    close_3m = agg.get("close_3m")
    close_1y = agg.get("close_1y")

    # Buy zone: price dropped to or below 1-month reference close
    if close_1m and price <= close_1m:
        return "BUY", f"price {price:.2f} ≤ 1M ref {close_1m:.2f}"

    # Sell zone: price is 10%+ above 1-year reference close (near highs)
    if close_1y and price >= close_1y * 1.10:
        return "SELL", f"price {price:.2f} ≥ 1Y ref×1.10 {close_1y * 1.10:.2f}"

    return None, None


# ── Alert cooldown (stored in intraday table as ALERT# record) ────────────────

def _is_on_cooldown(market, symbol, zone_type):
    """Check if an alert was sent for this symbol+zone within ALERT_COOLDOWN_MIN."""
    try:
        table = ddb.Table(INTRADAY_TABLE)
        resp = table.get_item(
            Key={"market_symbol": f"{market}#{symbol}", "timestamp": f"ALERT#{zone_type}"}
        )
        item = resp.get("Item")
        if not item:
            return False
        last_sent = datetime.fromisoformat(item["last_sent"])
        return (datetime.now(timezone.utc) - last_sent).total_seconds() < ALERT_COOLDOWN_MIN * 60
    except Exception:
        return False


def _set_cooldown(market, symbol, zone_type):
    try:
        ddb.Table(INTRADAY_TABLE).put_item(Item={
            "market_symbol": f"{market}#{symbol}",
            "timestamp":     f"ALERT#{zone_type}",
            "last_sent":     datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


# ── SES alert ─────────────────────────────────────────────────────────────────

def _send_alert(market, symbol, zone_type, zone_label, price):
    if not ALERT_FROM_EMAIL:
        print(f"  ALERT [{zone_type}] {market}:{symbol} @ {price:.2f} — {zone_label} (SES not configured)")
        return
    try:
        subject = f"[{zone_type}] {symbol} ({market}) @ {price:.2f}"
        body    = f"{symbol} ({market}) entered {zone_type} zone\n\n{zone_label}\n\nPrice: {price:.2f}"
        ses.send_email(
            Source=ALERT_FROM_EMAIL,
            Destination={"ToAddresses": [ALERT_FROM_EMAIL]},
            Message={
                "Subject": {"Data": subject},
                "Body":    {"Text": {"Data": body}},
            },
        )
        print(f"  ALERT sent: {subject}")
    except Exception as e:
        print(f"  ALERT failed for {symbol}: {e}")


# ── 5-min bar write ───────────────────────────────────────────────────────────

def _write_5min_bar(market, symbol, bar, ts_str):
    """Write a 5-min OHLCV bar to DDB intraday table with TTL = end of today."""
    now_utc = datetime.now(timezone.utc)
    eod_utc = now_utc.replace(hour=23, minute=59, second=59, microsecond=0)
    ttl     = int(eod_utc.timestamp())

    try:
        ddb.Table(INTRADAY_TABLE).put_item(Item={
            "market_symbol": f"{market}#{symbol}",
            "timestamp":     ts_str,
            "open":          Decimal(str(round(bar["open"],   4))),
            "high":          Decimal(str(round(bar["high"],   4))),
            "low":           Decimal(str(round(bar["low"],    4))),
            "close":         Decimal(str(round(bar["close"],  4))),
            "volume":        int(bar["volume"]),
            "ttl":           ttl,
        })
    except Exception as e:
        print(f"  {symbol}: 5-min write error — {e}")


# ── Per-symbol processing ─────────────────────────────────────────────────────

def _process_symbol(market, symbol, now_utc, write_5min):
    yf_sym = f"{symbol}.NS" if market == "IN" else symbol
    try:
        hist = yf.Ticker(yf_sym).history(period="1d", interval="1m")
    except Exception as e:
        print(f"  {symbol}: yfinance error — {e}")
        return

    if hist is None or hist.empty:
        return

    last_row = hist.iloc[-1]
    price    = float(last_row["Close"])
    bar      = {
        "open":   float(last_row["Open"]),
        "high":   float(last_row["High"]),
        "low":    float(last_row["Low"]),
        "close":  price,
        "volume": int(last_row["Volume"]),
    }
    ts_str = hist.index[-1].strftime("%Y-%m-%dT%H:%M")

    # Zone alert check
    agg = _get_agg(market, symbol)
    zone_type, zone_label = _check_zone(price, agg)
    if zone_type and not _is_on_cooldown(market, symbol, zone_type):
        _send_alert(market, symbol, zone_type, zone_label, price)
        _set_cooldown(market, symbol, zone_type)

    # User-defined price triggers
    _check_triggers(market, symbol, price)

    # Write 5-min bar every 5th minute
    if write_5min:
        _write_5min_bar(market, symbol, bar, ts_str)


# ── Lambda handler ────────────────────────────────────────────────────────────

def handler(event, context):
    market   = event.get("market", "US").upper()
    now_utc  = datetime.now(timezone.utc)
    write_5min = (now_utc.minute % 5 == 0)

    print(f"=== Intraday Scanner: {market} {now_utc.strftime('%H:%M')} UTC write_5min={write_5min} ===")

    symbols = _get_intraday_symbols(market)
    if not symbols:
        print("No min1_enabled symbols — nothing to do")
        return {"market": market, "symbols": 0}

    print(f"min1_enabled symbols: {len(symbols)}")
    for sym in symbols:
        try:
            _process_symbol(market, sym, now_utc, write_5min)
        except Exception as e:
            print(f"  {sym}: unexpected error — {e}")

    print(f"Intraday Scanner done: {len(symbols)} symbols processed")
    return {"market": market, "symbols": len(symbols), "write_5min": write_5min}

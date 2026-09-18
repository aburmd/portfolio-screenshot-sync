"""
Backfill trade lots from current Alpaca positions into portfolio-trade-lots-dev.

Creates one BACKFILL lot entry per position using today's date as the
submitted_at date. This gives a baseline — tax clock starts from today
for all pre-existing positions.

Run once:
  python3 scripts/backfill_trade_lots.py [--paper] [--live]
"""
import argparse
import boto3
import sys
from datetime import date, datetime, timezone

REGION          = "us-west-1"
TRADE_LOTS_TABLE = "portfolio-trade-lots-dev"
USER_POOL_ID    = "us-west-1_DRjc1Cz3h"

ddb = boto3.resource("dynamodb", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)


def get_admin_user_id():
    cognito = boto3.client("cognito-idp", region_name=REGION)
    resp = cognito.list_users(UserPoolId=USER_POOL_ID)
    for u in resp["Users"]:
        attrs = {a["Name"]: a["Value"] for a in u["Attributes"]}
        if attrs.get("custom:role") == "admin":
            return attrs["sub"]
    raise RuntimeError("No admin user found")


def get_alpaca_positions(paper: bool):
    prefix = "/portfolio-sync/alpaca-paper" if paper else "/portfolio-sync/alpaca-live"
    api_key    = ssm.get_parameter(Name=f"{prefix}-key",    WithDecryption=True)["Parameter"]["Value"]
    api_secret = ssm.get_parameter(Name=f"{prefix}-secret", WithDecryption=True)["Parameter"]["Value"]
    from alpaca.trading.client import TradingClient
    client = TradingClient(api_key, api_secret, paper=paper)
    return client.get_all_positions()


def backfill(paper: bool, user_id: str, dry_run: bool):
    label = "PAPER" if paper else "LIVE"
    print(f"\n=== Backfilling {label} positions for user {user_id} ===")

    positions = get_alpaca_positions(paper)
    print(f"Found {len(positions)} open positions")

    table = ddb.Table(TRADE_LOTS_TABLE)
    today = date.today().isoformat()
    ts    = datetime.now(timezone.utc).isoformat()

    written = skipped = 0
    for p in positions:
        sym      = p.symbol
        qty      = float(p.qty)
        avg_price = float(p.avg_entry_price)
        cost     = round(qty * avg_price, 2)

        # SK format: SYMBOL#DATE#backfill-paper / backfill-live
        sk = f"{sym}#{today}#backfill-{'paper' if paper else 'live'}"

        # Check if already exists
        existing = table.get_item(Key={"user_id": user_id, "sk": sk}).get("Item")
        if existing:
            print(f"  {sym}: already backfilled, skipping")
            skipped += 1
            continue

        item = {
            "user_id":      user_id,
            "sk":           sk,
            "order_id":     f"backfill-{'paper' if paper else 'live'}-{sym}",
            "symbol":       sym,
            "side":         "buy",
            "order_type":   "backfill",
            "qty":          str(qty),
            "fill_price":   str(avg_price),
            "cost_basis":   str(cost),
            "notional":     str(cost),
            "paper":        str(paper),
            "status":       "filled",
            "submitted_at": ts,
            "filled_at":    ts,
            "filled_qty":   str(qty),
            "note":         f"Backfilled from Alpaca {'paper' if paper else 'live'} position on {today}",
        }

        if dry_run:
            print(f"  [DRY RUN] {sym}: qty={qty} avg={avg_price} cost={cost}")
        else:
            table.put_item(Item=item)
            print(f"  ✅ {sym}: qty={qty} @ ${avg_price} (cost ${cost})")
        written += 1

    print(f"\n{'[DRY Run] Would write' if dry_run else 'Written'}: {written}, Skipped: {skipped}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--paper", action="store_true", default=False)
    parser.add_argument("--live",  action="store_true", default=False)
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--user-id", default=None, help="Override user_id (default: auto-detect admin)")
    args = parser.parse_args()

    if not args.paper and not args.live:
        print("Specify --paper and/or --live"); sys.exit(1)

    user_id = args.user_id or get_admin_user_id()
    print(f"User ID: {user_id}")

    if args.paper:
        backfill(paper=True,  user_id=user_id, dry_run=args.dry_run)
    if args.live:
        backfill(paper=False, user_id=user_id, dry_run=args.dry_run)


if __name__ == "__main__":
    main()

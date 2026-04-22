"""FastAPI backend: upload, portfolio, CSV export, admin symbol management."""
import io
import csv
import os
import uuid
from typing import List

import boto3
from boto3.dynamodb.conditions import Key, Attr
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from mangum import Mangum

import yfinance as yf

app = FastAPI(title="Portfolio Screenshot Sync")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REGION = os.environ.get("AWS_REGION", "us-west-1")
SCREENSHOTS_BUCKET = os.environ.get("SCREENSHOTS_BUCKET", "portfolio-screenshots-dev")
PORTFOLIO_TABLE = os.environ.get("PORTFOLIO_TABLE", "portfolio-holdings-dev")
SYMBOL_MAP_TABLE = os.environ.get("SYMBOL_MAP_TABLE", "portfolio-symbol-map-dev")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "us-west-1_DRjc1Cz3h")
SHARES_TABLE = os.environ.get("SHARES_TABLE", "portfolio-shares-dev")
UPLOADS_TABLE = os.environ.get("UPLOADS_TABLE", "portfolio-uploads-dev")
SNAPSHOTS_TABLE = os.environ.get("SNAPSHOTS_TABLE", "portfolio-snapshots-dev")
TRANSACTIONS_TABLE = os.environ.get("TRANSACTIONS_TABLE", "portfolio-transactions-dev")
DAILY_PRICES_TABLE = os.environ.get("DAILY_PRICES_TABLE", "portfolio-daily-prices-dev")
BUY_LOTS_TABLE = os.environ.get("BUY_LOTS_TABLE", "portfolio-buy-lots-dev")

s3 = boto3.client("s3", region_name=REGION)
ddb = boto3.resource("dynamodb", region_name=REGION)
cognito = boto3.client("cognito-idp", region_name=REGION)


def _decimal_to_float(items):
    for item in items:
        for k, v in item.items():
            if hasattr(v, "is_finite"):
                item[k] = float(v)
    return items


# --- User endpoints ---

@app.post("/upload")
async def upload_screenshots(files: List[UploadFile] = File(...), user_id: str = Form(...), platform: str = Form("unknown")):
    """Upload one or more screenshots to S3. Lambda triggers on each."""
    results = []
    for file in files:
        key = f"uploads/{user_id}/{platform}/{uuid.uuid4().hex[:8]}_{file.filename}"
        content = await file.read()
        s3.put_object(Bucket=SCREENSHOTS_BUCKET, Key=key, Body=content, ContentType=file.content_type)
        results.append({"s3_key": key, "filename": file.filename})
    return {"uploaded": len(results), "files": results}


@app.get("/upload-status/{user_id}")
async def get_upload_status(user_id: str):
    """Get recent upload processing status for a user."""
    table = ddb.Table(UPLOADS_TABLE)
    resp = table.query(
        IndexName="user-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=20,
    )
    items = resp.get("Items", [])
    for item in items:
        for k, v in item.items():
            if hasattr(v, "is_finite"):
                item[k] = float(v)
    return items


@app.get("/portfolio/{user_id}")
async def get_portfolio(user_id: str):
    """Get user's portfolio from DynamoDB."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return _decimal_to_float(resp.get("Items", []))


@app.post("/prices")
async def get_prices(data: dict):
    """Fetch current prices. USD symbols as-is, INR symbols with .NS suffix."""
    usd_symbols = [s for s in data.get("symbols", []) if s and s != "UNKNOWN"]
    inr_symbols = [s for s in data.get("inr_symbols", []) if s and s != "UNKNOWN"]

    all_yf_symbols = usd_symbols + [f"{s}.NS" for s in inr_symbols]
    if not all_yf_symbols:
        return {}

    try:
        tickers = yf.Tickers(" ".join(all_yf_symbols))
        prices = {}
        for sym in usd_symbols:
            try:
                info = tickers.tickers[sym].fast_info
                prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
            except Exception:
                prices[sym] = None
        for sym in inr_symbols:
            try:
                info = tickers.tickers[f"{sym}.NS"].fast_info
                prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
            except Exception:
                prices[sym] = None
        return prices
    except Exception:
        return {}


@app.get("/exchange-rate/{from_currency}/{to_currency}")
async def get_exchange_rate(from_currency: str, to_currency: str):
    """Get exchange rate. Cached in DDB for 24 hours."""
    from datetime import datetime, timezone as tz
    cache_key = f"{from_currency}_{to_currency}"
    table = ddb.Table(PORTFOLIO_TABLE)

    # Check cache (stored as a special record)
    try:
        resp = table.get_item(Key={"user_id": "__cache__", "stock_name": cache_key})
        item = resp.get("Item")
        if item:
            cached_at = item.get("uploaded_date", "")
            if cached_at:
                from datetime import datetime as dt
                age_hours = (dt.now(tz.utc) - dt.fromisoformat(cached_at)).total_seconds() / 3600
                if age_hours < 24:
                    return {"pair": f"{from_currency}/{to_currency}", "rate": float(item["avg_buy_price"]), "cached": True}
    except Exception:
        pass

    # Fetch fresh rate
    try:
        pair = f"{from_currency}{to_currency}=X"
        ticker = yf.Ticker(pair)
        rate = ticker.fast_info.get("lastPrice") or ticker.fast_info.get("previousClose")
        if rate:
            rate = round(rate, 4)
            # Cache it
            from decimal import Decimal
            table.put_item(Item={
                "user_id": "__cache__",
                "stock_name": cache_key,
                "avg_buy_price": Decimal(str(rate)),
                "uploaded_date": datetime.now(tz.utc).isoformat(),
            })
            return {"pair": f"{from_currency}/{to_currency}", "rate": rate, "cached": False}
    except Exception:
        pass
    return {"pair": f"{from_currency}/{to_currency}", "rate": None}

@app.post("/portfolio/{user_id}/add")
async def add_portfolio_item(
    user_id: str, stock_name: str = Form(...),
    quantity: float = Form(...), avg_buy_price: float = Form(...),
    platform: str = Form("manual"), currency: str = Form("USD"),
):
    """Manually add a stock to portfolio."""
    from decimal import Decimal
    from datetime import datetime, timezone as tz

    # Symbol lookup from symbol-map table
    sym_table = ddb.Table(SYMBOL_MAP_TABLE)
    sym_resp = sym_table.get_item(Key={"stock_name": stock_name.strip().lower()})
    symbol = sym_resp.get("Item", {}).get("symbol", "UNKNOWN")

    table = ddb.Table(PORTFOLIO_TABLE)
    table.put_item(Item={
        "user_id": user_id,
        "stock_name": stock_name,
        "symbol": symbol,
        "quantity": Decimal(str(quantity)),
        "avg_buy_price": Decimal(str(avg_buy_price)),
        "platform_name": platform,
        "currency": currency.upper(),
        "uploaded_date": datetime.now(tz.utc).isoformat(),
    })
    return {"added": stock_name, "symbol": symbol, "platform": platform, "currency": currency}


@app.delete("/portfolio/{user_id}/{stock_name}")
async def delete_portfolio_item(user_id: str, stock_name: str):
    """Delete a stock from user's portfolio."""
    table = ddb.Table(PORTFOLIO_TABLE)
    table.delete_item(Key={"user_id": user_id, "stock_name": stock_name})
    return {"deleted": stock_name}


@app.post("/portfolio/{user_id}/bulk-delete")
async def bulk_delete_portfolio(user_id: str, stock_names: list[str]):
    """Delete multiple stocks from user's portfolio."""
    table = ddb.Table(PORTFOLIO_TABLE)
    deleted = []
    for sn in stock_names:
        table.delete_item(Key={"user_id": user_id, "stock_name": sn})
        deleted.append(sn)
    return {"deleted": deleted, "count": len(deleted)}


@app.put("/portfolio/{user_id}/{stock_name}")
async def update_portfolio_item(
    user_id: str, stock_name: str,
    quantity: float = Form(...), avg_buy_price: float = Form(...),
    current_price: float = Form(None),
):
    """Edit quantity, avg_buy_price, and optionally current_price for a stock."""
    from decimal import Decimal
    table = ddb.Table(PORTFOLIO_TABLE)
    update_expr = "SET quantity = :q, avg_buy_price = :a"
    expr_vals = {
        ":q": Decimal(str(quantity)),
        ":a": Decimal(str(avg_buy_price)),
    }
    if current_price is not None:
        update_expr += ", current_price = :cp"
        expr_vals[":cp"] = Decimal(str(current_price))
    table.update_item(
        Key={"user_id": user_id, "stock_name": stock_name},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_vals,
    )
    return {"updated": stock_name, "quantity": quantity, "avg_buy_price": avg_buy_price, "current_price": current_price}


@app.get("/portfolio/{user_id}/csv")
async def download_csv(user_id: str):
    """Generate CSV from DynamoDB portfolio data on-demand."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = _decimal_to_float(resp.get("Items", []))

    output = io.StringIO()
    if items:
        fields = ["symbol", "stock_name", "quantity", "avg_buy_price", "platform_name", "uploaded_date"]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            writer.writerow(item)

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=portfolio.csv"},
    )


# --- Admin endpoints ---

@app.get("/admin/unknown-symbols")
async def get_unknown_symbols():
    """Get all stocks with UNKNOWN symbol across all users."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.scan(FilterExpression=Attr("symbol").eq("UNKNOWN"))
    items = resp.get("Items", [])
    # Paginate if needed
    while resp.get("LastEvaluatedKey"):
        resp = table.scan(
            FilterExpression=Attr("symbol").eq("UNKNOWN"),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))
    return _decimal_to_float(items)


@app.post("/admin/update-symbol")
async def update_symbol(stock_name: str = Form(...), symbol: str = Form(...)):
    """Admin sets the symbol for a stock_name. Updates symbol-map AND all portfolio records."""
    symbol = symbol.strip().upper()
    stock_name_lower = stock_name.strip().lower()

    # 1. Update symbol-map table
    symbol_map = ddb.Table(SYMBOL_MAP_TABLE)
    symbol_map.put_item(Item={"stock_name": stock_name_lower, "symbol": symbol})

    # 2. Update all portfolio records with this stock_name
    portfolio = ddb.Table(PORTFOLIO_TABLE)
    resp = portfolio.scan(FilterExpression=Attr("stock_name").eq(stock_name))
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = portfolio.scan(
            FilterExpression=Attr("stock_name").eq(stock_name),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    updated = 0
    for item in items:
        portfolio.update_item(
            Key={"user_id": item["user_id"], "stock_name": item["stock_name"]},
            UpdateExpression="SET symbol = :s",
            ExpressionAttributeValues={":s": symbol},
        )
        updated += 1

    return {"stock_name": stock_name, "symbol": symbol, "records_updated": updated}


@app.get("/admin/symbol-map")
async def get_symbol_map():
    """Get all entries in the symbol-map table."""
    table = ddb.Table(SYMBOL_MAP_TABLE)
    resp = table.scan()
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return items


# --- Admin: User management ---

@app.get("/admin/users")
async def list_users():
    """List all Cognito users with their role."""
    users = []
    params = {"UserPoolId": COGNITO_USER_POOL_ID, "Limit": 60}
    while True:
        resp = cognito.list_users(**params)
        for u in resp.get("Users", []):
            attrs = {a["Name"]: a["Value"] for a in u.get("Attributes", [])}
            users.append({
                "username": u["Username"],
                "email": attrs.get("email", ""),
                "role": attrs.get("custom:role", "user"),
                "status": u["UserStatus"],
                "created": u["UserCreateDate"].isoformat(),
            })
        token = resp.get("PaginationToken")
        if not token:
            break
        params["PaginationToken"] = token
    return users


@app.post("/admin/set-role")
async def set_user_role(username: str = Form(...), role: str = Form(...)):
    """Set a user's role to admin or user."""
    role = role.strip().lower()
    if role not in ("admin", "user"):
        return {"error": "role must be 'admin' or 'user'"}

    cognito.admin_update_user_attributes(
        UserPoolId=COGNITO_USER_POOL_ID,
        Username=username,
        UserAttributes=[{"Name": "custom:role", "Value": role}],
    )

    if role == "admin":
        cognito.admin_add_user_to_group(
            UserPoolId=COGNITO_USER_POOL_ID, Username=username, GroupName="admin",
        )
    else:
        try:
            cognito.admin_remove_user_from_group(
                UserPoolId=COGNITO_USER_POOL_ID, Username=username, GroupName="admin",
            )
        except Exception:
            pass

    return {"username": username, "role": role, "status": "updated"}


# --- Sharing endpoints ---

def _resolve_email_to_username(email: str) -> str | None:
    """Look up Cognito username by email."""
    resp = cognito.list_users(
        UserPoolId=COGNITO_USER_POOL_ID, Filter=f'email = "{email}"', Limit=1,
    )
    users = resp.get("Users", [])
    return users[0]["Username"] if users else None


def _resolve_username_to_email(username: str) -> str:
    """Look up email by Cognito username."""
    try:
        resp = cognito.admin_get_user(UserPoolId=COGNITO_USER_POOL_ID, Username=username)
        attrs = {a["Name"]: a["Value"] for a in resp.get("UserAttributes", [])}
        return attrs.get("email", username)
    except Exception:
        return username


@app.post("/shares/request")
async def request_share(owner_id: str = Form(...), viewer_email: str = Form(...)):
    """Owner requests to share dashboard with a viewer. Goes to admin for approval."""
    viewer_id = _resolve_email_to_username(viewer_email.strip())
    if not viewer_id:
        return {"error": f"No user found with email {viewer_email}"}
    if viewer_id == owner_id:
        return {"error": "Cannot share with yourself"}

    table = ddb.Table(SHARES_TABLE)
    from datetime import datetime, timezone as tz
    table.put_item(Item={
        "owner_id": owner_id,
        "viewer_id": viewer_id,
        "owner_email": _resolve_username_to_email(owner_id),
        "viewer_email": viewer_email.strip(),
        "status": "pending_admin",
        "created_at": datetime.now(tz.utc).isoformat(),
    })
    return {"status": "pending_admin", "viewer_email": viewer_email}


@app.get("/shares/my-shares/{user_id}")
async def get_my_shares(user_id: str):
    """Get shares where I am the owner."""
    table = ddb.Table(SHARES_TABLE)
    resp = table.query(KeyConditionExpression=Key("owner_id").eq(user_id))
    return resp.get("Items", [])


@app.get("/shares/shared-with-me/{user_id}")
async def get_shared_with_me(user_id: str):
    """Get approved shares where I am the viewer."""
    table = ddb.Table(SHARES_TABLE)
    resp = table.query(
        IndexName="viewer-index",
        KeyConditionExpression=Key("viewer_id").eq(user_id) & Key("status").eq("approved"),
    )
    return resp.get("Items", [])


@app.get("/shares/pending-viewer/{user_id}")
async def get_pending_viewer(user_id: str):
    """Get share requests pending my (viewer) approval."""
    table = ddb.Table(SHARES_TABLE)
    resp = table.query(
        IndexName="viewer-index",
        KeyConditionExpression=Key("viewer_id").eq(user_id) & Key("status").eq("pending_viewer"),
    )
    return resp.get("Items", [])


@app.post("/shares/viewer-respond")
async def viewer_respond(owner_id: str = Form(...), viewer_id: str = Form(...), action: str = Form(...)):
    """Viewer approves or rejects a share request."""
    new_status = "approved" if action == "approve" else "rejected"
    table = ddb.Table(SHARES_TABLE)
    table.update_item(
        Key={"owner_id": owner_id, "viewer_id": viewer_id},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": new_status},
    )
    return {"status": new_status}


@app.delete("/shares/{owner_id}/{viewer_id}")
async def revoke_share(owner_id: str, viewer_id: str):
    """Either owner or viewer can revoke a share. No admin approval needed."""
    table = ddb.Table(SHARES_TABLE)
    table.delete_item(Key={"owner_id": owner_id, "viewer_id": viewer_id})
    return {"revoked": True}


# --- Admin: Share approval ---

@app.get("/admin/pending-shares")
async def get_pending_shares():
    """Get all share requests pending admin approval."""
    table = ddb.Table(SHARES_TABLE)
    resp = table.query(
        IndexName="status-index",
        KeyConditionExpression=Key("status").eq("pending_admin"),
    )
    return resp.get("Items", [])


@app.post("/admin/share-respond")
async def admin_share_respond(owner_id: str = Form(...), viewer_id: str = Form(...), action: str = Form(...)):
    """Admin approves (→ pending_viewer) or rejects a share request."""
    new_status = "pending_viewer" if action == "approve" else "rejected"
    table = ddb.Table(SHARES_TABLE)
    table.update_item(
        Key={"owner_id": owner_id, "viewer_id": viewer_id},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": new_status},
    )
    return {"status": new_status}


# --- Position Tracker endpoints (admin only) ---

@app.post("/position-tracker/{user_id}/freeze")
async def freeze_portfolio(user_id: str, data: dict = None):
    """Freeze current portfolio as snapshot, diff with last snapshot per platform."""
    from datetime import datetime, timezone as tz
    from decimal import Decimal

    data = data or {}
    initial_date = data.get("initial_date")  # optional: date for auto-deposit on first freeze

    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    snap_table = ddb.Table(SNAPSHOTS_TABLE)

    resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = _decimal_to_float(resp.get("Items", []))

    # Group by platform
    by_platform = {}
    for item in items:
        p = item.get("platform_name", "unknown")
        by_platform.setdefault(p, []).append(item)

    now = datetime.now(tz.utc).isoformat()
    diffs = []

    for platform, stocks in by_platform.items():
        # Save snapshot
        stock_list = [{
            "symbol": s["symbol"], "stock_name": s["stock_name"],
            "quantity": s["quantity"], "avg_buy_price": s["avg_buy_price"],
            "currency": s.get("currency", "USD"),
        } for s in stocks]
        total_inv = sum(s["quantity"] * s["avg_buy_price"] for s in stocks)

        sk = f"{platform}#{now}"
        snap_table.put_item(Item={
            "user_id": user_id, "platform_ts": sk,
            "stocks": _to_decimal_list(stock_list),
            "frozen_date": now, "total_invested": Decimal(str(round(total_inv, 2))),
        })

        # Find previous snapshot for this platform
        prev_resp = snap_table.query(
            KeyConditionExpression=Key("user_id").eq(user_id) & Key("platform_ts").begins_with(f"{platform}#"),
            ScanIndexForward=False, Limit=2,
        )
        prev_items = prev_resp.get("Items", [])
        # First item is the one we just saved, second is previous
        prev_stocks = {}
        prev_date = None
        if len(prev_items) >= 2:
            prev_snap = prev_items[1]
            prev_date = prev_snap.get("frozen_date")
            for s in prev_snap.get("stocks", []):
                prev_stocks[s["symbol"]] = _decimal_map_to_float(s)

        # Build diff
        curr_by_sym = {s["symbol"]: s for s in stock_list}
        changes = []
        all_syms = set(list(curr_by_sym.keys()) + list(prev_stocks.keys()))
        for sym in sorted(all_syms):
            curr = curr_by_sym.get(sym)
            prev = prev_stocks.get(sym)
            if curr and not prev:
                changes.append({"type": "ADDED", "symbol": sym, "stock_name": curr["stock_name"],
                    "curr_qty": curr["quantity"], "curr_avg": curr["avg_buy_price"], "currency": curr["currency"]})
            elif prev and not curr:
                changes.append({"type": "REMOVED", "symbol": sym, "stock_name": prev["stock_name"],
                    "prev_qty": prev["quantity"], "prev_avg": prev["avg_buy_price"],
                    "currency": prev["currency"], "needs_sold_price": True})
            elif curr and prev:
                cq, pq = curr["quantity"], prev["quantity"]
                if abs(cq - pq) < 0.0001:
                    changes.append({"type": "UNCHANGED", "symbol": sym, "stock_name": curr["stock_name"],
                        "qty": cq, "avg": curr["avg_buy_price"], "currency": curr["currency"]})
                elif cq > pq:
                    changes.append({"type": "INCREASED", "symbol": sym, "stock_name": curr["stock_name"],
                        "prev_qty": pq, "curr_qty": cq, "curr_avg": curr["avg_buy_price"], "currency": curr["currency"]})
                else:
                    changes.append({"type": "DECREASED", "symbol": sym, "stock_name": curr["stock_name"],
                        "prev_qty": pq, "curr_qty": cq, "sold_qty": round(pq - cq, 6),
                        "prev_avg": prev["avg_buy_price"], "currency": curr["currency"], "needs_sold_price": True})

        # Auto-create DEPOSIT on first freeze ONLY if no cash flows exist for this platform
        if prev_date is None and total_inv > 0:
            txn_table = ddb.Table(TRANSACTIONS_TABLE)
            # Check if cash flows already exist for this platform
            existing_cfs = txn_table.query(
                KeyConditionExpression=Key("user_id").eq(user_id) & Key("platform_ts_type").begins_with(f"{platform}#"),
                Limit=1,
            )
            if not existing_cfs.get("Items"):
                currency = stocks[0].get("currency", "USD") if stocks else "USD"
                deposit_date = initial_date or now[:10]
                deposit_sk = f"{platform}#{now}#DEPOSIT"
                txn_table.put_item(Item={
                    "user_id": user_id, "platform_ts_type": deposit_sk,
                    "type": "DEPOSIT",
                    "amount": Decimal(str(round(total_inv, 2))),
                    "currency": currency,
                    "date": deposit_date,
                })
                auto_dep = round(total_inv, 2)
            else:
                auto_dep = None

        diffs.append({"platform": platform, "snapshot_date": now,
            "previous_snapshot_date": prev_date, "changes": changes,
            "auto_deposit": auto_dep if prev_date is None else None})

    return {"frozen": len(by_platform), "diffs": diffs}


@app.get("/position-tracker/{user_id}/snapshots")
async def list_snapshots(user_id: str):
    """List all snapshots for a user."""
    table = ddb.Table(SNAPSHOTS_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id), ScanIndexForward=False)
    items = resp.get("Items", [])
    result = []
    for item in items:
        sk = item["platform_ts"]
        platform = sk.split("#")[0]
        stocks = item.get("stocks", [])
        result.append({
            "platform_ts": sk, "platform": platform,
            "frozen_date": item.get("frozen_date"),
            "stock_count": len(stocks),
            "total_invested": float(item.get("total_invested", 0)),
        })
    return result


@app.get("/position-tracker/{user_id}/diff")
async def get_diff(user_id: str, platform: str = None):
    """Get diff between current portfolio and last snapshot."""
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    snap_table = ddb.Table(SNAPSHOTS_TABLE)

    resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items = _decimal_to_float(resp.get("Items", []))

    by_platform = {}
    for item in items:
        p = item.get("platform_name", "unknown")
        by_platform.setdefault(p, []).append(item)

    platforms = [platform] if platform else list(by_platform.keys())
    diffs = []

    for plat in platforms:
        curr_stocks = by_platform.get(plat, [])
        curr_by_sym = {s["symbol"]: s for s in curr_stocks}

        prev_resp = snap_table.query(
            KeyConditionExpression=Key("user_id").eq(user_id) & Key("platform_ts").begins_with(f"{plat}#"),
            ScanIndexForward=False, Limit=1,
        )
        prev_items = prev_resp.get("Items", [])
        prev_stocks = {}
        prev_date = None
        if prev_items:
            prev_date = prev_items[0].get("frozen_date")
            for s in prev_items[0].get("stocks", []):
                prev_stocks[s["symbol"]] = _decimal_map_to_float(s)

        changes = []
        all_syms = set(list(curr_by_sym.keys()) + list(prev_stocks.keys()))
        for sym in sorted(all_syms):
            curr = curr_by_sym.get(sym)
            prev = prev_stocks.get(sym)
            if curr and not prev:
                changes.append({"type": "ADDED", "symbol": sym, "stock_name": curr["stock_name"],
                    "curr_qty": curr["quantity"], "curr_avg": curr["avg_buy_price"], "currency": curr.get("currency", "USD")})
            elif prev and not curr:
                changes.append({"type": "REMOVED", "symbol": sym, "stock_name": prev["stock_name"],
                    "prev_qty": prev["quantity"], "prev_avg": prev["avg_buy_price"],
                    "currency": prev["currency"], "needs_sold_price": True})
            elif curr and prev:
                cq, pq = curr["quantity"], prev["quantity"]
                if abs(cq - pq) < 0.0001:
                    changes.append({"type": "UNCHANGED", "symbol": sym, "stock_name": curr["stock_name"],
                        "qty": cq, "avg": curr["avg_buy_price"], "currency": curr.get("currency", "USD")})
                elif cq > pq:
                    changes.append({"type": "INCREASED", "symbol": sym, "stock_name": curr["stock_name"],
                        "prev_qty": pq, "curr_qty": cq, "curr_avg": curr["avg_buy_price"], "currency": curr.get("currency", "USD")})
                else:
                    changes.append({"type": "DECREASED", "symbol": sym, "stock_name": curr["stock_name"],
                        "prev_qty": pq, "curr_qty": cq, "sold_qty": round(pq - cq, 6),
                        "prev_avg": prev["avg_buy_price"], "currency": curr.get("currency", "USD"), "needs_sold_price": True})

        diffs.append({"platform": plat, "previous_snapshot_date": prev_date, "changes": changes})

    return {"diffs": diffs}


@app.post("/position-tracker/{user_id}/confirm-sells")
async def confirm_sells(user_id: str, data: dict):
    """Record sell transactions for removed/reduced stocks."""
    from datetime import datetime, timezone as tz
    from decimal import Decimal

    txn_table = ddb.Table(TRANSACTIONS_TABLE)
    platform = data.get("platform", "unknown")
    sells = data.get("sells", [])
    now = datetime.now(tz.utc)

    recorded = []
    for i, sell in enumerate(sells):
        ts = (now.isoformat() + f"_{i:03d}")  # ensure unique SK
        sk = f"{platform}#{ts}#SELL"
        txn_table.put_item(Item={
            "user_id": user_id, "platform_ts_type": sk,
            "type": "SELL", "symbol": sell["symbol"],
            "stock_name": sell.get("stock_name", ""),
            "quantity": Decimal(str(sell["quantity"])),
            "avg_buy_price": Decimal(str(sell["avg_buy_price"])),
            "avg_sold_price": Decimal(str(sell["avg_sold_price"])),
            "currency": sell.get("currency", "USD"),
            "date": now.strftime("%Y-%m-%d"),
        })
        recorded.append(sell["symbol"])

    return {"recorded": len(recorded), "symbols": recorded}


@app.post("/position-tracker/{user_id}/cash-flow")
async def add_cash_flow(user_id: str, data: dict):
    """Add a deposit or withdrawal."""
    from datetime import datetime, timezone as tz
    from decimal import Decimal

    txn_table = ddb.Table(TRANSACTIONS_TABLE)
    now = datetime.now(tz.utc).isoformat()
    cf_type = data.get("type", "DEPOSIT").upper()
    platform = data.get("platform", "unknown")
    sk = f"{platform}#{now}#{cf_type}"

    txn_table.put_item(Item={
        "user_id": user_id, "platform_ts_type": sk,
        "type": cf_type,
        "amount": Decimal(str(data["amount"])),
        "currency": data.get("currency", "USD"),
        "date": data.get("date", now[:10]),
    })
    return {"recorded": cf_type, "platform": platform, "amount": data["amount"]}


@app.get("/position-tracker/{user_id}/cash-flows")
async def list_cash_flows(user_id: str):
    """List all cash flows (deposits + withdrawals)."""
    table = ddb.Table(TRANSACTIONS_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id), ScanIndexForward=False)
    items = resp.get("Items", [])
    result = []
    for item in items:
        t = item.get("type", "")
        if t in ("DEPOSIT", "WITHDRAW"):
            result.append({
                "platform_ts_type": item["platform_ts_type"],
                "platform": item["platform_ts_type"].split("#")[0],
                "type": t,
                "amount": float(item.get("amount", 0)),
                "currency": item.get("currency", "USD"),
                "date": item.get("date", ""),
            })
    return result


@app.delete("/position-tracker/{user_id}/cash-flow/{sk}")
async def delete_cash_flow(user_id: str, sk: str):
    """Delete a cash flow entry."""
    from urllib.parse import unquote
    table = ddb.Table(TRANSACTIONS_TABLE)
    table.delete_item(Key={"user_id": user_id, "platform_ts_type": unquote(sk)})
    return {"deleted": True}


@app.get("/position-tracker/{user_id}/positions")
async def get_positions(user_id: str):
    """Get open + closed positions with live prices."""
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    txn_table = ddb.Table(TRANSACTIONS_TABLE)

    # Open positions = current holdings
    resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    open_items = _decimal_to_float(resp.get("Items", []))

    # Fetch live prices
    usd_syms = [h["symbol"] for h in open_items if h.get("currency", "USD") == "USD" and h["symbol"] != "UNKNOWN"]
    inr_syms = [h["symbol"] for h in open_items if h.get("currency") == "INR" and h["symbol"] != "UNKNOWN"]
    live_prices = _fetch_live_prices(usd_syms, inr_syms)

    total_invested = 0
    total_current = 0
    open_positions = []
    for h in open_items:
        invested = h["quantity"] * h["avg_buy_price"]
        cur_price = live_prices.get(h["symbol"]) or h.get("current_price") or h["avg_buy_price"]
        cur_value = h["quantity"] * cur_price
        pnl = cur_value - invested
        total_invested += invested
        total_current += cur_value
        open_positions.append({**h, "cur_price": cur_price, "cur_value": round(cur_value, 2),
            "invested": round(invested, 2), "pnl": round(pnl, 2),
            "pnl_pct": round(pnl / invested * 100, 2) if invested else 0})

    # Closed positions = SELL transactions
    txn_resp = txn_table.query(KeyConditionExpression=Key("user_id").eq(user_id), ScanIndexForward=False)
    closed = []
    for item in txn_resp.get("Items", []):
        if item.get("type") == "SELL":
            qty = float(item.get("quantity", 0))
            buy = float(item.get("avg_buy_price", 0))
            sell = float(item.get("avg_sold_price", 0))
            closed.append({
                "symbol": item.get("symbol"),
                "stock_name": item.get("stock_name", ""),
                "quantity": qty, "avg_buy_price": buy, "avg_sold_price": sell,
                "realized_pnl": round((sell - buy) * qty, 2),
                "currency": item.get("currency", "USD"),
                "date": item.get("date", ""),
                "platform": item["platform_ts_type"].split("#")[0],
            })

    total_pnl = total_current - total_invested
    return {
        "open": open_positions, "closed": closed,
        "summary": {
            "total_invested": round(total_invested, 2),
            "total_current": round(total_current, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round(total_pnl / total_invested * 100, 2) if total_invested else 0,
        },
    }


@app.get("/position-tracker/{user_id}/xirr")
async def calculate_xirr(user_id: str):
    """Calculate XIRR per platform + overall."""
    from datetime import date, datetime

    txn_table = ddb.Table(TRANSACTIONS_TABLE)
    holdings_table = ddb.Table(PORTFOLIO_TABLE)

    # Get all transactions
    txn_resp = txn_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    txns = txn_resp.get("Items", [])

    # Get current holdings
    hold_resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    holdings = _decimal_to_float(hold_resp.get("Items", []))

    # Build cash flows per platform
    platform_cfs = {}  # platform -> [(amount, date)]
    for txn in txns:
        t = txn.get("type", "")
        plat = txn["platform_ts_type"].split("#")[0]
        d = _parse_date(txn.get("date", ""))
        if not d:
            continue
        if t == "DEPOSIT":
            platform_cfs.setdefault(plat, []).append((-float(txn["amount"]), d))
        elif t == "WITHDRAW":
            platform_cfs.setdefault(plat, []).append((float(txn["amount"]), d))
        elif t == "SELL":
            proceeds = float(txn["quantity"]) * float(txn["avg_sold_price"])
            platform_cfs.setdefault(plat, []).append((proceeds, d))

    # Current value per platform — fetch live prices for accurate XIRR
    today = date.today()
    hold_by_plat = {}

    # Collect symbols by currency for price fetch
    usd_syms = [h["symbol"] for h in holdings if h.get("currency", "USD") == "USD" and h["symbol"] != "UNKNOWN"]
    inr_syms = [h["symbol"] for h in holdings if h.get("currency") == "INR" and h["symbol"] != "UNKNOWN"]
    live_prices = _fetch_live_prices(usd_syms, inr_syms)

    for h in holdings:
        p = h.get("platform_name", "unknown")
        hold_by_plat.setdefault(p, 0)
        sym = h["symbol"]
        price = live_prices.get(sym) or h.get("current_price") or h["avg_buy_price"]
        hold_by_plat[p] += h["quantity"] * price

    results = []
    all_cfs = []
    for plat, cfs in platform_cfs.items():
        cur_val = hold_by_plat.get(plat, 0)
        if cur_val > 0:
            cfs.append((cur_val, today))
        xirr_val = _compute_xirr(cfs)
        total_dep = sum(-cf for cf, _ in cfs if cf < 0)
        total_wd = sum(cf for cf, d in cfs if cf > 0 and d != today)
        results.append({
            "platform": plat,
            "xirr": xirr_val, "xirr_pct": f"{xirr_val * 100:.2f}%" if xirr_val is not None else "N/A",
            "total_deposited": round(total_dep, 2),
            "total_withdrawn": round(total_wd, 2),
            "current_value": round(cur_val, 2),
        })
        all_cfs.extend(cfs)

    overall_xirr = _compute_xirr(all_cfs) if all_cfs else None
    overall_dep = sum(-cf for cf, _ in all_cfs if cf < 0)
    overall_val = sum(hold_by_plat.values())

    return {
        "platforms": results,
        "overall": {
            "xirr": overall_xirr,
            "xirr_pct": f"{overall_xirr * 100:.2f}%" if overall_xirr is not None else "N/A",
            "total_deposited": round(overall_dep, 2),
            "current_value": round(overall_val, 2),
        },
    }


# --- Position Tracker helpers ---

def _fetch_live_prices(usd_symbols, inr_symbols):
    """Fetch live prices from Yahoo Finance. Returns {symbol: price}."""
    all_yf = [s for s in usd_symbols if s] + [f"{s}.NS" for s in inr_symbols if s]
    if not all_yf:
        return {}
    try:
        tickers = yf.Tickers(" ".join(all_yf))
        prices = {}
        for sym in usd_symbols:
            try:
                info = tickers.tickers[sym].fast_info
                prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
            except Exception:
                pass
        for sym in inr_symbols:
            try:
                info = tickers.tickers[f"{sym}.NS"].fast_info
                prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
            except Exception:
                pass
        return prices
    except Exception:
        return {}


def _to_decimal_list(stock_list):
    """Convert float values in stock list to Decimal for DDB."""
    from decimal import Decimal
    result = []
    for s in stock_list:
        result.append({
            k: Decimal(str(v)) if isinstance(v, (int, float)) else v
            for k, v in s.items()
        })
    return result


def _decimal_map_to_float(m):
    """Convert Decimal values in a map to float."""
    return {k: float(v) if hasattr(v, "is_finite") else v for k, v in m.items()}


def _parse_date(s):
    """Parse date string to date object."""
    from datetime import date, datetime
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date() if "T" in s else date.fromisoformat(s[:10])
    except Exception:
        return None


def _compute_xirr(cash_flows):
    """Compute XIRR from list of (amount, date) tuples. Returns float or None."""
    if len(cash_flows) < 2:
        return None
    has_neg = any(cf < 0 for cf, _ in cash_flows)
    has_pos = any(cf > 0 for cf, _ in cash_flows)
    if not (has_neg and has_pos):
        return None

    from datetime import date
    sorted_cfs = sorted(cash_flows, key=lambda x: x[1])
    d0 = sorted_cfs[0][1]
    days = [(cf, (d - d0).days / 365.25) for cf, d in sorted_cfs]

    # If all cash flows are on the same day, XIRR is undefined — return simple return
    if all(t == 0 for _, t in days):
        total_out = sum(cf for cf, _ in days if cf > 0)
        total_in = sum(-cf for cf, _ in days if cf < 0)
        return round((total_out / total_in - 1), 6) if total_in > 0 else None

    def npv(rate):
        return sum(cf / (1 + rate) ** t for cf, t in days)

    def dnpv(rate):
        return sum(-t * cf / (1 + rate) ** (t + 1) for cf, t in days)

    rate = 0.1
    for _ in range(100):
        n = npv(rate)
        d = dnpv(rate)
        if abs(d) < 1e-12:
            break
        new_rate = rate - n / d
        if abs(new_rate - rate) < 1e-9:
            return round(new_rate, 6)
        rate = new_rate
        if rate < -0.99:
            rate = -0.99

    return round(rate, 6) if abs(npv(rate)) < 1.0 else None


# --- Performance Chart endpoints (admin only) ---

@app.post("/performance/{user_id}/buy-lot")
async def add_buy_lot(user_id: str, data: dict):
    """Add a buy lot and trigger backfill from buy_date to today."""
    from datetime import datetime, timezone as tz, date
    from decimal import Decimal

    lots_table = ddb.Table(BUY_LOTS_TABLE)
    now = datetime.now(tz.utc).isoformat()
    symbol = data["symbol"].upper()
    buy_date = data.get("buy_date", date.today().isoformat())
    sk = f"{symbol}#{now}"

    lots_table.put_item(Item={
        "user_id": user_id, "symbol_ts": sk,
        "symbol": symbol,
        "stock_name": data.get("stock_name", ""),
        "quantity": Decimal(str(data["quantity"])),
        "buy_price": Decimal(str(data["buy_price"])),
        "buy_date": buy_date,
        "currency": data.get("currency", "USD"),
        "platform": data.get("platform", "unknown"),
    })

    # Trigger backfill for this symbol
    backfill_count = _backfill_symbol(user_id, symbol, buy_date,
        data.get("currency", "USD"), data.get("platform", "unknown"))

    return {"lot": sk, "symbol": symbol, "buy_date": buy_date, "backfilled": backfill_count}


@app.get("/performance/{user_id}/buy-lots")
async def list_buy_lots(user_id: str, symbol: str = None):
    """List buy lots merged with portfolio holdings. Stocks without explicit lots show as default lots."""
    table = ddb.Table(BUY_LOTS_TABLE)
    if symbol:
        resp = table.query(
            KeyConditionExpression=Key("user_id").eq(user_id) & Key("symbol_ts").begins_with(f"{symbol.upper()}#"))
    else:
        resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    lots = _decimal_to_float(resp.get("Items", []))

    # Get portfolio holdings to auto-populate defaults
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    h_resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    holdings = _decimal_to_float(h_resp.get("Items", []))

    # Find symbols that have explicit lots
    symbols_with_lots = {}
    for l in lots:
        sym = l["symbol"]
        symbols_with_lots.setdefault(sym, []).append(l)

    # Add default/remainder lots for holdings
    from datetime import date
    for h in holdings:
        sym = h.get("symbol", "UNKNOWN")
        if sym == "UNKNOWN" or (symbol and sym != symbol.upper()):
            continue
        portfolio_qty = h["quantity"]
        avg_price = h["avg_buy_price"]
        sym_lots = symbols_with_lots.get(sym, [])

        if not sym_lots:
            # No lots at all — show full position as default
            lots.append({
                "user_id": user_id,
                "symbol_ts": f"{sym}#default",
                "symbol": sym,
                "stock_name": h.get("stock_name", ""),
                "quantity": portfolio_qty,
                "buy_price": avg_price,
                "buy_date": date.today().isoformat(),
                "currency": h.get("currency", "USD"),
                "platform": h.get("platform_name", "unknown"),
                "is_default": True,
            })
        else:
            # Has lots — check if remainder needed
            lot_qty_sum = sum(l["quantity"] for l in sym_lots)
            remainder_qty = round(portfolio_qty - lot_qty_sum, 6)
            if remainder_qty > 0.0001:
                # Back-calculate remainder price to preserve weighted avg
                lot_cost_sum = sum(l["quantity"] * l["buy_price"] for l in sym_lots)
                total_cost = avg_price * portfolio_qty
                remainder_price = round((total_cost - lot_cost_sum) / remainder_qty, 2)
                if remainder_price < 0:
                    remainder_price = avg_price
                lots.append({
                    "user_id": user_id,
                    "symbol_ts": f"{sym}#remainder",
                    "symbol": sym,
                    "stock_name": h.get("stock_name", ""),
                    "quantity": round(remainder_qty, 6),
                    "buy_price": remainder_price,
                    "buy_date": date.today().isoformat(),
                    "currency": h.get("currency", "USD"),
                    "platform": h.get("platform_name", "unknown"),
                    "is_remainder": True,
                })

    lots.sort(key=lambda x: (x["symbol"], x.get("buy_date", "")))
    return lots


@app.delete("/performance/{user_id}/buy-lot/{sk}")
async def delete_buy_lot(user_id: str, sk: str):
    """Delete a buy lot."""
    from urllib.parse import unquote
    table = ddb.Table(BUY_LOTS_TABLE)
    table.delete_item(Key={"user_id": user_id, "symbol_ts": unquote(sk)})
    return {"deleted": True}


@app.post("/performance/{user_id}/backfill")
async def backfill_all(user_id: str):
    """Backfill daily prices for all stocks from their earliest lot date."""
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    lots_table = ddb.Table(BUY_LOTS_TABLE)

    resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    holdings = _decimal_to_float(resp.get("Items", []))

    lots_resp = lots_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    lots = _decimal_to_float(lots_resp.get("Items", []))

    # Group lots by symbol to find earliest buy_date
    lots_by_sym = {}
    for lot in lots:
        sym = lot["symbol"]
        lots_by_sym.setdefault(sym, []).append(lot)

    from datetime import date
    total = 0
    for h in holdings:
        sym = h["symbol"]
        if sym == "UNKNOWN":
            continue
        currency = h.get("currency", "USD")
        platform = h.get("platform_name", "unknown")
        sym_lots = lots_by_sym.get(sym, [])
        if sym_lots:
            earliest = min(l["buy_date"] for l in sym_lots)
        else:
            earliest = date.today().isoformat()
        total += _backfill_symbol(user_id, sym, earliest, currency, platform)

    return {"stocks": len(holdings), "records_written": total}


@app.post("/performance/{user_id}/backfill/{symbol}")
async def backfill_one(user_id: str, symbol: str):
    """Backfill daily prices for a single stock."""
    symbol = symbol.upper()
    lots_table = ddb.Table(BUY_LOTS_TABLE)
    holdings_table = ddb.Table(PORTFOLIO_TABLE)

    # Find earliest lot date
    lots_resp = lots_table.query(
        KeyConditionExpression=Key("user_id").eq(user_id) & Key("symbol_ts").begins_with(f"{symbol}#"))
    lots = _decimal_to_float(lots_resp.get("Items", []))

    from datetime import date
    earliest = min((l["buy_date"] for l in lots), default=date.today().isoformat())

    # Get currency/platform from holdings
    resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    holding = next((h for h in _decimal_to_float(resp.get("Items", [])) if h.get("symbol") == symbol), {})
    currency = holding.get("currency", "USD")
    platform = holding.get("platform_name", "unknown")

    count = _backfill_symbol(user_id, symbol, earliest, currency, platform)
    return {"symbol": symbol, "from_date": earliest, "records_written": count}


@app.get("/performance/{user_id}/chart")
async def get_chart_data(user_id: str, period: str = "1Y", start_date: str = None,
                         end_date: str = None, platform: str = "all"):
    """Get portfolio value time series for chart.

    Chart value = stock_value (from daily-prices DDB) + cash_balance (from transactions + lots).
    Period Gain = end_value - start_value - net_cashflows_during_period (pure market movement).
    Period Gain % = XIRR (annualized, consistent with XIRR tab).
    """
    from datetime import date, timedelta
    from dateutil.relativedelta import relativedelta

    today = date.today()

    # 1. Resolve period to start/end dates
    if period == "custom" and start_date and end_date:
        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
    else:
        ed = today
        period_map = {
            "1M": relativedelta(months=1), "3M": relativedelta(months=3),
            "1Y": relativedelta(years=1), "3Y": relativedelta(years=3),
            "5Y": relativedelta(years=5), "10Y": relativedelta(years=10),
        }
        sd = date(today.year, 1, 1) if period == "YTD" else today - period_map.get(period, relativedelta(years=1))

    # 2. Query daily stock prices (one query)
    dp_table = ddb.Table(DAILY_PRICES_TABLE)
    resp = dp_table.query(
        IndexName="date-index",
        KeyConditionExpression=Key("user_id").eq(user_id) & Key("date").between(sd.isoformat(), ed.isoformat()),
    )
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey"):
        resp = dp_table.query(
            IndexName="date-index",
            KeyConditionExpression=Key("user_id").eq(user_id) & Key("date").between(sd.isoformat(), ed.isoformat()),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))

    # 3. Query all transactions (one query, reused for cash flows, XIRR, and period gain)
    txn_table = ddb.Table(TRANSACTIONS_TABLE)
    txn_resp = txn_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    all_txns = txn_resp.get("Items", [])

    # 4. Query all buy lots (one query, reused for cash balance)
    lots_table = ddb.Table(BUY_LOTS_TABLE)
    lots_resp = lots_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    all_lots = _decimal_to_float(lots_resp.get("Items", []))

    # 5. Determine currency
    currencies = set(item.get("currency", "USD") for item in items)
    currency = "INR" if currencies == {"INR"} else "USD"

    # 6. Aggregate stock values by date
    by_date = {}
    for item in items:
        if platform != "all" and item.get("platform", "") != platform:
            continue
        d = item["date"]
        by_date.setdefault(d, {"value": 0, "count": 0})
        by_date[d]["value"] += float(item.get("value", 0))
        by_date[d]["count"] += 1

    data_points = sorted(
        [{"date": d, "value": round(v["value"], 2), "stocks_count": v["count"]} for d, v in by_date.items()],
        key=lambda x: x["date"]
    )

    # 7. Build cash balance timeline: cash = cumulative(deposits - withdrawals) - cumulative(lot costs)
    cash_events = sorted(
        [(t.get("date", ""), float(t.get("amount", 0)) * (1 if t.get("type") == "DEPOSIT" else -1))
         for t in all_txns if t.get("type") in ("DEPOSIT", "WITHDRAW") and t.get("date")]
    )
    lot_costs = sorted(
        [(l.get("buy_date", ""), l["quantity"] * l["buy_price"])
         for l in all_lots if l.get("buy_date")]
    )

    def cash_at_date(target):
        cash = sum(amt for d, amt in cash_events if d <= target)
        cash -= sum(cost for d, cost in lot_costs if d <= target)
        return max(cash, 0)

    # 8. Add cash to each data point → total value = stocks + cash
    for dp in data_points:
        dp["stock_value"] = dp["value"]
        dp["cash"] = round(cash_at_date(dp["date"]), 2)
        dp["value"] = round(dp["stock_value"] + dp["cash"], 2)

    # 9. Extract cash flows and sell events in the visible range (for chart annotations)
    visible_cfs = []
    visible_sells = []
    for txn in all_txns:
        txn_date = txn.get("date", "")
        if not txn_date or txn_date < sd.isoformat() or txn_date > ed.isoformat():
            continue
        t = txn.get("type", "")
        if t in ("DEPOSIT", "WITHDRAW"):
            visible_cfs.append({"date": txn_date, "type": t,
                "amount": float(txn.get("amount", 0)), "currency": txn.get("currency", "USD")})
        elif t == "SELL":
            qty = float(txn.get("quantity", 0))
            buy_p = float(txn.get("avg_buy_price", 0))
            sell_p = float(txn.get("avg_sold_price", 0))
            visible_sells.append({"date": txn_date, "symbol": txn.get("symbol", ""),
                "qty": qty, "realized_pnl": round((sell_p - buy_p) * qty, 2)})

    # 10. Compute summary
    start_val = data_points[0]["value"] if data_points else 0
    end_val = data_points[-1]["value"] if data_points else 0
    actual_start = data_points[0]["date"] if data_points else sd.isoformat()
    actual_end = data_points[-1]["date"] if data_points else ed.isoformat()

    # Period gain (amount) = value change minus deposits/withdrawals during period
    period_net_cf = sum(
        float(t.get("amount", 0)) * (1 if t.get("type") == "DEPOSIT" else -1)
        for t in all_txns
        if t.get("type") in ("DEPOSIT", "WITHDRAW") and actual_start < t.get("date", "") <= actual_end
    )
    period_gain = round(end_val - start_val - period_net_cf, 2)

    # Period gain % = simple return relative to start value (changes per timeframe)
    period_gain_pct = round(period_gain / start_val * 100, 2) if start_val else 0

    end_stock = data_points[-1].get("stock_value", 0) if data_points else 0
    end_cash = data_points[-1].get("cash", 0) if data_points else 0

    # Account P/L breakdown
    total_deposits = sum(float(t.get("amount", 0)) for t in all_txns if t.get("type") == "DEPOSIT")
    total_withdrawals = sum(float(t.get("amount", 0)) for t in all_txns if t.get("type") == "WITHDRAW")
    net_invested = round(total_deposits - total_withdrawals, 2)
    realized_pnl = round(sum(
        (float(t.get("avg_sold_price", 0)) - float(t.get("avg_buy_price", 0))) * float(t.get("quantity", 0))
        for t in all_txns if t.get("type") == "SELL"
    ), 2)
    # Unrealized = current stock value - total lot cost
    total_lot_cost = round(sum(l["quantity"] * l["buy_price"] for l in all_lots), 2)
    unrealized_pnl = round(end_stock - total_lot_cost, 2)
    total_pnl = round(realized_pnl + unrealized_pnl, 2)
    total_pnl_pct = round(total_pnl / net_invested * 100, 2) if net_invested else 0

    return {
        "period": period, "start_date": sd.isoformat(), "end_date": ed.isoformat(),
        "currency": currency,
        "data_points": data_points,
        "cash_flows": visible_cfs,
        "sell_events": visible_sells,
        "summary": {
            "start_value": start_val, "end_value": end_val,
            "period_gain": period_gain, "period_gain_pct": period_gain_pct,
            "end_stock_value": end_stock, "end_cash": end_cash,
            "net_invested": net_invested, "realized_pnl": realized_pnl,
            "unrealized_pnl": unrealized_pnl, "total_pnl": total_pnl, "total_pnl_pct": total_pnl_pct,
        },
    }


# --- Performance Chart helpers ---

def _backfill_symbol(user_id: str, symbol: str, from_date: str, currency: str, platform: str) -> int:
    """Fetch historical prices from Yahoo Finance and write daily records to DDB."""
    from datetime import date, datetime
    from decimal import Decimal
    import yfinance as yf

    # Get all lots for this symbol to compute qty held on each date
    lots_table = ddb.Table(BUY_LOTS_TABLE)
    lots_resp = lots_table.query(
        KeyConditionExpression=Key("user_id").eq(user_id) & Key("symbol_ts").begins_with(f"{symbol}#"))
    lots = _decimal_to_float(lots_resp.get("Items", []))

    # Get current portfolio qty for remainder calculation
    holdings_table = ddb.Table(PORTFOLIO_TABLE)
    h_resp = holdings_table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    holding = next((h for h in _decimal_to_float(h_resp.get("Items", [])) if h.get("symbol") == symbol), None)
    portfolio_qty = holding["quantity"] if holding else 0
    avg_buy = holding.get("avg_buy_price", 0) if holding else 0

    # Lot qty sum
    lot_qty_sum = sum(l["quantity"] for l in lots)
    remainder = portfolio_qty - lot_qty_sum

    # Fetch historical prices
    yf_symbol = f"{symbol}.NS" if currency == "INR" else symbol
    today = date.today()
    try:
        hist = yf.download(yf_symbol, start=from_date, end=(today.isoformat()), progress=False, auto_adjust=True)
    except Exception:
        return 0

    if hist is None or hist.empty:
        return 0

    # Handle multi-level columns from yf.download
    if hasattr(hist.columns, 'levels') and len(hist.columns.levels) > 1:
        hist.columns = hist.columns.droplevel(1)

    dp_table = ddb.Table(DAILY_PRICES_TABLE)
    records = []
    for idx, row in hist.iterrows():
        d = idx.strftime("%Y-%m-%d")
        close = float(row["Close"])
        # Qty held on this date = sum of lots with buy_date <= d
        qty_from_lots = sum(l["quantity"] for l in lots if l["buy_date"] <= d)
        # Add remainder (portfolio qty not covered by lots) — assume held from today
        qty = qty_from_lots + (remainder if remainder > 0 and d >= today.isoformat() else 0)
        # If no lots at all, use portfolio qty for all dates from from_date
        if not lots:
            qty = portfolio_qty
        if qty <= 0:
            continue
        records.append({
            "user_id": user_id, "symbol_date": f"{symbol}#{d}",
            "symbol": symbol, "date": d,
            "close_price": Decimal(str(round(close, 2))),
            "quantity": Decimal(str(round(qty, 6))),
            "currency": currency, "platform": platform,
            "value": Decimal(str(round(qty * close, 2))),
        })

    # Batch write
    with dp_table.batch_writer() as batch:
        for rec in records:
            batch.put_item(Item=rec)

    # Clean up records before earliest lot date (from old/deleted lots)
    if lots:
        earliest_lot_date = min(l["buy_date"] for l in lots)
    else:
        earliest_lot_date = from_date
    # Query all records for this symbol and delete ones before earliest lot
    cleanup_resp = dp_table.query(
        KeyConditionExpression=Key("user_id").eq(user_id) & Key("symbol_date").begins_with(f"{symbol}#"),
    )
    deleted = 0
    with dp_table.batch_writer() as batch:
        for item in cleanup_resp.get("Items", []):
            rec_date = item["symbol_date"].split("#")[1]
            if rec_date < earliest_lot_date:
                batch.delete_item(Key={"user_id": user_id, "symbol_date": item["symbol_date"]})
                deleted += 1

    return len(records)


# Lambda handler via Mangum
handler = Mangum(app)

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
async def get_prices(symbols: list[str]):
    """Fetch current prices for a list of ticker symbols via Yahoo Finance."""
    if not symbols:
        return {}
    # Filter out UNKNOWN and empty
    valid = [s for s in symbols if s and s != "UNKNOWN"]
    if not valid:
        return {}
    try:
        tickers = yf.Tickers(" ".join(valid))
        prices = {}
        for sym in valid:
            try:
                info = tickers.tickers[sym].fast_info
                prices[sym] = round(info.get("lastPrice", 0) or info.get("previousClose", 0), 2)
            except Exception:
                prices[sym] = None
        return prices
    except Exception:
        return {}

@app.post("/portfolio/{user_id}/add")
async def add_portfolio_item(
    user_id: str, stock_name: str = Form(...),
    quantity: float = Form(...), avg_buy_price: float = Form(...),
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
        "platform_name": "manual",
        "uploaded_date": datetime.now(tz.utc).isoformat(),
    })
    return {"added": stock_name, "symbol": symbol}


@app.delete("/portfolio/{user_id}/{stock_name}")
async def delete_portfolio_item(user_id: str, stock_name: str):
    """Delete a stock from user's portfolio."""
    table = ddb.Table(PORTFOLIO_TABLE)
    table.delete_item(Key={"user_id": user_id, "stock_name": stock_name})
    return {"deleted": stock_name}


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


# Lambda handler via Mangum
handler = Mangum(app)

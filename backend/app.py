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

app = FastAPI(title="Portfolio Screenshot Sync")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REGION = os.environ.get("AWS_REGION", "us-west-1")
SCREENSHOTS_BUCKET = os.environ.get("SCREENSHOTS_BUCKET", "portfolio-screenshots-dev")
PORTFOLIO_TABLE = os.environ.get("PORTFOLIO_TABLE", "portfolio-holdings-dev")
SYMBOL_MAP_TABLE = os.environ.get("SYMBOL_MAP_TABLE", "portfolio-symbol-map-dev")
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "us-west-1_DRjc1Cz3h")

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
async def upload_screenshots(files: List[UploadFile] = File(...), user_id: str = Form(...)):
    """Upload one or more screenshots to S3. Lambda triggers on each."""
    results = []
    for file in files:
        key = f"uploads/{user_id}/{uuid.uuid4().hex[:8]}_{file.filename}"
        content = await file.read()
        s3.put_object(Bucket=SCREENSHOTS_BUCKET, Key=key, Body=content, ContentType=file.content_type)
        results.append({"s3_key": key, "filename": file.filename})
    return {"uploaded": len(results), "files": results}


@app.get("/portfolio/{user_id}")
async def get_portfolio(user_id: str):
    """Get user's portfolio from DynamoDB."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return _decimal_to_float(resp.get("Items", []))


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
):
    """Edit quantity and avg_buy_price for a stock."""
    from decimal import Decimal
    table = ddb.Table(PORTFOLIO_TABLE)
    table.update_item(
        Key={"user_id": user_id, "stock_name": stock_name},
        UpdateExpression="SET quantity = :q, avg_buy_price = :a",
        ExpressionAttributeValues={
            ":q": Decimal(str(quantity)),
            ":a": Decimal(str(avg_buy_price)),
        },
    )
    return {"updated": stock_name, "quantity": quantity, "avg_buy_price": avg_buy_price}


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

"""FastAPI backend: upload screenshots to S3, query portfolio from DynamoDB, CSV export."""
import io
import csv
import os
from datetime import datetime, timezone

import boto3
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

s3 = boto3.client("s3", region_name=REGION)
ddb = boto3.resource("dynamodb", region_name=REGION)


@app.post("/upload")
async def upload_screenshot(file: UploadFile = File(...), user_id: str = Form(...)):
    """Upload screenshot to S3. Lambda triggers automatically on S3 event."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    key = f"uploads/{user_id}/{ts}_{file.filename}"
    content = await file.read()
    s3.put_object(Bucket=SCREENSHOTS_BUCKET, Key=key, Body=content, ContentType=file.content_type)
    return {"s3_key": key, "status": "uploaded"}


@app.get("/portfolio/{user_id}")
async def get_portfolio(user_id: str):
    """Get user's portfolio from DynamoDB."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id))
    items = resp.get("Items", [])
    # Convert Decimal to float for JSON serialization
    for item in items:
        for k, v in item.items():
            if hasattr(v, "is_finite"):
                item[k] = float(v)
    return items


@app.get("/portfolio/{user_id}/csv")
async def download_csv(user_id: str):
    """Generate CSV from DynamoDB portfolio data on-demand."""
    table = ddb.Table(PORTFOLIO_TABLE)
    resp = table.query(KeyConditionExpression=boto3.dynamodb.conditions.Key("user_id").eq(user_id))
    items = resp.get("Items", [])

    output = io.StringIO()
    if items:
        fields = ["symbol", "stock_name", "quantity", "avg_buy_price", "platform_name", "uploaded_date"]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for item in items:
            row = {k: float(v) if hasattr(v, "is_finite") else v for k, v in item.items()}
            writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=portfolio.csv"},
    )

# Local Development Guide

## Prerequisites

- Python 3.12+
- Node.js 18+
- AWS CLI configured (`aws configure` with access to us-west-1)

## Install Dependencies (one-time)

### Backend
```bash
cd ~/gitworkspace/portfolio-screenshot-sync/backend
pip3 install -r requirements.txt --break-system-packages
```

### Frontend
```bash
cd ~/gitworkspace/portfolio-screenshot-sync/frontend
npm install
```

---

## Running Locally

You need **2 separate terminal windows/tabs** running simultaneously.

### Terminal 1: Backend (FastAPI on port 8000)

```bash
cd ~/gitworkspace/portfolio-screenshot-sync/backend
python3 -m uvicorn app:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

**Leave this terminal running. Do NOT press Ctrl+Z or Ctrl+C.**

Verify: open http://localhost:8000/docs in browser — you should see Swagger UI.

### Terminal 2: Frontend (React on port 3000)

```bash
cd ~/gitworkspace/portfolio-screenshot-sync/frontend
npm start
```

You should see:
```
Compiled successfully!
Local: http://localhost:3000
```

**Leave this terminal running too.**

---

## Using the App

1. Open http://localhost:3000 in your browser
2. **Create Account** — enter email + password (Cognito)
3. **Verify email** — check inbox for verification code
4. **Sign In** — use your email + password
5. **Upload** — drag & drop or click to select INDmoney screenshots
6. **Wait ~5 seconds** — Lambda processes the screenshot via Textract OCR
7. **Refresh** — click the Refresh button to see portfolio data
8. **Download CSV** — click Download CSV button

---

## Troubleshooting

### "Address already in use" (port 8000)
```bash
lsof -ti:8000 | xargs kill -9
# wait a few seconds, then start backend again
```

### "Address already in use" (port 3000)
```bash
lsof -ti:3000 | xargs kill -9
# wait a few seconds, then start frontend again
```

### Kill ALL background processes
```bash
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

### Frontend shows blank page
- Open browser DevTools (F12 → Console) and check for errors
- Make sure backend is running on port 8000

### Upload works but portfolio is empty
- Lambda takes ~3-5 seconds to process
- Click Refresh button after a few seconds
- Check Lambda logs: `aws logs tail /aws/lambda/portfolio-ocr-dev --since 5m --region us-west-1`

### "UNKNOWN" symbol in portfolio
- Stock name not in symbol-map DDB table
- Add mapping: `aws dynamodb put-item --table-name portfolio-symbol-map-dev --item '{"stock_name":{"S":"stock name lowercase"},"symbol":{"S":"TICKER"}}' --region us-west-1`

---

## Architecture (Local Dev)

```
Browser (http://localhost:3000)
  │
  ├── Cognito (AWS) ── signup/login
  │
  └── FastAPI (http://localhost:8000)
        │
        ├── POST /upload ──→ S3 (portfolio-screenshots-dev)
        │                      │
        │                      └──→ Lambda (portfolio-ocr-dev)
        │                              │
        │                              ├── Textract OCR
        │                              ├── Symbol lookup (portfolio-symbol-map-dev)
        │                              └── DynamoDB upsert (portfolio-holdings-dev)
        │
        ├── GET /portfolio/{user_id} ──→ DynamoDB query
        │
        └── GET /portfolio/{user_id}/csv ──→ DynamoDB → in-memory CSV
```

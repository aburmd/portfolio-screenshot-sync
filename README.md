# portfolio-screenshot-sync

Upload brokerage screenshots, OCR extract portfolio data, sync to Google Sheets.

## Supported Brokers

| Broker | Status |
|--------|--------|
| INDmoney | 🔨 In progress |
| Robinhood | 📋 Planned |
| Webull | 📋 Planned |
| Fidelity | 📋 Planned |

## Architecture

- **Lambda** (`lambda/ocr_processor/`): S3 trigger → Tesseract OCR → DynamoDB upsert
- **Parser Router**: Auto-detects broker from OCR text, routes to broker-specific parser
- **Backend** (`backend/`): FastAPI REST API (auth, upload, portfolio, CSV export, Google Sheets sync)
- **Frontend** (`frontend/`): React app (login, dashboard, upload, portfolio view)

## Lambda Build & Deploy

```bash
# Build Lambda zip
./scripts/package.sh

# Upload to S3 artifact bucket
./scripts/upload-artifact.sh dev

# Deploy via CDK (from CDK repo)
cd ~/gitworkspace/portfolio-screenshot-sync-cdk/cdk
npx cdk deploy PortfolioSyncMainStack-dev -c env=dev \
  -c lambdaArtifactKey=lambda/ocr-processor-<git-sha>.zip
```

## Related

- CDK repo: [portfolio-screenshot-sync-cdk](https://github.com/aburmd/portfolio-screenshot-sync-cdk)

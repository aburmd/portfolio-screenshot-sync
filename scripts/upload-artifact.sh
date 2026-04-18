#!/bin/bash
set -euo pipefail

ENV="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/.build"
GIT_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "local")
ZIP_NAME="ocr-processor-${GIT_SHA}.zip"
S3_BUCKET="portfolio-sync-artifacts-${ENV}"
S3_KEY="lambda/${ZIP_NAME}"

if [ ! -f "$BUILD_DIR/$ZIP_NAME" ]; then
  echo "ERROR: $BUILD_DIR/$ZIP_NAME not found. Run scripts/package.sh first."
  exit 1
fi

echo "=== Uploading $ZIP_NAME to s3://$S3_BUCKET/$S3_KEY ==="
aws s3 cp "$BUILD_DIR/$ZIP_NAME" "s3://$S3_BUCKET/$S3_KEY" --region us-west-1

echo "=== Done ==="
echo "Lambda artifact key: $S3_KEY"
echo ""
echo "Deploy with:"
echo "  cd ~/gitworkspace/portfolio-screenshot-sync-cdk/cdk"
echo "  npx cdk deploy PortfolioSyncMainStack-${ENV} -c env=${ENV} -c lambdaArtifactKey=${S3_KEY}"

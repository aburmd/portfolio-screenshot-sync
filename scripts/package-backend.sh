#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
BUILD_DIR="$PROJECT_ROOT/.build"
GIT_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "local")
ZIP_NAME="backend-api-${GIT_SHA}.zip"

echo "=== Building Backend Lambda: $ZIP_NAME ==="

rm -rf "$BUILD_DIR/backend-package"
mkdir -p "$BUILD_DIR/backend-package"

echo "Installing dependencies..."
pip install -r "$BACKEND_DIR/requirements.txt" \
  --target "$BUILD_DIR/backend-package" \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  --quiet 2>&1 | grep -v "WARNING" || true

echo "Copying backend code..."
cp "$BACKEND_DIR/app.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/daily_price.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/screener.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/ma_scanner.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/daily_scanner.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/alpaca_client.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/auth.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/zones.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/eod_scanner.py" "$BUILD_DIR/backend-package/"
cp "$BACKEND_DIR/intraday_scanner.py" "$BUILD_DIR/backend-package/"

echo "Stripping pyarrow (provided by Lambda Layer or unused)..."
cd "$BUILD_DIR/backend-package"
rm -rf pyarrow pyarrow-*.dist-info

echo "Creating zip..."
cd "$BUILD_DIR/backend-package"
zip -r "$BUILD_DIR/$ZIP_NAME" . -q

echo "=== Built: $BUILD_DIR/$ZIP_NAME ==="
echo "Size: $(du -h "$BUILD_DIR/$ZIP_NAME" | cut -f1)"

# Upload to S3
echo "Uploading to S3..."
aws s3 cp "$BUILD_DIR/$ZIP_NAME" "s3://portfolio-sync-artifacts-dev/lambda/$ZIP_NAME" --region us-west-1

# Deploy to ALL Lambda functions that share this codebase
LAMBDAS=("portfolio-api-dev" "portfolio-eod-scanner-dev" "portfolio-daily-scanner-dev" "portfolio-intraday-scanner-dev")
for FN in "${LAMBDAS[@]}"; do
  echo "Deploying to $FN..."
  aws lambda update-function-code \
    --function-name "$FN" \
    --s3-bucket portfolio-sync-artifacts-dev \
    --s3-key "lambda/$ZIP_NAME" \
    --region us-west-1 \
    --query 'FunctionName' --output text
  aws lambda wait function-updated --function-name "$FN" --region us-west-1
  echo "  $FN ✅"
done
echo "=== All Lambdas deployed ==="

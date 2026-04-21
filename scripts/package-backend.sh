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

echo "Creating zip..."
cd "$BUILD_DIR/backend-package"
zip -r "$BUILD_DIR/$ZIP_NAME" . -q

echo "=== Built: $BUILD_DIR/$ZIP_NAME ==="
echo "Size: $(du -h "$BUILD_DIR/$ZIP_NAME" | cut -f1)"

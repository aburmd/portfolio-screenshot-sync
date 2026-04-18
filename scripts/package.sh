#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$PROJECT_ROOT/lambda/ocr_processor"
BUILD_DIR="$PROJECT_ROOT/.build"
GIT_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "local")
ZIP_NAME="ocr-processor-${GIT_SHA}.zip"

echo "=== Building Lambda package: $ZIP_NAME ==="

rm -rf "$BUILD_DIR/package"
mkdir -p "$BUILD_DIR/package"

# Install dependencies (cross-compile for Lambda x86_64)
echo "Installing dependencies..."
pip install -r "$LAMBDA_DIR/requirements.txt" \
  --target "$BUILD_DIR/package" \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  --quiet

# Copy Lambda code
echo "Copying Lambda code..."
cp "$LAMBDA_DIR/handler.py" "$BUILD_DIR/package/"
cp -r "$LAMBDA_DIR/ocr" "$BUILD_DIR/package/"
cp -r "$LAMBDA_DIR/parsers" "$BUILD_DIR/package/"
cp -r "$LAMBDA_DIR/common" "$BUILD_DIR/package/"

# Create zip
echo "Creating zip..."
cd "$BUILD_DIR/package"
zip -r "$BUILD_DIR/$ZIP_NAME" . -q

echo "=== Built: $BUILD_DIR/$ZIP_NAME ==="
echo "Size: $(du -h "$BUILD_DIR/$ZIP_NAME" | cut -f1)"

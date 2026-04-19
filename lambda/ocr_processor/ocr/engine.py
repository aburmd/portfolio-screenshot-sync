"""OCR engine: extract text from screenshot images using Amazon Textract."""
import os
import logging

import boto3

logger = logging.getLogger(__name__)

REGION = os.environ.get("AWS_REGION", "us-west-1")
textract = boto3.client("textract", region_name=REGION)


def extract_text_from_s3(bucket: str, key: str) -> str:
    """Extract text from an S3 image using Amazon Textract.

    Returns LINE-level text joined by newlines (preserves reading order).
    """
    try:
        response = textract.detect_document_text(
            Document={"S3Object": {"Bucket": bucket, "Name": key}}
        )
        lines = [
            block["Text"]
            for block in response.get("Blocks", [])
            if block["BlockType"] == "LINE"
        ]
        return "\n".join(lines)
    except Exception as e:
        logger.exception("Textract failed for s3://%s/%s: %s", bucket, key, e)
        return ""


def extract_text_from_image(image_path: str) -> str:
    """Extract text from a local image file using Tesseract (local dev fallback)."""
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(image_path)
        return pytesseract.image_to_string(img).strip()
    except ImportError:
        logger.error("pytesseract not installed — use extract_text_from_s3 in Lambda")
        return ""

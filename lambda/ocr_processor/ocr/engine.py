"""OCR engine: extract text from screenshot images using Tesseract."""
import logging

logger = logging.getLogger(__name__)


def extract_text_from_image(image_path: str) -> str:
    """Extract text from an image file using pytesseract.

    Falls back to empty string if Tesseract is not available.
    """
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
        return text.strip()
    except ImportError:
        logger.error("pytesseract or Pillow not installed")
        return ""
    except Exception as e:
        logger.exception("OCR failed for %s: %s", image_path, e)
        return ""

"""
All authentication and input-sanitization utilities.
These are imported by route handlers and the app middleware.
"""
import re
import secrets
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from core.config import settings

_API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)
_SAFE_FILENAME = re.compile(r"[^\w\-_\. ]")


def require_api_key(api_key: str = Security(_API_KEY_HEADER)) -> str:
    """
    Constant-time comparison prevents timing side-channel attacks.
    Returns the key on success, raises 401/403 on failure.
    """
    if not api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header is required.")
    if not secrets.compare_digest(api_key, settings.demo_api_key):
        raise HTTPException(status_code=403, detail="Invalid API key.")
    return api_key


def assert_pdf_content_type(content_type: str | None) -> None:
    allowed = {"application/pdf", "application/x-pdf", "application/octet-stream"}
    if (content_type or "").split(";")[0].strip() not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are accepted (Content-Type must be application/pdf).",
        )


def sanitize_filename(name: str) -> str:
    """Strip path traversal and dangerous characters, cap length."""
    name = name.replace("/", "").replace("\\", "").replace("..", "")
    name = _SAFE_FILENAME.sub("", name)
    return name[:100] or "upload.pdf"


def sanitize_question(text: str) -> str:
    """Remove characters that could cause injection in prompt context."""
    text = re.sub(r"[<>{}\\|\\\\^~\[\]`]", "", text)
    return text.strip()[:500]

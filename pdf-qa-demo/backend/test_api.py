"""
Run with: pytest test_api.py -v
"""
import io
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from main import app
from core.config import settings

HEADERS = {"X-API-Key": settings.demo_api_key}
FAKE_PDF = b"%PDF-1.4 minimal"  # will fail content validation — used for auth tests


@pytest.mark.asyncio
async def test_health_no_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_upload_requires_api_key():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/upload",
                         files={"file": ("x.pdf", FAKE_PDF, "application/pdf")})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_upload_wrong_api_key():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/upload",
                         headers={"X-API-Key": "wrong"},
                         files={"file": ("x.pdf", FAKE_PDF, "application/pdf")})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_upload_rejects_non_pdf():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/upload",
                         headers=HEADERS,
                         files={"file": ("x.txt", b"hello world", "text/plain")})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_query_requires_api_key():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/query",
                         json={"doc_id": "x", "question": "what is this?"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_query_short_question_rejected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/query",
                         headers=HEADERS,
                         json={"doc_id": "x", "question": "hi"})
    # 422 = Pydantic validation (min_length=3 fails for "hi" after sanitize strips it)
    assert r.status_code in (400, 422)


@pytest.mark.asyncio
async def test_insight_requires_selected_document():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/insights", headers=HEADERS, json={"mode": "summary"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_insight_requires_api_key():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/insights", json={"doc_id": "x", "mode": "key_points"})
    assert r.status_code == 401

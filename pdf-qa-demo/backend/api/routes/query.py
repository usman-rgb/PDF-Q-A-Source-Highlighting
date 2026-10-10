from fastapi import APIRouter, Depends, HTTPException, Request
from google.genai.errors import APIError
from core.security import require_api_key, sanitize_question
from core.rate_limiter import limiter
from services.rag_pipeline import rag_pipeline
from models.schemas import InsightRequest, InsightResponse, QueryRequest, QueryResponse
from services.database import database

router = APIRouter()


@router.post("/query", response_model=QueryResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("10/minute")
async def query_document(request: Request, body: QueryRequest):
    body.question = sanitize_question(body.question)
    if not body.question:
        raise HTTPException(status_code=400, detail="Question is empty after sanitization.")
    if not body.selected_doc_ids:
        raise HTTPException(status_code=400, detail="Select at least one document first.")
    if not database.owns_documents(request.headers.get("X-User-Email", "local@docmind"), body.selected_doc_ids):
        raise HTTPException(status_code=404, detail="One or more selected documents were not found.")

    try:
        return await rag_pipeline.run(body)
    except APIError as exc:
        raise HTTPException(
            status_code=502,
            detail="AI service is unavailable. Check the Gemini model and API key configuration.",
        ) from exc
    except Exception as exc:
        # Never leak internal error details to the client
        raise HTTPException(status_code=500, detail="Query failed. Please retry.") from exc


@router.post("/insights", response_model=InsightResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("6/minute")
async def document_insight(request: Request, body: InsightRequest):
    if not body.selected_doc_ids:
        raise HTTPException(status_code=400, detail="Select at least one document first.")
    if not database.owns_documents(request.headers.get("X-User-Email", "local@docmind"), body.selected_doc_ids):
        raise HTTPException(status_code=404, detail="One or more selected documents were not found.")
    try:
        return await rag_pipeline.run_insight(body)
    except APIError as exc:
        raise HTTPException(status_code=502, detail="AI service is unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Insight generation failed. Please retry.") from exc

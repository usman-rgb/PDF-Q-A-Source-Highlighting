from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Request
from google.genai.errors import APIError
from core.security import require_api_key, assert_pdf_content_type, sanitize_filename
from core.rate_limiter import limiter
from services.pdf_processor import pdf_processor
from services.embedder import embedder
from services.vector_store import vector_store
from models.schemas import UploadResponse
from services.database import database
from core.config import settings

router = APIRouter()


@router.post("/upload", response_model=UploadResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("5/hour")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
    # Content-type check
    assert_pdf_content_type(file.content_type)

    data = await file.read()
    safe_name = sanitize_filename(file.filename or "upload.pdf")

    # Deep PDF validation
    try:
        pdf_processor.validate(data, safe_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Extract text + bbox chunks
    doc_id, chunks = pdf_processor.process(data, safe_name)

    if not chunks:
        raise HTTPException(
            status_code=422,
            detail=(
                "No extractable text found. "
                "Ensure this is a text-based PDF, not a scanned image."
            ),
        )

    # Embed and index
    try:
        embeddings = await embedder.embed_texts([c.text for c in chunks])
    except APIError as exc:
        raise HTTPException(
            status_code=502,
            detail="Embedding service is unavailable. Check the Gemini model and API key configuration.",
        ) from exc
    pages = max(c.page for c in chunks) + 1
    stored_path = settings.upload_path / f"{doc_id}.pdf"
    stored_path.write_bytes(data)
    vector_store.store(chunks, embeddings)
    database.add_document(
        request.headers.get("X-User-Email", "local@docmind"),
        doc_id, safe_name, str(stored_path), pages, len(chunks),
    )
    return UploadResponse(
        doc_id=doc_id,
        filename=safe_name,
        pages=pages,
        chunks=len(chunks),
        message=f"PDF processed: {pages} pages, {len(chunks)} chunks indexed.",
    )

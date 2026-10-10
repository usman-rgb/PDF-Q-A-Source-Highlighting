# Agent.md — PDF Q&A + Source Highlighting RAG Demo
> Fiverr Main Gig · Complete Build Specification  
> **AI Agent:** Follow every phase top-to-bottom. Complete all checklist items before proceeding. Never skip security steps.

---

## What This Builds

A full-stack RAG application where a user uploads any PDF, asks natural language questions, and the UI renders the exact passages in the document that the AI used to form its answer — highlighted with colored bounding boxes directly on the rendered PDF page.

**Stack**
| Layer | Technology |
|---|---|
| Frontend | TypeScript + Vite + Three.js (particle background) + PDF.js (viewer) |
| Backend | FastAPI + Python 3.12 |
| Vector DB | ChromaDB (persistent, local) |
| Embeddings | OpenAI `text-embedding-3-small` |
| LLM | OpenAI `gpt-4o-mini` |
| Security | API Key Auth, Rate Limiting, File Validation, Security Headers |
| Deploy | Docker Compose |

---

## Architecture

```
Browser
 ├─ Three.js Canvas ← particle-network background (the visual centrepiece)
 └─ UI Layer (TypeScript)
     ├─ Drop-zone uploader
     ├─ PDF Viewer (PDF.js canvas + overlay canvas for highlights)
     └─ Chat Panel (messages + source chips)
          │
          │  HTTP + X-API-Key header
          ▼
     FastAPI  (/api/v1)
      ├─ Security Middleware  ← rate limit, API key, CSP headers
      ├─ POST /upload         ← validate → extract → embed → store
      └─ POST /query          ← embed question → retrieve → generate → return (answer + bbox coords)
           │
           ├─ ChromaDB  ← stores text chunks + bbox metadata
           └─ OpenAI    ← embeddings + chat completion
```

---

## Project Structure

```
pdf-qa-demo/
├── backend/
│   ├── main.py
│   ├── .env                    ← create from .env.example
│   ├── .env.example
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── upload.py
│   │       ├── query.py
│   │       └── health.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── security.py
│   │   └── rate_limiter.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── pdf_processor.py
│   │   ├── embedder.py
│   │   ├── vector_store.py
│   │   └── rag_pipeline.py
│   └── models/
│       ├── __init__.py
│       └── schemas.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── .env                    ← create from .env.example
│   ├── .env.example
│   ├── nginx.conf
│   ├── Dockerfile
│   └── src/
│       ├── main.ts
│       ├── style.css
│       ├── types/
│       │   └── index.ts
│       ├── three/
│       │   └── scene.ts
│       ├── ui/
│       │   ├── uploader.ts
│       │   ├── chat.ts
│       │   └── pdfViewer.ts
│       └── api/
│           └── client.ts
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## Phase 1 — Environment Setup

### 1.1 Create Directory Tree
```bash
mkdir -p pdf-qa-demo/{backend/{api/routes,core,services,models},frontend/src/{three,ui,api,types}}
cd pdf-qa-demo
git init
```

### 1.2 .gitignore
```gitignore
# Secrets
.env
.env.local

# Python
__pycache__/
*.pyc
*.pyo
.venv/
*.egg-info/

# Storage (never commit user data)
uploads/
chroma_db/

# Frontend
node_modules/
dist/

# System
.DS_Store
*.log
```

### 1.3 backend/.env.example
```env
# ── LLM ──────────────────────────────────
OPENAI_API_KEY=sk-replace-me
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_MODEL=text-embedding-3-small

# ── App ──────────────────────────────────
# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
APP_SECRET_KEY=replace-with-random-64-char-hex
# This key is what the frontend sends as X-API-Key header
DEMO_API_KEY=replace-with-your-demo-api-key
APP_ENV=development
# Comma-separated list of allowed frontend origins
CORS_ORIGINS=http://localhost:5173

# ── Storage ───────────────────────────────
CHROMA_DB_PATH=./chroma_db
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=20
MAX_PAGES=50

# ── Rate Limiting ─────────────────────────
RATE_LIMIT_QUERY_PER_MINUTE=10
RATE_LIMIT_UPLOAD_PER_HOUR=5
```

### 1.4 frontend/.env.example
```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_API_KEY=replace-with-your-demo-api-key
```

### 1.5 backend/requirements.txt
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
python-multipart==0.0.12
pymupdf==1.24.10
chromadb==0.5.18
openai==1.51.0
python-jose[cryptography]==3.3.0
slowapi==0.1.9
python-dotenv==1.0.1
pydantic==2.9.2
pydantic-settings==2.5.2
aiofiles==24.1.0
httpx==0.27.2
pytest==8.3.3
pytest-asyncio==0.24.0
```

### 1.6 Install Dependencies
```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # then fill in real values

# Frontend
cd ../frontend
npm create vite@latest . -- --template vanilla-ts
npm install three@0.169.0 gsap@3.12.5 pdfjs-dist@4.6.82 axios@1.7.7
npm install -D @types/three@0.169.0 vite@5.4.8 typescript@5.5.4
cp .env.example .env   # then fill in real values
```

---

## Phase 2 — Backend Core

### 2.1 backend/core/config.py
```python
from pydantic_settings import BaseSettings
from pydantic import field_validator
from pathlib import Path
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    openai_api_key: str
    openai_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"

    # App
    app_secret_key: str
    demo_api_key: str
    app_env: str = "development"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Storage
    chroma_db_path: str = "./chroma_db"
    upload_dir: str = "./uploads"
    max_file_size_mb: int = 20
    max_pages: int = 50

    # Rate Limiting
    rate_limit_query_per_minute: int = 10
    rate_limit_upload_per_hour: int = 5

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors(cls, v: str | list) -> list[str]:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",")]
        return v

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    model_config = {"env_file": ".env", "case_sensitive": False}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

### 2.2 backend/models/schemas.py
```python
from pydantic import BaseModel, Field
from datetime import datetime, timezone


class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    pages: int
    chunks: int
    message: str


class SourceChunk(BaseModel):
    text: str
    page: int           # 0-indexed page number
    page_label: str     # human-readable, e.g. "3"
    bbox: list[float]   # [x0, y0, x1, y1] — normalised 0-1 relative to page dims
    chunk_index: int
    score: float


class QueryRequest(BaseModel):
    doc_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=3, max_length=500)
    top_k: int = Field(default=3, ge=1, le=5)


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    doc_id: str
    question: str
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str
```

### 2.3 backend/services/pdf_processor.py
```python
"""
Extracts text chunks with normalised bounding boxes from PDFs.
Each chunk carries (text, page_number, bbox) so the frontend can
draw a highlight rectangle on the rendered PDF canvas.
"""
import uuid
from dataclasses import dataclass
from pathlib import Path
import fitz  # PyMuPDF
from core.config import settings


@dataclass
class PDFChunk:
    text: str
    page: int           # 0-indexed
    page_label: str
    bbox: list[float]   # [x0, y0, x1, y1] normalised 0–1
    chunk_index: int
    doc_id: str

    @property
    def id(self) -> str:
        return f"{self.doc_id}_{self.page}_{self.chunk_index}"


class PDFProcessor:
    CHUNK_CHARS = 450
    OVERLAP_WORDS = 12
    MIN_CHUNK_CHARS = 40

    # ── Validation ────────────────────────────────────────────────────────────

    def validate(self, data: bytes, filename: str) -> None:
        """Raise ValueError for any security or quality issue."""
        if not data[:4] == b"%PDF":
            raise ValueError("File is not a valid PDF (bad magic bytes).")

        if not filename.lower().endswith(".pdf"):
            raise ValueError("Only .pdf files are accepted.")

        if len(data) > settings.max_file_size_bytes:
            raise ValueError(
                f"File exceeds the {settings.max_file_size_mb} MB limit."
            )

        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except fitz.FileDataError as exc:
            raise ValueError("Corrupted or unreadable PDF.") from exc

        if doc.needs_pass:
            raise ValueError("Password-protected PDFs are not supported.")

        if doc.page_count > settings.max_pages:
            raise ValueError(
                f"PDF has {doc.page_count} pages — max allowed is {settings.max_pages}."
            )

        doc.close()

    # ── Processing ────────────────────────────────────────────────────────────

    def process(self, data: bytes, filename: str) -> tuple[str, list[PDFChunk]]:
        """Return (doc_id, list[PDFChunk])."""
        doc_id = str(uuid.uuid4())
        doc = fitz.open(stream=data, filetype="pdf")
        chunks: list[PDFChunk] = []
        chunk_index = 0

        for page_num in range(doc.page_count):
            page = doc[page_num]
            pw, ph = page.rect.width, page.rect.height
            page_label = str(page_num + 1)

            # word-level: (x0, y0, x1, y1, word, block, line, word_n)
            words = page.get_text("words")
            if not words:
                continue

            buf_words: list[str] = []
            buf_chars = 0
            buf_bbox: list[float] | None = None

            def flush() -> None:
                nonlocal chunk_index, buf_words, buf_chars, buf_bbox
                text = " ".join(buf_words).strip()
                if len(text) >= PDFProcessor.MIN_CHUNK_CHARS and buf_bbox:
                    chunks.append(PDFChunk(
                        text=text,
                        page=page_num,
                        page_label=page_label,
                        bbox=buf_bbox,
                        chunk_index=chunk_index,
                        doc_id=doc_id,
                    ))
                    chunk_index += 1
                # Overlap: keep last N words for context continuity
                buf_words = buf_words[-PDFProcessor.OVERLAP_WORDS:]
                buf_chars = sum(len(w) + 1 for w in buf_words)
                buf_bbox = None

            for x0, y0, x1, y1, word, *_ in words:
                norm = [x0 / pw, y0 / ph, x1 / pw, y1 / ph]
                buf_words.append(word)
                buf_chars += len(word) + 1

                if buf_bbox is None:
                    buf_bbox = norm[:]
                else:
                    buf_bbox = [
                        min(buf_bbox[0], norm[0]),
                        min(buf_bbox[1], norm[1]),
                        max(buf_bbox[2], norm[2]),
                        max(buf_bbox[3], norm[3]),
                    ]

                if buf_chars >= self.CHUNK_CHARS:
                    flush()

            # Flush remaining words on this page
            if buf_words:
                flush()

        doc.close()
        return doc_id, chunks


pdf_processor = PDFProcessor()
```

### 2.4 backend/services/embedder.py
```python
from openai import AsyncOpenAI
from core.config import settings


class Embedder:
    _BATCH = 100  # OpenAI recommended batch size

    def __init__(self) -> None:
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), self._BATCH):
            resp = await self._client.embeddings.create(
                model=settings.embedding_model,
                input=texts[i : i + self._BATCH],
            )
            all_embeddings.extend(item.embedding for item in resp.data)
        return all_embeddings

    async def embed_query(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(
            model=settings.embedding_model,
            input=[text],
        )
        return resp.data[0].embedding


embedder = Embedder()
```

### 2.5 backend/services/vector_store.py
```python
import chromadb
from chromadb.config import Settings as ChromaSettings
from services.pdf_processor import PDFChunk
from core.config import settings


class VectorStore:
    def __init__(self) -> None:
        self._client = chromadb.PersistentClient(
            path=settings.chroma_db_path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )

    def _collection(self, doc_id: str):
        return self._client.get_or_create_collection(
            name=f"doc_{doc_id}",
            metadata={"hnsw:space": "cosine"},
        )

    def store(self, chunks: list[PDFChunk], embeddings: list[list[float]]) -> None:
        if not chunks:
            return
        col = self._collection(chunks[0].doc_id)
        col.add(
            ids=[c.id for c in chunks],
            embeddings=embeddings,
            documents=[c.text for c in chunks],
            metadatas=[
                {
                    "page": c.page,
                    "page_label": c.page_label,
                    "x0": c.bbox[0],
                    "y0": c.bbox[1],
                    "x1": c.bbox[2],
                    "y1": c.bbox[3],
                    "chunk_index": c.chunk_index,
                    "doc_id": c.doc_id,
                }
                for c in chunks
            ],
        )

    def query(self, doc_id: str, embedding: list[float], top_k: int):
        col = self._collection(doc_id)
        return col.query(
            query_embeddings=[embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"],
        )

    def delete(self, doc_id: str) -> None:
        try:
            self._client.delete_collection(f"doc_{doc_id}")
        except Exception:
            pass


vector_store = VectorStore()
```

### 2.6 backend/services/rag_pipeline.py
```python
from openai import AsyncOpenAI
from services.embedder import embedder
from services.vector_store import vector_store
from models.schemas import QueryRequest, QueryResponse, SourceChunk
from core.config import settings

_SYSTEM = (
    "You are a precise document analysis assistant. "
    "Answer the user's question using ONLY the provided document context. "
    "If the answer is not in the context, say exactly: "
    "\"This information is not found in the provided document.\" "
    "Be concise. Never fabricate information."
)


class RAGPipeline:
    def __init__(self) -> None:
        self._llm = AsyncOpenAI(api_key=settings.openai_api_key)

    async def run(self, req: QueryRequest) -> QueryResponse:
        # 1. Embed the question
        q_emb = await embedder.embed_query(req.question)

        # 2. Retrieve top-k chunks
        results = vector_store.query(req.doc_id, q_emb, req.top_k)

        docs = results["documents"][0]
        metas = results["metadatas"][0]
        distances = results["distances"][0]

        if not docs:
            return QueryResponse(
                answer="No relevant content found in the document.",
                sources=[],
                doc_id=req.doc_id,
                question=req.question,
            )

        # 3. Build context block
        context_parts = []
        sources: list[SourceChunk] = []

        for i, (doc, meta, dist) in enumerate(zip(docs, metas, distances)):
            context_parts.append(f"[Source {i+1} · Page {meta['page_label']}]\n{doc}")
            sources.append(
                SourceChunk(
                    text=doc,
                    page=int(meta["page"]),
                    page_label=str(meta["page_label"]),
                    bbox=[meta["x0"], meta["y0"], meta["x1"], meta["y1"]],
                    chunk_index=int(meta["chunk_index"]),
                    score=round(1.0 - float(dist), 3),
                )
            )

        context = "\n\n---\n\n".join(context_parts)

        # 4. Generate answer
        resp = await self._llm.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {
                    "role": "user",
                    "content": f"Document context:\n{context}\n\nQuestion: {req.question}",
                },
            ],
            max_tokens=800,
            temperature=0.1,
        )

        return QueryResponse(
            answer=resp.choices[0].message.content or "",
            sources=sources,
            doc_id=req.doc_id,
            question=req.question,
        )


rag_pipeline = RAGPipeline()
```

---

## Phase 3 — Security Layer

### 3.1 backend/core/security.py
```python
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
    text = re.sub(r"[<>{}\|\\^~\[\]`]", "", text)
    return text.strip()[:500]
```

### 3.2 backend/core/rate_limiter.py
```python
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse

limiter = Limiter(key_func=get_remote_address, default_limits=[])


def on_rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please slow down.",
            "retry_after": "60",
        },
        headers={"Retry-After": "60"},
    )
```

### 3.3 backend/api/routes/upload.py
```python
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from core.security import require_api_key, assert_pdf_content_type, sanitize_filename
from core.rate_limiter import limiter
from services.pdf_processor import pdf_processor
from services.embedder import embedder
from services.vector_store import vector_store
from models.schemas import UploadResponse

router = APIRouter()


@router.post("/upload", response_model=UploadResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("5/hour")
async def upload_pdf(request, file: UploadFile = File(...)):
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
    embeddings = await embedder.embed_texts([c.text for c in chunks])
    vector_store.store(chunks, embeddings)

    pages = max(c.page for c in chunks) + 1
    return UploadResponse(
        doc_id=doc_id,
        filename=safe_name,
        pages=pages,
        chunks=len(chunks),
        message=f"PDF processed: {pages} pages, {len(chunks)} chunks indexed.",
    )
```

### 3.4 backend/api/routes/query.py
```python
from fastapi import APIRouter, Depends, HTTPException
from core.security import require_api_key, sanitize_question
from core.rate_limiter import limiter
from services.rag_pipeline import rag_pipeline
from models.schemas import QueryRequest, QueryResponse

router = APIRouter()


@router.post("/query", response_model=QueryResponse, dependencies=[Depends(require_api_key)])
@limiter.limit("10/minute")
async def query_document(request, body: QueryRequest):
    body.question = sanitize_question(body.question)
    if not body.question:
        raise HTTPException(status_code=400, detail="Question is empty after sanitization.")

    try:
        return await rag_pipeline.run(body)
    except Exception as exc:
        # Never leak internal error details to the client
        raise HTTPException(status_code=500, detail="Query failed. Please retry.") from exc
```

### 3.5 backend/api/routes/health.py
```python
from fastapi import APIRouter
from models.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", version="1.0.0", environment="demo")
```

### 3.6 backend/api/deps.py
```python
# Shared dependencies (extend as needed)
from core.security import require_api_key

__all__ = ["require_api_key"]
```

### 3.7 backend/api/__init__.py  and  backend/api/routes/__init__.py
```python
# Leave both files empty — they exist only to mark the packages.
```

### 3.8 backend/main.py
```python
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from core.config import settings
from core.rate_limiter import limiter, on_rate_limit_exceeded
from api.routes import upload, query, health

app = FastAPI(
    title="PDF Q&A Demo",
    version="1.0.0",
    # Hide docs in production so the spec is not publicly browsable
    docs_url="/docs" if settings.app_env == "development" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.app_env == "development" else None,
)

# ── Rate limiting ──────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, on_rate_limit_exceeded)

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
    max_age=3600,
)

# ── Gzip ───────────────────────────────────────────────────────────────────────
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ── Security headers ───────────────────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
    return response


# ── Global error handler — never expose stack traces ──────────────────────────
@app.exception_handler(Exception)
async def global_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


# ── Routes ─────────────────────────────────────────────────────────────────────
app.include_router(upload.router, prefix="/api/v1", tags=["Upload"])
app.include_router(query.router, prefix="/api/v1", tags=["Query"])
app.include_router(health.router, prefix="/api/v1", tags=["Health"])
```

---

## Phase 4 — Frontend (TypeScript + Three.js)

### Design Rationale
The brief calls for visual impact. The Three.js particle-network is the **single bold element** — it does all the visual work. Everything above it (uploader, PDF viewer, chat) is intentionally quiet: low-contrast surfaces, one accent colour, no decorative flourishes. The highlight colours on source chunks are the *product moment* — the one place where colour creates meaning.

**Token System**
| Token | Value | Role |
|---|---|---|
| `--bg` | `#07091a` | Deep navy — not generic near-black |
| `--surface` | `rgba(11,14,38,0.88)` | Glass panels |
| `--surface-2` | `rgba(20,25,60,0.6)` | Input fields, chips |
| `--border` | `rgba(80,100,255,0.18)` | Quiet indigo edge |
| `--accent` | `#5B6EF5` | Single UI accent (indigo-blue) |
| `--accent-hi` | `#818cf8` | Hover / active state |
| `--text` | `#dde3f4` | Body text |
| `--text-muted` | `#7887b0` | Secondary |
| `--hl-a` | `#F59E0B` | Source 1 highlight (amber) |
| `--hl-b` | `#2DD4BF` | Source 2 highlight (teal) |
| `--hl-c` | `#FB7185` | Source 3 highlight (rose) |
| Font | `Inter` (via system stack) | Single typeface |

### 4.1 frontend/package.json
```json
{
  "name": "pdf-qa-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.169.0",
    "gsap": "^3.12.5",
    "pdfjs-dist": "^4.6.82",
    "axios": "^1.7.7"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vite": "^5.4.8",
    "@types/three": "^0.169.0"
  }
}
```

### 4.2 frontend/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

### 4.3 frontend/vite.config.ts
```typescript
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], pdfjs: ["pdfjs-dist"] },
      },
    },
  },
});
```

### 4.4 frontend/src/types/index.ts
```typescript
export interface UploadResponse {
  doc_id: string;
  filename: string;
  pages: number;
  chunks: number;
  message: string;
}

export interface SourceChunk {
  text: string;
  page: number;         // 0-indexed
  page_label: string;
  bbox: [number, number, number, number]; // [x0, y0, x1, y1] normalised 0-1
  chunk_index: number;
  score: number;
}

export interface QueryResponse {
  answer: string;
  sources: SourceChunk[];
  doc_id: string;
  question: string;
  timestamp: string;
}

export interface AppState {
  docId: string | null;
  filename: string | null;
  isUploading: boolean;
  isQuerying: boolean;
  currentPage: number;
  totalPages: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any | null;
  pendingHighlights: SourceChunk[];
}
```

### 4.5 frontend/src/three/scene.ts
```typescript
/**
 * Three.js particle-network background.
 * This is the single visual centrepiece — everything else defers to it.
 * Rendered into a fixed canvas behind the UI.
 */
import * as THREE from "three";

const PARTICLE_COUNT = 1800;
const SPREAD = 90;
const CONNECT_DIST = 14;
const MAX_LINES_PER_PARTICLE = 3;

export class BackgroundScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private particles!: THREE.Points;
  private raf = 0;
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
    this.camera.position.z = 35;

    this.resize();
    this.buildParticles();
    this.buildLines();
    this.loop();

    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private buildParticles(): void {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const col = new Float32Array(PARTICLE_COUNT * 3);
    const palette = [
      new THREE.Color("#5B6EF5"),
      new THREE.Color("#818cf8"),
      new THREE.Color("#a5b4fc"),
      new THREE.Color("#2DD4BF"),
    ];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * SPREAD;
      pos[i * 3 + 1] = (Math.random() - 0.5) * SPREAD;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;

      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
    }));

    this.scene.add(this.particles);
  }

  private buildLines(): void {
    const pos = (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const verts: number[] = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let links = 0;
      for (let j = i + 1; j < PARTICLE_COUNT && links < MAX_LINES_PER_PARTICLE; j++) {
        const dx = pos[i*3]   - pos[j*3];
        const dy = pos[i*3+1] - pos[j*3+1];
        const dz = pos[i*3+2] - pos[j*3+2];
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < CONNECT_DIST) {
          verts.push(pos[i*3], pos[i*3+1], pos[i*3+2], pos[j*3], pos[j*3+1], pos[j*3+2]);
          links++;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    this.scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: "#5B6EF5",
      transparent: true,
      opacity: 0.07,
    })));
  }

  private loop(): void {
    this.raf = requestAnimationFrame(() => this.loop());
    const t = this.clock.getElapsedTime();
    this.particles.rotation.y = t * 0.025;
    this.particles.rotation.x = Math.sin(t * 0.015) * 0.08;
    this.renderer.render(this.scene, this.camera);
  }

  /** Intensify particles during active query — single purposeful state change. */
  pulseQuery(active: boolean): void {
    const mat = this.particles.material as THREE.PointsMaterial;
    mat.opacity = active ? 0.85 : 0.55;
    mat.size    = active ? 0.38 : 0.25;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}
```

### 4.6 frontend/src/api/client.ts
```typescript
import axios from "axios";
import type { UploadResponse, QueryResponse } from "../types";

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL as string || "http://localhost:8000/api/v1",
  headers: { "X-API-Key": import.meta.env.VITE_API_KEY as string },
  timeout: 45_000,
});

export async function uploadPDF(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await http.post<UploadResponse>("/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function queryDoc(
  docId: string,
  question: string,
  topK = 3,
): Promise<QueryResponse> {
  const { data } = await http.post<QueryResponse>("/query", {
    doc_id: docId,
    question,
    top_k: topK,
  });
  return data;
}
```

### 4.7 frontend/src/ui/pdfViewer.ts
```typescript
/**
 * Wraps PDF.js rendering and draws highlight rectangles on a transparent
 * overlay canvas that sits exactly on top of the PDF canvas.
 */
import * as pdfjsLib from "pdfjs-dist";
import type { SourceChunk } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

const HIGHLIGHT_COLORS = [
  { fill: "rgba(245,158,11,0.28)",  stroke: "#F59E0B" },  // amber
  { fill: "rgba(45,212,191,0.28)",  stroke: "#2DD4BF" },  // teal
  { fill: "rgba(251,113,133,0.28)", stroke: "#FB7185" },  // rose
];

export class PDFViewer {
  private wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private oc: CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pdfDoc: any = null;
  private page = 1;
  private scale = 1.5;

  constructor(wrapId: string) {
    this.wrap = document.getElementById(wrapId)!;
    this.wrap.style.position = "relative";

    this.canvas = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;pointer-events:none;";

    this.wrap.append(this.canvas, this.overlay);
    this.ctx = this.canvas.getContext("2d")!;
    this.oc = this.overlay.getContext("2d")!;
  }

  async load(file: File): Promise<number> {
    const buf = await file.arrayBuffer();
    this.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    this.page = 1;
    await this.render(1);
    return this.pdfDoc.numPages as number;
  }

  async render(pageNum: number): Promise<void> {
    if (!this.pdfDoc) return;
    this.page = pageNum;
    const pg = await this.pdfDoc.getPage(pageNum);
    const vp = pg.getViewport({ scale: this.scale });

    this.canvas.width  = this.overlay.width  = vp.width;
    this.canvas.height = this.overlay.height = vp.height;

    await pg.render({ canvasContext: this.ctx, viewport: vp }).promise;
    this.clearHighlights();
  }

  highlight(sources: SourceChunk[]): void {
    this.clearHighlights();
    const w = this.overlay.width;
    const h = this.overlay.height;

    sources.forEach((src, i) => {
      if (src.page !== this.page - 1) return;
      const { fill, stroke } = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length];
      const [x0, y0, x1, y1] = src.bbox;

      const rx = x0 * w, ry = y0 * h;
      const rw = (x1 - x0) * w, rh = (y1 - y0) * h;

      this.oc.fillStyle = fill;
      this.oc.fillRect(rx, ry, rw, rh);

      this.oc.strokeStyle = stroke;
      this.oc.lineWidth = 2;
      this.oc.strokeRect(rx, ry, rw, rh);

      // Small source badge
      this.oc.fillStyle = stroke;
      this.oc.fillRect(rx, ry - 20, 26, 20);
      this.oc.fillStyle = "#fff";
      this.oc.font = "bold 11px system-ui";
      this.oc.fillText(`S${i + 1}`, rx + 4, ry - 5);
    });

    // Jump to the page that has the first source
    const first = sources[0];
    if (first && first.page !== this.page - 1) {
      this.render(first.page + 1).then(() => this.highlight(sources));
    }
  }

  clearHighlights(): void {
    this.oc.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  prev(): void { if (this.page > 1) this.render(this.page - 1); }
  next(): void { if (this.pdfDoc && this.page < this.pdfDoc.numPages) this.render(this.page + 1); }

  get currentPage() { return this.page; }
  get total(): number { return this.pdfDoc?.numPages ?? 0; }
}
```

### 4.8 frontend/src/ui/chat.ts
```typescript
import type { QueryResponse, SourceChunk } from "../types";

export type OnSend = (q: string) => Promise<void>;
export type OnHighlight = (sources: SourceChunk[]) => void;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/\n/g, "<br>");
}

export class ChatUI {
  private feed: HTMLElement;
  private input: HTMLInputElement;
  private btn: HTMLButtonElement;

  constructor(id: string, private onSend: OnSend, private onHL: OnHighlight) {
    const root = document.getElementById(id)!;
    this.feed  = root.querySelector<HTMLElement>(".chat-feed")!;
    this.input = root.querySelector<HTMLInputElement>(".chat-input")!;
    this.btn   = root.querySelector<HTMLButtonElement>(".chat-send")!;
    this.btn.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.submit(); }
    });
  }

  private async submit() {
    const q = this.input.value.trim();
    if (!q) return;
    this.input.value = "";
    this.addUser(q);
    this.setLoading(true);
    await this.onSend(q);
    this.setLoading(false);
  }

  addUser(text: string): void {
    this.append(`
      <div class="msg msg--user">
        <div class="bubble">${esc(text)}</div>
      </div>`);
  }

  addAssistant(text: string, resp?: QueryResponse): void {
    const chips = (resp?.sources ?? []).map((s, i) => `
      <button class="chip chip--${i}" data-idx="${i}">
        S${i + 1} · p.${s.page_label} · ${Math.round(s.score * 100)}%
      </button>`).join("");

    const el = this.append(`
      <div class="msg msg--ai">
        <div class="bubble">
          <p>${esc(text)}</p>
          ${chips ? `<div class="chips">${chips}</div>` : ""}
        </div>
      </div>`);

    if (resp) {
      el.querySelectorAll<HTMLButtonElement>(".chip").forEach((c) => {
        c.addEventListener("click", () => this.onHL(resp.sources));
      });
    }
  }

  addError(msg: string): void {
    this.append(`<div class="chat-err">Error: ${esc(msg)}</div>`);
  }

  private setLoading(on: boolean): void {
    this.btn.disabled = this.input.disabled = on;
    if (on) {
      this.append(`
        <div class="msg msg--ai" id="typing">
          <div class="bubble">
            <span class="dots"><i></i><i></i><i></i></span>
          </div>
        </div>`);
    } else {
      document.getElementById("typing")?.remove();
    }
  }

  private append(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    const node = div.firstElementChild as HTMLElement;
    node.style.opacity = "0";
    this.feed.appendChild(node);
    requestAnimationFrame(() => {
      node.style.transition = "opacity 0.25s";
      node.style.opacity = "1";
    });
    this.feed.scrollTop = this.feed.scrollHeight;
    return node;
  }

  enable(): void {
    this.input.disabled = this.btn.disabled = false;
    this.input.placeholder = "Ask anything about this document…";
    this.input.focus();
  }

  disable(): void {
    this.input.disabled = this.btn.disabled = true;
    this.input.placeholder = "Upload a PDF first…";
  }
}
```

### 4.9 frontend/src/main.ts
```typescript
import { BackgroundScene } from "./three/scene";
import { PDFViewer } from "./ui/pdfViewer";
import { ChatUI } from "./ui/chat";
import { uploadPDF, queryDoc } from "./api/client";
import type { AppState } from "./types";
import "./style.css";

// ── State ─────────────────────────────────────────────────────────────────────
const state: AppState = {
  docId: null, filename: null,
  isUploading: false, isQuerying: false,
  currentPage: 1, totalPages: 0,
  pdfDoc: null, pendingHighlights: [],
};

// ── Three.js background ───────────────────────────────────────────────────────
const bg = new BackgroundScene(document.getElementById("bg") as HTMLCanvasElement);

// ── PDF Viewer ────────────────────────────────────────────────────────────────
const viewer = new PDFViewer("pdf-wrap");

// ── Chat ──────────────────────────────────────────────────────────────────────
const chat = new ChatUI(
  "chat",
  async (question) => {
    if (!state.docId) return;
    state.isQuerying = true;
    bg.pulseQuery(true);
    try {
      const resp = await queryDoc(state.docId, question);
      chat.addAssistant(resp.answer, resp);
      state.pendingHighlights = resp.sources;
      viewer.highlight(resp.sources);
      pageInfo();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? "Something went wrong.";
      chat.addError(msg);
    } finally {
      state.isQuerying = false;
      bg.pulseQuery(false);
    }
  },
  (sources) => {
    viewer.highlight(sources);
    pageInfo();
  },
);
chat.disable();

// ── Upload ────────────────────────────────────────────────────────────────────
const zone   = document.getElementById("zone")!;
const fileIn = document.getElementById("file-in") as HTMLInputElement;
const status = document.getElementById("status")!;

zone.addEventListener("click", () => fileIn.click());
zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
zone.addEventListener("dragleave", () => zone.classList.remove("over"));
zone.addEventListener("drop", (e) => {
  e.preventDefault(); zone.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) handle(f);
});
fileIn.addEventListener("change", () => { if (fileIn.files?.[0]) handle(fileIn.files[0]); });

async function handle(file: File): Promise<void> {
  if (state.isUploading) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) { setStatus("Only PDF files work here.", "err"); return; }
  if (file.size > 20 * 1024 * 1024)             { setStatus("Max file size is 20 MB.", "err"); return; }

  state.isUploading = true;
  setStatus("Reading PDF…", "load");
  zone.classList.add("busy");

  try {
    const res = await uploadPDF(file);
    state.docId = res.doc_id;
    state.filename = res.filename;
    state.totalPages = await viewer.load(file);

    setStatus(`${res.pages} pages · ${res.chunks} chunks indexed`, "ok");
    document.getElementById("main")!.style.display = "grid";
    pageInfo();
    chat.enable();
    chat.addAssistant(
      `I've read **${res.filename}** (${res.pages} pages). What would you like to know?`
    );
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { detail?: string } } })
      ?.response?.data?.detail ?? "Upload failed.";
    setStatus(msg, "err");
  } finally {
    state.isUploading = false;
    zone.classList.remove("busy");
  }
}

function setStatus(msg: string, type: "load" | "ok" | "err"): void {
  status.textContent = msg;
  status.className = `status status--${type}`;
  status.hidden = false;
}

function pageInfo(): void {
  document.getElementById("page-info")!.textContent =
    `${viewer.currentPage} / ${viewer.total}`;
}

document.getElementById("prev")?.addEventListener("click", () => {
  viewer.prev();
  if (state.pendingHighlights.length) viewer.highlight(state.pendingHighlights);
  pageInfo();
});
document.getElementById("next")?.addEventListener("click", () => {
  viewer.next();
  if (state.pendingHighlights.length) viewer.highlight(state.pendingHighlights);
  pageInfo();
});
```

### 4.10 frontend/index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:8000; worker-src blob:;" />
  <title>DocMind — AI Document Analysis</title>
</head>
<body>

  <canvas id="bg"></canvas>

  <div id="app">

    <header class="hdr">
      <span class="brand">DocMind<sup>AI</sup></span>
      <span class="tag">PDF Q&amp;A · Source Highlighting</span>
    </header>

    <!-- Upload step -->
    <section id="upload">
      <div id="zone">
        <div class="zone-icon">⬡</div>
        <p class="zone-h">Drop a PDF here</p>
        <p class="zone-sub">or click to browse &nbsp;·&nbsp; max 20 MB &nbsp;·&nbsp; 50 pages</p>
        <input id="file-in" type="file" accept=".pdf" />
      </div>
      <p id="status" class="status" hidden></p>
    </section>

    <!-- Viewer + Chat (hidden until upload) -->
    <section id="main" style="display:none">

      <div class="pdf-panel">
        <div class="panel-hdr">
          <span id="pdf-name" class="panel-title">Document</span>
          <div class="nav">
            <button id="prev">←</button>
            <span id="page-info">1 / 1</span>
            <button id="next">→</button>
          </div>
        </div>
        <div id="pdf-wrap" class="pdf-wrap"></div>
      </div>

      <div id="chat" class="chat-panel">
        <div class="panel-hdr">
          <span class="panel-title">Ask the Document</span>
        </div>
        <div class="chat-feed"></div>
        <div class="chat-bar">
          <input class="chat-input" type="text" maxlength="500" placeholder="Upload a PDF first…" />
          <button class="chat-send" disabled>Send</button>
        </div>
      </div>

    </section>
  </div>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### 4.11 frontend/src/style.css
```css
/* ── Tokens ──────────────────────────────────────────────────────────────── */
:root {
  --bg:       #07091a;
  --sur:      rgba(11,14,38,0.88);
  --sur2:     rgba(20,25,60,0.60);
  --bdr:      rgba(80,100,255,0.18);
  --acc:      #5B6EF5;
  --acc-hi:   #818cf8;
  --txt:      #dde3f4;
  --muted:    #7887b0;
  --ok:       #2DD4BF;
  --err:      #FB7185;
  --r:        10px;
  --blur:     blur(20px);
}

/* ── Reset ───────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--txt);
  min-height: 100dvh;
  overflow-x: hidden;
  line-height: 1.5;
}

/* ── Background canvas ───────────────────────────────────────────────────── */
#bg {
  position: fixed; inset: 0;
  width: 100%; height: 100%;
  z-index: 0; pointer-events: none;
}

/* ── App shell ───────────────────────────────────────────────────────────── */
#app {
  position: relative; z-index: 1;
  min-height: 100dvh;
  display: flex; flex-direction: column;
  padding: 14px; gap: 14px;
  max-width: 1560px; margin: 0 auto;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px;
  background: var(--sur); border: 1px solid var(--bdr);
  border-radius: var(--r); backdrop-filter: var(--blur);
}
.brand { font-size: 18px; font-weight: 700; letter-spacing: -.5px; }
.brand sup { color: var(--acc); font-size: 11px; vertical-align: super; }
.tag  { font-size: 12px; color: var(--muted); }

/* ── Upload section ──────────────────────────────────────────────────────── */
#upload {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 14px;
}

#zone {
  width: 100%; max-width: 520px;
  border: 2px dashed var(--bdr); border-radius: 18px;
  padding: 52px 32px; text-align: center; cursor: pointer;
  background: var(--sur); backdrop-filter: var(--blur);
  transition: border-color .25s, background .25s;
}
#zone:hover, #zone.over {
  border-color: var(--acc);
  background: rgba(91,110,245,.07);
}
#zone.busy { opacity: .5; pointer-events: none; }

#zone input { display: none; }
.zone-icon { font-size: 44px; margin-bottom: 14px; color: var(--acc); }
.zone-h    { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
.zone-sub  { font-size: 13px; color: var(--muted); }

/* ── Status pill ─────────────────────────────────────────────────────────── */
.status {
  font-size: 13px; padding: 8px 18px; border-radius: 20px;
  max-width: 520px; width: 100%; text-align: center;
}
.status--load { background: rgba(91,110,245,.12); color: var(--acc-hi); }
.status--ok   { background: rgba(45,212,191,.12); color: var(--ok); }
.status--err  { background: rgba(251,113,133,.12); color: var(--err); }

/* ── Main grid (PDF + Chat) ──────────────────────────────────────────────── */
#main {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 14px;
  height: calc(100dvh - 100px);
  min-height: 0;
}

/* ── Shared panel styles ─────────────────────────────────────────────────── */
.pdf-panel, .chat-panel {
  display: flex; flex-direction: column;
  background: var(--sur); border: 1px solid var(--bdr);
  border-radius: var(--r); backdrop-filter: var(--blur);
  overflow: hidden;
}

.panel-hdr {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bdr);
  background: rgba(0,0,0,.18);
  flex-shrink: 0;
}
.panel-title { font-size: 13px; font-weight: 600; }

/* ── PDF viewer ──────────────────────────────────────────────────────────── */
.nav { display: flex; align-items: center; gap: 10px; }
.nav button {
  background: rgba(91,110,245,.1);
  border: 1px solid var(--bdr); color: var(--txt);
  width: 30px; height: 30px; border-radius: 6px;
  cursor: pointer; font-size: 14px;
  transition: background .2s;
}
.nav button:hover { background: rgba(91,110,245,.28); }
#page-info { font-size: 12px; color: var(--muted); min-width: 50px; text-align: center; }

.pdf-wrap {
  flex: 1; overflow: auto;
  display: flex; justify-content: center; align-items: flex-start;
  padding: 16px;
  background: #0f1128;
}
.pdf-wrap canvas { max-width: 100%; border-radius: 4px; }

/* ── Chat panel ──────────────────────────────────────────────────────────── */
.chat-feed {
  flex: 1; overflow-y: auto;
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
}
.chat-feed::-webkit-scrollbar { width: 3px; }
.chat-feed::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 2px; }

/* Messages */
.msg { display: flex; }
.msg--user { justify-content: flex-end; }
.msg--ai   { justify-content: flex-start; }

.bubble {
  max-width: 88%; padding: 9px 13px;
  border-radius: 10px; font-size: 13.5px; line-height: 1.55;
}
.msg--user .bubble {
  background: var(--acc); color: #fff;
  border-bottom-right-radius: 3px;
}
.msg--ai .bubble {
  background: var(--sur2); border: 1px solid var(--bdr);
  color: var(--txt); border-bottom-left-radius: 3px;
}

/* Source chips */
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip {
  font-size: 11px; padding: 3px 9px; border-radius: 20px;
  border: none; cursor: pointer; transition: opacity .2s;
}
.chip--0 { background: rgba(245,158,11,.2); color: #F59E0B; }
.chip--1 { background: rgba(45,212,191,.2); color: #2DD4BF; }
.chip--2 { background: rgba(251,113,133,.2); color: #FB7185; }
.chip:hover { opacity: .7; }

/* Typing dots */
.dots { display: flex; gap: 4px; align-items: center; }
.dots i {
  display: block; width: 6px; height: 6px;
  background: var(--acc-hi); border-radius: 50%;
  animation: pulse 1.1s infinite;
}
.dots i:nth-child(2) { animation-delay: .18s; }
.dots i:nth-child(3) { animation-delay: .36s; }
@keyframes pulse {
  0%, 80%, 100% { transform: scale(.75); opacity: .4; }
  40%           { transform: scale(1);   opacity: 1; }
}

.chat-err {
  font-size: 12px; color: var(--err);
  padding: 7px 11px; background: rgba(251,113,133,.1);
  border-radius: 7px; text-align: center;
}

/* Input bar */
.chat-bar {
  display: flex; gap: 8px; padding: 10px;
  border-top: 1px solid var(--bdr);
  background: rgba(0,0,0,.18);
  flex-shrink: 0;
}
.chat-input {
  flex: 1; background: var(--sur2); border: 1px solid var(--bdr);
  border-radius: 7px; padding: 9px 12px;
  color: var(--txt); font-size: 13px; outline: none;
  transition: border-color .2s;
}
.chat-input:focus  { border-color: var(--acc); }
.chat-input:disabled { opacity: .35; }
.chat-input::placeholder { color: var(--muted); }

.chat-send {
  background: var(--acc); color: #fff; border: none;
  border-radius: 7px; padding: 9px 16px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background .2s, opacity .2s;
}
.chat-send:hover:not(:disabled) { background: var(--acc-hi); }
.chat-send:disabled { opacity: .35; cursor: not-allowed; }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  #main { grid-template-columns: 1fr; grid-template-rows: 1fr 380px; }
}
```

---

## Phase 5 — Docker & Deployment

### 5.1 backend/Dockerfile
```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user for security
RUN useradd -r -u 1001 -g root appuser \
    && mkdir -p chroma_db uploads \
    && chown -R appuser:root /app
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### 5.2 frontend/Dockerfile
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5.3 frontend/nginx.conf
```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  add_header X-Frame-Options "DENY";
  add_header X-Content-Type-Options "nosniff";
  add_header X-XSS-Protection "1; mode=block";
  add_header Referrer-Policy "strict-origin-when-cross-origin";

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location / { try_files $uri $uri/ /index.html; }

  location ~* \.(js|css|woff2|ico)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

### 5.4 docker-compose.yml
```yaml
version: "3.9"

services:
  backend:
    build:
      context: ./backend
    ports:
      - "8000:8000"
    env_file: ./backend/.env
    volumes:
      - chroma:/app/chroma_db
      - uploads:/app/uploads
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  chroma:
  uploads:
```

---

## Phase 6 — Tests

### 6.1 backend/test_api.py
```python
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
```

---

## Phase 7 — Launch Commands

```bash
# ── Development ───────────────────────────────────────────
# Terminal 1 — Backend
cd backend
source .venv/bin/activate
cp .env.example .env          # edit with real API keys
uvicorn main:app --reload

# Terminal 2 — Frontend
cd frontend
cp .env.example .env          # VITE_API_KEY must match DEMO_API_KEY in backend .env
npm run dev

# Open: http://localhost:5173

# ── Run tests ─────────────────────────────────────────────
cd backend && pytest test_api.py -v

# ── Production (Docker) ───────────────────────────────────
docker-compose up --build -d
docker-compose logs -f         # watch logs
docker-compose down            # stop
```

---

## Security Checklist

Before sharing the demo URL with Fiverr clients, verify every item:

```
[ ] backend/.env  — real OPENAI_API_KEY, random APP_SECRET_KEY, strong DEMO_API_KEY
[ ] frontend/.env — VITE_API_KEY matches backend DEMO_API_KEY exactly
[ ] CORS_ORIGINS  — set to your actual frontend domain, not *
[ ] APP_ENV=production in backend .env (disables /docs)
[ ] .gitignore    — .env, uploads/, chroma_db/ confirmed excluded
[ ] File size limit enforced client-side AND server-side (20 MB)
[ ] PDF magic-byte check passes (non-PDFs return 400, not 500)
[ ] Rate limits tested: 6th upload in an hour → 429
[ ] Security headers present: curl -I <backend-url>/api/v1/health
[ ] Docker container runs as non-root user (verified with: docker exec <id> whoami)
[ ] No API keys visible in browser Network tab (only X-API-Key header, not in URLs)
[ ] Source highlight renders correctly on a multi-page test PDF
```

---

## Demo PDF Suggestions (for Fiverr showcase)

| Document | Why it impresses clients |
|---|---|
| ArXiv research paper | Shows technical depth; sources highlight methodology sections |
| Sample employment contract | Legal niche — highest-paying clients |
| Product user manual | Shows enterprise use case |
| Annual report (SEC) | Finance niche demo |

**Suggested demo questions to pre-load in UI as placeholder hints:**
- "What are the main conclusions of this document?"
- "What risks or liabilities are mentioned?"
- "Summarise section 3 in simple terms."
- "What dates or deadlines are mentioned?"

---

## Final Checklist — All Phases

```
Phase 1 — Setup
  [ ] Directory tree created
  [ ] Backend venv + pip install done
  [ ] Frontend npm install done
  [ ] Both .env files filled from .env.example

Phase 2 — Backend Core
  [ ] config.py loads cleanly (python -c "from core.config import settings; print(settings.app_env)")
  [ ] pdf_processor.py extracts chunks with bbox from a test PDF
  [ ] vector_store.py stores and retrieves without error
  [ ] rag_pipeline.py returns an answer with sources

Phase 3 — Security
  [ ] /upload returns 401 without header
  [ ] /upload returns 403 with wrong key
  [ ] /upload returns 400 for non-PDF
  [ ] Rate limit returns 429 on excess
  [ ] curl -I response includes X-Content-Type-Options

Phase 4 — Frontend
  [ ] Three.js background renders and animates
  [ ] Drop-zone accepts a PDF and calls /upload
  [ ] PDF renders in viewer after upload
  [ ] Asking a question calls /query and shows answer
  [ ] Clicking a source chip highlights bbox on the PDF page
  [ ] Typing indicator (dots) shows while waiting

Phase 5 — Docker
  [ ] docker-compose up --build succeeds
  [ ] http://localhost opens frontend
  [ ] Frontend talks to backend through nginx proxy

Phase 6 — Tests
  [ ] pytest test_api.py -v — all tests green

Phase 7 — Deploy
  [ ] Public URL accessible
  [ ] Demo PDF loaded and tested end-to-end
  [ ] Fiverr gig screenshots/video captured
```

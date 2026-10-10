# DocMind — PDF Q&A + Source Highlighting

A full-stack RAG application where users upload any PDF, ask natural language questions, and see the exact passages the AI used — highlighted with colored bounding boxes directly on the rendered PDF page.

The AI workspace also provides retrieval-grounded document summaries and key-point extraction. Both modes return page-aware citations and use the same strict vector-store-first pipeline as Q&A.

Uploaded PDFs and per-user workspace metadata are persisted locally in `backend/uploads/`,
`backend/chroma_db/`, and `backend/docmind.sqlite3`. They survive server restarts and are
not removed automatically.

## Stack

| Layer       | Technology                                          |
|-------------|-----------------------------------------------------|
| Frontend    | TypeScript + Vite + Three.js (particles) + PDF.js   |
| Backend     | FastAPI + Python 3.12                                |
| Vector DB   | ChromaDB (persistent, local)                        |
| Embeddings  | Google Gemini `gemini-embedding-001`               |
| LLM         | Google Gemini `gemini-flash-lite-latest`            |
| Security    | API Key Auth, Rate Limiting, File Validation, Headers|
| Deploy      | Docker Compose                                      |

---

## Quickstart (Development)

### 1. Configure environment

```bash
# Backend
cd backend
cp .env.example .env
# Edit .env — fill in GEMINI_API_KEY, APP_SECRET_KEY, DEMO_API_KEY

# Frontend
cd ../frontend
cp .env.example .env
# Edit .env — VITE_API_KEY must match DEMO_API_KEY from backend/.env
```

### 2. Install dependencies

```bash
# Backend (Python 3.11+)
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 3. Run

Project root se dono services ek command mein start karne ke liye:

```powershell
cd "C:\Users\Usman\Desktop\PDF Q&A + Source Highlighting"
.\start.bat
```

Is se backend aur frontend apni alag terminal windows mein start ho jayenge.

Manual method:

```bash
# Terminal 1 — Backend
cd backend
uvicorn main:app --reload

# Terminal 2 — Frontend
cd frontend
npm run dev

# Open: http://localhost:5173
```

## Vercel deployment

This repository is configured to deploy the Vite frontend on Vercel:

1. Import the repository in Vercel.
2. Keep the project root at the repository root; `vercel.json` already points to
   `pdf-qa-demo/frontend`.
3. Add `VITE_API_BASE_URL` as the public URL of the deployed FastAPI backend,
   including `/api/v1` (for example `https://your-backend.example.com/api/v1`).
4. Add `VITE_API_KEY` with the same value as the backend `DEMO_API_KEY`.
5. Deploy.

The FastAPI backend requires a persistent Python host such as Render, Railway,
Fly.io, or a VM because ChromaDB, SQLite, and uploaded PDFs need persistent
storage. Do not put `GEMINI_API_KEY` in Vercel frontend variables.

---

## Docker Quickstart

```bash
# Make sure backend/.env exists and is filled
cd pdf-qa-demo
docker-compose up --build -d

# Watch logs
docker-compose logs -f

# Stop
docker-compose down
```

Frontend: `http://localhost` — Backend: `http://localhost:8000`

---

## Security Checklist

Before deploying to production, verify every item:

- [ ] `backend/.env` — real `GEMINI_API_KEY`, random `APP_SECRET_KEY`, strong `DEMO_API_KEY`
- [ ] `frontend/.env` — `VITE_API_KEY` matches backend `DEMO_API_KEY` exactly
- [ ] `CORS_ORIGINS` — set to your actual frontend domain, not `*`
- [ ] `APP_ENV=production` in backend `.env` (disables `/docs`)
- [ ] `.gitignore` — `.env`, `uploads/`, `chroma_db/` confirmed excluded
- [ ] File size limit enforced client-side AND server-side (20 MB)
- [ ] PDF magic-byte check passes (non-PDFs return 400, not 500)
- [ ] Rate limits tested: 6th upload in an hour → 429
- [ ] Security headers present: `curl -I <backend-url>/api/v1/health`
- [ ] Docker container runs as non-root user (`docker exec <id> whoami`)
- [ ] No API keys visible in browser Network tab (only `X-API-Key` header)
- [ ] Source highlights render correctly on a multi-page test PDF
- [ ] `/docs` and `/openapi.json` disabled in production

## Local persistence

The development workspace uses SQLite for users, workspace settings, document metadata,
and tags. PDF bytes are stored under `backend/uploads/`, while searchable vectors remain
in ChromaDB. The frontend sends the logged-in user's workspace identity with requests,
and a new login restores that user's stored documents from the backend.

Workspace settings are synchronized through `GET /api/v1/workspace` and
`PUT /api/v1/workspace`; uploaded document metadata is available through
`GET /api/v1/documents`.

---

## Running Tests

```bash
cd backend
pytest test_api.py -v
```

Tests verify:
1. `GET /health` returns 200 without auth
2. `POST /upload` returns 401 without `X-API-Key`
3. `POST /upload` returns 403 with wrong key
4. `POST /upload` returns 400 for non-PDF content-type
5. `POST /query` returns 401 without `X-API-Key`
6. `POST /query` rejects questions shorter than 3 characters

## Document intelligence

After uploading a PDF, use **Summary** for a concise overview or **Key points** for
important facts, dates, amounts, requirements, risks, and decisions. The backend
endpoints are:

- `POST /api/v1/query` — grounded questions
- `POST /api/v1/insights` with `mode: "summary"` — cited summary
- `POST /api/v1/insights` with `mode: "key_points"` — cited key points

Insight generation uses `temperature=0.0`, retrieved Chroma passages, and the same
`[Source N, Page X]` citation format. Selecting **Compare all** applies these
insights across all uploaded documents.

---

## Demo Questions to Try

After uploading a PDF, try these prompts:

1. **"What are the main conclusions of this document?"**
   — Tests broad summarization with multi-source attribution

2. **"What risks or liabilities are mentioned?"**
   — Great for legal/contract PDFs; highlights specific clauses

3. **"Summarise section 3 in simple terms."**
   — Tests section-specific retrieval and simplification

4. **"What dates or deadlines are mentioned?"**
   — Tests entity extraction; highlights relevant passages

---

## Architecture

```
Browser
 ├─ Three.js Canvas ← particle-network background
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
      └─ POST /query          ← embed question → retrieve → generate → return
           │
           ├─ ChromaDB       ← stores text chunks + bbox metadata
           └─ Google Gemini  ← embeddings (gemini-embedding-001) + generation (gemini-flash-lite-latest)
```

---

## License

Private — built as a demonstration project.

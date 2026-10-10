from pydantic import BaseModel, Field
from datetime import datetime, timezone


class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    pages: int
    chunks: int
    message: str


class DocumentResponse(BaseModel):
    doc_id: str
    filename: str
    pages: int
    chunks: int
    important: bool = False
    reviewed: bool = False
    created_at: str


class WorkspaceResponse(BaseModel):
    email: str
    name: str
    answer_style: str


class WorkspaceUpdate(BaseModel):
    email: str = Field(..., min_length=3)
    name: str = Field(..., min_length=1, max_length=80)
    answer_style: str = Field(default="strict", pattern="^(strict|detailed)$")


class SourceChunk(BaseModel):
    doc_id: str = ""
    filename: str = "Document"
    text: str
    page: int           # 0-indexed page number
    page_label: str     # human-readable, e.g. "3"
    bbox: list[float]   # [x0, y0, x1, y1] — normalised 0-1 relative to page dims
    chunk_index: int
    score: float


class QueryRequest(BaseModel):
    doc_id: str | None = Field(default=None, min_length=1)
    doc_ids: list[str] = Field(default_factory=list, min_length=0, max_length=5)
    question: str = Field(..., min_length=3, max_length=500)
    top_k: int = Field(default=3, ge=1, le=5)

    @property
    def selected_doc_ids(self) -> list[str]:
        ids = list(dict.fromkeys(self.doc_ids))
        if self.doc_id:
            ids.insert(0, self.doc_id)
        return list(dict.fromkeys(ids))


class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceChunk]
    doc_id: str
    doc_ids: list[str] = Field(default_factory=list)
    question: str
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class InsightRequest(BaseModel):
    doc_id: str | None = Field(default=None, min_length=1)
    doc_ids: list[str] = Field(default_factory=list, max_length=5)
    mode: str = Field(default="summary", pattern="^(summary|key_points)$")
    top_k: int = Field(default=5, ge=3, le=8)

    @property
    def selected_doc_ids(self) -> list[str]:
        ids = list(dict.fromkeys(self.doc_ids))
        if self.doc_id:
            ids.insert(0, self.doc_id)
        return list(dict.fromkeys(ids))


class InsightResponse(BaseModel):
    mode: str
    answer: str
    sources: list[SourceChunk]
    doc_id: str
    doc_ids: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str

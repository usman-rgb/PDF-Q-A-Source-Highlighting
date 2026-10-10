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
    filename: str

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
                        filename=filename,
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

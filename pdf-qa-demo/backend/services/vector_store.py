import os
import logging

os.environ.setdefault("ANONYMIZED_TELEMETRY", "FALSE")

import posthog
posthog.disabled = True
logging.getLogger("chromadb.telemetry.product.posthog").disabled = True
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
                    "filename": c.filename,
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

    def query_many(self, doc_ids: list[str], embedding: list[float], top_k: int):
        per_document = []
        for doc_id in doc_ids:
            # Keep representation from every selected document for comparisons.
            result = self.query(doc_id, embedding, max(8, top_k * 2))
            docs = result["documents"][0]
            metas = result["metadatas"][0]
            distances = result["distances"][0]
            per_document.append(list(zip(docs, metas, distances)))

        # Keep at least the best passage from every selected document, then fill
        # remaining slots by global relevance so comparisons stay balanced.
        balanced = [items[0] for items in per_document if items]
        remaining = [
            item for items in per_document for item in items[1:]
        ]
        remaining.sort(key=lambda item: float(item[2]))
        limit = max(top_k, min(10, len(balanced) + len(remaining)))
        return (balanced + remaining)[:limit]

    def delete(self, doc_id: str) -> None:
        try:
            self._client.delete_collection(f"doc_{doc_id}")
        except Exception:
            pass


vector_store = VectorStore()

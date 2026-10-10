from google import genai
from google.genai import types
import re
from services.embedder import embedder
from services.vector_store import vector_store
from models.schemas import InsightRequest, InsightResponse, QueryRequest, QueryResponse, SourceChunk
from core.config import settings

_SYSTEM = """You are DocMind, a strict retrieval-grounded document analyst.

Follow this order on every request:
1. Treat the supplied CONTEXT as the only source of truth. It was retrieved from the
   selected document vector store. Do not use outside knowledge.
2. Synthesize an answer from the retrieved passages; do not merely repeat one passage.
3. For comparisons, inspect every labelled document and explicitly state each
   document's evidence before explaining similarities or differences.
4. Attach inline citations exactly in the form [Source N, Page X] using the source
   labels in the context. Never invent a citation.
5. If the context does not support an answer, say exactly:
   "This information is not found in the provided document."
6. Keep the answer concise, factual, and explicit about uncertainty. Never guess.
"""


class RAGPipeline:
    def __init__(self) -> None:
        self._client: genai.Client | None = None

    def _get_client(self) -> genai.Client:
        if self._client is None:
            api_key = settings.active_gemini_api_key
            if not api_key:
                raise ValueError(
                    "Gemini API key is not configured. Please set GEMINI_API_KEY in backend/.env"
                )
            self._client = genai.Client(api_key=api_key)
        return self._client

    async def run(self, req: QueryRequest) -> QueryResponse:
        q_emb = await embedder.embed_query(req.question)
        docs, sources, context = self._retrieve(
            req.selected_doc_ids, q_emb, req.question, req.top_k
        )
        if not docs:
            return QueryResponse(
                answer="No relevant content found in the document.",
                sources=[],
                doc_id=req.selected_doc_ids[0],
                doc_ids=req.selected_doc_ids,
                question=req.question,
            )
        client = self._get_client()
        prompt = (
            "CONTEXT (retrieved from the vector store):\n"
            f"{context}\n\n"
            "QUESTION:\n"
            f"{req.question}\n\n"
            "Answer only from CONTEXT. Use [Source N, Page X] citations."
        )

        resp = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM,
                temperature=0.0,
                max_output_tokens=600,
            ),
        )
        answer = (resp.text or "").strip()
        if not answer:
            raise RuntimeError("The AI service returned an empty answer.")

        return QueryResponse(
            answer=answer,
            sources=sources,
            doc_id=req.selected_doc_ids[0],
            doc_ids=req.selected_doc_ids,
            question=req.question,
        )

    async def run_insight(self, req: InsightRequest) -> InsightResponse:
        doc_ids = req.selected_doc_ids
        if not doc_ids:
            raise ValueError("At least one document must be selected.")
        focus = (
            "Create a concise executive summary with 4-6 short paragraphs. "
            "Cover purpose, scope, key obligations or findings, and important limitations."
            if req.mode == "summary"
            else "Extract 6-10 concrete key points as a numbered list. Include dates, amounts, "
            "requirements, risks, and decisions when present."
        )
        q_emb = await embedder.embed_query("document overview key facts requirements findings")
        docs, sources, context = self._retrieve(doc_ids, q_emb, focus, req.top_k)
        if not docs:
            return InsightResponse(
                mode=req.mode, answer="No relevant content found in the document.",
                sources=[], doc_id=doc_ids[0], doc_ids=doc_ids,
            )
        client = self._get_client()
        resp = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=f"CONTEXT (retrieved from the vector store):\n{context}\n\nTASK:\n{focus}\n"
                    "Use only the context. Add [Source N, Page X] citations to every important claim.",
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM,
                temperature=0.0,
                max_output_tokens=700,
            ),
        )
        answer = (resp.text or "").strip()
        if not answer:
            raise RuntimeError("The AI service returned an empty insight.")
        return InsightResponse(
            mode=req.mode, answer=answer, sources=sources,
            doc_id=doc_ids[0], doc_ids=doc_ids,
        )

    @staticmethod
    def _retrieve(doc_ids: list[str], embedding: list[float], question: str, top_k: int):
        if not doc_ids:
            raise ValueError("At least one document must be selected.")
        matches = vector_store.query_many(doc_ids, embedding, top_k)
        matches = RAGPipeline._rerank(question, matches, top_k)
        context_parts = []
        sources: list[SourceChunk] = []
        for i, (doc, meta, dist) in enumerate(matches):
            context_parts.append(
                f"[Source {i+1} · {meta.get('filename', 'Document')} · Page {meta['page_label']}]\n{doc}"
            )
            sources.append(SourceChunk(
                doc_id=str(meta["doc_id"]), filename=str(meta.get("filename", "Document")),
                text=doc, page=int(meta["page"]), page_label=str(meta["page_label"]),
                bbox=[meta["x0"], meta["y0"], meta["x1"], meta["y1"]],
                chunk_index=int(meta["chunk_index"]), score=round(1.0 - float(dist), 3),
            ))
        return [match[0] for match in matches], sources, "\n\n---\n\n".join(context_parts)

    @staticmethod
    def _rerank(question: str, matches: list[tuple[str, dict, float]], top_k: int):
        """Blend semantic distance with exact-term overlap for factual lookups."""
        stop_words = {
            "a", "an", "and", "are", "as", "at", "by", "for", "from", "how",
            "in", "is", "it", "of", "on", "or", "the", "to", "what", "when",
            "where", "which", "who", "why", "with",
        }
        terms = {
            term for term in re.findall(r"[a-z0-9]+", question.lower())
            if len(term) > 2 and term not in stop_words
        }
        ranked = []
        for doc, meta, distance in matches:
            words = set(re.findall(r"[a-z0-9]+", doc.lower()))
            overlap = len(terms & words) / max(len(terms), 1)
            semantic = max(0.0, 1.0 - float(distance))
            ranked.append((0.7 * semantic + 0.3 * overlap, doc, meta, distance))
        ranked.sort(key=lambda item: item[0], reverse=True)
        return [
            (doc, meta, distance)
            for _, doc, meta, distance in ranked[: max(top_k, 3)]
        ]


rag_pipeline = RAGPipeline()

from google import genai
from google.genai import types
from core.config import settings


class Embedder:
    _BATCH = 32  # Keep requests below provider payload limits.

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

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        client = self._get_client()
        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), self._BATCH):
            batch = texts[i : i + self._BATCH]
            try:
                resp = await client.aio.models.embed_content(
                    model=settings.embedding_model,
                    contents=batch,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=768,
                    ),
                )
            except Exception:
                # Some provider/API-key combinations reject larger batches.
                # Retry the same data in single-item requests before failing.
                resp_items = []
                for text in batch:
                    item_resp = await client.aio.models.embed_content(
                        model=settings.embedding_model,
                        contents=[text],
                        config=types.EmbedContentConfig(
                            task_type="RETRIEVAL_DOCUMENT",
                            output_dimensionality=768,
                        ),
                    )
                    if not item_resp.embeddings:
                        raise ValueError("Embedding service returned no vector.")
                    resp_items.extend(item_resp.embeddings)
                all_embeddings.extend(item.values for item in resp_items)
                continue
            if resp.embeddings:
                all_embeddings.extend(item.values for item in resp.embeddings)
        return all_embeddings

    async def embed_query(self, text: str) -> list[float]:
        client = self._get_client()
        resp = await client.aio.models.embed_content(
            model=settings.embedding_model,
            contents=[text],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=768,
            ),
        )
        if resp.embeddings and len(resp.embeddings) > 0:
            return resp.embeddings[0].values
        raise ValueError("Failed to generate embedding from Gemini API.")


embedder = Embedder()

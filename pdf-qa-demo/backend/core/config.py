from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path
from functools import lru_cache

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_PATH = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    # Gemini LLM
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-lite-latest"
    embedding_model: str = "gemini-embedding-001"
    openai_api_key: str = ""  # fallback if set

    # App
    app_secret_key: str = "docmind-default-secret-key-32chars-minimum-length-ok"
    demo_api_key: str = "docmind-demo-key-2024"
    app_env: str = "development"
    cors_origins_str: str = Field(default="http://localhost:5173", validation_alias="cors_origins")

    # Storage
    chroma_db_path: str = str(_BACKEND_DIR / "chroma_db")
    upload_dir: str = str(_BACKEND_DIR / "uploads")
    database_path: str = str(_BACKEND_DIR / "docmind.sqlite3")
    max_file_size_mb: int = 20
    max_pages: int = 50

    # Rate Limiting
    rate_limit_query_per_minute: int = 10
    rate_limit_upload_per_hour: int = 5

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins_str.split(",") if o.strip()]

    @property
    def active_gemini_api_key(self) -> str:
        return self.gemini_api_key or self.openai_api_key

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    model_config = {
        "env_file": [".env", str(_ENV_PATH)],
        "case_sensitive": False,
        "extra": "ignore",
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

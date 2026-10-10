import sqlite3
from pathlib import Path
from typing import Any

from core.config import settings


class Database:
    def __init__(self) -> None:
        self.path = Path(settings.database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init(self) -> None:
        with self._connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    email TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS workspaces (
                    email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    answer_style TEXT NOT NULL DEFAULT 'strict',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS documents (
                    doc_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                    filename TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    pages INTEGER NOT NULL,
                    chunks INTEGER NOT NULL,
                    important INTEGER NOT NULL DEFAULT 0,
                    reviewed INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_documents_email ON documents(email);
            """)

    def ensure_user(self, email: str, name: str = "") -> None:
        if not email:
            return
        with self._connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO users(email, name) VALUES (?, ?)",
                (email, name or email.split("@")[0]),
            )
            db.execute(
                "INSERT OR IGNORE INTO workspaces(email, name) VALUES (?, ?)",
                (email, f"{name.split(' ')[0]}'s workspace" if name else "My workspace"),
            )

    def get_workspace(self, email: str) -> dict[str, Any]:
        self.ensure_user(email)
        with self._connect() as db:
            row = db.execute(
                "SELECT email, name, answer_style FROM workspaces WHERE email = ?", (email,)
            ).fetchone()
            return dict(row)

    def update_workspace(self, email: str, name: str, answer_style: str) -> dict[str, Any]:
        self.ensure_user(email)
        with self._connect() as db:
            db.execute(
                "UPDATE workspaces SET name = ?, answer_style = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?",
                (name, answer_style, email),
            )
        return self.get_workspace(email)

    def add_document(self, email: str, doc_id: str, filename: str, path: str, pages: int, chunks: int) -> None:
        self.ensure_user(email)
        with self._connect() as db:
            db.execute(
                """INSERT INTO documents
                (doc_id, email, filename, stored_path, pages, chunks)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (doc_id, email, filename, path, pages, chunks),
            )

    def list_documents(self, email: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT doc_id, filename, pages, chunks, important, reviewed, created_at, stored_path "
                "FROM documents WHERE email = ? ORDER BY created_at DESC", (email,)
            ).fetchall()]

    def get_document(self, email: str, doc_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM documents WHERE email = ? AND doc_id = ?", (email, doc_id)
            ).fetchone()
            return dict(row) if row else None

    def owns_documents(self, email: str, doc_ids: list[str]) -> bool:
        if not doc_ids:
            return False
        with self._connect() as db:
            row = db.execute(
                "SELECT COUNT(*) AS count FROM documents WHERE email = ? AND doc_id IN ({})".format(
                    ",".join("?" for _ in doc_ids)
                ),
                [email, *doc_ids],
            ).fetchone()
            return int(row["count"]) == len(set(doc_ids))


database = Database()

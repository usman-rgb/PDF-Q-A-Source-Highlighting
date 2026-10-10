from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from core.security import require_api_key
from models.schemas import DocumentResponse, WorkspaceResponse, WorkspaceUpdate
from services.database import database

router = APIRouter()


def user_email(x_user_email: str | None = Header(default=None)) -> str:
    return x_user_email or "local@docmind"


@router.get("/workspace", response_model=WorkspaceResponse, dependencies=[Depends(require_api_key)])
async def get_workspace(x_user_email: str | None = Header(default=None)):
    return database.get_workspace(user_email(x_user_email))


@router.put("/workspace", response_model=WorkspaceResponse, dependencies=[Depends(require_api_key)])
async def update_workspace(body: WorkspaceUpdate, x_user_email: str | None = Header(default=None)):
    if user_email(x_user_email) != body.email:
        raise HTTPException(status_code=403, detail="Workspace identity mismatch.")
    return database.update_workspace(body.email, body.name, body.answer_style)


@router.get("/documents", response_model=list[DocumentResponse], dependencies=[Depends(require_api_key)])
async def list_documents(x_user_email: str | None = Header(default=None)):
    return [
        DocumentResponse(
            doc_id=item["doc_id"], filename=item["filename"], pages=item["pages"],
            chunks=item["chunks"], important=bool(item["important"]),
            reviewed=bool(item["reviewed"]), created_at=item["created_at"],
        )
        for item in database.list_documents(user_email(x_user_email))
    ]


@router.get("/documents/{doc_id}/file", dependencies=[Depends(require_api_key)])
async def download_document(doc_id: str, x_user_email: str | None = Header(default=None)):
    item = database.get_document(user_email(x_user_email), doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="Document not found.")
    path = Path(item["stored_path"])
    if not path.is_file():
        raise HTTPException(status_code=410, detail="Stored document is no longer available.")
    return Response(content=path.read_bytes(), media_type="application/pdf")

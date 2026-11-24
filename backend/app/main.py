import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError

# ---- Paths: work both in development and inside the PyInstaller exe ----
if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).resolve().parent      # folder with the .exe
    FRONTEND_DIST = APP_DIR / "frontend_dist"            # ship dist here
else:
    APP_DIR = Path(__file__).resolve().parent.parent     # backend/
    FRONTEND_DIST = APP_DIR.parent / "frontend" / "dist"

for env_file in (APP_DIR / ".env", APP_DIR.parent / ".env"):
    if env_file.exists():
        load_dotenv(env_file)

from app.database import check_database
from app.clients import router as clients_router
from app.auditors import router as auditors_router
from app.filings import router as filings_router
from app.fees import router as fees_router
from app.tasks import router as tasks_router
from app.reminders import router as reminders_router
from app.auth import get_current_user, router as auth_router
from app.google_auth import router as google_auth_router
from app.users import router as users_router
from app.documents import router as documents_router
from app.setup import router as setup_router
from app.sync import router as sync_router, public_router as sync_public_router, start_sync
from app.services import router as services_router
from app.search import router as search_router
from app.invoices import router as invoices_router
from app.notifications import router as notifications_router, start_notifications
from app.reports import router as reports_router
from app.models import Base
from app.database import engine
from app.migrations import ensure_columns
from app.recurrence import start_recurrence


@asynccontextmanager
async def lifespan(_: FastAPI):
    start_sync()
    start_recurrence()
    start_notifications()
    yield


app = FastAPI(
    title="GST Client Management System",
    description="Client, auditor and GST filing management API",
    version="1.0.0",
    lifespan=lifespan,
)
Base.metadata.create_all(bind=engine)
ensure_columns(engine)


logger = logging.getLogger("whatsapp_webhook")
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")

@app.get("/webhook/whatsapp")
async def verify_whatsapp_webhook(request: Request):
    params = request.query_params
    if (
        params.get("hub.mode") == "subscribe"
        and WHATSAPP_VERIFY_TOKEN
        and params.get("hub.verify_token") == WHATSAPP_VERIFY_TOKEN
    ):
        return PlainTextResponse(params.get("hub.challenge", ""))
    raise HTTPException(status_code=403, detail="Webhook verification failed")


@app.post("/webhook/whatsapp")
async def receive_whatsapp_webhook(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook payload")
    logger.info("WhatsApp webhook received %s update(s)", len(payload.get("entry", [])))
    return {"status": "ok"}

app.include_router(auth_router)
app.include_router(google_auth_router)
app.include_router(users_router)
app.include_router(clients_router, dependencies=[Depends(get_current_user)])
app.include_router(auditors_router, dependencies=[Depends(get_current_user)])
app.include_router(filings_router, dependencies=[Depends(get_current_user)])
app.include_router(fees_router, dependencies=[Depends(get_current_user)])
app.include_router(tasks_router, dependencies=[Depends(get_current_user)])
app.include_router(reminders_router, dependencies=[Depends(get_current_user)])
app.include_router(documents_router, dependencies=[Depends(get_current_user)])
app.include_router(services_router, dependencies=[Depends(get_current_user)])
app.include_router(search_router)
app.include_router(invoices_router, dependencies=[Depends(get_current_user)])
app.include_router(notifications_router, dependencies=[Depends(get_current_user)])
app.include_router(reports_router, dependencies=[Depends(get_current_user)])
app.include_router(setup_router)
app.include_router(sync_public_router)
app.include_router(sync_router)

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "executable": str(Path(sys.executable).resolve())}


@app.get("/api/health/database")
def database_health():
    try:
        check_database()
        return {"status": "ok", "database": "connected"}
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Database connection failed")


# CORS is only needed for the Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Serve the React build (must stay LAST) ----
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if full_path.startswith(("api/", "webhook/")):
        raise HTTPException(status_code=404, detail="Not found")

    if full_path:
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(candidate)

    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    raise HTTPException(
        status_code=404,
        detail="Frontend build not found. Run npm run build in the frontend folder.",
    )
import logging
import os
from datetime import timedelta
from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db, utcnow
from ..models import MagicLink, Organizer, OrganizerSession
from ..security import new_token, token_hash
from ..services import magic_links
from ..services.mailer import deliver, preview_enabled, public_link

router = APIRouter(prefix="/auth", tags=["auth"])
SESSION_COOKIE = "alleycat_session"
log = logging.getLogger(__name__)
THROTTLE = timedelta(seconds=60)
SESSION_TTL = timedelta(days=7)  # counted from the last use, not from sign-in
RENEW_EVERY = timedelta(days=1)  # so an active session costs one write a day, not one per request
GENERIC = "If this email belongs to an organizer account, a sign-in link has been sent."


class EmailIn(BaseModel):
    email: str


def normalize_email(email: str) -> str:
    return email.strip().lower()


def superadmin_email() -> str:
    return normalize_email(os.getenv("SUPERADMIN_EMAIL", ""))


def set_session_cookie(response: Response, session_token: str):
    response.set_cookie(SESSION_COOKIE, session_token, httponly=True, secure=not preview_enabled(), samesite="lax",
                        max_age=int(SESSION_TTL.total_seconds()))


def organizer(alleycat_session: str | None = Cookie(None), db: Session = Depends(get_db), response: Response = None) -> Organizer:
    if not alleycat_session:
        raise HTTPException(401, "Organizer authentication required")
    session = db.query(OrganizerSession).filter_by(token_hash=token_hash(alleycat_session)).first()
    now = utcnow()
    if not session or session.revoked_at or session.expires_at <= now:
        raise HTTPException(401, "Organizer authentication required")
    account = db.get(Organizer, session.organizer_id)
    if not account:
        raise HTTPException(401, "Organizer authentication required")
    # ponytail: sliding expiry with no absolute cap; a stolen cookie stays valid while used, add a max age if that matters
    if session.expires_at - now < SESSION_TTL - RENEW_EVERY:
        session.expires_at = now + SESSION_TTL
        db.commit()
        if response is not None:
            set_session_cookie(response, alleycat_session)
    return account


def superadmin(account: Organizer = Depends(organizer)) -> Organizer:
    if account.role != "superadmin":
        raise HTTPException(403, "Superadmin only")
    return account


def deliver_quietly(email: str, link: str):
    # Runs after the response: SMTP latency or failure must not reveal which emails have accounts.
    try:
        deliver(email, link, "magic_link")
    except Exception:
        log.exception("Magic-link delivery failed")


@router.post("/magic-links")
def issue_magic_link(body: EmailIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    email = normalize_email(body.email)
    account = db.query(Organizer).filter_by(email=email).first()
    if not account and email and email == superadmin_email():
        account = Organizer(email=email, role="superadmin")
        db.add(account)
        db.flush()
    if not account:
        return {"detail": GENERIC}  # identical response: never reveal whether an account exists
    # Throttle: an unused link issued in the last 60 s (links live 15 min) blocks a new one.
    recent = utcnow() + timedelta(minutes=15) - THROTTLE
    if db.query(MagicLink).filter(MagicLink.organizer_id == account.id, MagicLink.used_at.is_(None), MagicLink.expires_at > recent).first():
        db.commit()
        return {"detail": GENERIC}
    token = magic_links.issue(db, account)
    link = public_link(f"/auth/consume/{token}")
    db.commit()
    background.add_task(deliver_quietly, email, link)
    return {"detail": GENERIC, **({"link": link} if preview_enabled() else {})}


@router.post("/consume/{token}")
def consume_magic_link(token: str, response: Response, db: Session = Depends(get_db)):
    link = magic_links.consume(db, token)
    if not link:
        raise HTTPException(404, "Magic link is invalid, expired, or already used")
    session_token = new_token()
    db.add(OrganizerSession(organizer_id=link.organizer_id, token_hash=token_hash(session_token), expires_at=utcnow() + SESSION_TTL))
    db.commit()
    set_session_cookie(response, session_token)
    return {"status": "signed_in"}


@router.get("/me")
def me(account: Organizer = Depends(organizer)):
    return {"id": account.id, "email": account.email, "role": account.role}

from datetime import timedelta
from sqlalchemy.orm import Session
from ..database import utcnow
from ..models import MagicLink, Organizer
from ..security import new_token, token_hash


def issue(db: Session, organizer: Organizer) -> str:
    token = new_token()
    db.add(MagicLink(organizer_id=organizer.id, token_hash=token_hash(token), expires_at=utcnow() + timedelta(minutes=15)))
    return token


def consume(db: Session, token: str) -> MagicLink | None:
    link = db.query(MagicLink).filter_by(token_hash=token_hash(token)).first()
    if not link or link.used_at or link.expires_at <= utcnow():
        return None
    link.used_at = utcnow()
    return link

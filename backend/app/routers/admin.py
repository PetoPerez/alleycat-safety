from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Organizer
from .auth import EmailIn, normalize_email, superadmin

router = APIRouter(prefix="/admin", tags=["admin"])


def out(account: Organizer):
    return {"id": account.id, "email": account.email, "role": account.role, "created_at": account.created_at}


@router.post("/organizers", status_code=201)
def create_organizer(body: EmailIn, account=Depends(superadmin), db: Session = Depends(get_db)):
    email = normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(422, "A valid email is required")
    created = Organizer(email=email, role="admin")
    db.add(created)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An organizer with this email already exists")
    db.refresh(created)
    return out(created)


@router.get("/organizers")
def list_organizers(account=Depends(superadmin), db: Session = Depends(get_db)):
    return [out(item) for item in db.query(Organizer).order_by(Organizer.email).all()]

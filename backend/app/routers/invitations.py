from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ..database import get_db, utcnow
from ..models import Checkpoint, Invitation, Race, Rider
from ..security import token_hash
from ..services import invitations as service
from ..services import races as race_service
from ..services.mailer import preview_enabled
from .auth import organizer
from .races import race_for

router = APIRouter(tags=["invitations"])
DUPLICATE = "Active invitation exists; resend or revoke it"


class InviteIn(BaseModel):
    rider_id: int
    channel: str
    expires_hours: int = 168


def response(invitation: Invitation, link: str):
    # WhatsApp links are handed to the organizer to copy; email links stay out of the response outside development.
    show = invitation.channel == "whatsapp" or preview_enabled()
    return {"id": invitation.id, "delivery_status": invitation.delivery_status, "state": service.state(invitation),
            "expires_at": invitation.expires_at, **({"link": link} if show else {})}


def owned_invitation(invitation_id: int, account, db: Session) -> Invitation:
    item = db.get(Invitation, invitation_id)
    if not item:
        raise HTTPException(404, "Invitation not found")
    race_for(item.race_id, account, db)
    return item


@router.post("/races/{race_id}/invitations")
def invite(race_id: int, body: InviteIn, account=Depends(organizer), db: Session = Depends(get_db)):
    race = race_for(race_id, account, db)
    if race.status != "published":
        raise HTTPException(422, "Publish race before inviting")
    rider = db.get(Rider, body.rider_id)
    if not rider or rider.organizer_id != account.id:
        raise HTTPException(404, "Rider not found")
    if body.channel not in ("email", "whatsapp"):
        raise HTTPException(422, "Unsupported delivery channel")
    if body.channel == "email" and not rider.email:
        raise HTTPException(422, "Email delivery requires a rider email address")
    if not 1 <= body.expires_hours <= 24 * 30:
        raise HTTPException(422, "Invitation expiry must be between 1 hour and 30 days")
    if any(service.active(item) for item in db.query(Invitation).filter_by(race_id=race.id, rider_id=rider.id).all()):
        raise HTTPException(409, DUPLICATE)
    try:
        invitation, link = service.issue(db, race, rider, body.channel, body.expires_hours)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, DUPLICATE)
    return response(invitation, link)


@router.get("/races/{race_id}/invitations")
def list_invitations(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    return [{"id": item.id, "rider_id": item.rider_id, "channel": item.channel, "expires_at": item.expires_at,
             "delivery_status": item.delivery_status, "state": service.state(item)}
            for item in db.query(Invitation).filter_by(race_id=race_id).order_by(Invitation.id).all()]


@router.post("/invitations/{invitation_id}/revoke")
def revoke(invitation_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    item = owned_invitation(invitation_id, account, db)
    if not service.active(item):
        raise HTTPException(422, f"Invitation is already {service.state(item)}")
    item.active = False
    item.revoked_at = utcnow()
    item.delivery_status = "revoked"
    service.event(db, item, "revoked")
    db.commit()
    return {"status": "revoked"}


@router.post("/invitations/{invitation_id}/resend")
def resend(invitation_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    item = owned_invitation(invitation_id, account, db)
    if not service.active(item):
        raise HTTPException(422, "Invitation is no longer active")
    rider = db.get(Rider, item.rider_id)
    hours_left = max(1, int((item.expires_at - utcnow()).total_seconds() // 3600))
    replacement, link = service.issue(db, db.get(Race, item.race_id), rider, item.channel, hours_left, item)
    db.commit()
    return response(replacement, link)


# POST, not GET: the SPA owns GET /invite/{token}, and link-preview bots must not mark invitations opened.
@router.post("/invite/{token}")
def open_invite(token: str, db: Session = Depends(get_db)):
    item = db.query(Invitation).filter_by(token_hash=token_hash(token)).first()
    if not item or not service.active(item):
        raise HTTPException(404, "This invitation is invalid, expired, revoked, or already used")
    if not item.opened_at:
        item.opened_at = utcnow()
        item.delivery_status = "opened"
        service.event(db, item, "opened")
        db.commit()
    race = db.get(Race, item.race_id)
    summary = {"name": race.name, "start_label": race.start_label, "starts_at": race.starts_at, "ends_at": race.ends_at,
               "checkpoints_release_at": race_service.release_at(race)}
    # Before release the response carries no checkpoint data at all, not even a count.
    if race_service.released(race, utcnow()):
        pins = db.query(Checkpoint).filter_by(race_id=race.id, active=True).order_by(Checkpoint.name).all()
        summary["checkpoints"] = [{"name": p.name, "latitude": p.latitude, "longitude": p.longitude} for p in pins]
    return {"race": summary, "next": "Registration will be available in a later release."}

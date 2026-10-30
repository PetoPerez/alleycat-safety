"""Race day: what riders report with their invitation token, and what the owning organizer sees."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db, utcnow
from ..models import Checkpoint, CheckIn, HelpRequest, Invitation, Race, Rider, RiderPosition
from ..services import races as race_service
from .auth import organizer
from .invitations import active_invitation
from .races import race_for

router = APIRouter(tags=["live"])
HELP_KINDS = ("medical", "accident", "mechanical", "other")


class PositionIn(BaseModel):
    latitude: float
    longitude: float


class CheckInIn(BaseModel):
    code: str
    latitude: float
    longitude: float


class HelpIn(BaseModel):
    kind: str
    latitude: float | None = None
    longitude: float | None = None


def live_race(token: str, db: Session):
    item = active_invitation(token, db)
    race = db.get(Race, item.race_id)
    now = utcnow()
    if race.status != "published" or not race.starts_at <= now < race.ends_at:
        raise HTTPException(422, "Race is not in progress")
    return item, race, now


@router.post("/invite/{token}/position", status_code=204)
def report_position(token: str, body: PositionIn, db: Session = Depends(get_db)):
    item, race, now = live_race(token, db)
    if not race_service.coordinates_valid(body.latitude, body.longitude):
        raise HTTPException(422, "Invalid coordinates")
    db.merge(RiderPosition(race_id=race.id, rider_id=item.rider_id, latitude=body.latitude, longitude=body.longitude,
                           recorded_at=now))
    db.commit()


@router.post("/invite/{token}/checkins")
def check_in(token: str, body: CheckInIn, db: Session = Depends(get_db)):
    item, race, now = live_race(token, db)
    checkpoint = db.query(Checkpoint).filter_by(code=body.code, race_id=race.id, active=True).first()
    if not checkpoint:
        raise HTTPException(404, "Checkpoint not found")
    if not race_service.coordinates_valid(body.latitude, body.longitude):
        raise HTTPException(422, "Invalid coordinates")
    # The QR proves the code was seen; the position proves the rider was there, not sent a photo of it.
    if race_service.distance_m(body.latitude, body.longitude, checkpoint.latitude, checkpoint.longitude) > race_service.CHECKIN_RADIUS_M:
        raise HTTPException(422, "Too far from the checkpoint")
    existing = db.get(CheckIn, (checkpoint.id, item.rider_id))
    if not existing:
        existing = CheckIn(checkpoint_id=checkpoint.id, rider_id=item.rider_id, checked_in_at=now)
        db.add(existing)
        db.commit()
    return {"checkpoint": checkpoint.name, "checked_in_at": existing.checked_in_at}


@router.post("/invite/{token}/help", status_code=201)
def ask_help(token: str, body: HelpIn, db: Session = Depends(get_db)):
    """Accepted for as long as the invitation is valid, not only during the race: help is never refused on a clock."""
    item = active_invitation(token, db)
    if body.kind not in HELP_KINDS:
        raise HTTPException(422, "Unknown help type")
    if (body.latitude is None) != (body.longitude is None) or (
            body.latitude is not None and not race_service.coordinates_valid(body.latitude, body.longitude)):
        raise HTTPException(422, "Invalid coordinates")
    request = HelpRequest(race_id=item.race_id, rider_id=item.rider_id, kind=body.kind, latitude=body.latitude,
                          longitude=body.longitude, created_at=utcnow())
    db.add(request)
    db.commit()
    return {"id": request.id}


@router.get("/races/{race_id}/positions")
def positions(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    rows = db.query(RiderPosition, Rider.name).join(Rider, Rider.id == RiderPosition.rider_id).filter(
        RiderPosition.race_id == race_id).order_by(Rider.name).all()
    return [{"rider_id": p.rider_id, "name": name, "latitude": p.latitude, "longitude": p.longitude,
             "recorded_at": p.recorded_at} for p, name in rows]


@router.get("/races/{race_id}/checkins")
def checkins(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    rows = db.query(CheckIn, Rider.name, Checkpoint.name).join(Rider, Rider.id == CheckIn.rider_id).join(
        Checkpoint, Checkpoint.id == CheckIn.checkpoint_id).filter(Checkpoint.race_id == race_id).order_by(CheckIn.checked_in_at).all()
    return [{"rider_id": c.rider_id, "rider": rider, "checkpoint_id": c.checkpoint_id, "checkpoint": checkpoint,
             "checked_in_at": c.checked_in_at} for c, rider, checkpoint in rows]


@router.get("/races/{race_id}/help")
def help_requests(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    rows = db.query(HelpRequest, Rider).join(Rider, Rider.id == HelpRequest.rider_id).filter(
        HelpRequest.race_id == race_id).order_by(HelpRequest.created_at.desc()).all()
    return [{"id": h.id, "rider": r.name, "phone": r.phone, "kind": h.kind, "latitude": h.latitude, "longitude": h.longitude,
             "created_at": h.created_at, "resolved_at": h.resolved_at} for h, r in rows]


@router.post("/help/{help_id}/resolve")
def resolve_help(help_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    item = db.get(HelpRequest, help_id)
    if not item:
        raise HTTPException(404, "Help request not found")
    race_for(item.race_id, account, db)
    if not item.resolved_at:
        item.resolved_at = utcnow()
        db.commit()
    return {"id": item.id, "resolved_at": item.resolved_at}


@router.get("/races/{race_id}/board")
def board(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    """Everything the race-day screen shows, in one poll."""
    race = race_for(race_id, account, db)
    pins = db.query(Checkpoint).filter_by(race_id=race_id, active=True).order_by(Checkpoint.name).all()
    visits = db.query(CheckIn).join(Checkpoint, Checkpoint.id == CheckIn.checkpoint_id).filter(Checkpoint.race_id == race_id).all()
    # Revoked riders drop off the board unless they already reached a checkpoint.
    rider_ids = {i.rider_id for i in db.query(Invitation).filter(Invitation.race_id == race_id, Invitation.delivery_status != "revoked")}
    rider_ids |= {v.rider_id for v in visits}
    riders = db.query(Rider).filter(Rider.id.in_(rider_ids)).all() if rider_ids else []
    help_open = [h for h in help_requests(race_id, account, db) if not h["resolved_at"]]
    return {"race": {"id": race.id, "name": race.name, "starts_at": race.starts_at, "ends_at": race.ends_at,
                     "winner_rider_id": race.winner_rider_id},
            "checkpoints": [{"id": p.id, "name": p.name} for p in pins],
            "riders": [{"id": r.id, "name": r.name} for r in riders],
            "checkins": [{"rider_id": v.rider_id, "checkpoint_id": v.checkpoint_id, "checked_in_at": v.checked_in_at} for v in visits],
            "help": help_open}

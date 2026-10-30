from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict
from sqlalchemy.orm import Session
from ..database import get_db, utcnow
from ..models import CheckIn, Checkpoint, HelpRequest, Invitation, InvitationEvent, Race, Rider, RiderPosition
from ..services import races as race_service
from .auth import organizer

router = APIRouter(tags=["races"])


class RaceIn(BaseModel):
    name: str
    start_label: str
    latitude: float
    longitude: float
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    checkpoints_release_minutes: int = 10


class CheckpointIn(BaseModel):
    name: str
    description: str | None = None
    latitude: float
    longitude: float


class RiderIn(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RaceOut(Out):
    id: int
    name: str
    start_label: str
    latitude: float
    longitude: float
    starts_at: datetime
    ends_at: datetime
    status: str
    checkpoints_release_minutes: int
    checkpoints_release_at: datetime
    checkpoints_released: bool


class CheckpointOut(Out):
    id: int
    race_id: int
    name: str
    description: str | None
    latitude: float
    longitude: float
    code: str


class RiderOut(Out):
    id: int
    name: str
    email: str | None
    phone: str | None


def race_for(race_id: int, account, db: Session) -> Race:
    """Ownership guard: someone else's race is indistinguishable from a missing one."""
    race = db.get(Race, race_id)
    if not race or race.organizer_id != account.id:
        raise HTTPException(404, "Race not found")
    return race


def coordinate_field(latitude: float) -> str:
    return "latitude" if not -90 <= latitude <= 90 else "longitude"


def race_values(body: RaceIn) -> dict:
    return {**body.model_dump(), "name": body.name.strip(), "start_label": body.start_label.strip()}


def field_error(field: str, message: str):
    raise HTTPException(422, [{"loc": ["body", field], "msg": message}])


def validate(body: RaceIn):
    if not body.name.strip():
        field_error("name", "Name cannot be blank")
    if not body.start_label.strip():
        field_error("start_label", "Start area cannot be blank")
    if not race_service.coordinates_valid(body.latitude, body.longitude):
        field_error(coordinate_field(body.latitude), "Invalid coordinates")
    if body.ends_at <= body.starts_at:
        field_error("ends_at", "End time must be after start time")
    if not race_service.release_minutes_valid(body.checkpoints_release_minutes):
        field_error("checkpoints_release_minutes", "Release minutes must be between 0 and 1440")


def draft_for(race_id: int, account, db: Session) -> Race:
    race = race_for(race_id, account, db)
    if race.status != "draft":
        raise HTTPException(422, "Published races cannot be changed in this release")
    return race


@router.post("/races/{race_id}/riders", response_model=RiderOut)
def create_rider(race_id: int, body: RiderIn, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    name = body.name.strip()
    email = (body.email or "").strip().lower() or None
    phone = (body.phone or "").strip() or None
    if not name:
        field_error("name", "Rider name cannot be blank")
    if not email and not phone:
        field_error("email", "Email or phone is required")
    rider = Rider(organizer_id=account.id, race_id=race_id, name=name, email=email, phone=phone)
    db.add(rider)
    db.commit()
    db.refresh(rider)
    return rider


@router.get("/races/{race_id}/riders", response_model=list[RiderOut])
def list_riders(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    return db.query(Rider).filter_by(race_id=race_id).order_by(Rider.name).all()


@router.post("/races", response_model=RaceOut)
def create_race(body: RaceIn, account=Depends(organizer), db: Session = Depends(get_db)):
    validate(body)
    race = Race(organizer_id=account.id, status="draft", **race_values(body))
    db.add(race)
    db.commit()
    db.refresh(race)
    return race


@router.put("/races/{race_id}", response_model=RaceOut)
def edit_race(race_id: int, body: RaceIn, account=Depends(organizer), db: Session = Depends(get_db)):
    race = draft_for(race_id, account, db)
    validate(body)
    for key, value in race_values(body).items():
        setattr(race, key, value)
    db.commit()
    db.refresh(race)
    return race


@router.get("/races", response_model=list[RaceOut])
def list_races(account=Depends(organizer), db: Session = Depends(get_db)):
    return db.query(Race).filter_by(organizer_id=account.id).order_by(Race.starts_at).all()


@router.get("/races/{race_id}", response_model=RaceOut)
def get_race(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    return race_for(race_id, account, db)


@router.delete("/races/{race_id}", status_code=204)
def delete_race(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    """Only finished races: deleting one mid-event would erase help requests still being handled."""
    race = race_for(race_id, account, db)
    if race.ends_at > utcnow():
        raise HTTPException(422, "Only finished races can be deleted")
    pins = db.query(Checkpoint.id).filter_by(race_id=race_id)
    invitations = db.query(Invitation.id).filter_by(race_id=race_id)
    riders = db.query(Rider.id).filter_by(race_id=race_id)
    # Children first: the foreign keys have no ON DELETE CASCADE.
    for query in (db.query(CheckIn).filter(CheckIn.checkpoint_id.in_(pins) | CheckIn.rider_id.in_(riders)),
                  db.query(InvitationEvent).filter(InvitationEvent.invitation_id.in_(invitations)),
                  db.query(Invitation).filter_by(race_id=race_id), db.query(RiderPosition).filter_by(race_id=race_id),
                  db.query(HelpRequest).filter_by(race_id=race_id), db.query(Checkpoint).filter_by(race_id=race_id),
                  db.query(Rider).filter_by(race_id=race_id)):
        query.delete(synchronize_session=False)
    db.delete(race)
    db.commit()


@router.post("/races/{race_id}/checkpoints", response_model=CheckpointOut)
def add_checkpoint(race_id: int, body: CheckpointIn, account=Depends(organizer), db: Session = Depends(get_db)):
    draft_for(race_id, account, db)
    if not race_service.coordinates_valid(body.latitude, body.longitude):
        field_error(coordinate_field(body.latitude), "Invalid coordinates")
    if not body.name.strip():
        field_error("name", "Checkpoint label cannot be blank")
    checkpoint = Checkpoint(race_id=race_id, **{**body.model_dump(), "name": body.name.strip()})
    db.add(checkpoint)
    db.commit()
    db.refresh(checkpoint)
    return checkpoint


@router.get("/races/{race_id}/checkpoints", response_model=list[CheckpointOut])
def checkpoints(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race_for(race_id, account, db)
    return db.query(Checkpoint).filter_by(race_id=race_id, active=True).all()


@router.delete("/races/{race_id}/checkpoints/{checkpoint_id}", status_code=204)
def delete_checkpoint(race_id: int, checkpoint_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    draft_for(race_id, account, db)
    checkpoint = db.get(Checkpoint, checkpoint_id)
    if not checkpoint or checkpoint.race_id != race_id:
        raise HTTPException(404, "Checkpoint not found")
    db.delete(checkpoint)
    db.commit()


@router.post("/races/{race_id}/publish", response_model=RaceOut)
def publish(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    race = race_for(race_id, account, db)
    if race.status == "published":
        return race
    if not race_service.publishable(db.query(Checkpoint).filter_by(race_id=race.id, active=True).count()):
        raise HTTPException(422, "Add at least one checkpoint before publishing")
    race.status = "published"
    db.commit()
    db.refresh(race)
    return race


@router.post("/races/{race_id}/release-checkpoints", response_model=RaceOut)
def release_checkpoints(race_id: int, account=Depends(organizer), db: Session = Depends(get_db)):
    """Irreversible: there is deliberately no endpoint to hide checkpoints again."""
    race = race_for(race_id, account, db)
    if race.status != "published":
        raise HTTPException(422, "Publish race before releasing checkpoints")
    now = utcnow()
    if not race_service.released(race, now):  # already released: idempotent, release time stays put
        race.checkpoints_released_at = now
        db.commit()
        db.refresh(race)
    return race

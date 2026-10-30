import secrets
from datetime import datetime
from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base, UTCDateTime, utcnow
from .services.races import release_at, released


class Organizer(Base):
    __tablename__ = "organizers"
    __table_args__ = (CheckConstraint("role in ('superadmin', 'admin')", name="organizer_role"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)  # always stored strip().lower()
    role: Mapped[str] = mapped_column(String, default="admin")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Rider(Base):
    __tablename__ = "riders"
    id: Mapped[int] = mapped_column(primary_key=True)
    organizer_id: Mapped[int] = mapped_column(ForeignKey("organizers.id"))
    race_id: Mapped[int | None] = mapped_column(ForeignKey("races.id"), nullable=True)  # each race has its own roster; null only for pre-0006 riders
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)


class Race(Base):
    __tablename__ = "races"
    id: Mapped[int] = mapped_column(primary_key=True)
    organizer_id: Mapped[int] = mapped_column(ForeignKey("organizers.id"))
    name: Mapped[str] = mapped_column(String)
    start_label: Mapped[str] = mapped_column(String)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String, default="draft")
    checkpoints_release_minutes: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    checkpoints_released_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)  # "release now"; never cleared
    # Chosen by the organizers at the finish line, after checking the rider's checkpoints; not computed.
    winner_rider_id: Mapped[int | None] = mapped_column(ForeignKey("riders.id", use_alter=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)  # the real start whistle; starts_at is only the plan

    @property
    def checkpoints_release_at(self) -> datetime:
        return release_at(self)

    @property
    def checkpoints_released(self) -> bool:
        return released(self, utcnow())


class Checkpoint(Base):
    """Unordered by design: there is no sequence column. At most one per race is the finish line (meta)."""
    __tablename__ = "checkpoints"
    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    finish: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    code: Mapped[str] = mapped_column(String, unique=True, default=lambda: secrets.token_urlsafe(12))  # secret in the checkpoint QR


class MagicLink(Base):
    __tablename__ = "magic_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    organizer_id: Mapped[int] = mapped_column(ForeignKey("organizers.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class OrganizerSession(Base):
    __tablename__ = "organizer_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    organizer_id: Mapped[int] = mapped_column(ForeignKey("organizers.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (Index("one_active_invitation", "race_id", "rider_id", unique=True, sqlite_where=text("active"), postgresql_where=text("active")),)
    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    rider_id: Mapped[int] = mapped_column(ForeignKey("riders.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    channel: Mapped[str] = mapped_column(String)
    delivery_status: Mapped[str] = mapped_column(String, default="created")
    opened_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)  # set by rider registration (later slice)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)  # the rider said "I'm riding"
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class InvitationEvent(Base):
    """Append-only audit trail; token values are deliberately never recorded."""
    __tablename__ = "invitation_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    invitation_id: Mapped[int] = mapped_column(ForeignKey("invitations.id"))
    event: Mapped[str] = mapped_column(String)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)


class RiderPosition(Base):
    """Latest known position only: each report overwrites the previous one, no track history is kept."""
    __tablename__ = "rider_positions"
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"), primary_key=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("riders.id"), primary_key=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime)


class CheckIn(Base):
    """A rider scanned a checkpoint's QR; one row per rider and checkpoint, the first scan wins."""
    __tablename__ = "check_ins"
    checkpoint_id: Mapped[int] = mapped_column(ForeignKey("checkpoints.id"), primary_key=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("riders.id"), primary_key=True)
    checked_in_at: Mapped[datetime] = mapped_column(UTCDateTime)


class HelpRequest(Base):
    __tablename__ = "help_requests"
    __table_args__ = (CheckConstraint("kind in ('medical', 'accident', 'mechanical', 'other')", name="help_kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    rider_id: Mapped[int] = mapped_column(ForeignKey("riders.id"))
    kind: Mapped[str] = mapped_column(String)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)  # absent when the phone gave no fix
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

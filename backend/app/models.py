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

    @property
    def checkpoints_release_at(self) -> datetime:
        return release_at(self)

    @property
    def checkpoints_released(self) -> bool:
        return released(self, utcnow())


class Checkpoint(Base):
    """Unordered by design: there is no sequence column."""
    __tablename__ = "checkpoints"
    id: Mapped[int] = mapped_column(primary_key=True)
    race_id: Mapped[int] = mapped_column(ForeignKey("races.id"))
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


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

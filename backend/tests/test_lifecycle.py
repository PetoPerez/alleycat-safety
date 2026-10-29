"""Lifecycle tests deliberately call the HTTP handlers directly.

Starlette's TestClient deadlocks with the Python 3.14 portal/runtime combination
used here; handler tests preserve lifecycle coverage without it.
"""
import asyncio
import logging
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["APP_ENV"] = "development"
os.environ["SUPERADMIN_EMAIL"] = "Boss@Example.test"
os.environ.pop("SMTP_HOST", None)

import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException, Response
from app.database import Base, SessionLocal, engine, normalize_url, utcnow
from app.main import app
from app.models import Checkpoint, Invitation, MagicLink, Organizer, OrganizerSession
from app.routers.admin import create_organizer, list_organizers
from app.routers.auth import EmailIn, consume_magic_link, issue_magic_link, organizer, superadmin
from app.routers.invitations import InviteIn, invite, list_invitations, open_invite, resend, revoke
from app.routers.races import (CheckpointIn, RaceIn, RiderIn, add_checkpoint, checkpoints, create_race, create_rider,
                               delete_checkpoint, edit_race, get_race, publish, release_checkpoints)
from app.services import mailer

Base.metadata.create_all(engine)
START = datetime(2030, 1, 1, 10, tzinfo=UTC)


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    # Retire unused links so the 60 s magic-link throttle doesn't leak between tests.
    session.rollback()
    session.query(MagicLink).filter(MagicLink.used_at.is_(None)).update({"expires_at": datetime(2000, 1, 1, tzinfo=UTC)})
    session.commit()
    session.close()


def request_link(db, email, run_tasks=False):
    tasks = BackgroundTasks()
    result = issue_magic_link(EmailIn(email=email), tasks, db)
    if run_tasks:
        asyncio.run(tasks())
    return result


def status_of(call, *args) -> HTTPException:
    with pytest.raises(HTTPException) as exc:
        call(*args)
    return exc.value


def token_of(link: str) -> str:
    return link.rsplit("/", 1)[1]


def sign_in(db, email) -> Organizer:
    issued = request_link(db, email)
    response = Response()
    consume_magic_link(token_of(issued["link"]), response, db)
    cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    return organizer(cookie, db)


def boss(db) -> Organizer:
    return sign_in(db, "boss@example.test")


def new_admin(db, email) -> Organizer:
    create_organizer(EmailIn(email=email), boss(db), db)
    return sign_in(db, email)


def race_input(name="Night", **overrides):
    values = dict(name=name, start_label="Park", latitude=19.4, longitude=-99.1, starts_at=START, ends_at=START + timedelta(hours=2))
    return RaceIn(**{**values, **overrides})


def published_race(db, admin, name="Night"):
    race = create_race(race_input(name), admin, db)
    add_checkpoint(race.id, CheckpointIn(name="A", latitude=19.41, longitude=-99.11), admin, db)
    publish(race.id, admin, db)
    return race


# --- auth & roles -------------------------------------------------------------

def test_superadmin_bootstraps_and_creates_admins(db):
    root = boss(db)
    assert root.role == "superadmin" and root.email == "boss@example.test"
    created = create_organizer(EmailIn(email="  New@Example.test "), root, db)
    assert created["email"] == "new@example.test" and created["role"] == "admin"
    assert status_of(create_organizer, EmailIn(email="NEW@example.test"), root, db).status_code == 409
    admin = sign_in(db, "new@example.test")
    assert admin.role == "admin"
    assert status_of(superadmin, admin).status_code == 403
    assert "new@example.test" in [o["email"] for o in list_organizers(root, db)]


def test_unknown_email_gets_generic_response_and_nothing_is_created(db):
    before = db.query(MagicLink).count()
    known = request_link(db, "boss@example.test")
    unknown = request_link(db, "stranger@example.test")
    assert "link" not in unknown and unknown["detail"] == known["detail"]
    assert db.query(Organizer).filter_by(email="stranger@example.test").count() == 0
    assert db.query(MagicLink).count() == before + 1


class FakeSMTP:
    sent = []
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def starttls(self): pass
    def login(self, *args): pass
    def send_message(self, message): FakeSMTP.sent.append(message)


@pytest.mark.parametrize("app_env", [None, "production", "staging"])
def test_outside_development_links_are_never_returned(db, monkeypatch, app_env):
    admin = new_admin(db, f"prod-{app_env}@example.test")
    race = published_race(db, admin, "Prod")
    rider = create_rider(RiderIn(name="R", email="prod-rider@example.test"), admin, db)
    if app_env:
        monkeypatch.setenv("APP_ENV", app_env)
    else:
        monkeypatch.delenv("APP_ENV")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    FakeSMTP.sent = []
    known = request_link(db, admin.email, run_tasks=True)
    unknown = request_link(db, "nobody@example.test", run_tasks=True)
    assert known == unknown and "link" not in known
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="email"), admin, db)
    assert "link" not in created and created["delivery_status"] == "sent"
    assert [m["Subject"] for m in FakeSMTP.sent] == ["Your Alleycat Safety sign-in link", "Your Alleycat Safety race invitation"]
    response = Response()
    token = token_of(FakeSMTP.sent[0].get_content().strip())
    consume_magic_link(token, response, db)
    assert "Secure" in response.headers["set-cookie"] and "HttpOnly" in response.headers["set-cookie"]


def test_outside_development_without_smtp_sends_nothing_and_stays_generic(monkeypatch, db, caplog):
    monkeypatch.delenv("APP_ENV")
    with caplog.at_level(logging.ERROR):
        result = request_link(db, "boss@example.test", run_tasks=True)
    assert result == {"detail": request_link(db, "nobody@example.test")["detail"]}
    assert "Magic-link delivery failed" in caplog.text


class BrokenSMTP(FakeSMTP):
    def send_message(self, message): raise OSError("smtp down")


def test_smtp_failure_for_known_email_still_returns_generic(monkeypatch, db):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(mailer.smtplib, "SMTP", BrokenSMTP)
    known = request_link(db, "boss@example.test", run_tasks=True)
    assert known == request_link(db, "nobody@example.test", run_tasks=True)


def test_magic_link_requests_are_throttled(db):
    first = request_link(db, "boss@example.test")
    count = db.query(MagicLink).count()
    second = request_link(db, "boss@example.test")
    assert "link" in first and "link" not in second and second["detail"] == first["detail"]
    assert db.query(MagicLink).count() == count


def test_blank_email_without_superadmin_configured_gets_nothing(monkeypatch, db):
    monkeypatch.delenv("SUPERADMIN_EMAIL")
    result = request_link(db, "  ")
    assert "link" not in result and db.query(Organizer).filter_by(email="").count() == 0


def test_http_sign_in_sets_cookie_and_me_works(db):
    async def flow():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            issued = (await client.post("/auth/magic-links", json={"email": "boss@example.test"})).json()
            assert (await client.post(f"/auth/consume/{token_of(issued['link'])}")).status_code == 200
            me = await client.get("/auth/me")
            assert me.status_code == 200 and me.json()["role"] == "superadmin"
            assert (await httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test").get("/auth/me")).status_code == 401
    asyncio.run(flow())


def test_magic_link_is_single_use_and_expires(db):
    link = token_of(request_link(db, "boss@example.test")["link"])
    consume_magic_link(link, Response(), db)
    db.query(MagicLink).update({"used_at": datetime(2000, 1, 1, tzinfo=UTC)})  # step past the throttle
    db.commit()
    assert status_of(consume_magic_link, link, Response(), db).status_code == 404
    stale = token_of(request_link(db, "boss@example.test")["link"])
    db.query(MagicLink).filter(MagicLink.used_at.is_(None)).update({"expires_at": datetime(2000, 1, 1, tzinfo=UTC)})
    db.commit()
    assert status_of(consume_magic_link, stale, Response(), db).status_code == 404


def test_expired_unknown_and_missing_sessions_are_rejected(db):
    issued = request_link(db, "boss@example.test")
    response = Response()
    consume_magic_link(token_of(issued["link"]), response, db)
    cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    assert organizer(cookie, db).role == "superadmin"
    db.query(OrganizerSession).update({"expires_at": datetime(2000, 1, 1, tzinfo=UTC)})
    db.commit()
    for value in (cookie, "forged-session", None):
        assert status_of(organizer, value, db).status_code == 401


def test_database_url_normalization():
    for raw in ("postgres://u:p@h/d", "postgresql://u:p@h/d"):
        assert normalize_url(raw) == "postgresql+psycopg://u:p@h/d"
    assert normalize_url("sqlite:///x.db") == "sqlite:///x.db"


# --- races & checkpoints ------------------------------------------------------

def test_draft_race_and_field_specific_validation(db):
    admin = new_admin(db, "drafts@example.test")
    race = create_race(race_input("Draft"), admin, db)
    assert race.status == "draft" and race.organizer_id == admin.id
    assert race.starts_at == START  # aware UTC round-trip
    for bad, field in ((race_input(" "), "name"), (race_input(start_label=" "), "start_label"),
                       (race_input(latitude=91), "latitude"), (race_input(longitude=181), "longitude"),
                       (race_input(ends_at=START), "ends_at")):
        exc = status_of(create_race, bad, admin, db)
        assert exc.status_code == 422 and exc.detail[0]["loc"] == ["body", field]
    edited = edit_race(race.id, race_input("  Renamed ", start_label=" Plaza "), admin, db)
    assert edited.name == "Renamed" and edited.start_label == "Plaza"


def test_unordered_checkpoints_bad_pin_and_delete_in_draft(db):
    admin = new_admin(db, "pins@example.test")
    race = create_race(race_input("Pins"), admin, db)
    for name, lat in (("C", 19.43), ("A", 19.41), ("B", 19.42)):
        add_checkpoint(race.id, CheckpointIn(name=name, latitude=lat, longitude=-99.1), admin, db)
    assert status_of(add_checkpoint, race.id, CheckpointIn(name="Bad", latitude=91, longitude=0), admin, db).status_code == 422
    pins = checkpoints(race.id, admin, db)
    assert sorted(p.name for p in pins) == ["A", "B", "C"]
    assert not any(hasattr(Checkpoint, col) for col in ("order", "sequence", "position"))
    delete_checkpoint(race.id, pins[0].id, admin, db)
    assert len(checkpoints(race.id, admin, db)) == 2
    assert status_of(delete_checkpoint, race.id, 99999, admin, db).status_code == 404


def test_publish_requires_checkpoints_and_locks_the_race(db):
    admin = new_admin(db, "publish@example.test")
    race = create_race(race_input("Publish"), admin, db)
    assert status_of(publish, race.id, admin, db).status_code == 422
    pin = add_checkpoint(race.id, CheckpointIn(name="A", latitude=19.41, longitude=-99.11), admin, db)
    assert publish(race.id, admin, db).status == "published"
    assert status_of(add_checkpoint, race.id, CheckpointIn(name="B", latitude=19.4, longitude=-99.1), admin, db).status_code == 422
    assert status_of(delete_checkpoint, race.id, pin.id, admin, db).status_code == 422
    assert status_of(edit_race, race.id, race_input("Changed"), admin, db).status_code == 422


def test_rider_requires_name_and_contact(db):
    admin = new_admin(db, "riders@example.test")
    assert status_of(create_rider, RiderIn(name="  ", email="x@example.test"), admin, db).status_code == 422
    assert status_of(create_rider, RiderIn(name="No contact"), admin, db).status_code == 422


# --- invitations --------------------------------------------------------------

def test_invite_open_and_duplicate_prevention(db):
    admin = new_admin(db, "invites@example.test")
    draft = create_race(race_input("Draft only"), admin, db)
    rider = create_rider(RiderIn(name="Rider", email="r@example.test", phone="+5255"), admin, db)
    assert status_of(invite, draft.id, InviteIn(rider_id=rider.id, channel="whatsapp"), admin, db).status_code == 422
    race = published_race(db, admin)
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp"), admin, db)
    assert created["state"] == "sent"
    for channel in ("whatsapp", "email"):
        assert status_of(invite, race.id, InviteIn(rider_id=rider.id, channel=channel), admin, db).status_code == 409
    token = token_of(created["link"])
    assert open_invite(token, db)["race"]["name"] == "Night"
    assert open_invite(token, db)["race"]["name"] == "Night"  # reopenable until registration (later slice)
    assert list_invitations(race.id, admin, db)[0]["state"] == "opened"


def test_revoke_resend_and_reinvite(db):
    admin = new_admin(db, "reissue@example.test")
    race = published_race(db, admin, "Reissue")
    rider = create_rider(RiderIn(name="Rider", phone="+525500000000"), admin, db)
    first = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp"), admin, db)
    replacement = resend(first["id"], admin, db)
    assert replacement["link"] != first["link"]
    assert status_of(open_invite, token_of(first["link"]), db).status_code == 404
    revoke(replacement["id"], admin, db)
    assert status_of(open_invite, token_of(replacement["link"]), db).status_code == 404
    assert status_of(revoke, replacement["id"], admin, db).status_code == 422
    second = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp"), admin, db)
    states = {item["id"]: item["state"] for item in list_invitations(race.id, admin, db)}
    assert states == {first["id"]: "revoked", replacement["id"]: "revoked", second["id"]: "sent"}
    for item_id in (first["id"], replacement["id"]):
        db.get(Invitation, item_id).expires_at = datetime(2000, 1, 1, tzinfo=UTC)
    db.commit()
    states = {item["id"]: item["state"] for item in list_invitations(race.id, admin, db)}
    assert states[first["id"]] == "revoked" and states[replacement["id"]] == "revoked"


def test_invitation_and_resend_expire_exactly_at_race_end(db):
    admin = new_admin(db, "keep-expiry@example.test")
    race = published_race(db, admin, "Keep expiry")
    rider = create_rider(RiderIn(name="Rider", phone="+5255"), admin, db)
    # A client-sent duration is ignored: the organizer cannot choose it.
    first = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp", expires_hours=5), admin, db)
    replacement = resend(first["id"], admin, db)
    assert first["expires_at"] == replacement["expires_at"] == race.ends_at


def test_reinvite_after_expiry_shows_expired_not_revoked(db):
    admin = new_admin(db, "expiry@example.test")
    race = published_race(db, admin, "Expiry")
    rider = create_rider(RiderIn(name="Rider", email="expiry-r@example.test"), admin, db)
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="email"), admin, db)
    db.get(Invitation, created["id"]).expires_at = datetime(2000, 1, 1, tzinfo=UTC)
    db.commit()
    exc = status_of(open_invite, token_of(created["link"]), db)
    assert exc.status_code == 404 and "Expiry" not in str(exc.detail)
    assert status_of(resend, created["id"], admin, db).status_code == 422
    again = invite(race.id, InviteIn(rider_id=rider.id, channel="email"), admin, db)
    states = {item["id"]: item["state"] for item in list_invitations(race.id, admin, db)}
    assert states == {created["id"]: "expired", again["id"]: "sent"}


def test_used_and_unknown_invites_do_not_disclose_race(db):
    admin = new_admin(db, "used@example.test")
    race = published_race(db, admin, "Secret Race")
    rider = create_rider(RiderIn(name="Rider", email="used-r@example.test"), admin, db)
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="email"), admin, db)
    db.get(Invitation, created["id"]).used_at = datetime.now(UTC)
    db.commit()
    for token in (token_of(created["link"]), "not-a-token"):
        exc = status_of(open_invite, token, db)
        assert exc.status_code == 404 and "Secret Race" not in str(exc.detail)
    assert list_invitations(race.id, admin, db)[0]["state"] == "used"


def test_email_invitation_requires_an_email_address(db):
    admin = new_admin(db, "email-required@example.test")
    race = published_race(db, admin, "Email required")
    rider = create_rider(RiderIn(name="Phone only", phone="+525500000000"), admin, db)
    assert status_of(invite, race.id, InviteIn(rider_id=rider.id, channel="email"), admin, db).status_code == 422


def test_other_organizers_cannot_touch_races_riders_or_invitations(db):
    owner = new_admin(db, "owner@example.test")
    other = new_admin(db, "other@example.test")
    race = published_race(db, owner, "Private")
    draft = create_race(race_input("Private draft"), owner, db)
    pin = add_checkpoint(draft.id, CheckpointIn(name="A", latitude=19.41, longitude=-99.11), owner, db)
    rider = create_rider(RiderIn(name="Owner rider", phone="+5255"), owner, db)
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp"), owner, db)
    other_race = published_race(db, other, "Other")
    for call, args in ((get_race, (race.id,)), (checkpoints, (race.id,)), (list_invitations, (race.id,)),
                       (edit_race, (draft.id, race_input("Hijack"))), (delete_checkpoint, (draft.id, pin.id)),
                       (revoke, (created["id"],)), (resend, (created["id"],)),
                       (invite, (other_race.id, InviteIn(rider_id=rider.id, channel="whatsapp")))):
        assert status_of(call, *args, other, db).status_code == 404
    assert status_of(organizer, None, db).status_code == 401


# --- checkpoint release -------------------------------------------------------

@pytest.fixture
def clock(monkeypatch):
    """Sets "now" for every module that decides checkpoint visibility."""
    def set_now(when):
        for target in ("app.models.utcnow", "app.routers.races.utcnow", "app.routers.invitations.utcnow",
                       "app.services.invitations.utcnow"):
            monkeypatch.setattr(target, lambda: when)
    return set_now


def invited(db, admin, race):
    rider = create_rider(RiderIn(name="Rider", phone="+5255"), admin, db)
    created = invite(race.id, InviteIn(rider_id=rider.id, channel="whatsapp"), admin, db)
    return created, token_of(created["link"])


def test_release_minutes_default_range_and_field_error(db):
    admin = new_admin(db, "minutes@example.test")
    assert create_race(race_input("Default"), admin, db).checkpoints_release_minutes == 10
    for ok in (0, 1440):
        assert create_race(race_input(checkpoints_release_minutes=ok), admin, db).checkpoints_release_minutes == ok
    for bad in (-1, 1441):
        exc = status_of(create_race, race_input(checkpoints_release_minutes=bad), admin, db)
        assert exc.status_code == 422 and exc.detail[0]["loc"] == ["body", "checkpoints_release_minutes"]
    race = create_race(race_input("Edit minutes"), admin, db)
    assert edit_race(race.id, race_input("Edit minutes", checkpoints_release_minutes=30), admin, db).checkpoints_release_minutes == 30
    db.expire_all()
    assert get_race(race.id, admin, db).checkpoints_release_minutes == 30


def test_zero_minutes_releases_exactly_at_start(db, clock):
    admin = new_admin(db, "zero@example.test")
    race = create_race(race_input("Zero", checkpoints_release_minutes=0), admin, db)
    add_checkpoint(race.id, CheckpointIn(name="A", latitude=19.41, longitude=-99.11), admin, db)
    publish(race.id, admin, db)
    _, token = invited(db, admin, race)
    clock(START - timedelta(microseconds=1))
    summary = open_invite(token, db)["race"]
    assert summary["checkpoints_release_at"] == START and "checkpoints" not in summary
    clock(START)
    assert [p["name"] for p in open_invite(token, db)["race"]["checkpoints"]] == ["A"]


def test_guest_before_release_gets_release_time_but_no_checkpoints(db, clock):
    admin = new_admin(db, "before@example.test")
    race = published_race(db, admin, "Before")
    _, token = invited(db, admin, race)
    clock(START - timedelta(minutes=11))
    summary = open_invite(token, db)["race"]
    assert summary["checkpoints_release_at"] == START - timedelta(minutes=10)
    assert "checkpoints" not in summary and "19.41" not in str(summary)
    assert get_race(race.id, admin, db).checkpoints_released is False


def test_scheduled_release_shows_all_checkpoints_by_name(db, clock):
    admin = new_admin(db, "scheduled@example.test")
    race = create_race(race_input("Scheduled", checkpoints_release_minutes=30), admin, db)
    for name, lat in (("Zeta", 19.43), ("Alfa", 19.41)):
        add_checkpoint(race.id, CheckpointIn(name=name, latitude=lat, longitude=-99.1), admin, db)
    publish(race.id, admin, db)
    _, token = invited(db, admin, race)
    clock(START - timedelta(minutes=30))
    assert open_invite(token, db)["race"]["checkpoints"] == [
        {"name": "Alfa", "latitude": 19.41, "longitude": -99.1}, {"name": "Zeta", "latitude": 19.43, "longitude": -99.1}]


def test_release_now_is_owner_only_published_only_and_idempotent(db, clock):
    owner = new_admin(db, "release@example.test")
    other = new_admin(db, "release-other@example.test")
    draft = create_race(race_input("Draft release"), owner, db)
    assert status_of(release_checkpoints, draft.id, owner, db).status_code == 422
    race = published_race(db, owner, "Release now")
    assert status_of(release_checkpoints, race.id, other, db).status_code == 404
    _, token = invited(db, owner, race)
    early = START - timedelta(days=1)
    clock(early)
    assert "checkpoints" not in open_invite(token, db)["race"]
    released = release_checkpoints(race.id, owner, db)
    assert released.checkpoints_released and released.checkpoints_released_at == early
    assert [p["name"] for p in open_invite(token, db)["race"]["checkpoints"]] == ["A"]
    clock(early + timedelta(hours=1))
    assert release_checkpoints(race.id, owner, db).checkpoints_released_at == early


def test_invalid_invitation_never_leaks_release_data(db, clock):
    admin = new_admin(db, "leak@example.test")
    race = published_race(db, admin, "Leak")
    created, token = invited(db, admin, race)
    release_checkpoints(race.id, admin, db)
    revoke(created["id"], admin, db)
    for value in (token, "unknown-token"):
        exc = status_of(open_invite, value, db)
        assert exc.status_code == 404 and "checkpoint" not in str(exc.detail).lower()


def test_migration_0002_applies_with_default_for_existing_races(tmp_path):
    url = f"sqlite:///{tmp_path}/migrate.db"
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {**os.environ, "DATABASE_URL": url}
    alembic = lambda target: subprocess.run([sys.executable, "-m", "alembic", "upgrade", target], cwd=backend, env=env, check=True)
    alembic("0001_initial")
    with sqlite3.connect(tmp_path / "migrate.db") as conn:
        conn.execute("insert into organizers (id, email, role, created_at) values (1, 'a@x', 'admin', '2030-01-01')")
        conn.execute("insert into races (organizer_id, name, start_label, latitude, longitude, starts_at, ends_at, status) "
                     "values (1, 'Old', 'Park', 0, 0, '2030-01-01', '2030-01-02', 'published')")
    alembic("head")
    with sqlite3.connect(tmp_path / "migrate.db") as conn:
        assert conn.execute("select checkpoints_release_minutes, checkpoints_released_at from races").fetchall() == [(10, None)]


# --- invitation expiry at race end --------------------------------------------

def test_invitation_issued_20_days_early_works_through_release_and_race(db, clock):
    admin = new_admin(db, "early@example.test")
    race = published_race(db, admin, "Early")
    clock(START - timedelta(days=20))
    created, token = invited(db, admin, race)
    assert created["expires_at"] == race.ends_at
    for when in (START - timedelta(minutes=10), START, race.ends_at - timedelta(microseconds=1)):
        clock(when)
        assert [p["name"] for p in open_invite(token, db)["race"]["checkpoints"]] == ["A"]


def test_first_open_during_race_shows_summary_and_checkpoints(db, clock):
    admin = new_admin(db, "during@example.test")
    race = published_race(db, admin, "During")
    _, token = invited(db, admin, race)
    clock(START + timedelta(hours=1))
    summary = open_invite(token, db)["race"]
    assert summary["name"] == "During" and [p["name"] for p in summary["checkpoints"]] == ["A"]


def test_after_race_end_invitation_is_expired_and_safe_404(db, clock):
    admin = new_admin(db, "after@example.test")
    race = published_race(db, admin, "After")
    _, token = invited(db, admin, race)
    clock(race.ends_at)
    exc = status_of(open_invite, token, db)
    assert exc.status_code == 404 and "After" not in str(exc.detail)
    assert list_invitations(race.id, admin, db)[0]["state"] == "expired"


def test_cannot_invite_or_resend_once_race_ended(db, clock):
    admin = new_admin(db, "ended@example.test")
    race = published_race(db, admin, "Ended")
    created, _ = invited(db, admin, race)
    other = create_rider(RiderIn(name="Late", phone="+5256"), admin, db)
    clock(race.ends_at)
    for call, args in ((invite, (race.id, InviteIn(rider_id=other.id, channel="whatsapp"))), (resend, (created["id"],))):
        exc = status_of(call, *args, admin, db)
        assert exc.status_code == 422 and exc.detail == "Race has already ended"
    assert [item["id"] for item in list_invitations(race.id, admin, db)] == [created["id"]]


def test_migration_0003_moves_only_active_invitations_to_race_end(tmp_path):
    url = f"sqlite:///{tmp_path}/migrate.db"
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {**os.environ, "DATABASE_URL": url}
    alembic = lambda target: subprocess.run([sys.executable, "-m", "alembic", "upgrade", target], cwd=backend, env=env, check=True)
    alembic("0002_checkpoint_release")
    with sqlite3.connect(tmp_path / "migrate.db") as conn:
        conn.execute("insert into organizers (id, email, role, created_at) values (1, 'a@x', 'admin', '2030-01-01')")
        conn.execute("insert into riders (id, organizer_id, name) values (1, 1, 'R'), (2, 1, 'R2')")
        conn.execute("insert into races (id, organizer_id, name, start_label, latitude, longitude, starts_at, ends_at, status) "
                     "values (1, 1, 'Old', 'Park', 0, 0, '2030-01-20 10:00:00', '2030-01-20 12:00:00', 'published')")
        # Row 3: still flagged active but already past its old 168 h expiry; those riders were victims of the old rule.
        for id_, rider, expires, active in ((1, 1, "2030-01-08 00:00:00", 1), (2, 1, "2030-01-08 00:00:00", 0),
                                            (3, 2, "2020-01-01 00:00:00", 1)):
            conn.execute("insert into invitations (id, race_id, rider_id, token_hash, expires_at, channel, delivery_status, active) "
                         "values (?, 1, ?, ?, ?, 'whatsapp', 'link_ready', ?)", (id_, rider, f"h{id_}", expires, active))
    alembic("head")
    with sqlite3.connect(tmp_path / "migrate.db") as conn:
        assert conn.execute("select id, expires_at from invitations order by id").fetchall() == [
            (1, "2030-01-20 12:00:00"), (2, "2030-01-08 00:00:00"), (3, "2030-01-20 12:00:00")]

from ..database import utcnow
from ..models import Invitation, InvitationEvent
from ..security import new_token, token_hash
from .mailer import deliver, public_link


def active(invitation: Invitation) -> bool:
    return invitation.active and invitation.used_at is None and invitation.expires_at > utcnow()


def state(invitation: Invitation) -> str:
    if invitation.used_at:
        return "used"
    if invitation.delivery_status == "expired" or (invitation.active and invitation.expires_at <= utcnow()):
        return "expired"
    if not invitation.active:
        return "revoked"  # includes credentials replaced by a resend
    return "confirmed" if invitation.confirmed_at else "opened" if invitation.opened_at else "sent"


def event(db, invitation, name, detail=None):
    db.add(InvitationEvent(invitation_id=invitation.id, event=name, detail=detail))


def issue(db, race, rider, channel: str, replacing=None):
    now = utcnow()
    # Retire expired-but-still-flagged rows first so the partial unique index admits the new one.
    for previous in db.query(Invitation).filter_by(race_id=race.id, rider_id=rider.id, active=True).all():
        if previous.expires_at <= now:
            previous.active = False
            previous.delivery_status = "expired"
            event(db, previous, "expired")
    if replacing:
        replacing.active = False
        replacing.revoked_at = now
        replacing.delivery_status = "replaced"
        event(db, replacing, "replaced")
    db.flush()
    token = new_token()
    link = public_link(f"/invite/{token}")
    status = deliver(rider.email, link, "invitation") if channel == "email" else "link_ready"
    invitation = Invitation(race_id=race.id, rider_id=rider.id, token_hash=token_hash(token),
                            expires_at=race.ends_at, channel=channel, delivery_status=status)
    db.add(invitation)
    db.flush()
    event(db, invitation, "issued", channel)
    return invitation, link

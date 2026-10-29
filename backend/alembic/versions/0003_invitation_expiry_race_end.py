"""Invitations expire when their race ends: realign the already-active ones."""
from alembic import op

revision = "0003_invitation_expiry_race_end"
down_revision = "0002_checkpoint_release"


def upgrade():
    op.execute("UPDATE invitations SET expires_at = (SELECT ends_at FROM races WHERE races.id = invitations.race_id) "
               "WHERE active")


def downgrade():
    # Data-only migration: the previous issued_at + N hours expiries were not stored, so there is nothing to restore.
    pass

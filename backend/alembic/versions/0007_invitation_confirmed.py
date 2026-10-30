"""Riders confirm from their invitation that they are taking part."""
from alembic import op
import sqlalchemy as sa

revision = "0007_invitation_confirmed"
down_revision = "0006_race_rosters"


def upgrade():
    op.add_column("invitations", sa.Column("confirmed_at", sa.DateTime(timezone=True)))


def downgrade():
    with op.batch_alter_table("invitations") as batch:
        batch.drop_column("confirmed_at")

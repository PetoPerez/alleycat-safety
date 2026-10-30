"""Organizers mark the race winner at the finish line."""
from alembic import op
import sqlalchemy as sa

revision = "0008_race_winner"
down_revision = "0007_invitation_confirmed"


def upgrade():
    with op.batch_alter_table("races") as batch:
        batch.add_column(sa.Column("winner_rider_id", sa.Integer, sa.ForeignKey("riders.id", name="races_winner_rider_id"), nullable=True))


def downgrade():
    with op.batch_alter_table("races") as batch:
        batch.drop_column("winner_rider_id")

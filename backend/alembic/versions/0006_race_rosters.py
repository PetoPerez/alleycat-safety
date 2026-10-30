"""Riders belong to one race: each race keeps its own roster."""
from alembic import op
import sqlalchemy as sa

revision = "0006_race_rosters"
down_revision = "0005_checkins_help"


def upgrade():
    # Existing riders keep race_id null: their past invitations and check-ins stay intact, they just leave the rosters.
    with op.batch_alter_table("riders") as batch:
        batch.add_column(sa.Column("race_id", sa.Integer, sa.ForeignKey("races.id", name="riders_race_id"), nullable=True))


def downgrade():
    with op.batch_alter_table("riders") as batch:
        batch.drop_column("race_id")

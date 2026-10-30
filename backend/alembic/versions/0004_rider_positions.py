"""Live tracking: latest position per rider per race."""
from alembic import op
import sqlalchemy as sa

revision = "0004_rider_positions"
down_revision = "0003_invitation_expiry_race_end"


def upgrade():
    op.create_table("rider_positions",
        sa.Column("race_id", sa.Integer, sa.ForeignKey("races.id"), primary_key=True),
        sa.Column("rider_id", sa.Integer, sa.ForeignKey("riders.id"), primary_key=True),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("rider_positions")

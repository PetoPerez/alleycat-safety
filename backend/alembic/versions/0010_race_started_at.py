"""The real start ("pitazo"), which often comes later than the scheduled starts_at."""
from alembic import op
import sqlalchemy as sa

revision = "0010_race_started_at"
down_revision = "0009_finish_checkpoint"


def upgrade():
    op.add_column("races", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("races") as batch:
        batch.drop_column("started_at")

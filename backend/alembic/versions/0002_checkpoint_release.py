"""Checkpoint release: scheduled minutes before start, plus an irreversible "release now"."""
from alembic import op
import sqlalchemy as sa

revision = "0002_checkpoint_release"
down_revision = "0001_initial"


def upgrade():
    op.add_column("races", sa.Column("checkpoints_release_minutes", sa.Integer, nullable=False, server_default="10"))
    op.add_column("races", sa.Column("checkpoints_released_at", sa.DateTime(timezone=True)))


def downgrade():
    with op.batch_alter_table("races") as batch:
        batch.drop_column("checkpoints_released_at")
        batch.drop_column("checkpoints_release_minutes")

"""The finish line is a checkpoint flagged as such: its QR records the rider's arrival."""
from alembic import op
import sqlalchemy as sa

revision = "0009_finish_checkpoint"
down_revision = "0008_race_winner"


def upgrade():
    op.add_column("checkpoints", sa.Column("finish", sa.Boolean, nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("checkpoints") as batch:
        batch.drop_column("finish")

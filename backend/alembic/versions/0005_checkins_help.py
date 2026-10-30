"""Checkpoint QR check-ins and rider help requests."""
import secrets
from alembic import op
import sqlalchemy as sa

revision = "0005_checkins_help"
down_revision = "0004_rider_positions"
TS = sa.DateTime(timezone=True)


def upgrade():
    op.add_column("checkpoints", sa.Column("code", sa.String))
    conn = op.get_bind()
    for (id_,) in conn.execute(sa.text("SELECT id FROM checkpoints")).fetchall():
        conn.execute(sa.text("UPDATE checkpoints SET code = :code WHERE id = :id"), {"code": secrets.token_urlsafe(12), "id": id_})
    op.create_index("checkpoints_code", "checkpoints", ["code"], unique=True)
    op.create_table("check_ins",
        sa.Column("checkpoint_id", sa.Integer, sa.ForeignKey("checkpoints.id"), primary_key=True),
        sa.Column("rider_id", sa.Integer, sa.ForeignKey("riders.id"), primary_key=True),
        sa.Column("checked_in_at", TS, nullable=False))
    op.create_table("help_requests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("race_id", sa.Integer, sa.ForeignKey("races.id"), nullable=False),
        sa.Column("rider_id", sa.Integer, sa.ForeignKey("riders.id"), nullable=False),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("latitude", sa.Float),
        sa.Column("longitude", sa.Float),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("resolved_at", TS),
        sa.CheckConstraint("kind in ('medical', 'accident', 'mechanical', 'other')", name="help_kind"))


def downgrade():
    op.drop_table("help_requests")
    op.drop_table("check_ins")
    op.drop_index("checkpoints_code", "checkpoints")
    with op.batch_alter_table("checkpoints") as batch:
        batch.drop_column("code")

"""Initial race administration schema (matches app/models.py)."""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None

TS = sa.DateTime(timezone=True)


def upgrade():
    op.create_table("organizers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String, unique=True, nullable=False),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.CheckConstraint("role in ('superadmin', 'admin')", name="organizer_role"))
    op.create_table("riders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("organizer_id", sa.Integer, sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("email", sa.String),
        sa.Column("phone", sa.String))
    op.create_table("races",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("organizer_id", sa.Integer, sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("start_label", sa.String, nullable=False),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("starts_at", TS, nullable=False),
        sa.Column("ends_at", TS, nullable=False),
        sa.Column("status", sa.String, nullable=False))
    op.create_table("checkpoints",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("race_id", sa.Integer, sa.ForeignKey("races.id"), nullable=False),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("description", sa.String),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False))
    op.create_table("magic_links",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("organizer_id", sa.Integer, sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("token_hash", sa.String, unique=True, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("used_at", TS))
    op.create_table("organizer_sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("organizer_id", sa.Integer, sa.ForeignKey("organizers.id"), nullable=False),
        sa.Column("token_hash", sa.String, unique=True, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("revoked_at", TS))
    op.create_table("invitations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("race_id", sa.Integer, sa.ForeignKey("races.id"), nullable=False),
        sa.Column("rider_id", sa.Integer, sa.ForeignKey("riders.id"), nullable=False),
        sa.Column("token_hash", sa.String, unique=True, nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("channel", sa.String, nullable=False),
        sa.Column("delivery_status", sa.String, nullable=False),
        sa.Column("opened_at", TS),
        sa.Column("used_at", TS),
        sa.Column("revoked_at", TS),
        sa.Column("active", sa.Boolean, nullable=False))
    op.create_index("one_active_invitation", "invitations", ["race_id", "rider_id"], unique=True,
                    postgresql_where=sa.text("active"), sqlite_where=sa.text("active"))
    op.create_table("invitation_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("invitation_id", sa.Integer, sa.ForeignKey("invitations.id"), nullable=False),
        sa.Column("event", sa.String, nullable=False),
        sa.Column("occurred_at", TS, nullable=False),
        sa.Column("detail", sa.Text))


def downgrade():
    op.drop_index("one_active_invitation", table_name="invitations")
    for table in ("invitation_events", "invitations", "organizer_sessions", "magic_links", "checkpoints", "races", "riders", "organizers"):
        op.drop_table(table)

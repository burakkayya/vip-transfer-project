"""K-83: olaylar, olay tekrarları, yolculuk geçmişi; saklama görevi için değiştirilemezlik istisnası

- `incidents`, `incident_occurrences`, `booking_activities` tabloları.
- `booking_activities` yalnızca eklenebilir. UPDATE/DELETE yalnızca saklama görevinin işlem içi bayrağıyla
  (`SET LOCAL getaway.retention_purge = 'on'`) ya da rezervasyon silinirken yabancı anahtar zincirinden
  (pg_trigger_depth() > 1) geçer.
- `audit_logs` tetikleyicisi: UPDATE her zaman engelli; DELETE yalnızca saklama bayrağıyla (2 yıl, K-83).

Revision ID: 0021
Revises: 0020
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "incidents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("code", sa.String(80), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(15), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.Uuid(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["acknowledged_by"], ["users.id"], name="fk_incidents_acknowledged_by_users"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], name="fk_incidents_resolved_by_users"),
        sa.PrimaryKeyConstraint("id", name="pk_incidents"),
        sa.UniqueConstraint("fingerprint", name="uq_incidents_fingerprint"),
    )
    op.create_index("ix_incidents_source", "incidents", ["source"])
    op.create_index("ix_incidents_status_last_seen", "incidents", ["status", "last_seen_at"])

    op.create_table(
        "incident_occurrences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("incident_id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("booking_id", sa.Uuid(), nullable=True),
        sa.Column("context", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE",
                                name="fk_incident_occurrences_incident_id_incidents"),
        sa.PrimaryKeyConstraint("id", name="pk_incident_occurrences"),
    )
    op.create_index("ix_incident_occurrences_incident_occurred", "incident_occurrences",
                    ["incident_id", "occurred_at"])
    op.create_index("ix_incident_occurrences_request_id", "incident_occurrences", ["request_id"])
    op.create_index("ix_incident_occurrences_booking_id", "incident_occurrences", ["booking_id"])
    op.create_index("ix_incident_occurrences_occurred_at", "incident_occurrences", ["occurred_at"])

    op.create_table(
        "booking_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("booking_id", sa.Uuid(), nullable=False),
        sa.Column("booking_leg_id", sa.Uuid(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_type", sa.String(10), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.String(60), nullable=False),
        sa.Column("platform", sa.String(10), nullable=True),
        sa.Column("app_version", sa.String(30), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE",
                                name="fk_booking_activities_booking_id_bookings"),
        sa.ForeignKeyConstraint(["booking_leg_id"], ["booking_legs.id"], ondelete="CASCADE",
                                name="fk_booking_activities_booking_leg_id_booking_legs"),
        sa.PrimaryKeyConstraint("id", name="pk_booking_activities"),
    )
    op.create_index("ix_booking_activities_booking_occurred", "booking_activities", ["booking_id", "occurred_at"])
    op.create_index("ix_booking_activities_actor_id", "booking_activities", ["actor_id"])
    op.create_index("ix_booking_activities_occurred_at", "booking_activities", ["occurred_at"])
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id", "created_at"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION booking_activities_immutable() RETURNS trigger AS $$
        BEGIN
            IF current_setting('getaway.retention_purge', true) = 'on' OR pg_trigger_depth() > 1 THEN
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'booking_activities kayıtları değiştirilemez veya silinemez';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER booking_activities_no_update_delete
            BEFORE UPDATE OR DELETE ON booking_activities
            FOR EACH ROW EXECUTE FUNCTION booking_activities_immutable();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION booking_activities_no_truncate() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'booking_activities toplu silinemez (TRUNCATE)';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER booking_activities_no_truncate
            BEFORE TRUNCATE ON booking_activities
            FOR EACH STATEMENT EXECUTE FUNCTION booking_activities_no_truncate();
        """
    )
    # Denetim kaydı: UPDATE yine her zaman engelli; DELETE yalnızca saklama görevinin bayrağıyla.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('getaway.retention_purge', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_logs kayıtları değiştirilemez veya silinemez';
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs kayıtları değiştirilemez veya silinemez';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.drop_index("ix_audit_logs_entity", table_name="audit_logs")
    op.execute("DROP TRIGGER IF EXISTS booking_activities_no_update_delete ON booking_activities")
    op.execute("DROP FUNCTION IF EXISTS booking_activities_immutable()")
    op.execute("DROP TRIGGER IF EXISTS booking_activities_no_truncate ON booking_activities")
    op.execute("DROP FUNCTION IF EXISTS booking_activities_no_truncate()")
    op.drop_table("booking_activities")
    op.drop_table("incident_occurrences")
    op.drop_table("incidents")

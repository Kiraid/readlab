"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")  # fuzzy title search

    op.create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.String(length=16), server_default='user', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ux_users_email', 'users', [sa.literal_column('lower(email)')], unique=True)
    op.create_table('documents',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('subtitle', sa.Text(), nullable=False),
    sa.Column('authors', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('edition', sa.String(length=120), nullable=False),
    sa.Column('blurb', sa.Text(), nullable=False),
    sa.Column('accent', sa.String(length=16), nullable=False),
    sa.Column('filename', sa.Text(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=True),
    sa.Column('pages', sa.Integer(), nullable=False),
    sa.Column('bytes', sa.BigInteger(), nullable=False),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('has_cover', sa.Boolean(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('search_text', sa.Text(), nullable=False),
    sa.Column('search_tsv', postgresql.TSVECTOR(), sa.Computed("to_tsvector('english', search_text) || to_tsvector('simple', search_text)", persisted=True), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'sha256', name='ux_documents_owner_sha')
    )
    op.create_index('ix_documents_owner_kind', 'documents', ['owner_id', 'kind', 'updated_at'], unique=False)
    op.create_index('ix_documents_title_trgm', 'documents', ['title'], unique=False, postgresql_using='gin', postgresql_ops={'title': 'gin_trgm_ops'})
    op.create_index('ix_documents_tsv', 'documents', ['search_tsv'], unique=False, postgresql_using='gin')
    op.create_table('sessions',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('user_agent', sa.String(length=300), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('token_hash')
    )
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)
    op.create_table('chapters',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('document_id', sa.String(length=40), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('number', sa.String(length=16), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('selector', sa.String(length=32), nullable=False),
    sa.Column('page_start', sa.Integer(), nullable=False),
    sa.Column('page_end', sa.Integer(), nullable=False),
    sa.Column('section_count', sa.Integer(), nullable=False),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='none', nullable=False),
    sa.Column('current_job_id', sa.String(length=40), nullable=True),
    sa.Column('page_dir', sa.Text(), nullable=True),
    sa.Column('parts', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('stats', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('ready_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('search_tsv', postgresql.TSVECTOR(), sa.Computed("to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '')) || to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, ''))", persisted=True), nullable=True),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_id', 'position', name='ux_chapters_doc_pos')
    )
    op.create_index('ix_chapters_status', 'chapters', ['document_id', 'status'], unique=False)
    op.create_index('ix_chapters_title_trgm', 'chapters', ['title'], unique=False, postgresql_using='gin', postgresql_ops={'title': 'gin_trgm_ops'})
    op.create_index('ix_chapters_tsv', 'chapters', ['search_tsv'], unique=False, postgresql_using='gin')
    op.create_table('content_sections',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('chapter_id', sa.BigInteger(), nullable=False),
    sa.Column('part', sa.Integer(), nullable=False),
    sa.Column('anchor', sa.String(length=120), nullable=False),
    sa.Column('number', sa.String(length=32), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('tsv', postgresql.TSVECTOR(), sa.Computed("setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B') || setweight(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')), 'D')", persisted=True), nullable=True),
    sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_content_sections_chapter_id'), 'content_sections', ['chapter_id'], unique=False)
    op.create_index('ix_content_sections_tsv', 'content_sections', ['tsv'], unique=False, postgresql_using='gin')
    op.create_table('jobs',
    sa.Column('id', sa.String(length=40), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('document_id', sa.String(length=40), nullable=False),
    sa.Column('chapter_id', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='queued', nullable=False),
    sa.Column('stage', sa.String(length=24), nullable=False),
    sa.Column('progress', sa.Float(), nullable=False),
    sa.Column('detail', sa.Text(), nullable=False),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('spec', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('cost_usd', sa.Numeric(precision=10, scale=5), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('worker', sa.String(length=80), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('queued_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('heartbeat_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_jobs_chapter_id'), 'jobs', ['chapter_id'], unique=False)
    op.create_index(op.f('ix_jobs_owner_id'), 'jobs', ['owner_id'], unique=False)
    op.create_index('ix_jobs_owner_time', 'jobs', ['owner_id', 'queued_at'], unique=False)
    op.create_index('ix_jobs_queue', 'jobs', ['queued_at'], unique=False, postgresql_where=sa.text("status = 'queued'"))
    op.create_index('ix_jobs_running', 'jobs', ['heartbeat_at'], unique=False, postgresql_where=sa.text("status = 'running'"))
    op.create_table('reading_progress',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('chapter_id', sa.BigInteger(), nullable=False),
    sa.Column('part', sa.Integer(), nullable=False),
    sa.Column('anchor', sa.String(length=120), nullable=False),
    sa.Column('offset', sa.Float(), nullable=False),
    sa.Column('percent', sa.Float(), nullable=False),
    sa.Column('furthest', sa.Float(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['chapter_id'], ['chapters.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'chapter_id')
    )
    op.create_index('ix_progress_recent', 'reading_progress', ['user_id', 'updated_at'], unique=False)
    op.create_table('job_events',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('job_id', sa.String(length=40), nullable=False),
    sa.Column('ts', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('stage', sa.String(length=24), nullable=False),
    sa.Column('msg', sa.Text(), nullable=False),
    sa.Column('chunk', sa.String(length=16), nullable=True),
    sa.Column('level', sa.String(length=8), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['jobs.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_job_events_job', 'job_events', ['job_id', 'id'], unique=False)



def downgrade() -> None:

    op.drop_index('ix_job_events_job', table_name='job_events')
    op.drop_table('job_events')
    op.drop_index('ix_progress_recent', table_name='reading_progress')
    op.drop_table('reading_progress')
    op.drop_index('ix_jobs_running', table_name='jobs', postgresql_where=sa.text("status = 'running'"))
    op.drop_index('ix_jobs_queue', table_name='jobs', postgresql_where=sa.text("status = 'queued'"))
    op.drop_index('ix_jobs_owner_time', table_name='jobs')
    op.drop_index(op.f('ix_jobs_owner_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_chapter_id'), table_name='jobs')
    op.drop_table('jobs')
    op.drop_index('ix_content_sections_tsv', table_name='content_sections', postgresql_using='gin')
    op.drop_index(op.f('ix_content_sections_chapter_id'), table_name='content_sections')
    op.drop_table('content_sections')
    op.drop_index('ix_chapters_tsv', table_name='chapters', postgresql_using='gin')
    op.drop_index('ix_chapters_title_trgm', table_name='chapters', postgresql_using='gin', postgresql_ops={'title': 'gin_trgm_ops'})
    op.drop_index('ix_chapters_status', table_name='chapters')
    op.drop_table('chapters')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_index('ix_documents_tsv', table_name='documents', postgresql_using='gin')
    op.drop_index('ix_documents_title_trgm', table_name='documents', postgresql_using='gin', postgresql_ops={'title': 'gin_trgm_ops'})
    op.drop_index('ix_documents_owner_kind', table_name='documents')
    op.drop_table('documents')
    op.drop_index('ux_users_email', table_name='users')
    op.drop_table('users')


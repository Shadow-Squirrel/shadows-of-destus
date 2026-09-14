-- ═══════════════════════════════════════════════════════════════
--  Minimal Supabase-compatible SHIM for running the SQL tests on a
--  plain PostgreSQL cluster (auth/storage/roles/realtime that the
--  hosted platform provides but a bare Postgres does not). This is
--  TEST SCAFFOLDING only — never apply it to a real database.
--  Load it BEFORE supabase/schema.sql. Used by
--  tools/run-ai-caps-tests.sh (and usable for tools/test-isolation.sql).
-- ═══════════════════════════════════════════════════════════════

-- the three data-API roles Supabase provides
do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- auth.jwt(): the current request's JWT claims, carried in the
-- `request.jwt.claims` GUC (the tests set it per simulated user).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt()->>'role', 'authenticated')
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;

-- storage tables — only the columns the RLS policies actually read
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);
alter table storage.objects enable row level security;

-- the realtime publication schema.sql adds tables to
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

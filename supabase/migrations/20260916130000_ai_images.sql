-- ═════════════════════════════════════════════════════════════
--  AI image generation — cost-safe by construction.
--
--  DMs can generate character portraits and battle maps with
--  FLUX.1 [schnell] through the `generate-image` Edge Function.
--  The Edge Function holds the paid provider's key; this app
--  never does. The MONEY-CRITICAL part lives here, in the
--  database, where it is enforced atomically before any paid
--  call can be made:
--
--   • ai_image_config  — one row the owner edits to move the caps
--     (per-DM/month and global/month) with a single UPDATE, no
--     redeploy.
--   • ai_image_log     — one row per generation attempt, carrying
--     the month bucket ('YYYY-MM'), the DM, the kind, and a
--     status of pending | done | failed. A 'failed' row does NOT
--     count against quota, so a provider hiccup never burns a
--     paying customer's budget.
--   • ai_reserve_image — SECURITY DEFINER. Checks DM-ship, reads
--     the caps, counts this month's non-failed rows for the DM and
--     globally, and — only if both are under cap — inserts the
--     'pending' row. The count-and-insert is made atomic with a
--     per-month advisory lock so two concurrent requests can never
--     both slip past the cap (see the note on the lock below).
--   • ai_complete_image / ai_fail_image — flip a reservation to
--     done (recording the storage path) or failed (releasing the
--     slot). Owner or service role only.
--   • ai_usage — a cheap read the UI uses to show remaining quota.
--
--  The ULTIMATE ceiling the owner controls is NOT in this file:
--  it is the PREPAID CREDIT / hard spend limit set at the image
--  provider (fal.ai / Replicate). These DB caps are the in-app UX
--  layer; the prepaid balance is the guarantee they can never be
--  billed beyond what they loaded. See docs/AI-IMAGES.md.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- ── the caps (single-row config) ─────────────────────────────
-- A one-row table: `id` is constrained to true so there is only
-- ever one row. The owner changes the caps with:
--   update ai_image_config set per_dm_monthly_cap = 100;
create table if not exists ai_image_config (
  id boolean primary key default true,
  per_dm_monthly_cap  int not null default 50,
  global_monthly_cap  int not null default 5000,
  updated_at timestamptz not null default now(),
  constraint ai_image_config_singleton check (id = true)
);
insert into ai_image_config (id) values (true) on conflict (id) do nothing;
alter table ai_image_config enable row level security;

-- The caps aren't secret (they're just two integers the UI shows as
-- "N left this month"), so any signed-in user may read them. There
-- are NO write policies: the owner changes caps from the SQL editor
-- (or dashboard), never from the browser.
drop policy if exists "ai config: readable" on ai_image_config;
create policy "ai config: readable" on ai_image_config
  for select to authenticated using (true);

-- ── the ledger ───────────────────────────────────────────────
create table if not exists ai_image_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  dm_email     text not null,
  ym           text not null,                 -- 'YYYY-MM' in UTC
  kind         text not null check (kind in ('map','portrait')),
  prompt       text not null default '',
  storage_path text,
  status       text not null default 'pending' check (status in ('pending','done','failed')),
  created_at   timestamptz not null default now()
);
-- Partial indexes matching exactly the two cap counts, so the
-- check inside ai_reserve_image stays O(rows-this-month).
create index if not exists ai_image_log_dm_ym_live_idx
  on ai_image_log (dm_email, ym) where status <> 'failed';
create index if not exists ai_image_log_ym_live_idx
  on ai_image_log (ym) where status <> 'failed';
create index if not exists ai_image_log_campaign_idx on ai_image_log (campaign_id);
alter table ai_image_log enable row level security;

-- Campaign members may read their campaign's generation history.
-- There are NO insert/update/delete policies: rows are written only
-- by the SECURITY DEFINER functions below (called with the user's
-- JWT) and by the service role (which bypasses RLS). The browser
-- can never write here directly.
drop policy if exists "ai log: members read" on ai_image_log;
create policy "ai log: members read" on ai_image_log
  for select to authenticated using (is_campaign_member(campaign_id));

-- ── reserve: the atomic cap gate ─────────────────────────────
-- Returns the new reservation id, or RAISEs a message the Edge
-- Function forwards to the user (HTTP 429 for the cap messages).
--
-- THE RACE, AND HOW IT IS CLOSED:
--   Naively, two concurrent requests could both run "count < cap"
--   (each seeing count = cap-1), both pass, and both insert — one
--   image over budget. Multiply that across many concurrent
--   requests and the cap leaks badly.
--   We take a TRANSACTION-scoped advisory lock keyed on the month
--   string before counting. All reservations for the same month
--   therefore serialize: each caller sees the previous caller's
--   freshly-inserted 'pending' row in its count. The lock releases
--   automatically at commit/rollback. It is keyed on the month (not
--   globally) so a month rollover never blocks the new month, and
--   because both caps are per-month the single lock covers the
--   per-DM and the global check together. Generation volume is tiny
--   (caps are tens per DM, thousands globally, per MONTH), so fully
--   serializing reservations costs nothing and is the simplest
--   thing that is provably correct. (A `select ... for update` on a
--   per-(dm,month) counter row would close the per-DM race but NOT
--   the global one without a second lock; the month lock does both.)
create or replace function ai_reserve_image(p_campaign uuid, p_kind text, p_prompt text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ym          text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email       text := my_email();
  v_per_dm      int;
  v_global      int;
  v_dm_count    int;
  v_global_cnt  int;
  v_id          uuid;
begin
  if v_email = '' then raise exception 'Must be signed in'; end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a DM of this campaign can generate images';
  end if;
  if p_kind not in ('map','portrait') then
    raise exception 'Unknown image kind';
  end if;

  -- serialize this month's reservations (see the note above)
  perform pg_advisory_xact_lock(hashtextextended('ai_image_reserve:' || v_ym, 0));

  select per_dm_monthly_cap, global_monthly_cap
    into v_per_dm, v_global
    from ai_image_config where id = true;
  -- No config row => no budget. Fail SAFE (never open the gate).
  if v_per_dm is null or v_global is null then
    raise exception 'AI image budget is not configured';
  end if;

  select count(*) into v_dm_count
    from ai_image_log
   where dm_email = v_email and ym = v_ym and status <> 'failed';
  if v_dm_count >= v_per_dm then
    raise exception 'DM monthly limit reached';
  end if;

  select count(*) into v_global_cnt
    from ai_image_log
   where ym = v_ym and status <> 'failed';
  if v_global_cnt >= v_global then
    raise exception 'Global monthly AI budget reached';
  end if;

  insert into ai_image_log (campaign_id, dm_email, ym, kind, prompt, status)
    values (p_campaign, v_email, v_ym, p_kind, left(coalesce(p_prompt, ''), 2000), 'pending')
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function ai_reserve_image(uuid, text, text) from public, anon;
grant  execute on function ai_reserve_image(uuid, text, text) to authenticated, service_role;

-- ── complete / fail ──────────────────────────────────────────
-- Owner (the DM who reserved) or the service role may finalize.
create or replace function ai_complete_image(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_image_log
     set status = 'done', storage_path = p_path
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
  if not found then
    raise exception 'Reservation not found, not yours, or already finalized';
  end if;
end $$;
revoke execute on function ai_complete_image(uuid, text) from public, anon;
grant  execute on function ai_complete_image(uuid, text) to authenticated, service_role;

-- A failed generation must NOT consume quota → mark it 'failed',
-- which every cap count excludes.
create or replace function ai_fail_image(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_image_log
     set status = 'failed'
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
  -- idempotent: silent if already gone/finalized (don't mask the
  -- real provider error the Edge Function is about to return).
end $$;
revoke execute on function ai_fail_image(uuid) from public, anon;
grant  execute on function ai_fail_image(uuid) to authenticated, service_role;

-- ── usage (for the "N left this month" display) ──────────────
create or replace function ai_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ym    text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email text := my_email();
  v_per   int;
  v_glob  int;
  v_used  int;
  v_gused int;
begin
  select per_dm_monthly_cap, global_monthly_cap into v_per, v_glob
    from ai_image_config where id = true;
  select count(*) into v_used  from ai_image_log
    where dm_email = v_email and ym = v_ym and status <> 'failed';
  select count(*) into v_gused from ai_image_log
    where ym = v_ym and status <> 'failed';
  return jsonb_build_object(
    'ym', v_ym,
    'used', v_used,
    'cap', v_per,
    'remaining', greatest(0, coalesce(v_per, 0) - v_used),
    'global_used', v_gused,
    'global_cap', v_glob
  );
end $$;
revoke execute on function ai_usage() from public, anon;
grant  execute on function ai_usage() to authenticated, service_role;

-- ── ai-art storage bucket (portraits) ────────────────────────
-- PRIVATE. Portraits live here at `${campaign_id}/${id}.<ext>`.
-- Battle maps do NOT go here — they go to the existing reveal-gated
-- 'maps' bucket so a hidden map stays hidden from players (this
-- bucket is readable by ALL campaign members, which is correct for
-- a portrait but would leak an un-revealed map). See docs/AI-IMAGES.md.
insert into storage.buckets (id, name, public)
values ('ai-art', 'ai-art', false)
on conflict (id) do nothing;
update storage.buckets
   set file_size_limit = 10485760,   -- 10 MB is plenty for a schnell PNG/webp
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'ai-art';

-- May this user fetch this ai-art file? The first path segment is a
-- campaign id; you must be a member of it.
create or replace function can_read_ai_art(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare seg text := split_part(p, '/', 1); cid uuid;
begin
  begin cid := seg::uuid; exception when others then return false; end;
  return is_campaign_member(cid);
end $$;

drop policy if exists "ai-art: members read own campaign" on storage.objects;
create policy "ai-art: members read own campaign" on storage.objects
  for select to authenticated
  using (bucket_id = 'ai-art' and can_read_ai_art(name));
-- No insert/update/delete policy on ai-art for `authenticated`:
-- only the service role (which bypasses RLS) writes these files.

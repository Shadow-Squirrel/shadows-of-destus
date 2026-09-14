-- ═══════════════════════════════════════════════════════════════
--  Cost-safety proof for AI image generation.
--
--  Runs against a REAL Postgres that already has schema.sql applied
--  on top of the Supabase auth/storage SHIM (see
--  tools/run-ai-caps-tests.sh, which boots a throwaway cluster as a
--  non-root user and wires all this up). Any failed check RAISEs;
--  with `psql -v ON_ERROR_STOP=1` that is a non-zero exit.
--
--  Proves, against the actual migration SQL:
--    1. a non-DM (player) cannot reserve an image
--    2. a non-member cannot reserve an image
--    3. a DM is blocked the instant they hit the per-DM monthly cap
--    4. a 'failed' row does NOT consume quota (fail one → one frees up)
--    5. the GLOBAL monthly cap blocks everyone, across DMs
--    6. only the reserving DM (or service role) can complete/fail a row
--    7. ai_usage() reports the right remaining count
--  (Concurrency — that the advisory lock stops two racers exceeding
--   the cap — is proven separately by the parallel stress in the
--   runner script.)
-- ═══════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Supabase grants table DML to `authenticated`; RLS + the SECURITY
-- DEFINER RPCs do the real limiting.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── seed as superuser (setup, not the test) ──
truncate campaigns cascade;      -- cascades to campaign_members + ai_image_log
delete from ai_image_log;
insert into campaigns (id, name, owner_email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice Campaign', 'alice@x.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bob Campaign',   'bob@x.com');
insert into campaign_members (campaign_id, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@x.com', 'dm'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'pat@x.com',   'player'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@x.com',   'dm');

-- helpers (mirror tools/test-isolation.sql)
create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true);
end $$;
create or replace function assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'CAP TEST FAIL: %', msg; end if; end $$;

do $$
declare
  n int; blocked boolean; rid uuid; rid2 uuid; msg text; u jsonb;
  A constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
begin
  -- ═══ 1. a player cannot reserve ═══
  perform set_config('role','authenticated', true);
  perform as_user('pat@x.com'); perform set_config('role','authenticated', true);
  blocked := false;
  begin perform ai_reserve_image(A, 'map', 'sneaky'); exception when others then blocked := true; msg := SQLERRM; end;
  perform assert(blocked, 'a player (pat) must NOT be able to reserve an image');
  perform assert(msg like '%DM of this campaign%', 'player block should be the DM-only message, got: '||coalesce(msg,'<none>'));
  raise notice '  ✓ 1. player cannot reserve';

  -- ═══ 2. a non-member cannot reserve ═══
  perform as_user('stranger@x.com'); perform set_config('role','authenticated', true);
  blocked := false;
  begin perform ai_reserve_image(A, 'map', 'intrusion'); exception when others then blocked := true; end;
  perform assert(blocked, 'a non-member (stranger) must NOT be able to reserve an image');
  raise notice '  ✓ 2. non-member cannot reserve';

  -- ═══ 3. per-DM monthly cap blocks the DM ═══
  -- (config changes are an owner/superuser action — RLS blocks the
  --  browser roles from writing ai_image_config, so switch back to
  --  the superuser to move the caps, exactly as the owner would.)
  perform set_config('role','postgres', true);
  update ai_image_config set per_dm_monthly_cap = 3, global_monthly_cap = 100000;
  perform as_user('alice@x.com'); perform set_config('role','authenticated', true);
  perform ai_reserve_image(A, 'portrait', 'a');
  perform ai_reserve_image(A, 'map', 'b');
  rid := ai_reserve_image(A, 'portrait', 'c');   -- keep this id for step 4/6
  perform assert((select count(*) from ai_image_log where dm_email='alice@x.com' and status<>'failed') = 3,
                 'alice should have 3 live rows at the cap');
  blocked := false;
  begin perform ai_reserve_image(A, 'map', 'd (over cap)'); exception when others then blocked := true; msg := SQLERRM; end;
  perform assert(blocked, 'alice must be blocked at the per-DM cap');
  perform assert(msg = 'DM monthly limit reached', 'expected the per-DM cap message, got: '||coalesce(msg,'<none>'));
  perform assert((select count(*) from ai_image_log where dm_email='alice@x.com' and status<>'failed') = 3,
                 'the blocked call must NOT have inserted a row (still 3)');
  raise notice '  ✓ 3. per-DM cap blocks at the limit (and inserts nothing over-cap)';

  -- ═══ 4. a failed row frees a slot (does not consume quota) ═══
  perform ai_fail_image(rid);   -- alice fails one of her own → 2 live
  perform assert((select status from ai_image_log where id = rid) = 'failed', 'rid should be failed');
  perform assert((select count(*) from ai_image_log where dm_email='alice@x.com' and status<>'failed') = 2,
                 'a failed row must not count → 2 live now');
  rid2 := ai_reserve_image(A, 'map', 'e (after a failure freed a slot)');  -- allowed again
  perform assert((select count(*) from ai_image_log where dm_email='alice@x.com' and status<>'failed') = 3,
                 'alice reserved again after the failure freed a slot');
  perform assert((select count(*) from ai_image_log where dm_email='alice@x.com' and status='failed') = 1,
                 'the failed row is still recorded as failed (audit trail intact)');
  raise notice '  ✓ 4. a failed generation does NOT consume quota';

  -- ═══ 6. only the owner/service role can finalize a reservation ═══
  perform as_user('pat@x.com'); perform set_config('role','authenticated', true);
  blocked := false;
  begin perform ai_complete_image(rid2, 'aaaaaaaa/hijack.png'); exception when others then blocked := true; end;
  perform assert(blocked, 'a different user (pat) must NOT be able to complete alice''s reservation');
  perform as_user('alice@x.com'); perform set_config('role','authenticated', true);
  perform ai_complete_image(rid2, 'aaaaaaaa-0000-0000-0000-000000000001/ai-'||rid2||'.png');
  perform assert((select status from ai_image_log where id=rid2) = 'done', 'owner can complete → done');
  perform assert((select storage_path from ai_image_log where id=rid2) like '%ai-%', 'storage_path recorded on complete');
  raise notice '  ✓ 6. only the owner (or service role) finalizes a reservation';

  -- ═══ 7. ai_usage() reports the right remaining ═══
  u := ai_usage();
  perform assert((u->>'used')::int = 3, 'usage.used should be 3 for alice');
  perform assert((u->>'cap')::int = 3, 'usage.cap should be 3');
  perform assert((u->>'remaining')::int = 0, 'usage.remaining should be 0 (at cap)');
  raise notice '  ✓ 7. ai_usage() reports used/cap/remaining correctly';

  -- ═══ 5. GLOBAL monthly cap blocks everyone, across DMs ═══
  perform set_config('role','postgres', true);
  delete from ai_image_log;
  update ai_image_config set per_dm_monthly_cap = 100000, global_monthly_cap = 2;
  perform as_user('alice@x.com'); perform set_config('role','authenticated', true);
  perform ai_reserve_image(A, 'map', 'global-1');
  perform as_user('bob@x.com'); perform set_config('role','authenticated', true);
  perform ai_reserve_image(B, 'map', 'global-2');   -- now 2 live globally == cap
  -- alice (well under her own huge per-DM cap) is now blocked by the GLOBAL cap
  perform as_user('alice@x.com'); perform set_config('role','authenticated', true);
  blocked := false;
  begin perform ai_reserve_image(A, 'map', 'global-over'); exception when others then blocked := true; msg := SQLERRM; end;
  perform assert(blocked, 'alice must be blocked by the GLOBAL cap even with per-DM budget left');
  perform assert(msg = 'Global monthly AI budget reached', 'expected the global cap message, got: '||coalesce(msg,'<none>'));
  -- bob is blocked too
  perform as_user('bob@x.com'); perform set_config('role','authenticated', true);
  blocked := false;
  begin perform ai_reserve_image(B, 'map', 'global-over-2'); exception when others then blocked := true; end;
  perform assert(blocked, 'bob must be blocked by the GLOBAL cap too');
  -- the GLOBAL total spans both campaigns; no single non-super user
  -- can see across the campaign boundary (RLS), so count as superuser.
  perform set_config('role','postgres', true);
  perform assert((select count(*) from ai_image_log where status<>'failed') = 2, 'global live count stays at the cap (2)');
  raise notice '  ✓ 5. global cap blocks everyone across DMs';

  perform set_config('role','postgres', true);
  raise notice 'ALL SINGLE-SESSION CAP CHECKS PASSED';
end $$;

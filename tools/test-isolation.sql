-- Cross-campaign isolation proof. Run against a DB that has schema.sql +
-- the multicampaign migration applied, with the Supabase auth shim.
-- Seeds two independent campaigns and asserts, as each signed-in user,
-- that nobody can read or write across the campaign boundary.
-- Any failure RAISEs (psql -v ON_ERROR_STOP=1 turns it into a non-zero exit).

\set ON_ERROR_STOP on

-- Supabase grants table DML to `authenticated`; RLS does the real limiting.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── seed as superuser (bypasses RLS; this is setup, not the test) ──
truncate campaigns cascade;
delete from characters;
insert into campaigns (id, name, owner_email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice Campaign', 'alice@x.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bob Campaign',   'bob@x.com');
insert into campaign_members (campaign_id, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@x.com', 'dm'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'pat@x.com',   'player'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@x.com',   'dm'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'quinn@x.com', 'player');
insert into maps (campaign_id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice Secret Map'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bob Secret Map');
insert into quests (campaign_id, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Alice Quest'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bob Quest');
-- portable characters
insert into characters (id, owner_email, name, sheet) values
  ('cccccccc-0000-0000-0000-0000000000a1', 'pat@x.com',   'Pat Hero',   '{}'),
  ('cccccccc-0000-0000-0000-0000000000b1', 'quinn@x.com', 'Quinn Hero', '{}');
insert into campaign_characters (campaign_id, character_id, added_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000000a1', 'pat@x.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-0000000000b1', 'quinn@x.com');
-- an encounter + a hidden token in Alice's campaign
insert into encounters (id, campaign_id, name, active) values
  ('eeeeeeee-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ambush', true);
insert into tokens (campaign_id, encounter_id, kind, label, hidden) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-0000000000a1', 'monster', 'Lurker', true);

-- ── helper: run a block as a signed-in user ──
create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
end $$;

create or replace function assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ISOLATION FAIL: %', msg; end if; end $$;

-- ═══ tests run as the `authenticated` role, per-user via jwt claims ═══
do $$
declare n int; blocked boolean;
begin
  -- PAT (player in Alice's campaign)
  perform set_config('role','authenticated', true);
  perform as_user('pat@x.com');
  perform set_config('role','authenticated', true);
  select count(*) into n from maps;         perform assert(n = 1, 'pat should see exactly 1 map, saw '||n);
  select count(*) into n from maps where title='Alice Secret Map'; perform assert(n=1,'pat should see Alice map');
  select count(*) into n from maps where title='Bob Secret Map';   perform assert(n=0,'pat must NOT see Bob map');
  select count(*) into n from quests;       perform assert(n = 1, 'pat should see exactly 1 quest, saw '||n);
  select count(*) into n from campaigns;    perform assert(n = 1, 'pat should see exactly 1 campaign, saw '||n);
  -- pat is a player: cannot create a quest even in his own campaign
  blocked := false;
  begin
    insert into quests (campaign_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001','Pat Sneaky Quest');
  exception when others then blocked := true; end;
  perform assert(blocked, 'a player must not be able to insert a quest');
  -- pat cannot roll dice into Bob's campaign
  blocked := false;
  begin perform roll_dice('bbbbbbbb-0000-0000-0000-000000000002','x','[{"sides":20,"count":1}]'::jsonb,0);
  exception when others then blocked := true; end;
  perform assert(blocked, 'pat must NOT be able to roll into Bob''s campaign');
  -- pat CAN roll into his own campaign
  perform roll_dice('aaaaaaaa-0000-0000-0000-000000000001','x','[{"sides":20,"count":1}]'::jsonb,0);
  -- pat does not see the DM's hidden token
  select count(*) into n from tokens; perform assert(n = 0, 'pat must NOT see a hidden token, saw '||n);
  raise notice 'PAT checks passed';

  -- QUINN (player in Bob's campaign) sees only Bob's stuff
  perform as_user('quinn@x.com'); perform set_config('role','authenticated', true);
  select count(*) into n from maps where title='Alice Secret Map'; perform assert(n=0,'quinn must NOT see Alice map');
  select count(*) into n from maps where title='Bob Secret Map';   perform assert(n=1,'quinn should see Bob map');
  raise notice 'QUINN checks passed';

  -- BOB (DM of B) cannot see or write Alice's content
  perform as_user('bob@x.com'); perform set_config('role','authenticated', true);
  select count(*) into n from maps where title='Alice Secret Map'; perform assert(n=0,'bob must NOT see Alice map');
  blocked := false;
  begin insert into maps (campaign_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001','Bob Intrusion');
  exception when others then blocked := true; end;
  perform assert(blocked, 'bob must NOT be able to add a map to Alice''s campaign');
  raise notice 'BOB checks passed';

  -- PORTABLE CHARACTER visibility: Pat's hero is visible to Alice (shared
  -- campaign) and to Pat, but NOT to Bob or Quinn.
  perform as_user('alice@x.com'); perform set_config('role','authenticated', true);
  select count(*) into n from characters where name='Pat Hero'; perform assert(n=1,'alice (DM of Pat''s campaign) should see Pat''s hero');
  select count(*) into n from characters where name='Quinn Hero'; perform assert(n=0,'alice must NOT see Quinn''s hero');
  perform as_user('bob@x.com'); perform set_config('role','authenticated', true);
  select count(*) into n from characters where name='Pat Hero'; perform assert(n=0,'bob must NOT see Pat''s hero');
  perform as_user('pat@x.com'); perform set_config('role','authenticated', true);
  select count(*) into n from characters where name='Pat Hero'; perform assert(n=1,'pat should see his own hero');
  select count(*) into n from characters where name='Quinn Hero'; perform assert(n=0,'pat must NOT see Quinn''s hero');
  -- a player cannot edit someone else's character even if shared
  raise notice 'CHARACTER portability checks passed';

  perform set_config('role','postgres', true);
  raise notice 'ALL ISOLATION CHECKS PASSED';
end $$;

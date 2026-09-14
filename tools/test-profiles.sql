-- ═══════════════════════════════════════════════════════════════
--  Per-user profile isolation, against real Postgres. Applied on top
--  of schema.sql + the profiles migration by run-profiles-tests.sh.
--  Reads go through direct RLS, so we switch to the `authenticated`
--  role (via the role GUC) to make RLS apply, exactly like production.
-- ═══════════════════════════════════════════════════════════════

create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('email', p_email, 'role', 'authenticated')::text, true);
end $$;
create or replace function assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'PROFILE TEST FAIL: %', msg; end if; end $$;

-- clean slate + an allow-listed DM
delete from profiles;
delete from campaign_members;
delete from campaigns;
delete from campaign_creators;
insert into campaign_creators (email) values ('dm@x.com');

-- setup (as superuser: create a campaign, add alice+bob as members; carol is a
-- signed-in stranger who shares no campaign). Each saves their own profile.
do $$
declare cid uuid;
begin
  perform as_user('dm@x.com');
  cid := (create_campaign('Camp')->>'id')::uuid;
  insert into campaign_members (campaign_id, email, role, display_name)
    values (cid, 'alice@x.com', 'player', 'Alice'), (cid, 'bob@x.com', 'player', 'Bob');
  perform as_user('alice@x.com'); perform save_profile('Alice A', null, '{}'::jsonb);
  perform as_user('bob@x.com');   perform save_profile('Bob B',   null, '{}'::jsonb);
  perform as_user('carol@x.com'); perform save_profile('Carol C', null, '{}'::jsonb);
end $$;

-- isolation checks under the authenticated role (RLS enforced)
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);

  perform as_user('alice@x.com');
  select count(*) into n from profiles where lower(email) = 'alice@x.com';
  perform assert(n = 1, 'a user could not read their OWN profile');

  perform as_user('alice@x.com');
  select count(*) into n from profiles where lower(email) = 'bob@x.com';
  perform assert(n = 1, 'a campaign-mate profile was NOT readable');

  perform as_user('alice@x.com');
  select count(*) into n from profiles where lower(email) = 'carol@x.com';
  perform assert(n = 0, 'LEAK: a non-campaign-mate profile was readable');

  -- alice tries to overwrite bob's profile: RLS must filter his row out
  perform as_user('alice@x.com');
  update profiles set display_name = 'HACKED' where lower(email) = 'bob@x.com';
  perform set_config('role', 'postgres', true);
  perform assert(not exists (select 1 from profiles where lower(email) = 'bob@x.com' and display_name = 'HACKED'),
    'RLS BREACH: a user updated another user''s profile');
  -- and bob's real data survived
  perform assert(exists (select 1 from profiles where lower(email) = 'bob@x.com' and display_name = 'Bob B'),
    'bob''s profile was corrupted');

  raise notice '  ✓ user reads own profile';
  raise notice '  ✓ campaign-mate can read a member profile (name/avatar for the party)';
  raise notice '  ✓ a stranger (no shared campaign) profile is NOT readable — no leak';
  raise notice '  ✓ a user cannot update another user''s profile';
  raise notice 'ALL PROFILE ISOLATION CHECKS PASSED';
end $$;

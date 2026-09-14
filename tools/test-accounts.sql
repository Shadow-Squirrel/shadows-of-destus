-- ═══════════════════════════════════════════════════════════════
--  Security proofs for DM-gating + invite links, against real
--  Postgres. Applied ON TOP of schema.sql + the accounts migration
--  by tools/run-accounts-tests.sh. Every RPC is SECURITY DEFINER and
--  authorizes via my_email() (the simulated JWT), so we just switch
--  users with as_user() and call them.
-- ═══════════════════════════════════════════════════════════════

create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('email', p_email, 'role', 'authenticated')::text, true);
end $$;

create or replace function assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ACCOUNTS TEST FAIL: %', msg; end if; end $$;

-- clean slate + a known allow-listed owner
delete from campaign_invites;
delete from campaign_members;
delete from campaigns;
delete from campaign_creators;
insert into campaign_creators (email) values ('owner@x.com');

do $$
declare
  cidA uuid; cidB uuid; tok text; tok_exp text; tok_max text;
  info record; r jsonb; v_valid boolean; ok boolean;
begin
  -- 1. a non-creator cannot create a campaign
  perform as_user('rando@x.com');
  ok := false;
  begin perform create_campaign('Sneaky'); exception when others then ok := true; end;
  perform assert(ok, '1. a non-creator was allowed to create a campaign');

  -- 2. an allow-listed owner can, and becomes the DM
  perform as_user('owner@x.com');
  cidA := (create_campaign('Owner Camp A')->>'id')::uuid;
  perform assert(cidA is not null, '2. owner create_campaign returned no id');
  perform assert(exists(select 1 from campaign_members
    where campaign_id = cidA and lower(email) = 'owner@x.com' and role = 'dm'), '2. owner was not made DM');
  cidB := (create_campaign('Owner Camp B')->>'id')::uuid;   -- second campaign, for the leak check

  -- 3. only a DM of the campaign can mint an invite
  tok := (create_campaign_invite(cidA)).token;
  perform assert(tok is not null, '3. DM could not mint an invite');
  perform as_user('stranger@x.com');
  ok := false;
  begin perform create_campaign_invite(cidA); exception when others then ok := true; end;
  perform assert(ok, '3. a non-DM was allowed to mint an invite');

  -- 4. invite_info: name + valid for a good token, nothing for a bad one
  select campaign_name, valid into info from invite_info(tok);
  perform assert(info.campaign_name = 'Owner Camp A' and info.valid, '4. invite_info not valid for a fresh token');
  perform assert(not exists(select 1 from invite_info('deadbeefdeadbeef')), '4. a bad token returned a row');

  -- 5. a friend redeems → becomes a PLAYER of cidA, and ONLY cidA
  perform as_user('friend@x.com');
  r := redeem_invite(tok, 'Friendo');
  perform assert((r->>'campaign_id')::uuid = cidA, '5. redeem returned the wrong campaign');
  perform assert(exists(select 1 from campaign_members
    where campaign_id = cidA and lower(email) = 'friend@x.com' and role = 'player'), '5. redeemer is not a player member');
  perform assert(not exists(select 1 from campaign_members
    where campaign_id = cidB and lower(email) = 'friend@x.com'), '5. redeemer leaked into another campaign');

  -- 5b. redeeming again is idempotent (no duplicate membership)
  r := redeem_invite(tok);
  perform assert((r->>'already')::boolean, '5b. second redeem was not idempotent');
  perform assert((select count(*) from campaign_members
    where campaign_id = cidA and lower(email) = 'friend@x.com') = 1, '5b. a duplicate membership was created');

  -- 6. a revoked invite is rejected
  update campaign_invites set revoked = true where token = tok;
  perform as_user('third@x.com');
  ok := false;
  begin perform redeem_invite(tok); exception when others then ok := true; end;
  perform assert(ok, '6. redeemed a revoked invite');
  select valid into v_valid from invite_info(tok);
  perform assert(not v_valid, '6. invite_info reports a revoked token as valid');

  -- 7. an expired invite is rejected
  perform as_user('owner@x.com');
  tok_exp := (create_campaign_invite(cidA, 'player', now() - interval '1 minute', null)).token;
  perform as_user('four@x.com');
  ok := false;
  begin perform redeem_invite(tok_exp); exception when others then ok := true; end;
  perform assert(ok, '7. redeemed an expired invite');

  -- 8. max_uses is enforced
  perform as_user('owner@x.com');
  tok_max := (create_campaign_invite(cidA, 'player', null, 1)).token;
  perform as_user('five@x.com');
  r := redeem_invite(tok_max);
  perform assert((r->>'already')::boolean = false, '8. first redeem should be new');
  perform as_user('six@x.com');
  ok := false;
  begin perform redeem_invite(tok_max); exception when others then ok := true; end;
  perform assert(ok, '8. redeemed past max_uses');

  raise notice '  ✓ 1. non-creator cannot create a campaign';
  raise notice '  ✓ 2. allow-listed owner creates and becomes DM';
  raise notice '  ✓ 3. only a DM can mint an invite';
  raise notice '  ✓ 4. invite_info: valid for a good token, empty for a bad one';
  raise notice '  ✓ 5. redeem adds the player to that campaign only (no leak)';
  raise notice '  ✓ 5b. redeem is idempotent (no duplicate membership)';
  raise notice '  ✓ 6. revoked invite rejected';
  raise notice '  ✓ 7. expired invite rejected';
  raise notice '  ✓ 8. max_uses enforced';
  raise notice 'ALL ACCOUNT / INVITE / GATING CHECKS PASSED';
end $$;

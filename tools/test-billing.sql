-- ═══════════════════════════════════════════════════════════════
--  Security proofs for billing (the Dungeon Lord seat), against real
--  Postgres. Applied ON TOP of schema.sql + the accounts + billing
--  migrations by tools/run-billing-tests.sh. The grant/revoke RPCs are
--  guarded on auth.role(), which the shim reads from request.jwt.claims,
--  so "the webhook" is simulated with a service_role claim and ordinary
--  users with as_user(). Direct table reads run under the `authenticated`
--  role so RLS applies exactly like production.
-- ═══════════════════════════════════════════════════════════════

create or replace function as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('email', p_email, 'role', 'authenticated')::text, true);
end $$;
create or replace function as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'BILLING TEST FAIL: %', msg; end if; end $$;

-- clean slate: one manual (owner-style) seat, nothing from Stripe
delete from stripe_events;
delete from subscriptions;
delete from campaign_members;
delete from campaigns;
delete from campaign_creators;
insert into campaign_creators (email, source) values ('owner@x.com', 'manual');

do $$
declare ok boolean; st jsonb;
begin
  -- a. an ordinary signed-in user cannot grant or revoke a seat (the guard raises)
  perform as_user('rando@x.com');
  ok := false;
  begin perform grant_campaign_creator('rando@x.com'); exception when others then ok := true; end;
  perform assert(ok, 'a. an authenticated user was allowed to call grant_campaign_creator');
  perform assert(not exists (select 1 from campaign_creators where email = 'rando@x.com'),
    'a. a seat was granted by a non-service call');
  ok := false;
  begin perform revoke_campaign_creator('owner@x.com'); exception when others then ok := true; end;
  perform assert(ok, 'a. an authenticated user was allowed to call revoke_campaign_creator');
  -- …and neither can a request with no JWT at all (NULL role)
  perform set_config('request.jwt.claims', '{}', true);
  ok := false;
  begin perform grant_campaign_creator('rando@x.com'); exception when others then ok := true; end;
  perform assert(ok, 'a. a call with no role claim was allowed to grant');

  -- b. the service role (the webhook) grants → the buyer becomes a DM
  perform as_service();
  perform grant_campaign_creator('Buyer@X.com');   -- mixed case: must be stored lowercased
  perform as_user('buyer@x.com');
  perform assert(can_create_campaign(), 'b. buyer cannot create a campaign after a stripe grant');
  st := billing_status();
  perform assert(st->>'tier' = 'dm' and (st->>'is_creator')::boolean and st->>'creator_source' = 'stripe',
    'b. billing_status did not report tier dm / source stripe: ' || st::text);
  perform assert(exists (select 1 from campaign_creators where email = 'buyer@x.com' and source = 'stripe'),
    'b. stripe seat row missing or not lowercased');
  perform assert(create_campaign('Bought Camp')->>'id' is not null, 'b. buyer could not actually create a campaign');

  -- b2. granting twice is idempotent (one row)
  perform as_service();
  perform grant_campaign_creator('buyer@x.com');
  perform assert((select count(*) from campaign_creators where lower(email) = 'buyer@x.com') = 1,
    'b2. duplicate seat rows after a second grant');

  -- c. revoke removes the stripe seat → free again
  perform as_service();
  perform revoke_campaign_creator('buyer@x.com');
  perform as_user('buyer@x.com');
  perform assert(not can_create_campaign(), 'c. buyer can still create campaigns after revoke');
  st := billing_status();
  perform assert(st->>'tier' = 'free' and not (st->>'is_creator')::boolean and st->'creator_source' = 'null'::jsonb,
    'c. billing_status did not report free after revoke: ' || st::text);
  -- lapse policy: the campaign they already made keeps them as its DM
  perform assert(exists (select 1 from campaign_members where lower(email) = 'buyer@x.com' and role = 'dm'),
    'c. revoke stripped DM-ship of an existing campaign (it must only stop NEW creation)');

  -- d. revoke NEVER removes a manual seat (the owner)
  perform as_service();
  perform revoke_campaign_creator('owner@x.com');
  perform as_user('owner@x.com');
  perform assert(can_create_campaign(), 'd. the manual owner seat was revoked by the webhook path');
  -- …and a stripe grant for the owner's email cannot downgrade it to 'stripe'
  perform as_service();
  perform grant_campaign_creator('owner@x.com', 'stripe');
  perform assert(exists (select 1 from campaign_creators where email = 'owner@x.com' and source = 'manual'),
    'd. a stripe grant downgraded the manual owner row');
  perform revoke_campaign_creator('owner@x.com');
  perform as_user('owner@x.com');
  perform assert(can_create_campaign(), 'd. owner lost the seat after grant+revoke via stripe');
  st := billing_status();
  perform assert(st->>'creator_source' = 'manual', 'd. owner creator_source should be manual: ' || st::text);

  -- e. a user with no rows at all: free, no subscription, all four keys present
  perform as_user('nobody@x.com');
  st := billing_status();
  perform assert(st->>'tier' = 'free' and st->'subscription' = 'null'::jsonb and st->'creator_source' = 'null'::jsonb,
    'e. empty billing_status wrong: ' || st::text);
  perform assert(st ? 'tier' and st ? 'is_creator' and st ? 'creator_source' and st ? 'subscription'
    and (select count(*) from jsonb_object_keys(st)) = 4,
    'e. billing_status keys differ from the contract: ' || st::text);

  -- e2. with a subscriptions row, billing_status mirrors it with exactly the contract's sub-keys
  insert into subscriptions (email, stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end)
    values ('buyer@x.com', 'cus_test', 'sub_test', 'active', '2030-01-01T00:00:00Z', true),
           ('other@x.com', null, null, 'incomplete', null, false);
  perform as_user('buyer@x.com');
  st := billing_status();
  perform assert(st->'subscription'->>'status' = 'active'
    and (st->'subscription'->>'cancel_at_period_end')::boolean
    and (st->'subscription'->>'has_customer')::boolean
    and (st->'subscription'->>'current_period_end')::timestamptz = '2030-01-01T00:00:00Z'::timestamptz,
    'e2. billing_status subscription block wrong: ' || st::text);
  perform assert((select count(*) from jsonb_object_keys(st->'subscription')) = 4,
    'e2. subscription block has unexpected keys: ' || st::text);
  perform as_user('other@x.com');
  st := billing_status();
  perform assert(not (st->'subscription'->>'has_customer')::boolean and st->'subscription'->'current_period_end' = 'null'::jsonb,
    'e2. has_customer/current_period_end wrong without a customer: ' || st::text);

  raise notice '  ✓ a. an ordinary user (or no JWT) cannot grant/revoke a seat';
  raise notice '  ✓ b. service-role grant → buyer can create campaigns, tier = dm, source = stripe';
  raise notice '  ✓ b2. grant is idempotent';
  raise notice '  ✓ c. revoke → tier = free; existing campaign keeps its DM (lapse policy)';
  raise notice '  ✓ d. revoke never removes a manual seat; a stripe grant never downgrades it';
  raise notice '  ✓ e. no rows → free, subscription null, exact contract keys';
  raise notice '  ✓ e2. subscription block mirrors the row with exact sub-keys';
end $$;

-- f. RLS under the authenticated role: a user reads ONLY their own
--    subscriptions row, writes none of them, and sees no stripe_events.
insert into stripe_events (id, type) values ('evt_test', 'checkout.session.completed');
do $$
declare n int; ok boolean; st jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform as_user('buyer@x.com');

  select count(*) into n from subscriptions;
  perform assert(n = 1, 'f. buyer sees ' || n || ' subscription rows (expected 1: their own)');
  select count(*) into n from subscriptions where email = 'other@x.com';
  perform assert(n = 0, 'f. LEAK: buyer can read another user''s subscription row');
  select count(*) into n from stripe_events;
  perform assert(n = 0, 'f. LEAK: a user can read the stripe_events ledger');

  -- billing_status() is callable by the authenticated role and still correct
  st := billing_status();
  perform assert(st->>'tier' = 'free' and st->'subscription'->>'status' = 'active',
    'f. billing_status under the authenticated role wrong: ' || st::text);

  -- no client write path: insert is refused, update/delete are filtered out
  ok := false;
  begin insert into subscriptions (email, status) values ('buyer2@x.com', 'active');
  exception when others then ok := true; end;
  perform assert(ok, 'f. a user inserted a subscriptions row');
  update subscriptions set status = 'active' where email = 'other@x.com';
  update subscriptions set status = 'canceled' where email = 'buyer@x.com';
  delete from subscriptions where email = 'other@x.com';
  ok := false;
  begin insert into stripe_events (id) values ('evt_forged'); exception when others then ok := true; end;
  perform assert(ok, 'f. a user inserted a stripe_events row');

  -- the seat RPCs are not even EXECUTABLE by the authenticated role
  ok := false;
  begin perform grant_campaign_creator('buyer@x.com'); exception when others then ok := true; end;
  perform assert(ok, 'f. authenticated role could execute grant_campaign_creator');
  ok := false;
  begin perform revoke_campaign_creator('owner@x.com'); exception when others then ok := true; end;
  perform assert(ok, 'f. authenticated role could execute revoke_campaign_creator');

  perform set_config('role', 'postgres', true);
  perform assert(exists (select 1 from subscriptions where email = 'other@x.com' and status = 'incomplete'),
    'f. RLS BREACH: a user updated/deleted another user''s subscription row');
  perform assert(exists (select 1 from subscriptions where email = 'buyer@x.com' and status = 'active'),
    'f. RLS BREACH: a user updated their own subscription row');
  perform assert(not exists (select 1 from campaign_creators where email = 'buyer@x.com'),
    'f. a seat appeared from a client-side call');

  raise notice '  ✓ f. RLS: own subscriptions row only; no client writes; stripe_events invisible; RPCs not executable';
  raise notice 'ALL BILLING CHECKS PASSED';
end $$;

-- ═════════════════════════════════════════════════════════════
--  BILLING — the "Dungeon Lord" subscription, paid through Stripe.
--
--  The model is deliberately tiny. Everyone who signs up is a free
--  player. A paid subscription is NOTHING MORE than the buyer's email
--  in `campaign_creators` — the very allow-list the accounts migration
--  already consults in can_create_campaign() / create_campaign(). AI
--  tools are DM-only at the database, so the same seat unlocks them.
--  There is no second permission system to keep in sync.
--
--   • Stripe is the SOURCE OF TRUTH for who is paying. The browser
--     never talks to Stripe and never writes here. The `stripe-webhook`
--     Edge Function (service role) is the ONLY writer of `subscriptions`
--     and the only caller of grant_/revoke_campaign_creator().
--   • `campaign_creators.source` tells a 'manual' seat (the seeded
--     owner, or a friend you add by hand in the SQL editor) from a
--     'stripe' seat. A lapsed subscription revokes ONLY 'stripe' rows,
--     so a webhook can never cancel a seat you granted yourself.
--   • `subscriptions` mirrors each buyer's Stripe subscription (status,
--     period end, cancel flag) so the profile page can show "renews on
--     …". A user may READ their own row; nobody writes from the client.
--   • `stripe_events` is an idempotency ledger: Stripe retries webhooks
--     and may deliver one twice, so each event id is claimed once.
--   • billing_status() is the one RPC the UI reads: tier + own row.
--
--  LAPSE POLICY: revoking a seat only stops NEW campaign creation.
--  Existing campaigns keep their campaign_members role = 'dm', so a
--  lapsed subscriber can still run the tables they already built (and
--  the DM-only tools inside them); their players lose nothing.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- ── who granted the seat ─────────────────────────────────────
-- 'manual' = the owner (seed row / SQL editor); 'stripe' = the webhook.
-- Rows that predate this column (the seeded owner) take the 'manual'
-- default, so the owner's seat can never be revoked by a webhook.
alter table campaign_creators
  add column if not exists source text not null default 'manual';

-- ── subscriptions: a mirror of each buyer's Stripe subscription ──
create table if not exists subscriptions (
  email                  text primary key,
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  status                 text not null default 'incomplete',  -- Stripe's status string, verbatim
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);
alter table subscriptions enable row level security;

-- A user may read their OWN row (the profile page shows status / renewal).
-- There are NO insert/update/delete policies: only the service role (the
-- stripe-webhook function, which bypasses RLS) or the owner in the SQL
-- editor ever writes here. The browser cannot promote itself.
drop policy if exists "subs: self reads" on subscriptions;
create policy "subs: self reads" on subscriptions
  for select to authenticated using (lower(email) = my_email());

create or replace function touch_subscriptions() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists subscriptions_touch on subscriptions;
create trigger subscriptions_touch before update on subscriptions
  for each row execute function touch_subscriptions();

-- ── stripe_events: idempotency ledger ────────────────────────
-- The webhook INSERTs the event id before doing any work; a duplicate
-- delivery hits the primary key and is acknowledged without re-running.
create table if not exists stripe_events (
  id          text primary key,                 -- Stripe event id (evt_…)
  type        text not null default '',
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
-- No policies at all: service role only (it bypasses RLS).

-- Explicit table grants. Supabase's default privileges usually cover
-- these, but new projects stop auto-exposing tables to the API roles
-- (see the note in supabase/config.toml), so say it out loud.
grant select on subscriptions to authenticated;
grant select, insert, update, delete on subscriptions, stripe_events to service_role;

-- ── grant / revoke a seat — SERVICE ROLE ONLY ────────────────
-- Called by the stripe-webhook Edge Function with the service-role key.
-- Guarded on auth.role() as well as on EXECUTE grants (defence in depth:
-- a user JWT is refused even if a grant is ever loosened by mistake).
-- `is distinct from` so a NULL role (no JWT at all) is refused too.
create or replace function grant_campaign_creator(p_email text, p_source text default 'stripe')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'email required'; end if;
  if p_source not in ('manual', 'stripe') then raise exception 'bad source'; end if;
  insert into campaign_creators (email, source)
    values (lower(trim(p_email)), p_source)
  on conflict (email) do update
    set source = excluded.source
    where campaign_creators.source = 'stripe';   -- never downgrade a 'manual' seat
end $$;
revoke execute on function grant_campaign_creator(text, text) from public, anon, authenticated;
grant  execute on function grant_campaign_creator(text, text) to service_role;

-- Removes a seat Stripe granted. A 'manual' seat (the seeded owner, a
-- hand-added friend) is NEVER touched, whatever Stripe says.
create or replace function revoke_campaign_creator(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role only';
  end if;
  delete from campaign_creators
   where lower(email) = lower(trim(coalesce(p_email, ''))) and source = 'stripe';
end $$;
revoke execute on function revoke_campaign_creator(text) from public, anon, authenticated;
grant  execute on function revoke_campaign_creator(text) to service_role;

-- ── billing_status(): what the UI reads ──────────────────────
-- Shape (the frontend contract — keep it exact):
--   { tier: 'dm'|'free', is_creator: bool, creator_source: 'manual'|'stripe'|null,
--     subscription: null | { status, current_period_end, cancel_at_period_end, has_customer } }
-- tier is 'dm' iff can_create_campaign() — one source of truth.
create or replace function billing_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_email   text := my_email();
  v_creator boolean := can_create_campaign();
  v_source  text;
  s         subscriptions;
  v_sub     jsonb := null;
begin
  select source into v_source from campaign_creators
   where lower(email) = v_email order by source limit 1;   -- 'manual' wins if both exist
  select * into s from subscriptions where lower(email) = v_email limit 1;
  if found then
    v_sub := jsonb_build_object(
      'status',               s.status,
      'current_period_end',   s.current_period_end,
      'cancel_at_period_end', s.cancel_at_period_end,
      'has_customer',         s.stripe_customer_id is not null);
  end if;
  return jsonb_build_object(
    'tier',           case when v_creator then 'dm' else 'free' end,
    'is_creator',     v_creator,
    'creator_source', v_source,
    'subscription',   v_sub);
end $$;
revoke execute on function billing_status() from public, anon;
grant  execute on function billing_status() to authenticated;

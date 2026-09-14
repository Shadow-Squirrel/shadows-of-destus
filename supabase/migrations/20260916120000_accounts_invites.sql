-- ═══════════════════════════════════════════════════════════
--  Accounts, invite links, and DM gating.
--
--  • While you're testing, ONLY allow-listed emails may create a
--    campaign (become a DM). Everyone else signs up as a player and
--    joins a campaign through an invite link. Later, a paid
--    subscription just adds the buyer's email to campaign_creators.
--  • A DM mints a random invite link for their campaign; a friend
--    opens it, creates an account, and is added to THAT campaign as
--    a player. Tokens are 128-bit random, revocable, and can expire
--    or cap their uses.
--
--  Security: every rule below is enforced in the database (RLS +
--  SECURITY DEFINER functions), never in the browser.
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_bytes for tokens

-- ── Who may create campaigns (i.e. be a DM) ──────────────────
create table if not exists campaign_creators (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table campaign_creators enable row level security;
-- No client policies: the table is consulted only through the
-- SECURITY DEFINER helpers below, so nobody can read or edit the
-- allow-list from the browser.

-- ⚔️ Seed the owner. EDIT this to the email you sign in with.
insert into campaign_creators (email) values ('mitchel.shepherd98@gmail.com')
  on conflict do nothing;

create or replace function can_create_campaign() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_creators where lower(email) = my_email())
$$;
revoke execute on function can_create_campaign() from public, anon;
grant execute on function can_create_campaign() to authenticated;

-- Gate campaign creation. Replaces the open create_campaign so a
-- random signup can't spin up campaigns while you're testing.
-- (drop first: the prior version may return a different type)
drop function if exists create_campaign(text);
create or replace function create_campaign(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if not can_create_campaign() then
    raise exception 'Your account is not allowed to create campaigns yet.';
  end if;
  insert into campaigns (name, owner_email)
    values (coalesce(nullif(trim(p_name), ''), 'New Campaign'), my_email())
    returning * into c;
  insert into campaign_members (campaign_id, email, role, display_name)
    values (c.id, my_email(), 'dm', split_part(my_email(), '@', 1))
    on conflict do nothing;
  return to_jsonb(c);
end $$;
revoke execute on function create_campaign(text) from public, anon;
grant execute on function create_campaign(text) to authenticated;

-- ── Invite links ─────────────────────────────────────────────
create table if not exists campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  role text not null default 'player' check (role in ('player', 'dm')),
  created_by text not null default my_email(),
  created_at timestamptz not null default now(),
  expires_at timestamptz,          -- null = never
  max_uses int,                    -- null = unlimited
  uses int not null default 0,
  revoked boolean not null default false
);
create index if not exists campaign_invites_campaign_idx on campaign_invites(campaign_id);
alter table campaign_invites enable row level security;

-- Only a DM of the campaign can mint / see / revoke its invites.
drop policy if exists "invites: dm reads" on campaign_invites;
create policy "invites: dm reads" on campaign_invites
  for select to authenticated using (is_campaign_dm(campaign_id));
drop policy if exists "invites: dm creates" on campaign_invites;
create policy "invites: dm creates" on campaign_invites
  for insert to authenticated with check (is_campaign_dm(campaign_id) and created_by = my_email());
drop policy if exists "invites: dm updates" on campaign_invites;
create policy "invites: dm updates" on campaign_invites
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "invites: dm deletes" on campaign_invites;
create policy "invites: dm deletes" on campaign_invites
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- Mint an invite for a campaign you DM. Returns the new row (incl. token).
create or replace function create_campaign_invite(
  p_campaign uuid, p_role text default 'player',
  p_expires timestamptz default null, p_max_uses int default null)
returns campaign_invites language plpgsql security definer set search_path = public as $$
declare inv campaign_invites;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a DM of this campaign can create invites.';
  end if;
  if p_role not in ('player', 'dm') then raise exception 'Bad invite role.'; end if;
  insert into campaign_invites (campaign_id, role, created_by, expires_at, max_uses)
    values (p_campaign, p_role, my_email(), p_expires, p_max_uses)
    returning * into inv;
  return inv;
end $$;
revoke execute on function create_campaign_invite(uuid, text, timestamptz, int) from public, anon;
grant execute on function create_campaign_invite(uuid, text, timestamptz, int) to authenticated;

-- Public, read-only peek at a token so the join page can show the
-- campaign name BEFORE someone signs up. Leaks only name + validity
-- for a correctly-guessed 128-bit token; never the roster or content.
create or replace function invite_info(p_token text)
returns table(campaign_id uuid, campaign_name text, role text, valid boolean)
language sql stable security definer set search_path = public as $$
  select i.campaign_id, c.name, i.role,
         (not i.revoked
           and (i.expires_at is null or i.expires_at > now())
           and (i.max_uses is null or i.uses < i.max_uses)) as valid
  from campaign_invites i
  join campaigns c on c.id = i.campaign_id
  where i.token = p_token
$$;
grant execute on function invite_info(text) to anon, authenticated;

-- Redeem a token: add the signed-in user to the campaign as the
-- invite's role. Locks the row so concurrent redeems can't overrun
-- max_uses. Idempotent if they're already a member.
create or replace function redeem_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv campaign_invites; nm text;
begin
  select * into inv from campaign_invites where token = p_token for update;
  if inv.id is null then raise exception 'This invite link is invalid.'; end if;
  if inv.revoked then raise exception 'This invite link has been turned off.'; end if;
  if inv.expires_at is not null and inv.expires_at <= now() then raise exception 'This invite link has expired.'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'This invite link has reached its limit.'; end if;

  if exists (select 1 from campaign_members where campaign_id = inv.campaign_id and lower(email) = my_email()) then
    return jsonb_build_object('campaign_id', inv.campaign_id, 'already', true);
  end if;

  nm := coalesce(nullif(trim(p_display_name), ''), split_part(my_email(), '@', 1));
  insert into campaign_members (campaign_id, email, role, display_name)
    values (inv.campaign_id, my_email(), inv.role, nm);
  update campaign_invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('campaign_id', inv.campaign_id, 'already', false);
end $$;
revoke execute on function redeem_invite(text, text) from public, anon;
grant execute on function redeem_invite(text, text) to authenticated;

-- ═════════════════════════════════════════════════════════════
--  BILLING follows an EMAIL CHANGE.
--
--  Billing is keyed on the account email (subscriptions.email and the
--  campaign_creators allow-list), but a user can change their email from
--  the profile page (Supabase Auth, confirmed by link). Without this, the
--  still-paying subscriber would lose their seat and portal access, and
--  whoever later signed up with the OLD address would inherit both.
--
--  When auth.users.email changes, move the Stripe-granted rows with it.
--  A 'manual' seat is left alone (the owner manages those by hand).
--  Runs as the definer so it can touch tables the user can't.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

create or replace function billing_follow_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_e text := lower(coalesce(old.email, ''));
  new_e text := lower(coalesce(new.email, ''));
begin
  if old_e = '' or new_e = '' or old_e = new_e then return new; end if;
  -- the seat (Stripe-granted only)
  update campaign_creators set email = new_e
   where lower(email) = old_e and source = 'stripe'
     and not exists (select 1 from campaign_creators c2 where lower(c2.email) = new_e);
  -- the subscription mirror (the new address has no row of its own)
  update subscriptions set email = new_e
   where lower(email) = old_e
     and not exists (select 1 from subscriptions s2 where lower(s2.email) = new_e);
  return new;
end $$;

drop trigger if exists billing_follow_email on auth.users;
create trigger billing_follow_email
  after update of email on auth.users
  for each row execute function billing_follow_email();

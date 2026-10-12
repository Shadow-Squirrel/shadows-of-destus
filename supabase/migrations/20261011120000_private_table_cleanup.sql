-- ═════════════════════════════════════════════════════════════
--  PRIVATE TABLE CLEANUP — the site is a campaign hub for one group of
--  friends again. This removes the database side of the two things that
--  were taken out of the app:
--
--   • Billing (Stripe): the subscriptions mirror, the webhook's
--     idempotency ledger, the service-role grant/revoke RPCs, the
--     billing_status() RPC, the email-follow trigger on auth.users, and
--     the campaign_creators.source column. campaign_creators ITSELF STAYS —
--     it's still how the DM is allowed to create campaigns.
--   • AI generation: the image/text budget tables, their logs, and the
--     reserve/complete/fail/usage RPCs the deleted Edge Functions called.
--
--  Deliberately KEPT: the 'ai-art' storage bucket and every art_path
--  column (homebrew_monsters, campaign_npcs, codex_entries, character
--  sheets) — pictures people already generated keep showing. The
--  `adventures` table is also left in place (it holds drafted adventures;
--  drop it by hand if you don't want them: `drop table adventures;`).
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- ── billing ──────────────────────────────────────────────────
-- The billing migration may never have been applied to this project (the
-- tables don't exist). `drop trigger if exists … on <table>` still errors
-- when the TABLE is missing, so guard the table-scoped statements.
drop trigger  if exists billing_follow_email on auth.users;
drop function if exists billing_follow_email();
drop function if exists billing_status();
drop function if exists grant_campaign_creator(text, text);
drop function if exists revoke_campaign_creator(text);
do $$ begin
  if to_regclass('public.subscriptions') is not null then
    drop trigger if exists subscriptions_touch on subscriptions;
  end if;
  if to_regclass('public.campaign_creators') is not null then
    alter table campaign_creators drop column if exists source;
  end if;
end $$;
drop function if exists touch_subscriptions();
drop table    if exists stripe_events;
drop table    if exists subscriptions;

-- ── AI budgets, logs and RPCs ────────────────────────────────
drop function if exists ai_reserve_image(uuid, text, text);
drop function if exists ai_complete_image(uuid, text);
drop function if exists ai_fail_image(uuid);
drop function if exists ai_usage();
drop function if exists ai_reserve_text(uuid, text, text);
drop function if exists ai_complete_text(uuid);
drop function if exists ai_fail_text(uuid);
drop function if exists ai_text_usage();
drop table    if exists ai_image_log;
drop table    if exists ai_image_config;
drop table    if exists ai_text_log;
drop table    if exists ai_text_config;

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
drop trigger  if exists billing_follow_email on auth.users;
drop function if exists billing_follow_email();
drop function if exists billing_status();
drop function if exists grant_campaign_creator(text, text);
drop function if exists revoke_campaign_creator(text);
drop trigger  if exists subscriptions_touch on subscriptions;
drop function if exists touch_subscriptions();
drop table    if exists stripe_events;
drop table    if exists subscriptions;
alter table campaign_creators drop column if exists source;

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

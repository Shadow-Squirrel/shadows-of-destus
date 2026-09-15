-- ═════════════════════════════════════════════════════════════
--  Homebrew ITEMS — a campaign's shared armory of magic items and
--  gear. Same ownership as monsters and spells: party members read,
--  only a DM writes. A DM authors an item once (by hand or with AI)
--  and can hand it to any character, where it lands in that sheet's
--  inventory. The `data` jsonb holds the full item (type, rarity,
--  attunement, properties, description — see js/pages/items.js).
--
--  No AI-budget changes here: the shared ai_text budget already
--  accepts kind 'item' (widened in ..._homebrew_spells.sql).
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

create table if not exists homebrew_items (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name        text not null default 'New item',
  type        text not null default '',          -- weapon, armor, potion, wondrous, …
  rarity      text not null default '',           -- common … artifact (shown in lists)
  data        jsonb not null default '{}'::jsonb,  -- the full item (see js/pages/items.js)
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists homebrew_items_campaign_idx on homebrew_items (campaign_id);
alter table homebrew_items enable row level security;

drop policy if exists "hbitem: members read" on homebrew_items;
create policy "hbitem: members read" on homebrew_items
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "hbitem: dm writes" on homebrew_items;
create policy "hbitem: dm writes" on homebrew_items
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "hbitem: dm edits" on homebrew_items;
create policy "hbitem: dm edits" on homebrew_items
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "hbitem: dm deletes" on homebrew_items;
create policy "hbitem: dm deletes" on homebrew_items
  for delete to authenticated using (is_campaign_dm(campaign_id));

create or replace function touch_homebrew_item() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists homebrew_items_touch on homebrew_items;
create trigger homebrew_items_touch before update on homebrew_items
  for each row execute function touch_homebrew_item();

-- The atlas, rebuilt for secrecy.
--
-- Map images now live in a PRIVATE Supabase Storage bucket, not
-- the public GitHub repo. Each map has a `revealed` flag:
--   • players can only see (or fetch) maps with revealed = true
--   • the DM sees everything and can toggle reveal on the site
-- Enforced twice: on the maps table (rows) and on the storage
-- bucket (the image files themselves).

-- ── maps table: new columns ──────────────────────────────────
alter table maps add column if not exists sort_order int not null default 100;
alter table maps add column if not exists revealed boolean not null default false;
alter table maps add column if not exists storage_path text;

-- Players see revealed maps only; the DM sees all.
drop policy if exists "maps: members read" on maps;
create policy "maps: members read revealed, dm reads all" on maps
  for select to authenticated
  using (is_member() and (revealed or is_dm()));

-- ── private storage bucket for the images ────────────────────
insert into storage.buckets (id, name, public)
values ('maps', 'maps', false)
on conflict (id) do nothing;

-- May this user fetch this image file? Mirrors the table rule.
create or replace function can_read_map(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member() and exists (
    select 1 from maps where storage_path = p and (revealed or is_dm())
  )
$$;

drop policy if exists "maps bucket: members read revealed, dm all" on storage.objects;
create policy "maps bucket: members read revealed, dm all" on storage.objects
  for select to authenticated
  using (bucket_id = 'maps' and can_read_map(name));

-- ── the world map row: point it at storage, revealed ─────────
update maps
   set sort_order = 1, revealed = true,
       storage_path = 'world-of-destus.png', image_url = ''
 where image_url = 'maps/world-of-destus.png' or storage_path = 'world-of-destus.png';

-- ── Tormir, Willowfen (revealed) + the towns (hidden) ────────
insert into maps (title, category, storage_path, description, sort_order, revealed)
select v.* from (values
  ('Tormir', 'region', 'tormir.webp', 'The homeland in full — Crownspire in the heartwood, Willowfen on the eastern marshes.', 2, true),
  ('Willowfen', 'city', 'willowfen.webp', 'A waterside settlement of Tormir: four hundred people, timber platforms, tidal marsh, and a smell with opinions. The campaign begins here.', 3, true),
  ('Crownspire', 'city', 'crownspire.webp', 'Capital of Tormir — the Citadel, the five quarters, and Lake Crownspire at its feet.', 10, false),
  ('Ashfall', 'city', 'ashfall.webp', 'Town on the Stormwake coast, in the shadow of Mount Varkul.', 11, false),
  ('Briarwatch', 'city', 'briarwatch.webp', 'Western town at the edge of the Sunscar Highlands.', 12, false),
  ('Ember Hollow', 'city', 'ember-hollow.webp', 'Village on Tormir''s southern shore.', 13, false),
  ('Frostford', 'city', 'frostford.webp', 'Northern town where Tormir meets the cold of Vantreach.', 14, false),
  ('Gull''s End', 'city', 'gulls-end.webp', 'Harbor village on the southeastern coast.', 15, false),
  ('Mireden', 'city', 'mireden.webp', 'Town below the Ironspine Range.', 16, false),
  ('Pinerest', 'city', 'pinerest.webp', 'Village on the northern edge of the Kingshade Forest.', 17, false),
  ('Redharbor', 'city', 'redharbor.webp', 'Port town of the southwest coast.', 18, false),
  ('Mount Varkul', 'other', 'mt-varkul.webp', 'The smoking mountain of the northeast coast.', 19, false)
) as v(title, category, storage_path, description, sort_order, revealed)
where not exists (select 1 from maps m where m.storage_path = v.storage_path);

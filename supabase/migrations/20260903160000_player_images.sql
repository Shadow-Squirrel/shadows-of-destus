-- Player images: notes can carry an attached picture, codex
-- entries can carry a portrait. Files live in a second PRIVATE
-- bucket ('uploads'): any member may add images, everyone in the
-- party may view them, and only the uploader or the DM may
-- delete. The bucket itself enforces size + image-only limits.

alter table notes add column if not exists image_path text;
alter table codex_entries add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 8388608,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "uploads: members view" on storage.objects;
create policy "uploads: members view" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and is_member());

drop policy if exists "uploads: members add images" on storage.objects;
create policy "uploads: members add images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and is_member());

drop policy if exists "uploads: uploader or dm removes" on storage.objects;
create policy "uploads: uploader or dm removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (owner_id = (select auth.uid())::text or is_dm()));

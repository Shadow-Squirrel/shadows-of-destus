-- Let the DM upload map images straight from the Maps page.
-- Until now only admin tooling could write into the private
-- 'maps' bucket; this grants upload/delete to the DM alone
-- (players still can't touch it), and puts sane server-side
-- limits on the bucket: images only, up to 25 MB.

drop policy if exists "maps bucket: dm uploads" on storage.objects;
create policy "maps bucket: dm uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maps' and is_dm());

drop policy if exists "maps bucket: dm removes" on storage.objects;
create policy "maps bucket: dm removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'maps' and is_dm());

update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
 where id = 'maps';

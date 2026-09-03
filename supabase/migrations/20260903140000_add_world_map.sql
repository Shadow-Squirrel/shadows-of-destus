-- Adds the world map to the atlas. The image itself lives in the
-- repo's maps/ folder; this row is what makes it appear on the
-- Maps page. Guarded so re-running can't create duplicates.
insert into maps (title, category, image_url, description)
select 'The World of Destus', 'world', 'maps/world-of-destus.png',
       'The known world. Find Willowfen on the southeastern coast of Tormir, between the Blackmire Wood and the Stormwake Sea.'
where not exists (select 1 from maps where image_url = 'maps/world-of-destus.png');

-- Each campaign gets its own DM-customizable tagline, shown under the app
-- name (Onyx Dungeon) in the header. Additive and safe on existing installs.
alter table campaigns add column if not exists tagline text;

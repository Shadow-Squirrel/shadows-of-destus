// ─────────────────────────────────────────────────────────────
//  Campaign Hub settings — the ONE file you edit by hand.
//
//  1) Name your campaign (shows in the header and browser tab).
//  2) After creating your Supabase project (README, step 2),
//     paste its URL and "anon public" key below.
//
//  The anon key is SAFE to publish in a public repo: it only
//  grants what the database's Row Level Security rules allow,
//  and those rules require an invited, signed-in member.
//  (Never put the "service_role" key anywhere in this site.)
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  CAMPAIGN_NAME: "Shadows of Destus",
  TAGLINE: "It starts small. It does not stay that way.",

  SUPABASE_URL: "",       // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",  // long key starting with "eyJ..."
};

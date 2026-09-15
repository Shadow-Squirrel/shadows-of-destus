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
  APP_NAME: "Onyx Dungeon",              // the product/site name (the brand)
  CAMPAIGN_NAME: "Shadows of Destus",    // default campaign name (legacy/demo only)
  TAGLINE: "It starts small. It does not stay that way.", // fallback tagline (legacy/demo)

  // Account tiers (shown on the landing + pricing pages and in the app).
  //   FREE  → everyone who signs up: build heroes, join tables, play.
  //   DM    → the subscription: run your own campaigns + every AI feature.
  TIERS: {
    FREE: { name: "Adventurer", icon: "🗡️" },
    DM:   { name: "Dungeon Lord", icon: "🔥" },
  },
  // ⚠ PLACEHOLDER price — set this to match the Price you create in Stripe
  // (docs/BILLING.md). It's display-only; Stripe is the source of truth.
  PRICING: { DM_PRICE: "$4.99", DM_PERIOD: "month" },

  SUPABASE_URL: "https://wmagwmnqmapasppgfpnj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtYWd3bW5xbWFwYXNwcGdmcG5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjIxODYsImV4cCI6MjEwNDAzODE4Nn0.UYA0pCNC8nJc7-gkUJJwo-Vmh8ldeDam0GGiDfnmyo0",
};

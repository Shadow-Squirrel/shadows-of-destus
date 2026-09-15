// ─────────────────────────────────────────────────────────────
//  discord-post — sends a DM-initiated message to a campaign's Discord
//  channel (game reminder, session recap, or free-form announcement).
//
//  The webhook URL is a secret, so it lives in the DM-only
//  `campaign_discord` table and NEVER reaches the browser. This function
//  reads it with the caller's own auth: RLS only returns a row to the
//  campaign's DM, so a non-DM (or a wrong campaign) simply gets nothing
//  back → 403. It then posts a formatted embed to Discord.
//
//  Auto dice results are handled separately by a DB trigger (see the
//  20260924_discord.sql migration), not this function.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Discord webhooks only — defence-in-depth against SSRF (the DB constraint
// already enforces this shape, but never trust a single layer).
function isDiscordWebhook(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:") &&
      (u.hostname === "discord.com" || u.hostname === "discordapp.com") &&
      u.pathname.startsWith("/api/webhooks/");
  } catch { return false; }
}

const COLORS = { reminder: 15844367, recap: 3447003, announce: 10197915, test: 3066993 };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function buildEmbed(type: string, title: string, message: string) {
  const t = String(title || "").trim();
  const m = String(message || "").trim();
  if (type === "reminder") {
    return { title: `⚔ ${clip(t || "Game session", 240)}`, description: clip(m, 2000), color: COLORS.reminder };
  }
  if (type === "recap") {
    return { title: `📖 ${clip(t || "Session recap", 240)}`, description: clip(m, 4000), color: COLORS.recap };
  }
  if (type === "test") {
    return { title: "✅ Onyx Dungeon connected", description: "This channel is now linked to your campaign. Reminders, recaps and announcements will appear here.", color: COLORS.test };
  }
  // announcement / default
  return { title: t ? clip(t, 240) : undefined, description: clip(m || "(no message)", 4000), color: COLORS.announce };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);

  let body: { campaignId?: string; type?: string; title?: string; message?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const campaignId = String(body.campaignId || "");
  const type = ["reminder", "recap", "announce", "test"].includes(String(body.type)) ? String(body.type) : "announce";
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  if (type !== "test" && !String(body.message || "").trim() && !String(body.title || "").trim()) {
    return json({ error: "Nothing to post" }, 400);
  }

  // Read the webhook with the caller's auth — RLS returns a row only to the
  // campaign's DM. No row → not connected, or not the DM.
  const { data: cfg, error: cfgErr } = await userClient
    .from("campaign_discord").select("webhook_url, enabled").eq("campaign_id", campaignId).maybeSingle();
  if (cfgErr) return json({ error: cfgErr.message }, 400);
  if (!cfg) return json({ error: "not-connected" }, 404);
  if (cfg.enabled === false && type !== "test") return json({ error: "Discord posting is turned off for this campaign" }, 409);
  if (!isDiscordWebhook(cfg.webhook_url)) return json({ error: "Stored webhook is not a valid Discord URL" }, 400);

  const payload = { username: "Onyx Dungeon", embeds: [buildEmbed(type, body.title || "", body.message || "")] };
  const res = await fetch(cfg.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // 401/404 from Discord almost always means the webhook was deleted/revoked
    if (res.status === 401 || res.status === 404) return json({ error: "webhook-invalid", detail }, 502);
    return json({ error: `Discord error ${res.status}`, detail }, 502);
  }
  return json({ ok: true });
});

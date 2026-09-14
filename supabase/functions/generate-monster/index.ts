// ─────────────────────────────────────────────────────────────
//  generate-monster — the ONLY thing that talks to the paid LLM
//  (Anthropic / Claude). Deployed as a Supabase Edge Function
//  (Deno). The ANTHROPIC_API_KEY lives in this function's secrets
//  and NEVER reaches the browser.
//
//  Flow (money-critical order — reserve BEFORE spending), the same
//  shape as generate-image:
//    1. Authenticate the caller from their JWT.
//    2. No ANTHROPIC_API_KEY → 501 {error:"not-configured"} BEFORE
//       reserving, so an unconfigured install never burns a slot.
//    3. ai_reserve_text(): the DB checks DM-ship + the monthly caps
//       ATOMICALLY and inserts a 'pending' row. A RAISE is forwarded
//       (429 for the cap messages) and NO paid call has happened.
//    4. Only now call Claude, forcing a single strict tool call so
//       the model must return a schema-valid stat block.
//    5. On any error → ai_fail_text() releases the slot (a failed
//       generation costs no quota) → 502. On success →
//       ai_complete_text() records the completed generation.
//    6. Return the stat block JSON to the browser, which shows it in
//       an editable form; the DM reviews, tweaks, and saves it
//       (a normal RLS insert into homebrew_monsters) — art is a
//       separate generate-image (kind:"portrait") call.
//
//  Model is swappable via the ANTHROPIC_MODEL secret (default
//  claude-opus-5). The model is asked (via the system prompt) to
//  return the stat block by calling the emit_monster tool; strict:true
//  guarantees the arguments validate against the schema.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// A stat block, described as a strict tool schema so Claude's output
// validates exactly (strict: true requires additionalProperties:false
// and every property listed in `required`; N/A fields come back as
// "" or []). Freeform strings for saves/skills/senses keep the shape
// small and read like a real stat block line.
const NAMED = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { name: { type: "string" }, text: { type: "string" } },
    required: ["name", "text"],
  },
};
const MONSTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    size: { type: "string", description: "Tiny | Small | Medium | Large | Huge | Gargantuan" },
    type: { type: "string", description: "creature type, e.g. 'beast', 'dragon', 'fiend (demon)'" },
    alignment: { type: "string" },
    ac: { type: "integer" },
    ac_note: { type: "string", description: "armor source, e.g. 'natural armor' (or '')" },
    hp: { type: "integer" },
    hp_dice: { type: "string", description: "e.g. '7d10 + 21'" },
    speed: { type: "string", description: "e.g. '30 ft., fly 60 ft.'" },
    str: { type: "integer" }, dex: { type: "integer" }, con: { type: "integer" },
    int: { type: "integer" }, wis: { type: "integer" }, cha: { type: "integer" },
    saves: { type: "string", description: "saving-throw line, e.g. 'Dex +5, Con +7' (or '')" },
    skills: { type: "string", description: "e.g. 'Perception +5, Stealth +6' (or '')" },
    damage_resistances: { type: "string" },
    damage_immunities: { type: "string" },
    condition_immunities: { type: "string" },
    senses: { type: "string", description: "e.g. 'darkvision 60 ft., passive Perception 13'" },
    languages: { type: "string", description: "e.g. 'Common, Draconic' or '—'" },
    cr: { type: "string", description: "challenge rating, e.g. '1/2', '5'" },
    traits: { ...NAMED, description: "passive/special traits" },
    actions: NAMED,
    reactions: NAMED,
    legendary: { ...NAMED, description: "legendary actions (usually empty for low CR)" },
    art_prompt: { type: "string", description: "one vivid sentence describing the creature's appearance, to seed portrait art" },
  },
  required: [
    "name", "size", "type", "alignment", "ac", "ac_note", "hp", "hp_dice", "speed",
    "str", "dex", "con", "int", "wis", "cha", "saves", "skills",
    "damage_resistances", "damage_immunities", "condition_immunities", "senses",
    "languages", "cr", "traits", "actions", "reactions", "legendary", "art_prompt",
  ],
};

const SYSTEM = [
  "You are an expert Dungeons & Dragons 5e (2014 SRD) monster designer.",
  "Given a short description, design ONE balanced, ready-to-run stat block.",
  "Match the requested challenge rating if one is given; otherwise choose a fitting CR.",
  "Keep ability scores, AC, HP, attack bonuses, save DCs, and damage internally consistent",
  "with the CR (use the DMG monster math). Write vivid but concise action text.",
  "Return the result by calling the emit_monster tool exactly once — never reply in prose.",
].join(" ");

function statusForDbError(msg: string): number {
  if (/monthly limit reached|monthly AI budget reached/i.test(msg)) return 429;
  if (/Only a DM|Must be signed in/i.test(msg)) return 403;
  if (/not configured/i.test(msg)) return 503;
  return 400;
}

async function callClaude(prompt: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("not-configured");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      output_config: { effort: "medium" },   // balanced cost/quality for a stat block
      system: SYSTEM,
      messages: [{ role: "user", content: `Design a D&D 5e monster: ${prompt}` }],
      tools: [{
        name: "emit_monster",
        description: "Return the finished, balanced stat block.",
        input_schema: MONSTER_SCHEMA,
        strict: true,           // guarantees the tool arguments validate against the schema
      }],
      // auto (not forced): thinking is on by default on Opus 5, and forced
      // tool_choice is incompatible with extended thinking. The system prompt
      // instructs the model to always call emit_monster; strict keeps it valid.
      tool_choice: { type: "auto" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try a different description.");
  const block = Array.isArray(data?.content)
    ? data.content.find((b: { type?: string }) => b.type === "tool_use")
    : null;
  const monster = block?.input;
  if (!monster || typeof monster !== "object") throw new Error("The model did not return a stat block. Try again.");
  return monster as Record<string, unknown>;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // 1. authenticate
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);

  // parse body
  let body: { campaignId?: string; prompt?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const campaignId = String(body.campaignId || "");
  const prompt = String(body.prompt || "").trim();
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  if (!prompt) return json({ error: "A description is required" }, 400);
  if (prompt.length > 2000) return json({ error: "Description is too long" }, 400);

  // 2. not configured? bail BEFORE reserving a slot.
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + caps) — no paid call yet.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_text", {
    p_campaign: campaignId,
    p_kind: "monster",
    p_prompt: prompt,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve a generation slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    // 4. paid call
    const monster = await callClaude(prompt);
    // 5. finalize the reservation
    const { error: doneErr } = await userClient.rpc("ai_complete_text", { p_id: id });
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);
    // 6. hand the draft back for review/edit (the browser saves it)
    return json({ ok: true, id, monster });
  } catch (e) {
    try { await userClient.rpc("ai_fail_text", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

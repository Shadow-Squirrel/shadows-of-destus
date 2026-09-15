// ─────────────────────────────────────────────────────────────
//  generate-monster — the ONLY thing that talks to the paid/free LLM.
//  Deployed as a Supabase Edge Function (Deno). Provider keys live in
//  this function's secrets and NEVER reach the browser.
//
//  Two providers, chosen by which secrets are set (Cloudflare wins if
//  both are present):
//    • Cloudflare Workers AI (FREE — no credit card): set CF_ACCOUNT_ID
//      + CF_API_TOKEN. Runs Llama 3.3 70B with JSON-schema output on the
//      free 10k-neurons/day tier. Default model overridable via CF_MODEL.
//    • Anthropic / Claude (paid, higher quality): set ANTHROPIC_API_KEY
//      (+ optional ANTHROPIC_MODEL, default claude-opus-5).
//
//  Flow (money-critical order — reserve BEFORE spending), same as
//  generate-image:
//    1. Authenticate the caller from their JWT.
//    2. No provider configured → 501 {error:"not-configured"} BEFORE
//       reserving, so an unconfigured install never burns a slot.
//    3. ai_reserve_text(): DB checks DM-ship + monthly caps ATOMICALLY,
//       inserts a 'pending' row. A RAISE is forwarded (429 for caps).
//    4. Call the model, asking for one schema-shaped stat block.
//    5. On error → ai_fail_text() releases the slot (failed = no quota) →
//       502. On success → ai_complete_text().
//    6. Return the stat block JSON; the browser shows it in an editable
//       form for the DM to review, tweak, and save.
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

// A stat block described as a JSON schema. N/A fields come back as "" or [].
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
    saves: { type: "string", description: "e.g. 'Dex +5, Con +7' (or '')" },
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
    art_prompt: { type: "string", description: "one vivid sentence describing the creature's appearance" },
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
  "Keep ability scores, AC, HP, attack bonuses, save DCs and damage internally consistent",
  "with the CR (use the DMG monster math). Write vivid but concise action text.",
].join(" ");

// Extra nudge for the JSON providers (Cloudflare): describe the exact shape.
const JSON_INSTRUCTION =
  " Respond with ONLY a single JSON object — no prose, no markdown fences — with these keys: " +
  "name, size, type, alignment, ac (integer), ac_note, hp (integer), hp_dice, speed, " +
  "str, dex, con, int, wis, cha (integers), saves, skills, damage_resistances, damage_immunities, " +
  "condition_immunities, senses, languages, cr, and traits/actions/reactions/legendary " +
  "(each an array of {name, text} objects — use [] if none), and art_prompt. " +
  "Use \"\" for any text field that doesn't apply.";

function statusForDbError(msg: string): number {
  if (/monthly limit reached|monthly AI budget reached/i.test(msg)) return 429;
  if (/Only a DM|Must be signed in/i.test(msg)) return 403;
  if (/not configured/i.test(msg)) return 503;
  return 400;
}

function extractJson(s: string): Record<string, unknown> | null {
  const cleaned = s.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

// ── provider: Cloudflare Workers AI (free tier) ──────────────
async function callCloudflare(prompt: string): Promise<Record<string, unknown>> {
  const acct = Deno.env.get("CF_ACCOUNT_ID");
  const token = Deno.env.get("CF_API_TOKEN");
  if (!acct || !token) throw new Error("not-configured");
  const model = Deno.env.get("CF_MODEL") || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM + JSON_INSTRUCTION },
          { role: "user", content: `Design a D&D 5e monster: ${prompt}` },
        ],
        max_tokens: 4096,
        response_format: { type: "json_schema", json_schema: MONSTER_SCHEMA },
      }),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare AI error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data?.success === false) {
    const msg = Array.isArray(data.errors) ? data.errors.map((e: { message?: string }) => e.message).join("; ") : "unknown error";
    throw new Error(`Cloudflare AI error: ${msg}`);
  }
  let out = data?.result?.response;
  if (typeof out === "string") out = extractJson(out);
  if (!out || typeof out !== "object") throw new Error("The model did not return a stat block. Try again.");
  return out as Record<string, unknown>;
}

// ── provider: Anthropic / Claude (paid) ──────────────────────
async function callClaude(prompt: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("not-configured");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: SYSTEM + " Return the result by calling the emit_monster tool exactly once — never reply in prose.",
      messages: [{ role: "user", content: `Design a D&D 5e monster: ${prompt}` }],
      tools: [{ name: "emit_monster", description: "Return the finished, balanced stat block.", input_schema: MONSTER_SCHEMA, strict: true }],
      tool_choice: { type: "auto" },  // forced tool choice is incompatible with Opus 5's default thinking
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try a different description.");
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b.type === "tool_use") : null;
  const monster = block?.input;
  if (!monster || typeof monster !== "object") throw new Error("The model did not return a stat block. Try again.");
  return monster as Record<string, unknown>;
}

function providerConfigured(): boolean {
  return (!!Deno.env.get("CF_ACCOUNT_ID") && !!Deno.env.get("CF_API_TOKEN")) || !!Deno.env.get("ANTHROPIC_API_KEY");
}
function generateMonster(prompt: string): Promise<Record<string, unknown>> {
  if (Deno.env.get("CF_ACCOUNT_ID") && Deno.env.get("CF_API_TOKEN")) return callCloudflare(prompt);
  if (Deno.env.get("ANTHROPIC_API_KEY")) return callClaude(prompt);
  return Promise.reject(new Error("not-configured"));
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

  // 2. not configured? bail BEFORE reserving.
  if (!providerConfigured()) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + caps) — no model call yet.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_text", {
    p_campaign: campaignId, p_kind: "monster", p_prompt: prompt,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve a generation slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    const monster = await generateMonster(prompt);           // 4. model call
    const { error: doneErr } = await userClient.rpc("ai_complete_text", { p_id: id });  // 5. finalize
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);
    return json({ ok: true, id, monster });                  // 6. hand the draft back
  } catch (e) {
    try { await userClient.rpc("ai_fail_text", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

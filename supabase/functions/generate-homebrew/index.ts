// ─────────────────────────────────────────────────────────────
//  generate-homebrew — one AI drafter for every homebrew editor.
//
//  Takes { campaignId, kind, prompt } and returns a schema-shaped
//  draft the matching editor understands. `kind` selects the schema
//  and the system prompt:
//    • "spell" → a custom-spell object (js/dnd/model.js shape)
//    • (items, feats, … slot in here later — add a SCHEMAS/SYSTEMS
//       entry; no new function, no new migration)
//
//  Deployed as a Supabase Edge Function (Deno). Provider keys live in
//  this function's secrets and NEVER reach the browser. Same two
//  providers as generate-monster (Cloudflare Workers AI — free — wins
//  if both are set; else Anthropic), and the SAME money-critical
//  order: reserve BEFORE spending, against the shared AI *text* budget
//  (ai_reserve_text / ai_complete_text / ai_fail_text). A failed draft
//  is marked 'failed' and never counts against quota.
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

// ── spell schema (matches the character model's custom-spell shape) ──
const SPELL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    level: { type: "integer", description: "0 for a cantrip, else 1-9" },
    school: { type: "string", description: "Abjuration | Conjuration | Divination | Enchantment | Evocation | Illusion | Necromancy | Transmutation" },
    time: { type: "string", description: "casting time, e.g. '1 action', '1 bonus action', '1 reaction'" },
    range: { type: "string", description: "e.g. '60 feet', 'Self', 'Touch'" },
    components: { type: "string", description: "e.g. 'V, S, M (a pinch of sulfur)'" },
    duration: { type: "string", description: "e.g. 'Instantaneous', 'Concentration, up to 1 minute'" },
    concentration: { type: "boolean" },
    ritual: { type: "boolean" },
    attack: { type: "boolean", description: "true if it requires a spell attack roll" },
    save: { type: "string", description: "'' if no save, else one of: str, dex, con, int, wis, cha" },
    dmg: { type: "string", description: "damage/healing dice at base level, e.g. '8d6' (or '' if none)" },
    dmgType: { type: "string", description: "e.g. 'fire', 'radiant', 'necrotic' (or '' if none)" },
    aoe_type: { type: "string", description: "'' or one of: sphere, cone, line, cube, cylinder — for the battle-map effect" },
    aoe_size: { type: "integer", description: "area size in feet (radius/length), or 0 if not an area spell" },
    higher: { type: "string", description: "the 'At Higher Levels' text, or '' " },
    desc: { type: "string", description: "the full rules text, 2-5 sentences" },
  },
  required: [
    "name", "level", "school", "time", "range", "components", "duration",
    "concentration", "ritual", "attack", "save", "dmg", "dmgType",
    "aoe_type", "aoe_size", "higher", "desc",
  ],
};

const SPELL_SYSTEM = [
  "You are an expert Dungeons & Dragons 5e (2014 SRD) spell designer.",
  "Given a short description, design ONE balanced, ready-to-play spell.",
  "Keep level, damage dice, save/attack and range internally consistent with 5e spell math",
  "(compare to SRD spells of the same level). Set aoe_type/aoe_size only for area spells,",
  "otherwise aoe_type '' and aoe_size 0. Use '' for any text field that doesn't apply, and",
  "choose a real school. Write vivid but concise rules text.",
].join(" ");

const SPELL_JSON_INSTRUCTION =
  " Respond with ONLY a single JSON object — no prose, no markdown fences — with these keys: " +
  "name, level (integer 0-9), school, time, range, components, duration, concentration (bool), " +
  "ritual (bool), attack (bool), save (''|str|dex|con|int|wis|cha), dmg, dmgType, aoe_type, " +
  "aoe_size (integer), higher, desc. Use \"\" for text that doesn't apply and 0 for aoe_size when not an area.";

const SCHEMAS: Record<string, { schema: unknown; system: string; jsonInstruction: string; noun: string }> = {
  spell: { schema: SPELL_SCHEMA, system: SPELL_SYSTEM, jsonInstruction: SPELL_JSON_INSTRUCTION, noun: "spell" },
};

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
async function callCloudflare(userMsg: string, schema: unknown, system: string): Promise<Record<string, unknown>> {
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
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        max_tokens: 3072,
        response_format: { type: "json_schema", json_schema: schema },
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
  if (!out || typeof out !== "object") throw new Error("The model did not return a draft. Try again.");
  return out as Record<string, unknown>;
}

// ── provider: Anthropic / Claude (paid) ──────────────────────
async function callClaude(userMsg: string, schema: unknown, system: string, noun: string): Promise<Record<string, unknown>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("not-configured");
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 6000,
      output_config: { effort: "medium" },
      system: system + ` Return the result by calling the emit_${noun} tool exactly once — never reply in prose.`,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ name: `emit_${noun}`, description: `Return the finished, balanced ${noun}.`, input_schema: schema, strict: true }],
      tool_choice: { type: "auto" },  // forced tool choice is incompatible with Opus 5's default thinking
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try a different description.");
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b.type === "tool_use") : null;
  const out = block?.input;
  if (!out || typeof out !== "object") throw new Error("The model did not return a draft. Try again.");
  return out as Record<string, unknown>;
}

function providerConfigured(): boolean {
  return (!!Deno.env.get("CF_ACCOUNT_ID") && !!Deno.env.get("CF_API_TOKEN")) || !!Deno.env.get("ANTHROPIC_API_KEY");
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
  let body: { campaignId?: string; kind?: string; prompt?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const campaignId = String(body.campaignId || "");
  const kind = String(body.kind || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  const cfg = SCHEMAS[kind];
  if (!cfg) return json({ error: `Unsupported kind: ${kind || "(none)"}` }, 400);
  if (!prompt) return json({ error: "A description is required" }, 400);
  if (prompt.length > 2000) return json({ error: "Description is too long" }, 400);

  // 2. not configured? bail BEFORE reserving.
  if (!providerConfigured()) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + shared text caps) — no model call yet.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_text", {
    p_campaign: campaignId, p_kind: kind, p_prompt: prompt,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve a generation slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    const userMsg = `Design a D&D 5e ${cfg.noun}: ${prompt}`;
    const result = (Deno.env.get("CF_ACCOUNT_ID") && Deno.env.get("CF_API_TOKEN"))
      ? await callCloudflare(userMsg, cfg.schema, cfg.system + cfg.jsonInstruction)
      : await callClaude(userMsg, cfg.schema, cfg.system, cfg.noun);
    const { error: doneErr } = await userClient.rpc("ai_complete_text", { p_id: id });
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);
    return json({ ok: true, id, kind, result });
  } catch (e) {
    try { await userClient.rpc("ai_fail_text", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

// ─────────────────────────────────────────────────────────────
//  plan-encounter — the "brain" of the AI DM-prep accelerator.
//  Turns a one-line scene description into a ready-to-run encounter
//  PLAN: a title, a battle-map art prompt, and a balanced monster
//  roster (drawn from the SRD catalogue the browser sends, so the
//  indices are real). The browser then orchestrates the rest —
//  creating the encounter, drawing the map (generate-image), pulling
//  or generating each monster, and dropping the tokens.
//
//  Deployed as a Supabase Edge Function (Deno). Provider keys live in
//  this function's secrets and NEVER reach the browser.
//
//  Same two providers as generate-monster (Cloudflare wins if both
//  are set), and the SAME money-critical order — reserve BEFORE
//  spending — reusing the AI *text* budget (kind "monster", the only
//  kind the ai_text_log check constraint allows, so no migration is
//  needed). One plan = one text slot; the map and any generated
//  homebrew monsters are billed by their own functions/caps as the
//  browser calls them.
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

// The plan the model returns, as a JSON schema.
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "a short, evocative encounter name" },
    summary: {
      type: "string",
      description: "1-2 sentences: the tactical situation and how the fight opens, for the DM",
    },
    map_prompt: {
      type: "string",
      description:
        "a vivid TOP-DOWN battle-map art prompt (the terrain, lighting, features) — no creatures, no text, no grid lines",
    },
    monsters: {
      type: "array",
      description: "the balanced roster for this fight",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "the creature's display name" },
          srd_index: {
            type: "string",
            description:
              "the EXACT index from the provided SRD catalogue if one fits, else \"\" to mark a custom creature",
          },
          count: { type: "integer", description: "how many of this creature (1-12)" },
          cr: { type: "string", description: "challenge rating, e.g. '1/4', '3'" },
          homebrew_prompt: {
            type: "string",
            description:
              "ONLY when srd_index is \"\" : a one-line description to generate the custom stat block (else \"\")",
          },
        },
        required: ["name", "srd_index", "count", "cr", "homebrew_prompt"],
      },
    },
  },
  required: ["title", "summary", "map_prompt", "monsters"],
};

function systemPrompt(catalogText: string): string {
  return [
    "You are an expert Dungeons & Dragons 5e (2014 SRD) Dungeon Master and encounter designer.",
    "Given a scene description and the party's size and level, design ONE balanced, ready-to-run combat encounter.",
    "Use the DMG encounter-building math: size the roster to the requested difficulty against the party's XP budget —",
    "err toward a fun, winnable fight, not a slaughter.",
    "PREFER creatures from this SRD catalogue and copy their index EXACTLY into srd_index (format 'index | Name | CR'):",
    catalogText,
    "Only when nothing in the catalogue fits the fiction, set srd_index to \"\" and write a short homebrew_prompt so a custom",
    "stat block can be generated; keep such custom creatures to a minimum. Choose sensible counts (a few weak minions, or a",
    "single strong foe). The map_prompt must read as a top-down battle map of the terrain only — never include creatures,",
    "labels, letters, or grid lines.",
  ].join(" ");
}

const JSON_INSTRUCTION =
  " Respond with ONLY a single JSON object — no prose, no markdown fences — with keys: " +
  "title, summary, map_prompt, and monsters (an array of {name, srd_index, count (integer), cr, homebrew_prompt}). " +
  "Use \"\" for srd_index only when no catalogue creature fits, and \"\" for homebrew_prompt otherwise.";

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
async function callCloudflare(userMsg: string, sys: string): Promise<Record<string, unknown>> {
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
          { role: "system", content: sys + JSON_INSTRUCTION },
          { role: "user", content: userMsg },
        ],
        max_tokens: 4096,
        response_format: { type: "json_schema", json_schema: PLAN_SCHEMA },
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
  if (!out || typeof out !== "object") throw new Error("The model did not return an encounter plan. Try again.");
  return out as Record<string, unknown>;
}

// ── provider: Anthropic / Claude (paid) ──────────────────────
async function callClaude(userMsg: string, sys: string): Promise<Record<string, unknown>> {
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
      system: sys + " Return the result by calling the emit_plan tool exactly once — never reply in prose.",
      messages: [{ role: "user", content: userMsg }],
      tools: [{ name: "emit_plan", description: "Return the finished, balanced encounter plan.", input_schema: PLAN_SCHEMA, strict: true }],
      tool_choice: { type: "auto" },  // forced tool choice is incompatible with Opus 5's default thinking
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try a different description.");
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b.type === "tool_use") : null;
  const plan = block?.input;
  if (!plan || typeof plan !== "object") throw new Error("The model did not return an encounter plan. Try again.");
  return plan as Record<string, unknown>;
}

function providerConfigured(): boolean {
  return (!!Deno.env.get("CF_ACCOUNT_ID") && !!Deno.env.get("CF_API_TOKEN")) || !!Deno.env.get("ANTHROPIC_API_KEY");
}
function generatePlan(userMsg: string, sys: string): Promise<Record<string, unknown>> {
  if (Deno.env.get("CF_ACCOUNT_ID") && Deno.env.get("CF_API_TOKEN")) return callCloudflare(userMsg, sys);
  if (Deno.env.get("ANTHROPIC_API_KEY")) return callClaude(userMsg, sys);
  return Promise.reject(new Error("not-configured"));
}

// Compact the SRD catalogue the browser sends into "index | Name | CR" lines,
// bounded so a malformed/huge payload can't blow up the prompt.
function catalogLines(srd: unknown): string {
  if (!Array.isArray(srd)) return "(no catalogue provided — choose well-known SRD creatures by their lowercase index)";
  const lines: string[] = [];
  for (const row of srd) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const i = String(r.i ?? r.index ?? "").trim();
    const n = String(r.n ?? r.name ?? "").trim();
    if (!i || !n) continue;
    const cr = String(r.cr ?? "").trim();
    lines.push(`${i} | ${n}${cr ? ` | CR ${cr}` : ""}`);
    if (lines.length >= 400) break;
  }
  return lines.length ? lines.join("\n") : "(catalogue empty)";
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
  let body: {
    campaignId?: string; description?: string;
    partyLevel?: number; partySize?: number; difficulty?: string; srd?: unknown;
  };
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const campaignId = String(body.campaignId || "");
  const description = String(body.description || "").trim();
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  if (!description) return json({ error: "A description is required" }, 400);
  if (description.length > 2000) return json({ error: "Description is too long" }, 400);
  const partyLevel = Math.max(1, Math.min(20, Math.round(Number(body.partyLevel) || 3)));
  const partySize = Math.max(1, Math.min(10, Math.round(Number(body.partySize) || 4)));
  const difficulty = ["easy", "medium", "hard", "deadly"].includes(String(body.difficulty))
    ? String(body.difficulty) : "medium";

  // 2. not configured? bail BEFORE reserving.
  if (!providerConfigured()) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + caps) — no model call yet. Kind "monster"
  //    is the only kind the ai_text budget allows; a plan spends one such slot.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_text", {
    p_campaign: campaignId, p_kind: "monster", p_prompt: `[encounter] ${description}`,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve a generation slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    const sys = systemPrompt(catalogLines(body.srd));
    const userMsg =
      `Party: ${partySize} adventurers of level ${partyLevel}. Target difficulty: ${difficulty}.\n` +
      `Scene: ${description}`;
    const plan = await generatePlan(userMsg, sys);      // 4. model call
    const { error: doneErr } = await userClient.rpc("ai_complete_text", { p_id: id });  // 5. finalize
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);
    return json({ ok: true, id, plan });                // 6. hand the plan back
  } catch (e) {
    try { await userClient.rpc("ai_fail_text", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

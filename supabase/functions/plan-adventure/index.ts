// ─────────────────────────────────────────────────────────────
//  plan-adventure — the "brain" of the AI Create-Adventure feature.
//  Turns a one-paragraph brief into a full, ready-to-run ADVENTURE:
//  a named location, an ordered set of scenes (combat / puzzle /
//  social / exploration) each with BOXED READ-ALOUD text and DM notes,
//  a cast of NPCs (with a secret + voice + sample lines), suggested
//  treasure, and an XP/difficulty budget note. Combat scenes carry a
//  balanced monster roster drawn from the SRD catalogue the browser
//  sends (so the indices are real) — the SAME roster shape the ⚡ AI-prep
//  accelerator (plan-encounter) already stages onto the Battle map.
//
//  Deployed as a Supabase Edge Function (Deno). Provider keys live in
//  this function's secrets and NEVER reach the browser.
//
//  Same two providers as plan-encounter / generate-monster (Cloudflare
//  wins if both are set), and the SAME money-critical order — reserve
//  BEFORE spending — reusing the AI *text* budget (kind "monster", the
//  kind the ai_text_log check already allows, so no migration is
//  needed). One adventure = one text slot; any battle maps and any
//  generated homebrew monsters are billed by their own functions/caps
//  as the browser stages each combat scene later.
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

// The monster roster shape — identical to plan-encounter, so a combat
// scene hands straight to the Battle-map builder the browser already has.
const ROSTER = {
  type: "array",
  description: "for a combat scene: the balanced roster; [] for non-combat scenes",
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
};

// The adventure the model returns, as a JSON schema.
const ADVENTURE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "an evocative adventure title" },
    location: { type: "string", description: "the named place it happens, e.g. 'The Sunken Abbey of Vol'" },
    overview: {
      type: "string",
      description: "2-4 sentences for the DM: the hook, the stakes, and what's really going on",
    },
    xp_budget: {
      type: "string",
      description:
        "one line on difficulty & pacing for this party size/level (DMG XP-budget framing), e.g. 'Tuned Hard for 4 level-5 heroes; the boss is Deadly if the acolytes survive.'",
    },
    scenes: {
      type: "array",
      description: "the ordered scenes the party moves through (3-6)",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "a short scene name" },
          kind: {
            type: "string",
            description: "one of: combat | puzzle | social | exploration",
          },
          boss: { type: "boolean", description: "true for the single climactic boss scene" },
          read_aloud: {
            type: "string",
            description: "boxed text to read aloud to the players when they enter the scene (2-5 sentences, second person, evocative)",
          },
          dm_notes: {
            type: "string",
            description: "private DM guidance: tactics, how it can go, skill DCs, what unlocks the next scene",
          },
          monsters: ROSTER,
          puzzle: {
            type: "string",
            description: "ONLY for a puzzle scene: the puzzle, its solution, and a hint (else \"\")",
          },
          treasure: {
            type: "string",
            description: "the reward found or earned here (gold, items, information) — or \"\" if none",
          },
        },
        required: ["title", "kind", "boss", "read_aloud", "dm_notes", "monsters", "puzzle", "treasure"],
      },
    },
    npcs: {
      type: "array",
      description: "the key NPCs, each with a secret and a voice",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "who they are, e.g. 'cult quartermaster', 'frightened miner'" },
          personality: { type: "string", description: "a phrase or two of manner + motive" },
          secret: { type: "string", description: "what they're hiding (for the DM)" },
          voice: { type: "string", description: "how to play their voice/mannerism at the table" },
          lines: { type: "array", description: "2-3 sample lines of dialogue in their voice", items: { type: "string" } },
        },
        required: ["name", "role", "personality", "secret", "voice", "lines"],
      },
    },
    treasure_overall: {
      type: "string",
      description: "the total suggested reward for finishing the adventure (level-appropriate hoard + any signature item)",
    },
  },
  required: ["title", "location", "overview", "xp_budget", "scenes", "npcs", "treasure_overall"],
};

function systemPrompt(catalogText: string): string {
  return [
    "You are an expert Dungeons & Dragons 5e (2014 SRD) Dungeon Master and adventure designer.",
    "Your job is to REMOVE the boring prep for a busy DM — you do NOT play the game for them; everything you write is a draft they will edit and run.",
    "Given a brief and the party's size and level, design ONE cohesive, ready-to-run adventure: a named location, an ordered set of scenes,",
    "a mix of combat, a puzzle or a social scene where they fit the fiction, and exactly ONE climactic BOSS scene (set boss:true on it, boss:false on the rest).",
    "Every scene gets vivid second-person BOXED read-aloud text and private DM notes (tactics, skill DCs, what opens the next scene).",
    "Size combat with the DMG encounter-building math against the party's XP budget — fun and winnable, not a slaughter; the boss can be a notch harder.",
    "For each combat scene's roster PREFER creatures from this SRD catalogue and copy their index EXACTLY into srd_index (format 'index | Name | CR'):",
    catalogText,
    "Only when nothing in the catalogue fits the fiction, set srd_index to \"\" and write a short homebrew_prompt so a custom stat block can be generated;",
    "keep such custom creatures to a minimum. Non-combat scenes have monsters:[]. Give a puzzle scene its puzzle+solution+hint in `puzzle` (else \"\").",
    "Write 2-3 memorable NPCs, each with a real SECRET and a playable VOICE. Suggest level-appropriate treasure per scene and overall.",
  ].join(" ");
}

const JSON_INSTRUCTION =
  " Respond with ONLY a single JSON object — no prose, no markdown fences — matching the adventure schema exactly: " +
  "keys title, location, overview, xp_budget, scenes (array of {title, kind, boss, read_aloud, dm_notes, monsters, puzzle, treasure}), " +
  "npcs (array of {name, role, personality, secret, voice, lines}), and treasure_overall. " +
  "kind is one of combat|puzzle|social|exploration. Use \"\" for srd_index only when no catalogue creature fits, and \"\" for homebrew_prompt otherwise. " +
  "Exactly one scene has boss:true. Non-combat scenes have monsters:[].";

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
        max_tokens: 8192,
        response_format: { type: "json_schema", json_schema: ADVENTURE_SCHEMA },
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
  if (!out || typeof out !== "object") throw new Error("The model did not return an adventure. Try again.");
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
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: sys + " Return the result by calling the emit_adventure tool exactly once — never reply in prose.",
      messages: [{ role: "user", content: userMsg }],
      tools: [{ name: "emit_adventure", description: "Return the finished, ready-to-run adventure.", input_schema: ADVENTURE_SCHEMA, strict: true }],
      tool_choice: { type: "auto" },  // forced tool choice is incompatible with Opus 5's default thinking
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try a different brief.");
  const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b.type === "tool_use") : null;
  const adv = block?.input;
  if (!adv || typeof adv !== "object") throw new Error("The model did not return an adventure. Try again.");
  return adv as Record<string, unknown>;
}

function providerConfigured(): boolean {
  return (!!Deno.env.get("CF_ACCOUNT_ID") && !!Deno.env.get("CF_API_TOKEN")) || !!Deno.env.get("ANTHROPIC_API_KEY");
}
function generateAdventure(userMsg: string, sys: string): Promise<Record<string, unknown>> {
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
    campaignId?: string; brief?: string;
    partyLevel?: number; partySize?: number; difficulty?: string;
    scenes?: number; srd?: unknown;
  };
  try { body = await req.json(); } catch { return json({ error: "Bad request body" }, 400); }
  const campaignId = String(body.campaignId || "");
  const brief = String(body.brief || "").trim();
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  if (!brief) return json({ error: "A brief is required" }, 400);
  if (brief.length > 3000) return json({ error: "Brief is too long" }, 400);
  const partyLevel = Math.max(1, Math.min(20, Math.round(Number(body.partyLevel) || 3)));
  const partySize = Math.max(1, Math.min(10, Math.round(Number(body.partySize) || 4)));
  const difficulty = ["easy", "medium", "hard", "deadly"].includes(String(body.difficulty))
    ? String(body.difficulty) : "medium";
  const scenes = Math.max(2, Math.min(6, Math.round(Number(body.scenes) || 3)));

  // 2. not configured? bail BEFORE reserving.
  if (!providerConfigured()) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + caps) — no model call yet. Kind "monster"
  //    is the kind the ai_text budget allows; an adventure spends one such slot.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_text", {
    p_campaign: campaignId, p_kind: "monster", p_prompt: `[adventure] ${brief}`,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve a generation slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    const sys = systemPrompt(catalogLines(body.srd));
    const userMsg =
      `Party: ${partySize} adventurers of level ${partyLevel}. Target difficulty: ${difficulty}. ` +
      `Aim for about ${scenes} scenes (one of them the boss).\n` +
      `Brief: ${brief}`;
    const adventure = await generateAdventure(userMsg, sys);   // 4. model call
    const { error: doneErr } = await userClient.rpc("ai_complete_text", { p_id: id });  // 5. finalize
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);
    return json({ ok: true, id, adventure });                  // 6. hand the adventure back
  } catch (e) {
    try { await userClient.rpc("ai_fail_text", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

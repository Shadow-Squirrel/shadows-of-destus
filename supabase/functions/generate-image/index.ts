// ─────────────────────────────────────────────────────────────
//  generate-image — the ONLY thing that talks to the paid image
//  provider. Deployed as a Supabase Edge Function (Deno). The
//  provider API key lives in this function's secrets and NEVER
//  reaches the browser.
//
//  Flow (money-critical order — reserve BEFORE spending):
//    1. Authenticate the caller from their JWT.
//    2. If no provider is configured → 501 {error:"not-configured"}
//       (the UI shows a friendly "set up AI generation" note). We
//       do this BEFORE reserving so an unconfigured install never
//       burns a slot.
//    3. ai_reserve_image(): the DB checks DM-ship + the monthly
//       caps ATOMICALLY and inserts a 'pending' row. If it RAISEs,
//       we forward the message (429 for the cap messages) and have
//       NOT called the paid API.
//    4. Only now call FLUX.1 [schnell] at the provider.
//    5. Fetch the produced image and upload it to private Storage
//       with the SERVICE ROLE (the browser cannot write there).
//    6. On any provider/upload error → ai_fail_image() so the slot
//       is released (a failed generation costs no quota) → 502.
//       On success → ai_complete_image() records the storage path.
//    7. For a map, also insert a campaign-scoped `maps` row (as the
//       DM) so it appears on the Maps page and the VTT picker.
//
//  Provider is swappable by the IMAGE_PROVIDER secret ('fal' |
//  'replicate'); the key is FAL_KEY / REPLICATE_API_TOKEN.
//  Hugging Face is a documented future option, not implemented.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Kind = "map" | "portrait";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// FLUX.1 [schnell] is a 4-step "turbo" model — pin the steps low.
const STEPS = 4;

// ── provider: fal.ai (default) ───────────────────────────────
// POST https://fal.run/<model-id>, "Authorization: Key <FAL_KEY>".
// Sync endpoint: blocks until the image is ready, returns
// { images: [{ url, content_type, ... }], ... }.
async function generateFal(prompt: string, kind: Kind): Promise<string> {
  const key = Deno.env.get("FAL_KEY");
  if (!key) throw new Error("not-configured");
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      num_inference_steps: STEPS,
      image_size: kind === "map" ? "landscape_16_9" : "portrait_4_3",
      num_images: 1,
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`fal.ai error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image");
  return url as string;
}

// ── provider: Replicate ──────────────────────────────────────
// POST https://api.replicate.com/v1/models/black-forest-labs/
//   flux-schnell/predictions with "Authorization: Bearer <token>"
// and "Prefer: wait" for a (near-)synchronous response. Output is
// an array of image URLs. If the wait window lapses, poll the
// prediction until it settles.
async function generateReplicate(prompt: string, kind: Kind): Promise<string> {
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) throw new Error("not-configured");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  };
  const res = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: {
          prompt,
          num_inference_steps: STEPS,
          aspect_ratio: kind === "map" ? "16:9" : "3:4",
          output_format: "webp",
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Replicate error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  let pred = await res.json();
  // Poll if "Prefer: wait" returned before completion.
  let tries = 0;
  while (
    pred?.status && pred.status !== "succeeded" && pred.status !== "failed" &&
    pred.status !== "canceled" && tries < 30
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(pred.urls?.get, { headers });
    if (!poll.ok) break;
    pred = await poll.json();
    tries++;
  }
  if (pred?.status !== "succeeded") {
    throw new Error(`Replicate did not succeed: ${pred?.status ?? "unknown"} ${pred?.error ?? ""}`);
  }
  const out = pred.output;
  const url = Array.isArray(out) ? out[0] : out;
  if (!url || typeof url !== "string") throw new Error("Replicate returned no image");
  return url;
}

function providerConfigured(): boolean {
  const p = (Deno.env.get("IMAGE_PROVIDER") || "fal").toLowerCase();
  if (p === "replicate") return !!Deno.env.get("REPLICATE_API_TOKEN");
  return !!Deno.env.get("FAL_KEY");
}

function generate(prompt: string, kind: Kind): Promise<string> {
  const p = (Deno.env.get("IMAGE_PROVIDER") || "fal").toLowerCase();
  if (p === "replicate") return generateReplicate(prompt, kind);
  if (p === "fal") return generateFal(prompt, kind);
  throw new Error(`Unknown IMAGE_PROVIDER "${p}" (expected 'fal' or 'replicate')`);
}

function extFor(contentType: string | null): string {
  const t = (contentType || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  return "jpg";
}

// Map the DB's RAISE messages onto clean HTTP statuses.
function statusForDbError(msg: string): number {
  if (/monthly limit reached|monthly AI budget reached/i.test(msg)) return 429;
  if (/Only a DM|Must be signed in/i.test(msg)) return 403;
  if (/not configured/i.test(msg)) return 503;
  return 400;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // The caller's Authorization header carries their JWT (attached by
  // supabase.functions.invoke). We run all authorization-bearing DB
  // work AS THE USER so my_email()/is_campaign_dm() resolve.
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  // Service role is used only to WRITE the image file into private
  // Storage (the browser and even the authenticated user cannot).
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false },
  });

  // 1. authenticate
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);

  // parse body
  let body: { campaignId?: string; kind?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request body" }, 400);
  }
  const campaignId = String(body.campaignId || "");
  const kind = String(body.kind || "") as Kind;
  const prompt = String(body.prompt || "").trim();
  if (!campaignId) return json({ error: "Missing campaignId" }, 400);
  if (kind !== "map" && kind !== "portrait") return json({ error: "kind must be 'map' or 'portrait'" }, 400);
  if (!prompt) return json({ error: "A prompt is required" }, 400);
  if (prompt.length > 2000) return json({ error: "Prompt is too long" }, 400);

  // 2. not configured? bail BEFORE reserving a slot.
  if (!providerConfigured()) return json({ error: "not-configured" }, 501);

  // 3. reserve atomically (DM-ship + caps) — no paid call yet.
  const { data: reserveId, error: reserveErr } = await userClient.rpc("ai_reserve_image", {
    p_campaign: campaignId,
    p_kind: kind,
    p_prompt: prompt,
  });
  if (reserveErr) {
    const msg = reserveErr.message || "Could not reserve an image slot";
    return json({ error: msg }, statusForDbError(msg));
  }
  const id = reserveId as string;

  try {
    // 4. paid call
    const imageUrl = await generate(prompt, kind);

    // 5. fetch the produced image + upload with the service role
    const img = await fetch(imageUrl);
    if (!img.ok) throw new Error(`Could not fetch generated image (${img.status})`);
    const contentType = img.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(await img.arrayBuffer());
    const ext = extFor(contentType);

    // Portraits → private 'ai-art' bucket (readable by all campaign
    // members). Maps → existing 'maps' bucket, which is reveal-gated
    // so an un-revealed battle map stays hidden from players.
    const bucket = kind === "map" ? "maps" : "ai-art";
    const path = kind === "map"
      ? `${campaignId}/ai-${id}.${ext}`
      : `${campaignId}/${id}.${ext}`;

    const up = await admin.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert: true,
    });
    if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);

    // 6/7. finalize the reservation + create the map row if needed
    const { error: doneErr } = await userClient.rpc("ai_complete_image", {
      p_id: id,
      p_path: path,
    });
    if (doneErr) throw new Error(`Could not finalize reservation: ${doneErr.message}`);

    let mapId: string | null = null;
    if (kind === "map") {
      const title = prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "AI battle map";
      const { data: mapRow, error: mapErr } = await userClient
        .from("maps")
        .insert({
          campaign_id: campaignId,
          title,
          category: "battle",
          storage_path: path,
          image_url: "",
          description: "Generated with AI.",
          revealed: false,
          sort_order: 100,
        })
        .select("id")
        .single();
      if (mapErr) throw new Error(`Map created but could not be recorded: ${mapErr.message}`);
      mapId = mapRow?.id ?? null;
    }

    // a viewable, short-lived URL for the caller
    const signed = await admin.storage.from(bucket).createSignedUrl(path, 3600);

    return json({
      ok: true,
      id,
      kind,
      bucket,
      path,
      url: signed.data?.signedUrl ?? null,
      mapId,
    });
  } catch (e) {
    // release the slot so a failed generation costs no quota (best-effort)
    try { await userClient.rpc("ai_fail_image", { p_id: id }); } catch (_) { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not-configured") return json({ error: "not-configured" }, 501);
    return json({ error: msg }, 502);
  }
});

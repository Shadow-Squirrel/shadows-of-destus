// ─────────────────────────────────────────────────────────────
//  stripe-webhook — the ONLY writer of billing state. Stripe calls this
//  server-to-server when a subscription is created, renewed, changed or
//  cancelled; we verify Stripe's signature, record the event once, and
//  grant or revoke the "Dungeon Lord" seat (campaign_creators) through
//  the service-role-only RPCs. The browser never calls this and it
//  carries no Supabase JWT (config.toml: verify_jwt = false) — the
//  Stripe-Signature header IS the authentication.
//
//  Order of operations (each step guards the next):
//    1. Secrets missing → 501 (nothing to verify against; Stripe retries
//       later, harmlessly).
//    2. Read the RAW body (req.text(), never req.json() first — the
//       signature covers the exact bytes) and verify Stripe-Signature:
//       HMAC-SHA256 over `${t}.${raw}`, constant-time compared against
//       EVERY v1 (Stripe sends several while rotating secrets); the
//       timestamp must be within 5 minutes (replay guard). Bad → 400.
//    3. Idempotency: INSERT the event id into stripe_events. A duplicate
//       delivery hits the primary key → 200 {duplicate:true}, no re-run.
//    4. Handle the event. If any DB write / RPC fails AFTER the claim we
//       DELETE the claim and return 500, so Stripe's retry is processed
//       rather than swallowed as a duplicate.
//
//  Handled: checkout.session.completed (subscription mode) and
//  customer.subscription.{created,updated,deleted}. Anything else is
//  acknowledged and ignored. Stripe does not guarantee event ORDER, so
//  every handler upserts the row from what it has rather than assuming
//  a previous event arrived first.
//
//  Stripe API ≥ 2025-03-31 moved current_period_end from the
//  subscription onto its items; older versions keep it top-level. We
//  read either, so the account's API version doesn't matter.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// No CORS: browsers never call this.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STRIPE_API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;
const GRANT_STATUSES = new Set(["active", "trialing"]);
const REVOKE_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);
const enc = new TextEncoder();

// deno-lint-ignore no-explicit-any
type Json = any;
type Admin = ReturnType<typeof createClient>;

const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
// Stripe expands some ids into objects depending on the API version.
const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : (typeof (v as Json)?.id === "string" ? (v as Json).id : null);

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Constant-time equality — a timing leak here would let an attacker forge
// a signature byte by byte.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>…]". Returns null when
// valid, else a short reason (logged, never echoed to the caller in detail).
async function verifySignature(raw: string, header: string | null, secret: string): Promise<string | null> {
  if (!header) return "missing Stripe-Signature";
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v.toLowerCase());
  }
  if (!/^\d+$/.test(t) || sigs.length === 0) return "malformed Stripe-Signature";
  if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) return "timestamp outside tolerance";
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`)));
  // check every v1; accept if any matches (never short-circuit on a miss)
  let ok = false;
  for (const s of sigs) if (safeEqual(expected, s)) ok = true;
  return ok ? null : "signature mismatch";
}

// unix seconds → ISO, from wherever this API version puts it
function periodEnd(sub: Json): string | null {
  const unix = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? null;
  return typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;
}

async function stripeGet(path: string, key: string): Promise<Json> {
  const res = await fetch(`${STRIPE_API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${String(data?.error?.message || "").slice(0, 200)}`);
  return data;
}

type SubRow = {
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};
async function saveSub(admin: Admin, row: SubRow): Promise<void> {
  const { error } = await admin.from("subscriptions").upsert(row, { onConflict: "email" });
  if (error) throw new Error(`subscriptions upsert: ${error.message}`);
}

// Flip the seat to match a Stripe status. past_due / incomplete / paused
// change nothing: Stripe is still deciding, and a paying customer in a
// dunning window must not lose their DM tools over a card hiccup.
async function setSeat(admin: Admin, email: string, status: string): Promise<string> {
  if (GRANT_STATUSES.has(status)) {
    const { error } = await admin.rpc("grant_campaign_creator", { p_email: email, p_source: "stripe" });
    if (error) throw new Error(`grant_campaign_creator: ${error.message}`);
    return "granted";
  }
  if (REVOKE_STATUSES.has(status)) {
    const { error } = await admin.rpc("revoke_campaign_creator", { p_email: email });
    if (error) throw new Error(`revoke_campaign_creator: ${error.message}`);
    return "revoked";
  }
  return "unchanged";
}

// Which account does this Stripe subscription belong to? Our own metadata
// first (set at checkout), then the row that already knows this customer.
async function emailForSubscription(admin: Admin, sub: Json): Promise<string> {
  const fromMeta = lower(sub?.metadata?.email);
  if (fromMeta) return fromMeta;
  const customer = idOf(sub?.customer);
  if (!customer) return "";
  const { data, error } = await admin
    .from("subscriptions").select("email").eq("stripe_customer_id", customer).maybeSingle();
  if (error) throw new Error(`subscriptions lookup: ${error.message}`);
  return lower(data?.email);
}

// Returns a one-line summary for the log; throws to make Stripe retry.
async function handle(event: Json, admin: Admin, key: string): Promise<string> {
  const obj = event?.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return "ignored (not a subscription checkout)";
      // our metadata is the account email; Stripe's customer email is the fallback
      let email = lower(obj.metadata?.email) || lower(obj.customer_details?.email) || lower(obj.customer_email);
      if (!email && typeof obj.client_reference_id === "string") {
        // last resort: client_reference_id is the Supabase user id
        const { data } = await admin.auth.admin.getUserById(obj.client_reference_id);
        email = lower(data?.user?.email);
      }
      const subId = idOf(obj.subscription);
      if (!email) throw new Error("checkout session has no email");
      if (!subId) throw new Error("checkout session has no subscription");
      const sub = await stripeGet(`/subscriptions/${subId}`, key);   // status, period end, cancel flag
      const status = String(sub.status || "incomplete");
      await saveSub(admin, {
        email,
        stripe_customer_id: idOf(obj.customer) ?? idOf(sub.customer),
        stripe_subscription_id: subId,
        status,
        current_period_end: periodEnd(sub),
        cancel_at_period_end: !!sub.cancel_at_period_end,
      });
      return `${status} → seat ${await setSeat(admin, email, status)}`;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const email = await emailForSubscription(admin, obj);
      if (!email) return "ignored (no matching account)";
      const subId = typeof obj.id === "string" ? obj.id : null;
      // Stripe doesn't guarantee order: a late or retried "active" update must
      // not undo a later cancellation. Read the LIVE object and trust it over
      // the event payload; fall back to the payload only if Stripe is unreachable.
      const live = subId && event.type !== "customer.subscription.deleted"
        ? await stripeGet(`/subscriptions/${subId}`, key).catch(() => null)
        : null;
      const src = live ?? obj;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : String(src.status || "incomplete");
      // A dashboard "cancel and replace" ends an OLD subscription while a
      // NEW one is already live for the same account — don't let the old
      // one's ending revoke the seat the new one just paid for.
      if (!GRANT_STATUSES.has(status)) {
        const { data: cur, error } = await admin
          .from("subscriptions").select("stripe_subscription_id, status").eq("email", email).maybeSingle();
        if (error) throw new Error(`subscriptions lookup: ${error.message}`);
        if (cur?.stripe_subscription_id && subId && cur.stripe_subscription_id !== subId && GRANT_STATUSES.has(cur.status)) {
          return `ignored (stale subscription; ${cur.stripe_subscription_id} is current)`;
        }
      }
      await saveSub(admin, {
        email,
        stripe_customer_id: idOf(src.customer) ?? idOf(obj.customer),
        stripe_subscription_id: subId,
        status,
        current_period_end: periodEnd(src),
        cancel_at_period_end: !!src.cancel_at_period_end,
      });
      return `${status} → seat ${await setSeat(admin, email, status)}`;
    }

    default:
      return "ignored";
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. secrets — nothing to verify against without them
  const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!WEBHOOK_SECRET || !KEY) return json({ error: "not-configured" }, 501);

  // 2. raw body + signature
  const raw = await req.text();
  const bad = await verifySignature(raw, req.headers.get("Stripe-Signature"), WEBHOOK_SECRET);
  if (bad) {
    console.log(`stripe-webhook: rejected — ${bad}`);
    return json({ error: "bad signature" }, 400);
  }
  let event: Json;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad JSON" }, 400); }
  const id = typeof event?.id === "string" ? event.id : "";
  const type = typeof event?.type === "string" ? event.type : "";
  if (!id || !type) return json({ error: "Not a Stripe event" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // 3. idempotency claim
  const { error: claimErr } = await admin.from("stripe_events").insert({ id, type });
  if (claimErr) {
    if (claimErr.code === "23505" || /duplicate key/i.test(claimErr.message || "")) {
      return json({ received: true, duplicate: true });
    }
    console.log(`stripe-webhook: could not claim ${id}: ${claimErr.message}`);
    return json({ error: "ledger write failed" }, 500);
  }

  // 4. do the work; on failure release the claim so the retry is processed
  try {
    const note = await handle(event, admin, KEY);
    console.log(`stripe-webhook: ${type} ${id} — ${note}`);
    return json(note.startsWith("ignored") ? { received: true, ignored: type } : { received: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`stripe-webhook: ${type} ${id} FAILED — ${msg}`);
    await admin.from("stripe_events").delete().eq("id", id);
    return json({ error: "processing failed" }, 500);
  }
});

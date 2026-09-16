// ─────────────────────────────────────────────────────────────
//  billing-portal — mints a Stripe Customer Portal URL so a subscriber
//  can cancel, change their card, or download invoices on Stripe's
//  hosted page. Same shape as create-checkout-session: authenticate,
//  bail if Stripe isn't configured, look up the caller's Stripe customer
//  (service role — the table is read-only to users), ask Stripe, return
//  { url } for the browser to redirect to.
//
//  404 {error:"no-subscription"} when this email has never checked out
//  (there is no Stripe customer to open a portal for).
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

const STRIPE_API = "https://api.stripe.com/v1";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
  const email = String(userData.user.email || "").trim().toLowerCase();
  if (!email) return json({ error: "Your account has no email address" }, 400);

  const KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!KEY) return json({ error: "not-configured" }, 501);
  const SITE_URL = (Deno.env.get("SITE_URL") || "https://onyxdungeon.com").replace(/\/+$/, "");

  // The portal needs a Stripe customer; we only have one once they've
  // been through Checkout (the webhook records it).
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: sub, error: subErr } = await admin
    .from("subscriptions").select("stripe_customer_id").eq("email", email).maybeSingle();
  if (subErr) return json({ error: subErr.message }, 500);
  if (!sub?.stripe_customer_id) return json({ error: "no-subscription" }, 404);

  const form = new URLSearchParams();
  form.set("customer", sub.stripe_customer_id);
  form.set("return_url", `${SITE_URL}/profile.html`);

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch {
    return json({ error: "Could not reach Stripe" }, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.url !== "string") {
    const msg = String(data?.error?.message || `Stripe error ${res.status}`).slice(0, 200);
    console.log(`billing-portal: Stripe ${res.status} — ${msg}`);
    return json({ error: msg }, 502);
  }
  return json({ url: data.url });
});

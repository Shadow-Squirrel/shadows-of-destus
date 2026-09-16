// ─────────────────────────────────────────────────────────────
//  create-checkout-session — mints a Stripe Checkout URL for the
//  "Dungeon Lord" subscription and hands it to the browser, which simply
//  redirects there. The Stripe secret key lives in this function's
//  secrets and NEVER reaches the browser; no card data ever touches our
//  code (Stripe hosts the payment page — PCI SAQ A).
//
//  Flow:
//    1. Authenticate the caller from their JWT → 401 if not signed in.
//    2. Stripe not configured → 501 {error:"not-configured"} BEFORE any
//       side effect (the pricing page then shows "coming soon").
//    3. Email already has an active/trialing subscription →
//       409 {error:"already-subscribed"} (manage it in the portal instead).
//    4. POST /v1/checkout/sessions (form-encoded, raw fetch — no SDK),
//       tagging BOTH the session and the subscription-to-be with the
//       buyer's account email so the webhook can map Stripe's objects
//       back to campaign_creators.
//    5. Return { url }.
//
//  The seat itself is granted by the stripe-webhook function once Stripe
//  confirms payment — never here, never by the browser.
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

  // 1. who is asking? (their JWT, attached by supabase.functions.invoke)
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
  const email = String(userData.user.email || "").trim().toLowerCase();
  if (!email) return json({ error: "Your account has no email address" }, 400);

  // 2. not configured? say so before touching anything.
  const KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const PRICE = Deno.env.get("STRIPE_PRICE_DM");
  if (!KEY || !PRICE) return json({ error: "not-configured" }, 501);
  const SITE_URL = (Deno.env.get("SITE_URL") || "https://onyxdungeon.com").replace(/\/+$/, "");

  // 3. already paying? `subscriptions` is written only by the webhook, so
  //    read it with the service role (one code path, no RLS surprises).
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: sub, error: subErr } = await admin
    .from("subscriptions").select("stripe_customer_id, status").eq("email", email).maybeSingle();
  if (subErr) return json({ error: subErr.message }, 500);
  if (sub && (sub.status === "active" || sub.status === "trialing")) {
    return json({ error: "already-subscribed" }, 409);
  }

  // 4. ask Stripe for a hosted Checkout page
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", PRICE);
  form.set("line_items[0][quantity]", "1");
  // client_reference_id only allows [A-Za-z0-9_-] (Stripe silently drops
  // anything else), so it carries the user id; the EMAIL — the key
  // campaign_creators is keyed on — rides in metadata on both objects.
  form.set("client_reference_id", userData.user.id);
  form.set("metadata[email]", email);
  form.set("subscription_data[metadata][email]", email);
  form.set("allow_promotion_codes", "true");
  form.set("success_url", `${SITE_URL}/pricing.html?checkout=success`);
  form.set("cancel_url", `${SITE_URL}/pricing.html?checkout=cancelled`);
  // Re-use the Stripe customer we already know for this email (a lapsed
  // subscriber coming back) so invoices and the portal stay in one place.
  if (sub?.stripe_customer_id) form.set("customer", sub.stripe_customer_id);
  else form.set("customer_email", email);

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}/checkout/sessions`, {
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
    console.log(`create-checkout-session: Stripe ${res.status} — ${msg}`);
    return json({ error: msg }, 502);
  }

  // 5. the browser redirects here
  return json({ url: data.url });
});

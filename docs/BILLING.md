# Billing — the Dungeon Lord subscription (Stripe)

Onyx Dungeon has two tiers. Everyone who signs up is an **Adventurer** (free):
they build characters, join campaigns through invite links, roll dice, and play.
A **Dungeon Lord** subscription unlocks the Game-Master side — **creating
campaigns** and **every AI tool** — and under the hood it is nothing more than
**the buyer's email in `campaign_creators`**, the same allow-list
`can_create_campaign()` has checked since the accounts migration. There is no
second permission system to keep in sync.

Money is handled by **Stripe Checkout** (paying) and the **Stripe Customer
Portal** (cancel / change card / invoices). Both are Stripe-hosted pages: the
site never sees a card number (PCI SAQ A), holds no Stripe key in the browser,
and stores only what it needs to show "renews on …" on the profile page.

> **Stripe is the source of truth.** The browser never talks to Stripe and never
> writes billing state. The signed `stripe-webhook` Edge Function is the *only*
> writer: it turns the seat on when Stripe confirms payment and off when a
> subscription ends. Seats you grant by hand (`source = 'manual'`, including
> the seeded owner) are never touched by the webhook.

## How it flows

```
pricing.html ──► create-checkout-session (Edge Function, caller's JWT)
                   │  501 not-configured   until the Stripe secrets are set
                   │  409 already-subscribed if this email is active/trialing
                   ▼
            Stripe Checkout (hosted page — the card is typed on stripe.com)
                   │  paid      → /pricing.html?checkout=success
                   │  backed out → /pricing.html?checkout=cancelled
                   ▼
            Stripe ──► stripe-webhook (Stripe-signed; no Supabase JWT)
                          1. verify Stripe-Signature (HMAC-SHA256, 5-min replay window)
                          2. claim the event id in stripe_events (idempotent)
                          3. upsert the buyer's `subscriptions` row
                          4. grant_campaign_creator(email, 'stripe')
                                   │
                                   ▼
                      can_create_campaign() = true → the Campaigns page lets
                      them create; the AI tools work in the campaigns they run

profile.html ──► billing-portal (Edge Function) ──► Stripe Customer Portal
                                                     (cancel / card / invoices)
                                                     → back to /profile.html
```

Renewals, failed payments and cancellations all arrive the same way — the
`customer.subscription.*` events — and update the row and the seat together.

## Setup (owner, once)

1. **Apply the migration** — adds `campaign_creators.source`, the
   `subscriptions` and `stripe_events` tables, and the `billing_status()`,
   `grant_campaign_creator()` and `revoke_campaign_creator()` RPCs:
   ```bash
   npx supabase db push
   ```
2. **In Stripe → Product catalog:** create a product named **Dungeon Lord** with
   a **recurring** price (monthly, say). Copy its price id — it starts with
   `price_`.
3. **Set the function secrets** (never in the repo):
   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY=sk_… STRIPE_PRICE_DM=price_… SITE_URL=https://onyxdungeon.com
   ```
   `SITE_URL` is where Stripe sends people back to (it defaults to
   `https://onyxdungeon.com` if unset). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set those.
4. **Deploy the three functions:**
   ```bash
   npx supabase functions deploy create-checkout-session && npx supabase functions deploy billing-portal && npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   `--no-verify-jwt` matches `verify_jwt = false` in `supabase/config.toml`:
   Stripe's calls carry no Supabase JWT — the Stripe signature is the auth.
5. **In Stripe → Developers → Webhooks → Add endpoint:** URL
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`, listening
   for `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Copy the
   endpoint's **signing secret** and store it:
   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_…
   ```
6. **Turn on the Customer Portal** — Stripe → Settings → Billing → Customer
   portal → activate it (allow cancelling; card updates and invoice history are
   worth enabling). Without this, "Manage subscription" gets a Stripe error.
7. **Set the display price** — edit `CONFIG.PRICING` in `js/config.js` so what
   the pricing page shows matches the price you created in step 2. The page
   only *displays* this number; Stripe charges the real price.
8. **Before charging real money:**
   - Turn Supabase Auth **"Confirm email" ON** (see [`ACCOUNTS.md`](./ACCOUNTS.md)
     §3). The seat is keyed on the account email, so an unverified address must
     not be able to buy — or claim — one.
   - Fill in the `[e.g., Stripe]` and `[N days]` placeholders in `terms.html`
     and `privacy.html`.
   - Move from Stripe **test mode** to **live**: repeat steps 2, 3 and 5 with
     the live price, the `sk_live_…` key and a live-mode webhook endpoint.

**Until steps 3–5 are done the pricing page shows "Coming soon" — nothing
breaks.** The functions answer `501 {error:"not-configured"}` and the app turns
that into a calm note instead of a broken button.

## What happens on cancel (the lapse policy)

- Cancelling in the portal normally sets `cancel_at_period_end`; the seat stays
  on until the paid period ends (the profile page can show "ends on …"). When
  Stripe finally ends the subscription it sends `customer.subscription.deleted`
  and the webhook calls `revoke_campaign_creator(email)`.
- A subscription whose status becomes `canceled`, `unpaid` or
  `incomplete_expired` is revoked the same way. `past_due` (a failed renewal
  inside Stripe's retry window) changes **nothing** — a paying customer must not
  lose their tools over a card hiccup. If Stripe gives up, the status moves to
  `canceled`/`unpaid` and the seat goes then.
- **Revoking only stops NEW campaign creation.** Existing campaigns keep their
  `campaign_members` role `'dm'`, so a lapsed subscriber can still run the
  tables they already built and their players lose nothing. Only
  `source = 'stripe'` rows are ever removed — the seeded owner and any seat you
  added by hand are safe.
- Coming back later reuses their Stripe customer, so invoices and the portal
  stay in one place.

## Testing

**Stripe side (test mode).** Use the `sk_test_…` key and a test-mode price for
steps 2–3; the test card is `4242 4242 4242 4242` with any future date/CVC. To
deliver real webhook events to the deployed function, either:

- `stripe listen --forward-to https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
  — the CLI prints a `whsec_…` for that session; set it as
  `STRIPE_WEBHOOK_SECRET` while you test, then put the dashboard endpoint's
  secret back; or
- use the dashboard endpoint's **"Send test event"**. Note a synthetic event
  carries made-up ids and none of our metadata, so it will be acknowledged as
  *ignored (no matching account)* — a good smoke test of signature +
  idempotency, not of the grant. Do one real test-mode checkout for that, then
  check `select * from subscriptions;` and `select * from campaign_creators;`.

The function logs one line per event (`type id — outcome`); never secrets or
payloads. A `500` means a DB step failed *after* the event was claimed — the
claim is released and Stripe retries automatically.

**Database side (no Stripe needed).** The SQL proofs boot a throwaway Postgres
cluster, apply the shim + schema + migrations (the billing migration twice, to
prove it is re-runnable) and run `tools/test-billing.sql`:

```
su pgtest -c 'bash tools/run-billing-tests.sh'
```

It proves: an ordinary user cannot call the grant/revoke RPCs (guard *and*
EXECUTE grant); a service-role grant makes the buyer a DM and
`billing_status()` reports `tier = 'dm'`; revoke turns that off again; revoke
never removes a `'manual'` seat and a Stripe grant never downgrades one; an
account with no rows is `free` with `subscription: null`; the exact contract
keys; and RLS lets a user read only their own `subscriptions` row and write
none of them (nor read `stripe_events` at all).

## Manual grant / revoke (owner, SQL editor)

Give a friend (or yourself on a second address) the DM seat without Stripe:

```sql
insert into campaign_creators (email, source) values ('friend@example.com', 'manual')
  on conflict (email) do update set source = 'manual';
```

Take it away:

```sql
delete from campaign_creators where email = 'friend@example.com';
```

A `'manual'` row is invisible to the webhook: it is never revoked when a Stripe
subscription lapses, and a Stripe grant for the same email leaves it `'manual'`.

## Reference (for cross-checking the frontend)

| Piece | Contract |
| --- | --- |
| `billing_status()` RPC (authenticated) | `{ tier: "dm"\|"free", is_creator: bool, creator_source: "manual"\|"stripe"\|null, subscription: null \| { status, current_period_end, cancel_at_period_end, has_customer } }` |
| `grant_campaign_creator(p_email, p_source default 'stripe')` | service role only (raises `service role only` otherwise) |
| `revoke_campaign_creator(p_email)` | service role only; deletes only `source = 'stripe'` |
| `create-checkout-session` (POST `{}`, JWT) | `200 {url}` · `501 {error:"not-configured"}` · `409 {error:"already-subscribed"}` · `401` · `502` Stripe error |
| `billing-portal` (POST `{}`, JWT) | `200 {url}` · `501 {error:"not-configured"}` · `404 {error:"no-subscription"}` · `401` · `502` |
| `stripe-webhook` (Stripe only) | `200 {received:true[,duplicate\|ignored]}` · `400` bad signature · `501` not configured · `500` retry |
| Redirects | success `SITE_URL/pricing.html?checkout=success` · cancel `SITE_URL/pricing.html?checkout=cancelled` · portal return `SITE_URL/profile.html` |
| Secrets | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_DM`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` |

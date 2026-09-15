# Discord integration

Let a DM connect their campaign to a **Discord channel** so Onyx can post to it:
**game reminders**, **session recaps**, **announcements**, and (optionally)
**dice results**. It's **outbound only** — Onyx posts *to* your channel. There's
**no bot to host and no login**; it uses a Discord **channel webhook**, so it fits
the app's $0 / static + Supabase shape perfectly.

Find it on the **Party** page → the **🔗 Discord** card (DM only).

## How a DM connects (no deploy needed by players)

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**.
2. Choose the channel it should post to, then **Copy Webhook URL**.
3. On the Party page, paste it into **🔗 Connect Discord** → **Connect & send a
   test**. A test message appears in the channel.

> The webhook URL is a **secret** — anyone with it can post to that channel. Onyx
> stores it in a **DM-only** table (`campaign_discord`, enforced by the database)
> and only ever uses it **server-side**, so it never reaches a player's browser.

## What you can post

- **⚔ Game reminder** — a title (e.g. *"Curse of the Crimson King — tonight 7 PM"*)
  and an optional note.
- **📖 Session recap** — a titled recap for the channel.
- **📣 Announcement** — any free-form message.
- **🎲 Auto dice results** — posted automatically as rolls happen. Modes:
  - **Off** (default)
  - **Crits & fumbles only** — just natural 20s and 1s (low-volume, fun)
  - **Every roll** — chatty; posts every roll in the campaign.

You can pause all posting with the **Posting on** toggle, or **Disconnect**
(which only forgets the URL — your Discord channel is untouched).

## Setup (one migration + one function)

```
npx supabase db push
npx supabase functions deploy discord-post
```

- The migration `20260924120000_discord.sql` creates the DM-only
  `campaign_discord` table, enables the **`pg_net`** extension, and adds a
  trigger on the `rolls` table that posts dice results straight to the webhook
  (so auto-dice works even when no browser is open).
- The `discord-post` function sends the manual reminders / recaps /
  announcements. It reads the webhook with the DM's own auth (RLS returns it
  only to the campaign's DM) and posts a formatted embed.

**No API keys** — Discord webhooks need none. Nothing here touches the AI budgets.

## Notes & safety

- The webhook URL is validated to be a real Discord webhook (`discord.com` /
  `discordapp.com`) at the database, the Edge Function, and the browser — three
  layers of SSRF protection.
- If Discord rejects a post with 401/404, the webhook was probably deleted in
  Discord — just reconnect with a fresh URL.
- The auto-dice trigger never raises: a Discord hiccup can't break a dice roll.

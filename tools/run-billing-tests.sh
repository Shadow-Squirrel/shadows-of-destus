#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Security harness for billing (the Dungeon Lord seat). Boots a
#  throwaway Postgres cluster (Postgres won't run as root, so run as a
#  normal user: su pgtest -c 'bash tools/run-billing-tests.sh'), applies
#  the Supabase shim + schema.sql + the accounts migration + the billing
#  migration (TWICE — it must be safe to re-run), then runs
#  tools/test-billing.sql. Exits non-zero on any failure.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-55435}"
export PATH="$PGBIN:$PATH"

if [ "$(id -u)" = "0" ]; then
  echo "Refusing to run as root — Postgres won't start as root." >&2; exit 1
fi

WORK="$(mktemp -d)"; DATA="$WORK/data"; DB="billing"
cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "▶ initializing throwaway cluster in $WORK"
initdb -D "$DATA" -A trust --username=postgres >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
createdb -h "$WORK" -p "$PORT" --username=postgres "$DB"

P=(psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q --username=postgres)
echo "▶ applying shim + schema.sql + accounts migration + billing migration (×2)"
"${P[@]}" -f "$REPO/tools/test-supabase-shim.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/schema.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/migrations/20260916120000_accounts_invites.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/migrations/20260925120000_billing.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/migrations/20260925120000_billing.sql" >/dev/null   # re-runnable

echo "▶ billing proofs (tools/test-billing.sql)"
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" --username=postgres -f "$REPO/tools/test-billing.sql"

echo
echo "════════════════════════════════════════════════"
echo " ALL BILLING CHECKS PASSED"
echo "════════════════════════════════════════════════"

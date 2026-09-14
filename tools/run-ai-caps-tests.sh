#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Cost-safety test harness for AI image generation.
#
#  Boots a THROWAWAY PostgreSQL cluster (Postgres refuses to run as
#  root, so run this whole script as a non-root user, e.g.
#     su pgtest -c 'bash tools/run-ai-caps-tests.sh'
#  ), applies the Supabase shim + supabase/schema.sql, then:
#    • runs tools/test-ai-caps.sql (single-session cap proofs), and
#    • runs a PARALLEL stress that fires many concurrent reservations
#      at once and asserts the per-month advisory lock keeps the live
#      count exactly at the cap (the race the lock closes).
#  Cleans the cluster up on exit. Exits non-zero on any failure.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-55432}"
export PATH="$PGBIN:$PATH"

if [ "$(id -u)" = "0" ]; then
  echo "Refusing to run as root — Postgres won't start as root. Re-run as a normal user." >&2
  exit 1
fi

WORK="$(mktemp -d)"
DATA="$WORK/data"
DB="aicaps"
PSQL=(psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q)

cleanup() {
  pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "▶ initializing throwaway cluster in $WORK"
initdb -D "$DATA" -A trust --username=postgres >/dev/null

# listen only on the private unix socket in $WORK (no TCP surprises)
pg_ctl -D "$DATA" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
createdb -h "$WORK" -p "$PORT" --username=postgres "$DB"

echo "▶ applying Supabase shim + schema.sql"
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q --username=postgres \
  -f "$REPO/tools/test-supabase-shim.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q --username=postgres \
  -f "$REPO/supabase/schema.sql" >/dev/null

echo "▶ single-session cap proofs (tools/test-ai-caps.sql)"
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" --username=postgres \
  -f "$REPO/tools/test-ai-caps.sql"

echo
echo "▶ concurrency proof: 30 simultaneous reservations, per-DM cap = 5"
CAMP="aaaaaaaa-0000-0000-0000-000000000001"
CLAIMS='{"email":"alice@x.com","role":"authenticated"}'
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q --username=postgres <<SQL
delete from ai_image_log;
update ai_image_config set per_dm_monthly_cap = 5, global_monthly_cap = 100000;
SQL

# fire 30 reservations at once, each in its own connection/transaction,
# all as the same DM. The advisory lock must let exactly 5 through.
for i in $(seq 1 30); do
  psql -h "$WORK" -p "$PORT" -d "$DB" --username=postgres -q \
    -c "SET ROLE authenticated; SELECT set_config('request.jwt.claims', '$CLAIMS', false); SELECT ai_reserve_image('$CAMP','map','stress $i');" \
    >/dev/null 2>&1 &
done
wait

LIVE=$(psql -h "$WORK" -p "$PORT" -d "$DB" --username=postgres -tAc \
  "select count(*) from ai_image_log where dm_email='alice@x.com' and status<>'failed';")
echo "  live rows after 30 concurrent attempts: $LIVE (cap 5)"
if [ "$LIVE" = "5" ]; then
  echo "  ✓ concurrency: exactly 5 succeeded — the advisory lock closed the race"
else
  echo "  ✗ concurrency FAIL: expected 5 live rows, got $LIVE" >&2
  exit 1
fi

echo
echo "════════════════════════════════════════════════"
echo " ALL AI COST-SAFETY CHECKS PASSED"
echo "════════════════════════════════════════════════"

#!/usr/bin/env bash
# Per-user profile isolation harness. Run as a non-root user:
#   su pgtest -c 'bash tools/run-profiles-tests.sh'
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-55434}"
export PATH="$PGBIN:$PATH"
[ "$(id -u)" = "0" ] && { echo "Run as non-root (Postgres won't start as root)." >&2; exit 1; }

WORK="$(mktemp -d)"; DATA="$WORK/data"; DB="profiles"
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

echo "▶ initializing throwaway cluster in $WORK"
initdb -D "$DATA" -A trust --username=postgres >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
createdb -h "$WORK" -p "$PORT" --username=postgres "$DB"

P=(psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" -q --username=postgres)
echo "▶ applying shim + schema.sql + profiles migration"
"${P[@]}" -f "$REPO/tools/test-supabase-shim.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/schema.sql" >/dev/null
"${P[@]}" -f "$REPO/supabase/migrations/20260917120000_profiles.sql" >/dev/null

echo "▶ isolation proofs (tools/test-profiles.sql)"
psql -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -d "$DB" --username=postgres -f "$REPO/tools/test-profiles.sql"

echo
echo "════════════════════════════════════════════════"
echo " ALL PROFILE ISOLATION CHECKS PASSED"
echo "════════════════════════════════════════════════"

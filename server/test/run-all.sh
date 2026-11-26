#!/usr/bin/env bash
# Runs the server tests, each against its own throwaway server (fresh save dir, DEV_HOOKS on, a fast clock and
# whatever settings that test needs), and prints a summary. Exits non-zero if any test fails.
#
#   npm test -w server                    every test
#   npm test -w server -- water social    just these
#   PORT=8800 npm test -w server          another port (default 8791)
#
# Needs the generated world (npm run gen:world): several tests look for land and water at real places.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8791}"
TICK_MS=500
WORK="$(mktemp -d "${TMPDIR:-/tmp}/globalcity-tests.XXXXXX")"
TEST_TIMEOUT="${TEST_TIMEOUT:-300}"

# name | extra server environment
TESTS=(
  "smoke|"
  "features|"
  "social|ABANDON_DAY_MS=1000"
  "ambient|"
  "water|"
  "zonewire|"
  "uwcorner|"
  "abandon|"
  "lifeline|"
  "milestones|"
  "grandcentral|"
  "flights|"
  "freeze|CITY_FREEZE_MS=4000"
  "monument|MONUMENT_MIN_POP=1"
  "regrow|REGROW_MS=1000 REGROW_P=0.5 CITY_FREEZE_MS=3000"
  "smallrelease|SMALL_CITY_RELEASE_MS=3000"
  "custom|"
)

want=" $* "
passed=() failed=()
server_pid=""
stop_server() {
  [ -n "$server_pid" ] || return 0
  kill -- "-$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null
  server_pid=""
  for _ in $(seq 1 40); do curl -s "localhost:$PORT/health" >/dev/null || break; sleep 0.25; done
}
trap 'stop_server; exit 130' INT TERM

if curl -s "localhost:$PORT/health" >/dev/null; then
  echo "Something is already listening on port $PORT; set PORT to a free one." >&2
  exit 2
fi

for entry in "${TESTS[@]}"; do
  name="${entry%%|*}" extra="${entry#*|}"
  [ $# -eq 0 ] || [[ "$want" == *" $name "* ]] || continue
  file=$(ls "test/$name".ts "test/$name".mjs 2>/dev/null | head -1)
  [ -n "$file" ] || { echo "no test called $name" >&2; failed+=("$name"); continue; }
  save="$WORK/save-$name"; mkdir -p "$save"
  t0=$(date +%s)
  # own process group, so the whole server tree (npx -> tsx -> node) stops with it
  # shellcheck disable=SC2086
  setsid env PORT="$PORT" DATA_DIR="$save" DEV_HOOKS=1 TICK_MS="$TICK_MS" $extra npx tsx src/index.ts > "$WORK/$name-server.log" 2>&1 &
  server_pid=$!
  up=0
  for _ in $(seq 1 240); do
    curl -s "localhost:$PORT/health" >/dev/null && { up=1; break; }
    kill -0 "$server_pid" 2>/dev/null || break
    sleep 0.25
  done
  if [ $up = 0 ]; then
    echo "FAIL $name: server did not start"; tail -20 "$WORK/$name-server.log"
    failed+=("$name"); stop_server; continue
  fi
  if PORT="$PORT" TICK_MS="$TICK_MS" timeout "$TEST_TIMEOUT" npx tsx "$file" > "$WORK/$name.log" 2>&1; then
    echo "PASS $name ($(( $(date +%s) - t0 ))s)"; passed+=("$name")
  else
    echo "FAIL $name ($(( $(date +%s) - t0 ))s)"; tail -20 "$WORK/$name.log" | sed 's/^/    /'
    failed+=("$name")
  fi
  stop_server
done

echo
echo "${#passed[@]} passed, ${#failed[@]} failed${failed:+: ${failed[*]}}. Logs in $WORK"
[ ${#failed[@]} -eq 0 ]

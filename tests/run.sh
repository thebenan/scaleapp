#!/usr/bin/env bash
# Browser tests with no npm and no test framework: python's http.server plus
# headless Chrome, driving the real page. Deliberately matches the app's
# no-build-step constraint.
#
#   ./tests/run.sh            run every case
#   ./tests/run.sh phase2     run only cases matching "phase2"
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8766}"
FILTER="${1:-}"

CHROME=""
for candidate in google-chrome chromium chromium-browser google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then CHROME="$candidate"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "No Chrome or Chromium on PATH — cannot run browser tests." >&2
  exit 1
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  rm -f __test_*.html
  rm -rf .test-profile
}
trap cleanup EXIT

# Wait for the server rather than sleeping a guessed interval.
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/index.html" && break
  sleep 0.1
done

total_pass=0
total_fail=0

for testfile in tests/cases/*.test.js; do
  name="$(basename "$testfile" .test.js)"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then continue; fi

  page="__test_${name}.html"
  python3 tests/harness.py "$name" "$page" || { total_fail=$((total_fail + 1)); continue; }

  # Fresh profile per case: a service worker or cached asset left by a previous
  # run would otherwise serve stale code and report a false result.
  rm -rf .test-profile
  output="$("$CHROME" --headless --disable-gpu --no-sandbox \
    --user-data-dir=.test-profile --virtual-time-budget=20000 \
    --dump-dom "http://127.0.0.1:$PORT/$page" 2>/dev/null \
    | sed -n 's|</pre>.*||; /^\(PASS\|FAIL\) /p')"

  passes="$(printf '%s\n' "$output" | grep -c '^PASS' || true)"
  fails="$(printf '%s\n' "$output" | grep -c '^FAIL' || true)"

  if [ "$passes" -eq 0 ] && [ "$fails" -eq 0 ]; then
    echo "  $name: NO RESULTS (page failed to load or script threw at parse time)"
    total_fail=$((total_fail + 1))
    continue
  fi

  echo "  $name: $passes passed, $fails failed"
  printf '%s\n' "$output" | grep '^FAIL' | sed 's/^/      /' || true

  total_pass=$((total_pass + passes))
  total_fail=$((total_fail + fails))
done

echo
echo "total: $total_pass passed, $total_fail failed"
[ "$total_fail" -eq 0 ]

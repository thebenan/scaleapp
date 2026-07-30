#!/usr/bin/env python3
"""Build a runnable test page from the real index.html.

Tests run against the actual markup and the actual script.js rather than a
hand-copied approximation, so a change to index.html that breaks the app breaks
the tests too. A case is a pair of files in tests/cases/:

    <name>.seed.js   optional, runs before script.js (set up localStorage)
    <name>.test.js   runs after script.js, calls check(label, cond, detail)
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CASES = ROOT / "tests" / "cases"

# Runs before script.js, so the app sees whatever storage the seed sets up.
# alert() is captured rather than shown, since headless Chrome would block.
PRELUDE = """
  localStorage.clear();
  window.__alerts = [];
  window.alert = m => window.__alerts.push(m);
"""

# Wrapped in an async IIFE so cases can await — the import path reads a File,
# which is unavoidably asynchronous.
RUNNER_HEAD = """
const __results = [];
function check(label, cond, detail) {
  __results.push((cond ? "PASS " : "FAIL ") + label + (detail ? " :: " + detail : ""));
}

// Poll for the condition instead of sleeping a guessed interval. File reads and
// fetches are not driven by Chrome's virtual clock, so a fixed setTimeout races
// them and produces intermittent failures.
async function waitFor(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (predicate()) return true; } catch (e) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

(async () => {
try {
"""

# A thrown error must surface as a failure, not as an empty result set that the
# runner could mistake for "nothing to report".
RUNNER_TAIL = """
} catch (err) {
  __results.push("FAIL threw mid-test :: " + (err && err.stack ? err.stack : err));
}
document.getElementById("testout").textContent = "\\n" + __results.join("\\n") + "\\n";
})();
"""

BOOTSTRAP_TAG = '<script src="vendor/bootstrap.bundle.min.js"></script>'


def build(name, out_path):
    html = (ROOT / "index.html").read_text()

    seed_file = CASES / f"{name}.seed.js"
    seed = seed_file.read_text() if seed_file.exists() else ""
    test = (CASES / f"{name}.test.js").read_text()

    if BOOTSTRAP_TAG not in html:
        sys.exit(f"harness: could not find the bootstrap script tag in index.html")

    html = html.replace(BOOTSTRAP_TAG, f"<script>{PRELUDE}{seed}</script>\n{BOOTSTRAP_TAG}")
    html = html.replace(
        "</body>",
        f'<pre id="testout"></pre>\n<script>{RUNNER_HEAD}{test}{RUNNER_TAIL}</script>\n</body>',
    )
    (ROOT / out_path).write_text(html)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: harness.py <case-name> <output.html>")
    build(sys.argv[1], sys.argv[2])

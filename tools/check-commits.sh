#!/usr/bin/env bash
# check-commits.sh — compare current branch against <base> (default: main)
# and validate every ahead commit against Node.js core commit conventions.
#
# Usage:
#   ./tools/check-commits.sh [base-branch]
#
# Examples:
#   ./tools/check-commits.sh          # compares against main
#   ./tools/check-commits.sh upstream/main

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="${SCRIPT_DIR}/validate-commits.js"

BASE="${1:-main}"
CURRENT="$(git rev-parse --abbrev-ref HEAD)"

# ── Sanity checks ─────────────────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  echo "error: git not found" >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "error: node not found — required for commit-message validation" >&2
  exit 1
fi

if [ ! -f "${VALIDATOR}" ]; then
  echo "error: validator not found at ${VALIDATOR}" >&2
  exit 1
fi

if ! git rev-parse --git-dir &>/dev/null; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

if ! git rev-parse --verify "${BASE}" &>/dev/null; then
  echo "error: base branch '${BASE}' not found" >&2
  exit 1
fi

# ── Summary header ────────────────────────────────────────────────────────────

MERGE_BASE="$(git merge-base "${BASE}" HEAD)"
AHEAD="$(git rev-list --count "${MERGE_BASE}..HEAD")"
BEHIND="$(git rev-list --count "HEAD..${BASE}")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Branch : ${CURRENT}"
echo "  Base   : ${BASE}"
echo "  Ahead  : ${AHEAD} commit(s)"
echo "  Behind : ${BEHIND} commit(s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "${AHEAD}" -eq 0 ]; then
  echo "  No commits ahead of '${BASE}'. Nothing to validate."
  exit 0
fi

echo ""
echo "Commits ahead of '${BASE}':"
git log --oneline "${MERGE_BASE}..HEAD"
echo ""

# ── Build JSON payload for the validator ─────────────────────────────────────
# Use NUL-delimited output so newlines inside messages are safe.
# Format: hash<RS>subject<RS>fullMessage<NUL>
# RS = ASCII record separator (0x1e), NUL = 0x00

build_json() {
  python3 - <<'PYEOF'
import sys, subprocess, json

sep  = '\x1e'
null = '\x00'

result = subprocess.run(
    ['git', 'log', '--format=%H' + sep + '%s' + sep + '%B' + null,
     'MERGE_BASE..HEAD'],
    capture_output=True, text=True, check=True,
    env={**__import__('os').environ, 'MERGE_BASE': sys.argv[1] if len(sys.argv) > 1 else ''}
)

# We call git again with the real merge base substituted in the shell
PYEOF
}

# Collect commits as JSON array using a Node.js one-liner (keeps it simple)
JSON_PAYLOAD="$(
  node - "${MERGE_BASE}" <<'JSEOF'
const { execSync } = require('child_process');
const mergeBase = process.argv[2];

// %x00 = NUL delimiter between commits; %x1e = field separator
const raw = execSync(
  `git log --format=%H%x1e%s%x1e%B%x00 ${mergeBase}..HEAD`,
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);

const commits = raw
  .split('\0')
  .map(s => s.trim())
  .filter(Boolean)
  .map(entry => {
    const sepIdx = entry.indexOf('\x1e');
    const hash = entry.slice(0, sepIdx);
    const rest = entry.slice(sepIdx + 1);
    const sep2 = rest.indexOf('\x1e');
    const subject = rest.slice(0, sep2);
    const fullMessage = rest.slice(sep2 + 1).trim();
    return { hash, subject, fullMessage };
  });

process.stdout.write(JSON.stringify(commits));
JSEOF
)"

# ── Run validator ─────────────────────────────────────────────────────────────

RESULTS="$(echo "${JSON_PAYLOAD}" | node "${VALIDATOR}" || true)"

# ── Pretty-print results ──────────────────────────────────────────────────────

node - "${RESULTS}" <<'JSEOF'
const results = JSON.parse(process.argv[2]);
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

let anyFail = false;

for (const r of results) {
  const short = r.hash.slice(0, 10);
  const label = r.ok ? `${GREEN}✔ PASS${RESET}` : `${RED}✘ FAIL${RESET}`;
  console.log(`${BOLD}${short}${RESET}  ${label}  ${CYAN}${r.subject}${RESET}`);

  if (r.errors.length) {
    anyFail = true;
    for (const e of r.errors)
      console.log(`         ${RED}error${RESET}  ${e}`);
  }
  if (r.warnings.length) {
    for (const w of r.warnings)
      console.log(`         ${YELLOW}warn${RESET}   ${w}`);
  }
}

console.log('');
const total  = results.length;
const passed = results.filter(r => r.ok).length;
const failed = total - passed;

if (failed === 0) {
  console.log(`${GREEN}${BOLD}All ${total} commit(s) passed.${RESET}`);
} else {
  console.log(`${RED}${BOLD}${failed}/${total} commit(s) failed validation.${RESET}`);
  process.exit(1);
}
JSEOF

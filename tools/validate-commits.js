#!/usr/bin/env node
/**
 * Validates commit messages against Node.js core commit conventions.
 *
 * Rules (from SKILL.md):
 *  1. First line: max 72 chars (prefer ~50), entirely lowercase except
 *     proper nouns / code identifiers
 *  2. Prefix with subsystem name + imperative verb: `net: add localAddress`
 *  3. Second line must be blank (if body present)
 *  4. Body lines wrapped at 72 columns
 *  5. Fixes:/Refs: must use full URLs (not bare issue numbers)
 *  6. Signed-off-by: required (DCO)
 *  7. semver-major commits must explain the breaking change
 */

'use strict';

const SUBJECT_MAX = 72;
const BODY_MAX = 72;

// Matches "subsystem: verb rest…"  — subsystem may contain slashes (src/lib)
const SUBJECT_PREFIX_RE = /^[a-z0-9_\-./,]+:\s+\S/;

// Tokens that are clearly proper nouns / identifiers — exempt from lowercase check
// (we allow any uppercase after a colon+space since that's the subsystem separator)
const UPPERCASE_EXEMPT_RE = /^[A-Z]{2,}$|^[A-Z][a-z]/; // acronyms or PascalCase words

// Bare issue / PR reference (should be a full URL instead)
const BARE_REF_RE = /^(Fixes|Refs|Closes|Resolves):\s+#\d+/im;

// Full-URL reference line
const FULL_URL_REF_RE = /^(Fixes|Refs|Closes|Resolves):\s+https?:\/\//im;

const SIGNED_OFF_RE = /^Signed-off-by:\s+.+<.+@.+>/im;

const SEMVER_MAJOR_RE = /\bsemver-major\b/i;

/**
 * @param {string} raw  Full raw commit message (subject + optional body)
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateMessage(raw) {
  const errors = [];
  const warnings = [];
  const lines = raw.split('\n');
  const subject = lines[0] ?? '';

  // ── Rule 1: subject line length ──────────────────────────────────────────
  if (subject.length > SUBJECT_MAX) {
    errors.push(
      `Subject too long: ${subject.length} chars (max ${SUBJECT_MAX}): "${subject}"`
    );
  } else if (subject.length > 50) {
    warnings.push(
      `Subject slightly long: ${subject.length} chars (prefer ≤50): "${subject}"`
    );
  }

  // ── Rule 1 continued: lowercase check ────────────────────────────────────
  // Split on the subsystem prefix ("net: ") to get only the description part
  const afterPrefix = SUBJECT_PREFIX_RE.test(subject)
    ? subject.replace(/^[^:]+:\s+/, '')
    : subject;

  const firstWord = afterPrefix.split(/\s/)[0] ?? '';
  if (firstWord && firstWord !== firstWord.toLowerCase() && !isExemptWord(firstWord)) {
    errors.push(
      `Subject description must start lowercase (got "${firstWord}"): "${subject}"`
    );
  }

  // ── Rule 2: subsystem prefix ──────────────────────────────────────────────
  if (!SUBJECT_PREFIX_RE.test(subject)) {
    errors.push(
      `Subject missing "subsystem: verb …" prefix: "${subject}"`
    );
  }

  // ── Rule 3: second line blank ─────────────────────────────────────────────
  if (lines.length > 1 && lines[1].trim() !== '') {
    errors.push(
      `Second line must be blank (got "${lines[1]}")`
    );
  }

  // ── Rule 4: body line length ──────────────────────────────────────────────
  const bodyLines = lines.slice(2);
  bodyLines.forEach((line, i) => {
    // Skip trailer lines (Fixes:, Signed-off-by:, etc.)
    if (/^[A-Za-z-]+:\s/.test(line)) return;
    if (line.length > BODY_MAX) {
      warnings.push(
        `Body line ${i + 3} too long: ${line.length} chars (max ${BODY_MAX}): "${line.slice(0, 60)}…"`
      );
    }
  });

  // ── Rule 5: Fixes/Refs must be full URLs ─────────────────────────────────
  if (BARE_REF_RE.test(raw)) {
    errors.push(
      'Fixes:/Refs: must use full URLs (e.g. https://github.com/…), not bare #NNN'
    );
  }

  // ── Rule 6: Signed-off-by required ───────────────────────────────────────
  if (!SIGNED_OFF_RE.test(raw)) {
    errors.push('Missing required "Signed-off-by: Name <email>" trailer (DCO)');
  }

  // ── Rule 7: semver-major must have breaking-change explanation ────────────
  if (SEMVER_MAJOR_RE.test(subject) || SEMVER_MAJOR_RE.test(raw)) {
    const bodyText = bodyLines.join('\n');
    if (bodyText.trim().length < 20) {
      errors.push(
        'semver-major commit must explain the breaking change, trigger, and exact change in the body'
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Proper nouns / acronyms that are exempt from the lowercase rule.
 * Heuristic: all-caps (acronym) or contains a digit (identifier like
 * `Buffer`, `URL`, `fs.readFileSync`).
 */
function isExemptWord(word) {
  return /^[A-Z]{2,}$/.test(word) || /\d/.test(word) || /[._]/.test(word);
}

// ── CLI entry point ───────────────────────────────────────────────────────────

/**
 * Input: one JSON array via stdin, each element is
 *   { hash, subject, body, fullMessage }
 * Output: JSON array of results to stdout.
 */
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let commits;
  try {
    commits = JSON.parse(input);
  } catch {
    process.stderr.write('validate-commits.js: invalid JSON on stdin\n');
    process.exit(1);
  }

  if (!Array.isArray(commits) || commits.length === 0) {
    process.stdout.write(JSON.stringify([]));
    process.exit(0);
  }

  const results = commits.map(({ hash, subject, fullMessage }) => {
    const { ok, errors, warnings } = validateMessage(fullMessage ?? subject ?? '');
    return { hash, subject, ok, errors, warnings };
  });

  process.stdout.write(JSON.stringify(results, null, 2));

  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`validate-commits.js: ${err.message}\n`);
  process.exit(1);
});

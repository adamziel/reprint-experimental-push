# AO checklist completion lint evidence

Date: 2026-05-28
Lane: checklist-linter-current-tree
Scope: evidence toward RPP-0912 and RPP-0913. Release remains held, and
these checklist items remain unchecked until the release process wires the guard
into the required checks.

## What changed

- Added `scripts/release/checklist-completion-lint.mjs`, a deterministic JSON
  linter for RPP checklist language in evidence, audit, progress, supervisor,
  and `progress.html` surfaces.
- The linter parses `docs/reprint-push-completion-checklist.md`, reports
  checked and unchecked RPP IDs, fails closed for missing or duplicate checklist
  IDs, and reports reason-coded risky claims for unchecked items.
- The scanner allows cautious language such as evidence toward, release remains
  held, not complete, and remaining work, so support evidence can be recorded
  without implying final checklist closure.
- Added fixture-based tests in `test/checklist-completion-lint.test.js` for
  risky terms, cautious terms, RPP ranges, duplicate IDs, missing checklist
  failure, target file discovery, CLI JSON shape, and the current real
  `progress.html`, `docs/progress-log.md`, `docs/supervisor-feedback.md`,
  `docs/evidence/*.md`, and `audits/*.md` surfaces.

## Verification

Focused commands used for this evidence:

```sh
node --check scripts/release/checklist-completion-lint.mjs
node --test test/checklist-completion-lint.test.js
node scripts/release/checklist-completion-lint.mjs
git diff --check
```

Observed local repository lint summary from the standalone linter:

```json
{
  "ok": true,
  "riskyClaims": 0,
  "scannedFiles": 36,
  "checkedIds": 92,
  "uncheckedIds": 908,
  "reasonCodes": []
}
```

This is evidence toward the release/check progress discipline only. RPP-0912
and RPP-0913 remain unchecked, and production-backed release evidence is still
required.

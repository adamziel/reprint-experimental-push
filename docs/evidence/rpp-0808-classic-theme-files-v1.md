# RPP-0808 classic theme files v1 evidence

Date: 2026-06-01
Lane: RPP-0808 classic theme files, variant 1
Checklist item: RPP-0808 - Implement classic theme files, variant 1.

## Scope

This slice adds deterministic local support evidence for a classic WordPress
theme file scope while reusing the RPP-0803 external topology URL contract.
It records source, local edited, and remote changed role URLs as normalized
identities, then proves those identities pass the static source/local/changed
checks before the classic theme file scope is accepted.

The proof remains support-only. It does not contact external WordPress hosts,
run live import/export, establish production credentials, collect route
receipts, or move release gates. Final release status and integration
recommendation remain **NO-GO**.

## Proof surface

`test/rpp-0808-classic-theme-files-v1.test.js` builds a local proof around the
existing RPP-0803 topology validator. The topology layer checks:

- `REPRINT_PUSH_SOURCE_URL`
- `REPRINT_PUSH_LOCAL_URL`
- `REPRINT_PUSH_REMOTE_CHANGED_URL`
- optional source alias identity
- optional per-route source identity
- forbidden tunnel host rejection
- URL userinfo, query string, and fragment rejection
- sandbox loopback ingress limited to port `8080`
- packaged fallback flags disabled

The classic theme layer records a `wp-content/themes/rpp-0808-classic/` scope
with `style.css`, `index.php`, `functions.php`, `header.php`, `footer.php`,
and `screenshot.png`. It also records the active classic theme option row keys
for `template` and `stylesheet` without storing option row payloads.

## Variant 1 Checks

The focused test asserts:

- source, local edited, and remote changed URLs are captured;
- the three URL role identities are distinct;
- source alias and per-route source identities match the source URL identity;
- known remote tunnel hosts are rejected;
- URL userinfo, query strings, and fragments are rejected;
- credential-shaped URL parts and credential values are absent from the proof;
- the classic theme file scope is recorded before planner evidence is accepted;
- required classic theme files `style.css` and `index.php` exist in all three
  roles;
- local classic theme file edits produce live-remote preconditions; and
- a remote changed `style.css` drift produces a fail-closed conflict before
  release movement.

## Redaction Posture

The public proof stores normalized role URL identities, identity hashes,
classic theme file paths, file resource keys, planner counts, mutation hashes,
precondition hashes, conflict hashes, and boolean gate state. It does not store
theme file contents, option row payloads, credentials, cookies, bearer values,
application password values, query strings, URL userinfo, or production service
configuration.

The negative test feeds tunnel and secret-shaped topology URLs into the same
proof builder and asserts the proof fails closed without retaining the raw
credential-shaped URL parts.

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0808-classic-theme-files-v1.test.js
node --test --test-name-pattern RPP-0808 test/rpp-0808-classic-theme-files-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0808-classic-theme-files-v1.md
git diff --check
```

Observed local results after implementation:

- `node --check test/rpp-0808-classic-theme-files-v1.test.js`: exit 0
- RPP-0808 focused proof test: passed
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Integration Recommendation

Integration recommendation: **NO-GO**.

This is deterministic local support evidence for the RPP-0808 URL identity and
classic theme file scope contract. Production-backed WordPress reachability,
credentials, route receipts, durable journal behavior, and live mutation
receipts remain required for promotion.

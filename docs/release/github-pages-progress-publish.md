# GitHub Pages Progress Publish

Date: 2026-06-01
Slice: RPP-0913
Variant: 1
Release recommendation: NO-GO
Evidence mode: support-only

This note defines the support-only release-ops rule for publishing the public
progress page through the existing GitHub Pages source branch. It records the
required proof shape only. It does not publish `progress.html`, does not move a
release gate, and does not change final release readiness.

## Required publish proof

The GitHub Pages progress publish workflow must stay a blocking required proof
before release readiness can be true.

| Field | Value |
| --- | --- |
| Check id | `github-pages-progress-publish-proof` |
| Owner scope | `release-ops` |
| Area | `progress-publish` |
| Severity | `blocking` |
| Production required | `true` |
| Required command | `npm run publish:progress-page:dry-run` |
| Required artifacts | `scripts/release/publish-progress-page.mjs`, `progress.html`, `docs/evidence/ao-progress-report.md`, `docs/release/github-pages-progress-publish.md`, `docs/evidence/rpp-0913-github-pages-progress-publish.md` |
| Freshness window | `21600000` milliseconds |

Release readiness requires a fresh `passed` observation for this exact command
and every required artifact path. A missing, failed, stale, command-mismatched,
or artifact-incomplete observation keeps the required release-check summary held
and keeps final release at `NO-GO`.

## Workflow guard

1. Validate the lane-local progress change and required release proofs.
2. Run `npm run publish:progress-page:dry-run` for the publish-readiness proof.
3. Record the exact command, observed status, `observedAt` timestamp, and all
   required artifact paths in release-check evidence.
4. Treat any non-passed required publish proof as release-blocking.

This support note is not production-backed publish evidence. It only documents
the release-check requirement and is paired with
`docs/evidence/rpp-0913-github-pages-progress-publish.md`.

Integration recommendation: keep final release `NO-GO` until this publish proof
has a fresh passed observation and every other blocking release proof is ready.

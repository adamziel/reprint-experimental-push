# RPP-0804 BrewCommerce blueprint import variant 1 evidence

Date: 2026-06-01
Lane: RPP-0804 BrewCommerce blueprint import, variant 1
Checklist item: RPP-0804 - Implement BrewCommerce blueprint import, variant 1.
Success text: plugin and graph evidence survive real WordPress import/export.
Final release posture: `NO-GO`

## Scope

This slice adds support-only evidence for the BrewCommerce blueprint import
gate. It does not change shared topology or release verifier code, does not
publish progress surfaces, and does not start a listener or remote tunnel.

The focused test defines the minimum artifact that can satisfy RPP-0804:

- runtime must be `real-wordpress-import-export`;
- BrewCommerce blueprint import and a WordPress export after import must both
  be observed;
- imported and exported snapshots must be represented by SHA-256 hashes;
- the `reprint-push-release-state` plugin-driver row must survive both import
  and export with a live precondition hash;
- featured-image, taxonomy, post-parent, and comment graph evidence must
  survive both import and export with hash-only round-trip evidence.

Local Playground or synthetic support evidence is explicitly rejected as
release-ready RPP-0804 evidence.

## Current sandbox observation

The BrewCommerce fixture directory exists at
`/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce`, but the current
assets are not sufficient for a real import/export survival claim:

```text
blueprint.json: present
content.xml: present, size=0
database.sql: present, size=0
ensure-media.php: present
theme.zip: present
uploads.zip: present
```

Docker is not present in this sandbox, and no complete external WordPress
topology or real import/export survival artifact was provided. The exact
missing capabilities recorded by the RPP-0804 test are:

```text
docker runtime or complete external WordPress topology
non-placeholder BrewCommerce import assets
real WordPress import/export survival artifact
```

The proof remains local-only and records the sandbox constraint that only the
provided `8080` ingress may be exposed; remote tunnels remain prohibited.

## Focused test behavior

`test/rpp-0804-brewcommerce-blueprint-import-v1.test.js` covers three paths:

- the current missing-capability path stays `NO-GO`, with
  `REAL_WORDPRESS_IMPORT_EXPORT_EVIDENCE_MISSING` as the primary blocker;
- a fully populated real import/export artifact is accepted only when plugin
  and all required graph surfaces survive import and export;
- a local Playground substitute or partial survival artifact is rejected.

The positive branch is a deterministic contract fixture, not a claim that this
sandbox produced real WordPress import/export evidence.

## Validation commands

```sh
node --check test/rpp-0804-brewcommerce-blueprint-import-v1.test.js
node --test --test-name-pattern RPP-0804 test/rpp-0804-brewcommerce-blueprint-import-v1.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0804-brewcommerce-blueprint-import-v1.md
git diff --check
```

Observed local result: all commands exited 0. The focused Node test file
passed, the redaction scan reported `ok: true`, and the whitespace check
passed.

## Integration recommendation

Integrate as support-only RPP-0804 evidence. Keep the checklist item blocked
for release movement until a Docker or external WordPress run supplies a real
import/export survival artifact that satisfies the plugin and graph checks.

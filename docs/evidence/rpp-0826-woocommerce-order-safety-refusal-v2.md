# RPP-0826 WooCommerce order safety refusal v2 evidence

Date: 2026-06-01
Lane: RPP-0826 WooCommerce order safety refusal, variant 2
Checklist item: RPP-0826 - WooCommerce order safety refusal.

## Scope

This slice is deterministic local support evidence. It does not add a
WooCommerce order mutation driver, does not claim production-backed order
application, and does not move release readiness.

The proof keeps evidence hash/count/surface-only. It checks WooCommerce-owned
legacy and HPOS order storage without recording order titles, customer emails,
addresses, order identifiers, line labels, metadata payloads, or plugin file
contents.

## Checked Surfaces

The focused test covers 8 WooCommerce-owned order row surfaces:

- legacy storage count: `4`
- HPOS storage count: `4`
- total storage count: `8`

Surface names only:

- `legacy-shop-order-post`
- `legacy-order-billing-postmeta`
- `legacy-order-line-item`
- `legacy-order-line-item-meta`
- `hpos-order-row`
- `hpos-order-address-row`
- `hpos-order-operational-row`
- `hpos-order-meta-row`

Plugin ownership counts are asserted as:

- base snapshot: `8`
- local edited snapshot: `8`
- remote snapshot: `8`
- expected: `8`

## Refusal Contract

`test/rpp-0826-woocommerce-order-safety-refusal-v2.test.js` builds an active
WooCommerce owner context and local edits across all 8 surfaces. Because there
is no supported WooCommerce order mutation driver allowlist, the planner must
produce support-only refusal evidence:

- plan status: `blocked`
- planned WooCommerce order mutations: `0`
- planned live-remote preconditions for blocked order rows: `0`
- blocked WooCommerce order surfaces: `8`
- blocker class: `unsupported-plugin-owned-resource`
- reason code: `UNKNOWN_PLUGIN_OWNED_RESOURCE`
- blocked-plan apply refusal: `PLAN_NOT_READY`
- blocked-plan `beforeMutation` calls: `0`
- remote unchanged after blocked-plan refusal: `true`

The same test forges ready plans for every checked order row surface. Each
forged mutation is refused before mutation-capable work:

- forged mutation attempts: `8`
- refusal code: `UNSUPPORTED_PLUGIN_OWNED_RESOURCE`
- `beforeMutation` calls: `0`
- remote unchanged after every forged refusal: `true`
- apply validation outcome: `refused-before-mutation`

The proof object is validated by `assertEvidenceHasNoRawValues` and stores
resource identifiers and refusal details as hashes, counts, and surface names.

## Topology Capability

Required success for this variant is that the topology command either starts
the disposable sites or records the exact unavailable capability. In this
sandbox it did not start sites because Docker CLI is unavailable, and it
failed closed before any site startup claim.

Observed topology command:

```sh
npm run verify:release:docker-local-production
```

Observed result:

- exit status: `2`
- status: `blocked`
- status marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`
- topology variant: `RPP-0802-variant-1`
- topology command contract: `npm run verify:release`
- accepted for release gate: `false`
- release movement allowed: `false`
- primary release-gate failure: `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`

Exact unavailable capability recorded:

```json
{
  "code": "DOCKER_CLI_MISSING",
  "capability": "docker-cli",
  "command": "docker --version",
  "missingExecutable": true
}
```

The topology evidence remains local-only and fail-closed:

- only sandbox HTTP ingress: `127.0.0.1:8080`
- verifier traffic uses private Docker service DNS when Docker is available
- packaged fallback observed: `false`
- remote tunnel tools remain prohibited
- release movement remains blocked

## Validation

Required validation commands for this slice:

```sh
node --check test/rpp-0826-woocommerce-order-safety-refusal-v2.test.js
node --test test/rpp-0826-woocommerce-order-safety-refusal-v2.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0826-woocommerce-order-safety-refusal-v2.md
git diff --check
```

Observed local results before commit:

- syntax check: exit `0`
- focused RPP-0826 test: exit `0`
- topology command: exit `2`, accepted for this sandbox because it recorded exact unavailable capability `DOCKER_CLI_MISSING`
- evidence redaction scan: exit `0`
- diff whitespace check: clean

## Recommendation

Integration recommendation: **NO-GO** for release movement.

This variant satisfies the sandbox success criterion by proving local
WooCommerce order safety refusal and recording the exact Docker capability
blocker. A Docker-capable environment still needs to start the topology before
this can become site-startup or production-backed release evidence.

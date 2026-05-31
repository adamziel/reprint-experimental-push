# RPP-0806 WooCommerce order safety refusal v1 evidence

Date: 2026-06-01

## Scope

RPP-0806 variant 1 proves that WooCommerce order data stays fail-closed unless an explicit supported order driver exists. This slice is local model evidence plus the existing topology command prerequisite proof. It does not introduce a WooCommerce order mutation driver and does not move release readiness.

The checked order surfaces are:

- legacy `shop_order` rows in `wp_posts`
- order billing postmeta in `wp_postmeta`
- HPOS-style rows in `wp_wc_orders`
- HPOS-style rows in `wp_wc_order_addresses`
- line-item rows in `wp_woocommerce_order_items`

## Implemented contract

`test/rpp-0806-woocommerce-order-safety-refusal-v1.test.js` builds an active WooCommerce plugin context and local edits across the order surfaces above. Because no WooCommerce order driver allowlist is present, the planner must block each order resource with `unsupported-plugin-owned-resource` and `UNKNOWN_PLUGIN_OWNED_RESOURCE`.

The proof asserts:

- no WooCommerce order mutation is planned
- no live-remote precondition is created for a blocked order resource
- blocked-plan apply returns `PLAN_NOT_READY` before mutation-capable work
- the remote hash is unchanged after refusal
- forged ready-plan apply for a `wp_wc_orders` row returns `UNSUPPORTED_PLUGIN_OWNED_RESOURCE`
- forged apply refusal runs before the `beforeMutation` hook and leaves the remote hash unchanged
- refusal evidence is hash-only and does not include raw order titles, buyer emails, order keys, addresses, or line-item labels

The same focused test also validates the existing topology-command artifact path. In this sandbox the topology command did not start sites because Docker is not installed; the command recorded the exact unavailable capability instead:

- command: `npm run verify:release:docker-local-production`
- observed exit: `2`
- capability code: `DOCKER_CLI_MISSING`
- failing probe: `docker --version`
- `missingExecutable`: `true`
- final marker: `[RPP-DOCKER-LOCAL-PRODUCTION:FAIL-CLOSED]`

The artifact keeps the topology fail-closed: one local inspection ingress on `127.0.0.1:8080`, private Docker service DNS for verifier traffic, packaged fallback disabled, and no tunnel tools.

## Focused validation

Commands run:

```sh
node --check test/rpp-0806-woocommerce-order-safety-refusal-v1.test.js
node --test test/rpp-0806-woocommerce-order-safety-refusal-v1.test.js
npm run verify:release:docker-local-production
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0806-woocommerce-order-safety-refusal-v1.md
git diff --check
```

Observed result:

- syntax check exit `0`
- focused test exit `0`
- topology command exit `2`, accepted for this sandbox because the recorded blocker was exactly `DOCKER_CLI_MISSING`
- evidence redaction scan exit `0`
- diff check exit `0`

## Residual risks

- This is not production-backed WooCommerce evidence.
- No WooCommerce order apply driver exists in this slice.
- The Docker topology did not start sites in this sandbox because Docker CLI is unavailable.
- Product catalog behavior, HPOS semantic reconciliation, refunds, subscriptions, stock side effects, emails, webhooks, and payment state transitions remain outside this proof.

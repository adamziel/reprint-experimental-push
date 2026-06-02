# Graph Identity Map Contract Guards

Date: 2026-06-02

## What Changed

Explicit WordPress graph identity-map contracts now fail closed earlier and
more precisely:

- unsupported identity-map table suffixes refuse with
  `WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_UNSUPPORTED_TABLE_SURFACE`;
- same-contract source/target pairs across different graph surfaces refuse
  with `WORDPRESS_GRAPH_IDENTITY_MAP_CONTRACT_CROSS_SURFACE`;
- apply requires rewrite-side `identityMapContractHash` and
  `identityMapContractValidationHash` when the corresponding
  `map-local-identity-to-remote` decision carried accepted contract evidence.

The apply-side missing-evidence path refuses forged ready plans before mutation
with `WORDPRESS_GRAPH_REWRITE_IDENTITY_MAP_CONTRACT_EVIDENCE_MISSING`.

## Verification

```bash
node --test --test-name-pattern 'explicit WordPress graph identity-map contract carries accepted proof|malformed explicit WordPress graph identity-map contract rows' test/push-planner.test.js
node --check src/apply.js && node --check src/wordpress-graph-contracts.js
node --test test/wordpress-graph-contracts.test.js test/push-planner.test.js
```

Observed result:

- focused graph contract tests passed 2/2;
- JS syntax checks passed;
- adjacent planner/graph suite passed 155/155.

## Caveat

This is contract-bound graph hardening, not complete general graph identity.
Generic WordPress identity mapping, arbitrary serialized reference rewriting,
and hosted production graph proof remain release-scope work.

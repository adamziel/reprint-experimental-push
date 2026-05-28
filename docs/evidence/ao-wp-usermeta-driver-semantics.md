# AO wp_usermeta Driver Semantics Evidence - 2026-05-28

Lane: `RPP-0427 wp_usermeta driver semantics`

## Scope

This evidence is focused plugin-driver support only. It does not change release
state, checklist counts, or the broader release NO-GO posture.

The focused proof covers:

- exact table binding for `wp-usermeta` and `wp-user-meta` on `wp_usermeta`;
- wrong-policy refusal when a `wp_usermeta` resource is paired with another
  driver such as `wp-postmeta` or `wp-termmeta`;
- executor refusal for forged ready plans that replace the usermeta driver with
  `wp-option`;
- hash-only journal and refusal evidence for private usermeta values;
- generated harness variants for supported and unsupported usermeta policies.

## Verification

Focused commands:

```sh
node --test --test-name-pattern 'wp_usermeta|wp_usermeta driver|plugin-owned data rows as redacted plugin data conflicts' test/push-planner.test.js
node --test --test-name-pattern 'RPP-0427' test/generated-push-harness.test.js
```

Release-support checks:

```sh
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html
```

## Non-Claim

This is not a general proof for every usermeta-producing plugin. Plugin-owned
usermeta remains accepted only when the resource has explicit owner and driver
policy, and unsupported or forged policy evidence fails closed before mutation.

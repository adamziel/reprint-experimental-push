# Runtime Capability Proof - 2026-05-27

Verdict: Docker/external production runtime remains blocked in this sandbox.

Checked proof command:

```bash
node scripts/playground/runtime-capability-proof.mjs
```

Current sandbox result:

- Docker: missing from `PATH`; the proof exits non-zero and fails closed with
  `DOCKER_RUNTIME_UNAVAILABLE`.
- Podman: missing from `PATH`; not accepted as Docker release proof.
- `wp-env`: not locally installed or declared, and it would still require a
  usable Docker daemon.
- Nix: `nix` and `nix-shell` are present, but this repo has no `flake.nix`,
  `shell.nix`, or `default.nix`; Nix can only provide client tools unless a
  Docker daemon/socket exists.
- Local PHP/SQLite: PHP has `pdo_sqlite` and `sqlite3`, plus `curl` and `tar`;
  this is a plausible non-Playground primitive, but no checked PHP/SQLite
  WordPress proof script exists yet.
- Closest checked local substitute: `npm run verify:release:local-production`
  with the Brewcommerce blueprint assets under
  `/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce`.
- Complex local substitute: `npm run verify:release:local-production:complex-site`
  passed on 2026-05-28 00:03 CEST. It remains local Playground evidence, but it
  adds a bounded Brewcommerce-derived site with 22 checked mutations, a dry-run
  receipt, auth/session readback, durable DB-journal gates, and remote-drift
  no-data-loss conflicts.
- Journal-window local substitute:
  `npm run verify:release:local-production:complex-site:journal-window` passed
  on 2026-05-28 00:16 CEST. It expands the same local Playground topology to a
  35-mutation ready plan and verifies 115 durable DB-journal rows with
  `mutationApplied: 35`, `applyRevalidationVerifiedCount: 35`, checked
  auth/session and durable-journal gates, and replay equivalence.
- Full Brewcommerce/WooCommerce import was attempted with
  `REPRINT_PUSH_LOCAL_PRODUCTION_FULL_BREWCOMMERCE=1`; all four sites booted,
  but the checked release verifier failed closed with
  `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` after source auth/session
  preflight timed out. That run is a blocker signal, not release evidence.

The exact next command for a Docker or external WordPress host is:

```bash
REPRINT_PUSH_SOURCE_URL=https://source.example REPRINT_PUSH_REMOTE_CHANGED_URL=https://changed.example REPRINT_PUSH_LOCAL_URL=https://local-edited.example REPRINT_PUSH_USERNAME=<admin> REPRINT_PUSH_APPLICATION_PASSWORD=<application-password> npm run verify:release
```

Scope caveat: the local substitute remains Playground loopback WordPress. It
does not prove Docker/private-network restart behavior or an external
production WordPress runtime.

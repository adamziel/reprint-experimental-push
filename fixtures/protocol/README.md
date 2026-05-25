# Push Protocol Fixtures

These fixtures are wire-contract examples for the production Reprint push
extension. They intentionally show request and response shape, not full site
exports or executable WordPress state.

The checked command for this fixture set is:

```sh
node --test test/protocol-fixtures.test.js
```

That command is the release-facing proof for the production push handshake,
live-source preflight, remote snapshot hash listing, dry-run receipt, apply-
time revalidation, journal inspect, and inspect-first recovery boundary.

The normal production sequence is:

1. `push-preflight-request.json`
2. `push-preflight-response.json`
3. `push-snapshot-hashes-request.json`
4. `push-snapshot-hashes-response.json`
5. `push-dry-run-request.json`
6. `push-dry-run-response.json`
7. `push-apply-batch-request.json`
8. `push-apply-batch-response.json`
9. `push-journal-request.json`
10. `push-journal-response.json`
11. `push-journal-open-response.json`
12. `push-recovery-inspect-request.json`
13. `push-recovery-inspect-response.json`
14. `push-recovery-inspect-blocked-response.json`
15. `push-recovery-request.json`
16. `push-recovery-response.json`
17. `push-topology.json`
18. `push-flow.json`
19. `push-recovery-decision.json`
20. `push-session-journal-proof.json`
21. `push-auth-session-journal-proof.json`
22. `push-auth-session-fencing-contract.json`
23. `push-auth-session-recovery-contract.json`
24. `push-auth-session-journal-recovery-contract.json`
25. `push-auth-session-journal-recovery-inspect-contract.json`
26. `push-journal-inspect-contract.json`
27. `push-pull-mapping.json`
28. `push-contract.json`
29. `push-topology-matrix.json`
30. `push-production-ladder-contract.json`
31. `push-executor-topology-proof.json`
32. `push-recovery-path.json`
33. `push-recovery-inspect-contract.json`
34. `push-recovery-revalidation-contract.json`
35. `push-snapshot-hashes-page-contract.json`
36. `push-dry-run-apply-revalidation-contract.json`
37. `push-remote-liveness-contract.json`
38. `push-remote-snapshot-listing-contract.json`
39. `push-deployment-topology-contract.json`
40. `push-protocol-extension-contract.json`
41. `push-pull-to-topology-contract.json`
42. `push-preflight-contract.json`
43. `push-remote-liveness-topology-contract.json`
44. `push-production-revalidation-contract.json`
45. `push-recovery-boundary-contract.json`
46. `push-production-push-recovery-contract.json`
47. `push-production-recovery-inspect-contract.json`
48. `push-production-recovery-drift-contract.json`
49. `push-production-topology-contract.json`
50. `push-production-auth-session-journal-recovery-inspect-contract.json`
51. `push-production-pull-bridge-contract.json`
52. `push-production-journal-lease-recovery-inspect-contract.json`
53. `push-production-executor-flow-contract.json`
54. `push-production-route-matrix-contract.json`
55. `push-protocol-extension-topology-contract.json`
56. `push-production-missing-secret-contract.json`
57. `push-production-release-boundary-contract.json`

That sequence is intentionally split into three production phases:

- preflight, remote snapshot hash listing, and dry-run establish eligibility
  only
- apply is a separate remote operation and must revalidate before every batch
  and again at the storage boundary
- journal inspect and recovery stay read-only until inspect proves the branch
  safe
- if the real push secret is unavailable, the harness must fail fast with an
  explicit missing-secret error before preflight, dry-run, or apply can run

For production review, the shortest path is:

1. `push-protocol-extension-contract.json`
2. `push-production-topology-contract.json`
3. `push-production-auth-session-journal-recovery-inspect-contract.json`
4. `push-production-revalidation-contract.json`
5. `push-production-recovery-inspect-contract.json`
6. `push-production-executor-flow-contract.json`

For the canonical production ladder and topology handoff, cite:

1. `push-protocol-extension-contract.json`
2. `push-production-push-recovery-contract.json`
3. `push-production-topology-contract.json`
4. `push-production-pull-bridge-contract.json`
5. `push-production-route-matrix-contract.json`
6. `push-production-auth-session-journal-recovery-inspect-contract.json`
7. `push-production-journal-lease-recovery-inspect-contract.json`
8. `push-production-executor-flow-contract.json`

For the production Docker and Playground harness shape, the topology pair is:

1. `push-production-topology-contract.json`
2. `push-production-route-matrix-contract.json`
3. `push-production-executor-flow-contract.json`

Use that pair when you need the one-remote, one-local, one-drift proof plus the
shared route matrix, ingress rule, and local-only proxy policy in one review
path.

For the release-facing production proof, use:

```sh
npm run verify:release
```

That command must either reach a supplied Playground source preflight or fail
closed with the exact `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` or
`REPRINT_PUSH_SECRET_REQUIRED` gate before preflight, dry-run, or apply.

The checked command for the topology proof is:

```sh
npm run test:playground:production-shaped-topology-proof
```

It prints the one-remote, one-local, one-drift harness summary and the shared
Docker and Playground route matrix without requiring live credentials.

The checked proof command for this fixture set is `node --test test/protocol-fixtures.test.js`.
It exercises the production executor flow contract, the route matrix, the pull
bridge, the live revalidation contract, and the inspect-first recovery boundary
as a single production-shaped proof.

For the release-facing production-shaped proof that also pins the explicit
missing-secret gate, run:

```sh
npm run test:playground:production-shaped-proof
```

That command runs the protocol fixture test and then proves the harness fails
fast with `REPRINT_PUSH_SECRET_REQUIRED` when the real push secret is absent.

That checked command is also the release-facing proof entry point for the
explicit missing-secret gate: when the real push secret is unavailable, the
harness must fail fast before preflight, dry-run, or apply can proceed.

The checked release-boundary contract is:

```json
push-production-release-boundary-contract.json
```

It keeps the exact live-source gate separate from the first remaining
production boundary so the supervisor output can distinguish missing source
input from the still-unimplemented auth/session and durable-journal proof.

If you want the production-shaped missing-secret proof directly, run:

```sh
npm run test:playground:production-shaped-missing-secret
```

The direct smoke for the gate is:

```sh
npm run test:playground:production-shaped-missing-secret
```

It fails with `REPRINT_PUSH_SECRET_REQUIRED` unless
`REPRINT_PUSH_SIGNING_SECRET` or `REPRINT_PUSH_APPLICATION_PASSWORD` is set.

When you need the exact one-remote, one-local topology proof, start with:

1. `push-production-topology-contract.json`
2. `push-production-route-matrix-contract.json`
3. `push-production-executor-flow-contract.json`

The seven protocol surfaces are the ones the executor must treat as distinct
remote boundaries:

- preflight
- remote snapshot hash listing
- dry-run plan upload
- mutation batch apply
- journal inspect
- recovery inspect
- recovery mutate

The `journal` and `recovery-inspect` stages are intentionally separate:

- `push_journal` records durable evidence without authorizing mutation.
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating repair.
- `push_recover auto|finish|rollback` may mutate only after inspect proves
  the branch safe and the auth floor still holds.

The runtime sequence is fixed and non-overlapping:

1. `push_preflight` binds the persisted pull base package to one live remote identity and one short-lived push session.
2. `push_snapshot_hashes` lists remote hashes for planning only.
3. `push_plan_dry_run` uploads the canonical plan and returns an eligibility receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and again at the storage boundary.
5. `push_journal` records durable evidence without authorizing mutation.
6. `push_recover inspect` reads the journal and fresh live hashes before any mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves the branch safe and the auth floor still holds.

The production topology proof is one remote source site, one imported local
edit site, one later drift observation of the same remote identity, and one
runner:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery

The production topology proof is the same in Docker and Playground:

- `remote-base` seeds the persisted pull base package
- `local-edited` is the imported local edit site derived from that package
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The production test topology is intentionally fixed:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits derived from that package
- `remote-changed` reuses the same remote identity after drift
- `runner` owns preflight, snapshot listing, dry-run, apply, journal inspect,
  and recovery
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

That same proof bundle keeps the one-remote, one-local, one-drift topology
explicit:

- The topology proof is intentionally the same one-remote, one-local, one-drift
  shape in Docker and Playground.
- The mapping from pull exporter/importer to push surfaces is explicit and
  one-way.
- `remote-base` and `remote-changed` are the same remote identity at
  different times
- `local-edited` is the imported local site derived from the persisted pull
  base package
- `runner` uses the same route names in Docker and Playground
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy

The production proof bundle is intentionally layered and keeps the same remote
identity across `remote-base` and `remote-changed`:

- `push-protocol-extension-contract.json` is the top-level production ladder
  proof. Start here when you need the full preflight, remote snapshot hash
  listing, dry-run plan upload, batched apply, journal inspect, and
  inspect-first recovery story in one object, with dry-run and apply kept
  separate while apply revalidates fresh live evidence before every batch and
  again at the storage boundary.
- `push-protocol-extension-contract.json` also carries the canonical
  exporter/importer bridge, so the immutable pull base package, pull
  provenance mapping, auth floor, and one-remote-one-local-one-drift topology
  stay together in the same review object.
- `push-protocol-extension-topology-contract.json` is the compact umbrella
  proof that keeps the same ladder aligned with the one-remote, one-local,
  one-drift Docker and Playground topology.
- `push-production-ladder-contract.json` is the compact stage-order proof
  for the same preflight through inspect-first recovery ladder when you only
  need the production sequence and the pull-to-push bridge in one object.
- `push-production-topology-contract.json` pairs the pull bridge with the
  one-remote, one-local, one-drift topology for the production harness in
  both Docker and Playground.
- `push-deployment-topology-contract.json` is the smaller topology-only proof
  for Docker and Playground when you only need the one-remote, one-local
  harness shape.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the compact production proof that keeps auth, session minting, journal rows,
  lease fencing, and inspect-first recovery aligned on the same remote
  identity and local edit site.
- The shortest review path through the production bundle is
  `push-protocol-extension-contract.json`, `push-production-topology-contract.json`,
  `push-production-auth-session-journal-recovery-inspect-contract.json`, and
  `push-production-executor-flow-contract.json`.
- `push-remote-snapshot-listing-contract.json` is the compact proof that
  keeps planning-only remote hash discovery separate from write authority.
- `push-production-revalidation-contract.json` is the compact proof that
  keeps preflight, planning-only snapshot hashes, dry-run eligibility,
  apply-time revalidation, journal evidence, and inspect-first recovery
  together.
- `push-production-push-recovery-contract.json` is the compact proof that
  ties the pull provenance, the production push ladder, the one-remote,
  one-local topology, and inspect-first recovery into one reviewable object.
- `push-production-recovery-inspect-contract.json` is the compact proof that
  recovery inspect stays read-only while the journal row, lease fence, live
  evidence, auth floor, and `8080` topology still match the write path.
- `push-production-recovery-inspect-contract.json` proves the inspect-first
  recovery branch stays aligned with the journal row, lease fence, and fresh
  live hashes.
- `push-production-recovery-drift-contract.json` is the compact proof that
  recovery inspect stays read-only after live drift while the persisted pull
  base, journal row, auth floor, and one-remote, one-local topology still
  line up for a safe mutating recovery branch.
- `push-production-route-matrix-contract.json` is the compact proof that the
  same route names, ingress rule, and proxy policy stay aligned in Docker and
  Playground while the one-remote, one-local, one-drift harness remains fixed.
- `push-recovery-inspect-contract.json` and
  `push-auth-session-journal-recovery-inspect-contract.json` are the compact
  inspect-first recovery proofs that keep the journal row, lease fence, live
  hashes, and recovery classification read-only before any mutating repair.
- `push-production-recovery-inspect-contract.json` and
  `push-production-recovery-drift-contract.json` are the production-shaped
  inspect-first recovery proofs that keep the auth floor, the journal row,
  and live drift classification aligned with the same remote identity.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the compact production auth/session/journal/lease/recovery-inspect proof
  for the same remote identity and local edit site.
- `push-production-auth-session-journal-recovery-inspect-contract.json` is
  the proof to cite when you need the minimum production evidence for auth
  floor, push session minting, journal rows, lease fencing, and read-only
  recovery inspect on the same remote identity.
- `push-production-journal-lease-recovery-inspect-contract.json` is the
  narrowest production proof for journal rows, lease fencing, and inspect-
  first recovery after the dry-run/apply split.
- `push-production-executor-flow-contract.json` is the compact end-to-end
  proof for the full preflight through inspect-first recovery ladder on the
  one-remote, one-local, one-drift harness.
- `push-pull-mapping.json` and `push-contract.json` map the immutable pull
  provenance into the push protocol.
- `push-protocol-extension-contract.json` is the umbrella ladder proof that
  ties preflight, planning-only snapshot listing, dry-run eligibility,
  batched apply, journal inspect, and inspect-first recovery into one object.
- `push-preflight-contract.json` keeps the first live binding explicit: the
  imported base, requested scope, and short-lived session are tied together
  before snapshot listing starts.
- `push-remote-liveness-contract.json`, `push-dry-run-apply-revalidation-contract.json`,
  and `push-recovery-revalidation-contract.json` keep the liveness split and
  inspect-first recovery rules explicit.
- `push-remote-snapshot-listing-contract.json` isolates the planning-only
  remote hash listing and keeps its cursorability separate from write
  authority.
- `push-remote-liveness-topology-contract.json` combines that liveness split
  with the one-remote, one-local, one-drift test topology so a review can
  cite a single compact proof for both sequencing and harness shape.
- `push-production-pull-bridge-contract.json` pairs with
  `push-production-topology-contract.json` when you need the immutable pull
  provenance bridge and the production-shaped one-remote, one-local, one-drift
  harness in a single review path.
- `push-production-route-matrix-contract.json` is the compact proof that
  combines the bridge and the Docker/Playground route matrix for the same
  one-remote, one-local, one-drift harness.
- `push-production-executor-flow-contract.json` is the compact end-to-end
  production bundle for the pull handoff, preflight, planning-only hash
  listing, dry-run receipt, batched apply, journal inspect, and inspect-first
  recovery on the one-remote, one-local, one-drift harness.
- `push-production-journal-lease-recovery-inspect-contract.json` is the compact production proof for journal rows, lease fencing, and read-only recovery inspect after the dry-run/apply split.
- `push-preflight-contract.json` and `push-remote-snapshot-listing-contract.json`
  are the short-form proofs for the first live binding and the planning-only
  remote hash listing step.
- `push-deployment-topology-contract.json` is the smallest Docker and
  Playground topology-only proof, with the sandbox-provided `8080` ingress
  rule, the local-only proxy policy, and the no-tunnel rule spelled out.
- `push-remote-liveness-topology-contract.json` is the smallest topology plus
  liveness proof that keeps dry-run and apply separate while apply
  revalidates fresh live evidence before every batch and at the storage
  boundary.
- `push-production-topology-contract.json` is the compact production proof for
  the one-remote, one-local, one-drift harness in both Docker and Playground.
- `push-deployment-topology-contract.json` and
  `push-remote-liveness-topology-contract.json` are the two compact topology
  fixtures to cite when you need one remote source site, one imported local
  edited site, one later drift observation of the same remote identity, and
  the sandbox-provided `8080` ingress rule.
- `push-executor-topology-proof.json` is the shortest one-remote, one-local,
  one-drift topology proof that keeps the route names and `8080` ingress
  aligned in Docker and Playground.
- `push-production-push-recovery-contract.json` is the canonical
  end-to-end production bundle for the pull provenance, push ladder, and
  one-remote, one-local topology story, including the same remote identity
  before and after drift. It also pins the shared auth/session floor, the
  journal rows, lease fencing, and inspect-first recovery path so the same
  proof covers dry-run, apply, and recovery.

The fixed production ladder is:

1. Exporter/importer create and persist the immutable pull base package.
2. `push_preflight` binds that package to one live remote identity and one
   short-lived push session.
3. `push_snapshot_hashes` is planning evidence only.
4. `push_plan_dry_run` returns an eligibility receipt, not a lock.
5. `push_batch_apply` revalidates fresh live evidence before every batch and at
   the storage boundary.
6. `push_journal` records durable evidence without authorizing mutation.
7. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
8. `push_recover auto|finish|rollback` mutates only after inspect proves the
   branch safe with the same auth floor as the write path.

The compact topology proof pair for review is:

- `push-deployment-topology-contract.json` for the Docker and Playground
  topology-only shape
- `push-production-topology-contract.json` for the pull bridge plus the
  one-remote, one-local, one-drift production harness

The operational model is the same in every production proof:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning-only evidence for the live remote
  comparison surface
- `push_plan_dry_run` uploads the canonical plan and returns an eligibility
  receipt, not a lock
- `push_batch_apply` is a separate remote operation that revalidates fresh
  live evidence before every batch and again at the storage boundary
- `push_journal` records durable evidence without authorizing mutation
- `push_recover inspect` reads the journal and fresh live hashes before any
  mutating recovery branch
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The test topology is also fixed:

- `remote-base` seeds the persisted pull base package
- `local-edited` carries the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` is the only actor that may preflight, list hashes, dry-run, apply,
  inspect the journal, or recover
- Docker uses one private network
- Playground uses separate disposable blueprints
- browser-visible inspection stays on the sandbox-provided `8080` ingress
  through a local-only proxy
- remote tunnels are disallowed

The protocol extension itself is intentionally stage-ordered:

1. `push_preflight` binds the persisted pull base package to one live remote
   identity and one short-lived push session.
2. `push_snapshot_hashes` lists the live remote comparison surface for
   planning only and never becomes write authority.
3. `push_plan_dry_run` uploads the canonical plan and returns an eligibility
   receipt, not a lock.
4. `push_batch_apply` revalidates fresh live evidence before every batch and
   again at the storage boundary.
5. `push_journal` records durable evidence without authorizing mutation.
6. `push_recover inspect` reads the journal and fresh live hashes before any
   mutating repair.
7. `push_recover auto|finish|rollback` may mutate only after inspect proves
   the branch safe with the same auth floor as the write path.

The pull/export/import pipeline is the only source of immutable push
provenance:

- exporter discovers the merge base and coverage evidence
- importer persists the base package as immutable provenance
- `push_preflight` is the first live binding after importer persistence
- `push_snapshot_hashes` is planning evidence only
- `push_plan_dry_run` is an eligibility receipt, not a lock
- `push_batch_apply` revalidates fresh live evidence before every batch and
  again at the storage boundary
- `push_journal` is read-only evidence
- `push_recover inspect` is read-only and must happen before any mutating
  repair
- `push_recover auto|finish|rollback` may mutate only when inspect proves the
  branch safe and the auth floor still holds

The shared auth/session/journal proof path is also explicit:

- push authentication must be at least as strict as current Reprint HMAC
  usage
- mutating calls use the minted push session plus the canonical push
  signature and idempotency key
- journal rows carry the claim, lease, and fencing evidence that inspect
  reads back before any repair branch
- stale dry-run evidence never becomes recovery authority
- recovery stays inspect-first even when the journal is present

The top-level ladder is intentionally staged:

1. preflight
2. remote snapshot hash listing
3. dry-run plan upload
4. batched apply with apply-time revalidation
5. journal inspect
6. inspect-first recovery
- `push-production-topology-contract.json` is the compact one-remote,
  one-local, one-drift proof that keeps the pull provenance, push ladder, and
  Docker/Playground topology aligned in one object.
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` are the paired production
  proofs for auth, session minting, journal rows, lease fencing, and
  inspect-first recovery on the same remote identity.
- `push-production-pull-bridge-contract.json` is the compact proof that
  ties exporter/importer provenance directly to the full push ladder,
  including preflight, planning-only hash listing, dry-run eligibility,
  batched apply, journal inspect, and inspect-first recovery.
- `push-production-topology-contract.json` is the compact proof that keeps
  the immutable pull provenance, the production push ladder, and the
  one-remote, one-local, one-drift topology aligned in one object.
- `push-remote-liveness-topology-contract.json` is the compact proof that
  keeps the topology and the dry-run/apply liveness split together while
  still requiring apply-time revalidation.
- `push-snapshot-hashes-request.json`, `push-snapshot-hashes-response.json`,
  and `push-snapshot-hashes-page-contract.json` keep the live remote hash
  listing clearly in the planning-only lane, including cursoring for larger
  sites.
- `push-auth-headers.json`, `push-auth-session-journal-proof.json`, and
  `push-auth-session-fencing-contract.json` show the auth floor that is at
  least as strict as current Reprint HMAC usage and keep the session, lease
  fence, and inspect-first recovery proof together.
- `push-auth-session-journal-recovery-contract.json` is the compact proof that
  binds auth, session minting, journal rows, lease fencing, and inspect-first
  recovery into one production-shaped contract, and is the canonical bridge
  when a review needs the auth floor, session mint, journal row, and recovery
  inspect proof together.
- `push-session-journal-proof.json` is the restart-proof tuple for the minted
  push session, the fenced journal row, and inspect-first recovery when a
  review needs the same production claim chain in its smallest form.
- `push-auth-session-journal-recovery-inspect-contract.json` and
  `push-recovery-inspect-contract.json` are the compact inspect-first gates
  that keep read-only recovery classification explicit before any mutation.
- `push-recovery-boundary-contract.json` is the compact proof that keeps the
  inspect-first recovery boundary, the auth floor, and the Docker/Playground
  topology together in one object.
- `push-auth-session-journal-recovery-inspect-contract.json` is the compact
  proof that folds live drift classification into that same auth, session,
  journal, lease, and inspect-first recovery chain.
- `push-topology-matrix.json` is the canonical Docker/Playground stage matrix
  for one remote source, one local edited site, and one drift witness. It now
  also carries the explicit `docker` and `playground` harness blocks so the
  `8080` ingress rule and local-only proxy policy are machine-readable.
- `push-production-revalidation-contract.json` is the compact proof that
  keeps the same auth floor, the minted push session, the journal row, the
  lease fence, and the inspect-first recovery path in one place while still
  making apply-time revalidation explicit.
- `push-journal-inspect-contract.json` is the compact proof that journal
  inspection is read-only evidence and never becomes write authority.
- `push-auth-session-recovery-contract.json` keeps the stronger auth floor and
  the recovery fence together when a test wants to prove the claim is still
  fenced at recovery time.
- `push-recovery-inspect-contract.json` is the compact inspect-first proof to
  cite when a test needs the minted session, the journal row, the claim fence,
  the fresh-live hash classification, and the read-only recovery boundary in
  one object.
- `push-topology.json`, `push-topology-matrix.json`, and
  `push-deployment-topology-contract.json` prove the one-remote, one-local,
  one-drift-witness topology in both Docker and Playground. The matrix is the
  canonical machine-readable topology proof, and the deployment contract now
  also carries the explicit Docker/Playground test topology block.
- `push-production-topology-contract.json` is the compact production bundle
  that keeps the same one-remote, one-local, one-drift topology and the
  push-stage sequence in a single object.
- `push-production-push-recovery-contract.json` and
  `push-production-recovery-inspect-contract.json` are the compact production
  recovery pair for auth, session, journal, lease, and inspect-first
  recovery proof.
- The test topology is the same in both harnesses: `remote-base` seeds the
  persisted pull base, `local-edited` holds the imported local edits,
  `remote-changed` is the same remote identity after drift, and `runner`
  owns the push protocol calls.
- The browser-visible proof path stays on the sandbox-provided `8080`
  ingress through a local-only proxy; remote tunnels are not part of the test
  topology.
- `push-executor-topology-proof.json` is the shortest proof that the executor
  keeps the same remote identity, the same route names, and the
  sandbox-provided `8080` ingress rule aligned across Docker and Playground.
- `push-pull-to-topology-contract.json` is the smallest bridge from pull
  provenance into the production push topology when a review needs the proof
  chain in compact form.

When you need the minimum review order, cite these four objects together:

1. `push-protocol-extension-contract.json` for the full stage ladder.
2. `push-production-pull-bridge-contract.json` for exporter/importer to push
   mapping.
3. `push-remote-liveness-topology-contract.json` for dry-run/apply separation
   with apply-time revalidation.
4. `push-deployment-topology-contract.json` for the one-remote, one-local,
   one-drift harness and the `8080` ingress rule.

The canonical topology proof is always one remote source, one imported local
edited site, and one later drift observation of the same remote identity:

- `remote-base` seeds the persisted pull base package
- `local-edited` holds the imported local edits
- `remote-changed` is the same remote identity observed later after drift
- `runner` owns preflight, snapshot listing, dry-run upload, apply, journal
  inspect, and recovery
- browser-visible inspection stays on the sandbox-provided `8080` ingress via
  a local-only proxy

The canonical end-to-end bundle for the push extension is:

| Fixture | Role |
| --- | --- |
| `push-protocol-extension-contract.json` | Full production ladder from preflight through inspect-first recovery. |
| `push-pull-to-topology-contract.json` | Compact bridge from pull provenance into the production push topology. |
| `push-executor-topology-proof.json` | Shortest Docker/Playground proof for one remote, one local, one drift witness. |
| `push-topology-matrix.json` | Machine-readable stage matrix for Docker and Playground. |
| `push-preflight-contract.json` | First live binding between immutable pull provenance, scope, and session. |
| `push-remote-liveness-contract.json` | Separate planning-only and write-side liveness boundaries. |
| `push-dry-run-apply-revalidation-contract.json` | Dry-run/apply separation plus revalidation at batch and storage boundaries. |
| `push-recovery-inspect-contract.json` | Read-only inspect step that classifies recovery before mutation. |
| `push-auth-session-journal-recovery-contract.json` | Compact auth, session, journal-row, lease-fence, and inspect-first recovery proof. |
| `push-recovery-revalidation-contract.json` | Mutating recovery still requires fresh live hashes after inspect. |

## Canonical Topology

The production topology is always the same one-remote, one-local, one-drift
shape:

| Role | Fixture name | Meaning |
| --- | --- | --- |
| `remote-base` | remote source site | Seeds the persisted pull base package. |
| `local-edited` | imported local site | Carries the imported local edits. |
| `remote-changed` | later remote observation | Is the same remote identity observed after drift. |
| `runner` | protocol runner | Owns preflight, snapshot listing, dry-run, apply, journal inspect, and recovery. |

The harness rules are fixed:

- Docker uses one private network for the four roles.
- Playground uses separate disposable blueprints for the same roles.
- Browser-visible inspection stays on the sandbox-provided `8080` ingress.
- Local-only proxying is allowed; remote tunnels are not.
- Dry-run and apply stay separate remote calls, and apply revalidates fresh
  live evidence before every batch and at the storage boundary.

Failure and recovery examples:

- `push-precondition-failed-response.json` shows apply-time liveness
  revalidation rejecting a stale target.
- `push-journal-request.json` and `push-journal-response.json` show the
  read-only inspection step used before any lost-response retry or recovery
  decision.
- `push-journal-open-response.json` shows an in-progress claim with fenced
  writer evidence, including claim generation and lease expiry, which is the
  proof the executor needs before it retries or recovers an interrupted apply.
- `push-recovery-request.json` and `push-recovery-response.json` show a
  successful recovery finalization after a read-only inspect step.
- `push-recovery-inspect-request.json` and `push-recovery-inspect-response.json`
  show the read-only evidence lookup used before any mutating recovery mode.
- `push-recovery-inspect-blocked-response.json` shows the same inspect step
  when the remote can prove that finish or rollback is not safe.
- `push-recovery-blocked-response.json` shows the evidence returned when the
  remote cannot prove a safe finish or rollback.
- `push-pull-mapping.json` shows how the persisted pull base package becomes
  immutable provenance for push preflight, snapshot listing, dry-run upload,
  batched apply, journal inspection, and recovery.
- `push-production-ladder-contract.json` shows the production stage order and
  the liveness split: preflight, snapshot listing, dry-run, apply, journal
  inspect, and inspect-first recovery stay separate.
- `push-session-journal-proof.json` shows the restart-proof tuple that binds
  the minted push session to the journal claim, lease fence, and inspect-first
  recovery path.
- `push-auth-session-journal-proof.json` shows the stronger production proof
  that keeps push auth at least as strict as the export HMAC family while
  binding the session, journal row, lease fence, and inspect-first recovery
  path together.
- `push-auth-session-journal-recovery-contract.json` keeps those same
  production pieces in one compact contract when a review needs the auth floor,
  session mint, journal row, and recovery inspect proof together.
- `push-auth-headers.json` shows the authentication floor for read-only
  inspection versus mutating push requests: inspect stays on the existing HMAC
  family, while dry-run, apply, and mutating recovery require the push
  session, idempotency key, and canonical push signature.
- `push-auth-session-recovery-contract.json` is the compact contract that
  binds push auth, the minted session, the journal fence, and inspect-only
  recovery in one place.
- `push-auth-session-journal-recovery-contract.json` is the compact bridge
  from the auth floor into journal rows, lease fencing, and inspect-first
  recovery.
- `push-auth-session-journal-recovery-inspect-contract.json` is the compact
  proof that keeps auth, session minting, journal rows, lease fencing, live
  drift classification, and inspect-first recovery together in one object.
- `push-flow.json` shows the ordered push stages from preflight through
  inspect-first recovery and makes the dry-run/apply split explicit.
- `push-topology.json` shows the one-remote, one-local, one-drift-witness
  proof shape and the sandbox-only `8080` browser ingress rule.
- `push-auth-headers.json` shows the required authentication header families
  and versioned canonical push signature parts for dry-run, apply, and mutating
  recovery requests.
- `push-topology.json` gives a machine-readable one-remote, one-local proof
  shape for Docker and Playground test harnesses, including the same remote site
  after independent drift between dry-run and apply. It also records the
  remote identity binding that makes `remote-base` and `remote-changed` two
  observations of the same site rather than different sites.
- the pull/export/import pipeline maps to the push ladder in the same order
  the executor runs it: exporter discovers the merge base, importer persists
  the base package, `push_preflight` binds the immutable input, `push_snapshot_hashes`
  stays planning-only, `push_plan_dry_run` returns a receipt, `push_batch_apply`
  revalidates before every batch, `push_journal` stays read-only, and
  `push_recover inspect` stays read-only before any mutating recovery.
- `push-executor-topology-proof.json` gives the shortest executor-shaped proof
  that Docker and Playground share the same remote identity twice, the same
  route names, and the same browser-visible ingress rule.
- `push-recovery-decision.json` gives the inspect-first recovery decision
  matrix that keeps `inspect` read-only and requires fresh live proof before
  any mutating recovery mode.
- `push-recovery-path.json` gives the machine-readable inspect-first recovery
  classification used when a batch response is ambiguous and the executor must
  distinguish old, new, blocked, and open outcomes from journal plus live
  evidence.
- `push-recovery-inspect-contract.json` ties the minted session, journal row,
  live drift evidence, and inspect-first recovery rules into one compact
  contract for recovery proofs.
- `push-recovery-blocked-response.json` shows the inspect-first blocked case
  when the remote cannot prove a safe finish or rollback and returns
  `RECOVERY_BLOCKED` instead of mutating.
- `push-contract.json` gives the compact production contract that ties the
  exporter/importer handoff, push stages, auth/session proofs, and
  Docker/Playground topology into a single fixture.
- `push-topology-matrix.json` gives the shortest machine-readable proof of the
  one-remote, one-local, one-drift-witness topology used by both Docker and
  Playground test harnesses. It now carries the persisted pull base package
  plus the explicit preflight, snapshot listing, dry-run, apply, journal, and
  recovery boundaries so the topology proof stays tied to exporter/importer
  provenance and the production push sequence.
- `push-snapshot-hashes-page-contract.json` gives the compact cursoring proof
  for large remote sites and keeps partial snapshot listings clearly in the
  planning-only lane.
- `push-dry-run-apply-revalidation-contract.json` gives the compact proof that
  snapshot planning, dry-run eligibility, apply-time revalidation, and
  storage-boundary guards stay separate even when the remote drifts between
  dry-run and apply.
- `push-remote-liveness-contract.json` gives the compact proof that
  preflight, remote snapshot hash listing, dry-run receipt, batched apply,
  journal inspect, and inspect-first recovery stay on separate liveness
  boundaries.
- `push-protocol-extension-contract.json` gives the shortest end-to-end proof
  that the production push extension maps the pull exporter/importer
  provenance into preflight, snapshot listing, dry-run upload, batched apply,
  journal inspection, and inspect-first recovery while keeping the one-remote,
  one-local, one-drift topology explicit. It also points at the narrower
  auth/session fencing, recovery-inspect, and liveness proofs so the
  production bundle stays easy to navigate.
- `push-production-revalidation-contract.json` gives the compact proof that
  keeps the preflight, snapshot hash listing, dry-run eligibility, apply-time
  revalidation, journal evidence, and inspect-first recovery boundaries in one
  object.
- `push-deployment-topology-contract.json` and `push-pull-to-topology-contract.json`
  give the deployment and pull-to-push bridge proofs for the same one-remote,
  one-local, one-drift topology in Docker and Playground.
- `push-pull-to-topology-contract.json` gives the smallest composite proof that
  links the persisted pull base package to the production push ladder and the
  Docker/Playground topology in one object. Use it when a review wants the
  pull provenance, live-remote liveness split, auth floor, and 8080/local-only
  ingress rule in a single compact contract.
- `push-protocol-extension-contract.json` is the best single proof for the
  full production push extension: preflight, remote hash listing, dry-run
  receipt, batched apply, journal inspect, and inspect-first recovery.
- `push-deployment-topology-contract.json` is the clearest topology-only
  proof for one remote source, one local edited site, and one drift witness in
  both Docker and Playground.
- `push-recovery-revalidation-contract.json` gives the compact proof that the
  same drift case still requires fresh live hashes before each apply batch and
  before any mutating recovery path.
- `push-production-ladder-contract.json` gives the compact end-to-end proof
  that preflight, snapshot listing, dry-run, apply, journal inspect, and
  recovery all stay on the production push ladder while Docker and Playground
  use the same one-remote, one-local topology.
- `push-executor-topology-proof.json` gives the shortest proof that the
  executor keeps the pull provenance, push staging, and browser ingress on one
  production-shaped topology. It is the canonical fixture to cite when a test
  needs to prove that Docker and Playground both reuse the same remote identity
  twice, keep `remote-base` and `remote-changed` as two observations of that
  one site, and keep browser-visible inspection on the sandbox-provided `8080`
  ingress with a local-only proxy.
- `push-deployment-topology-contract.json` gives the smallest topology-only
  contract for Docker and Playground. It isolates the one-remote, one-local,
  one-drift-witness shape and keeps the pull-to-push mapping and ingress rules
  visible in one compact object. Use it when a test needs to prove the
  production push ladder end to end in a small form: exporter/importer feed
  preflight, snapshot-hash listing stays planning-only, dry-run returns a
  receipt, apply revalidates before every batch and at the storage boundary,
  journal inspect stays read-only, and recovery must start with inspect before
  any mutating repair.
- `push-preflight-contract.json` gives the compact first-binding proof that the
  persisted pull base, requested scope, live remote identity, and short-lived
  session all line up before snapshot listing begins.

The recovery proof fixtures are intentionally split so the auth fence and the
inspect fence can be asserted independently or together:

- `push-auth-session-journal-proof.json` binds push auth, session minting,
  claim generation, lease expiry, and inspect-first recovery to the same
  journal row.
- `push-auth-session-fencing-contract.json` keeps the same auth/session proof
  in a compact form when a test wants one fixture that ties the journal row,
  lease fence, and inspect-first recovery boundary together.
- `push-session-journal-proof.json` keeps the restart-proof tuple that binds
  the minted push session to the journal claim, lease fence, and
  inspect-first recovery path.
- `push-auth-session-recovery-contract.json` keeps the stronger auth floor and
  the recovery fence together when a test wants to prove the claim is still
  fenced at recovery time.
- `push-recovery-inspect-contract.json` keeps the inspect-only recovery step
  explicit when a test only needs the session, journal row, and live hash
  classification.
- `push-recovery-revalidation-contract.json` shows the same drift case still
  requires fresh live hashes before apply or mutating recovery.
- `push-production-recovery-drift-contract.json` shows the recovery case
  after drift while keeping the pull provenance, journal evidence, and
  one-remote, one-local topology aligned.
- `push-recovery-boundary-contract.json` gives the compact proof that keeps
  inspect-first recovery, the auth floor, and the Docker/Playground topology
  together in one object.

Fixture values such as `sha256:plan` are placeholders. Tests that execute the
protocol should replace them with canonical hashes generated from the exact
request bodies and should verify idempotency with byte-identical replays.

Dry-run and apply are intentionally separate fixtures. A test must not treat
`push-dry-run-response.json` as permission to skip the live preconditions in
`push-apply-batch-request.json`; apply revalidates the remote and can still
return `push-precondition-failed-response.json`.

The journal and recovery fixtures show how a client resolves ambiguity after
timeouts or crashes:

- `push-journal-response.json` reports the evidence needed to decide whether a
  request was only accepted, already committed, or still replayable.
- `push-recovery-response.json` shows the proof-oriented repair path.
- `push-recovery-blocked-response.json` shows the case where the server cannot
  prove that finish or rollback is safe.
- `push-recovery-request.json` also covers the read-only `mode: "inspect"`
  call used to read evidence before any mutating recovery mode.

Recovery examples use `mode: "auto"` for a mutating repair attempt. A pure
inspection call uses the same `push_recover` endpoint with `mode: "inspect"`
and omits the mutating recovery idempotency key unless the implementation
requires idempotency for all recovery requests.

`push_journal` is the ambiguity resolver after a timeout or crash. It reads
durable journal rows that carry claim ownership, claim generation, lease
expiry, and resource-level before/staged/after hashes.
`push_recover` `mode: "inspect"` is the evidence reader that decides whether
the next safe step is finish, rollback, retry, or block. Neither call should
be treated as a live write lock.
`push_recover` `mode: "inspect"` must happen before any mutating recovery
mode, and the blocked inspect fixture proves that the read-only path can
return a definitive stop without authorizing repair.

The open-journal and inspect fixtures intentionally keep the proof surface
small but explicit:

- `push-journal-open-response.json` shows a claim owner, claim generation,
  lease expiry, and per-resource guard outcomes so fenced ownership is visible.
- `push-recovery-inspect-response.json` reports the journal and live-hash
  review result without authorizing a mutation.
- `push-recovery-response.json` is only the committed case after the inspect
  evidence proves the batch can be finalized safely.

The fixtures are intentionally paired so tests can verify the full sequence:
preflight, remote snapshot hash listing, dry-run upload, batched apply,
journal inspection, and recovery. They should be treated as wire-contract
examples only; the production executor must still revalidate the live remote
between dry-run and every apply batch.

The hash-listing fixture is the planning boundary:

- `push-snapshot-hashes-request.json` binds the live remote scope used for
  planning.
- `push-snapshot-hashes-response.json` proves the remote returned a complete
  cursorable hash view for the requested scopes.
- dry-run may only consume that listing as evidence; it is never the write
  lock.
- apply must fetch fresh live evidence again before each batch.

The topology proof is intentionally asymmetric and mirrors the production
sequence exactly:

- `remote-base` is the source site that produced the persisted pull base.
- `local-edited` is the imported local clone after user edits.
- `remote-changed` is the same remote site after it drifts between dry-run and apply.
- the runner is the only process that can compare, upload, inspect, or
  recover.

The test only proves the production rule if the remote changes after dry-run
and before `push_batch_apply`.
Reusing a stale snapshot as the apply target turns the drift case into a
replay of old state and weakens the proof that apply revalidates live state.

For integration tests, the fixtures are meant to be exercised in the same
one-remote, one-local topology described in the executor docs:

- `remote-base` is the remote source site that produced the pull base package.
- `local-edited` is the locally edited site used to build the candidate plan.
- `remote-changed` is the same remote after live drift and is used to prove
  apply-time revalidation, journal inspection, and recovery are distinct from
  dry-run.

That topology is the minimal production-shaped test setup because it keeps the
planning remote and the drift remote separate while the runner remains the
only process that can compare, upload, and recover.

The fixture topology encodes the exact proof order the executor must preserve:

1. `push_preflight` authenticates a push-scoped session against the live remote.
2. `push_snapshot_hashes` records the current remote comparison set and coverage.
3. `push_plan_dry_run` uploads the canonical plan without mutating anything.
4. `push_batch_apply` revalidates the live remote again before every batch and at the storage boundary.
5. `push_journal` resolves lost responses and crash ambiguity without authorizing a write.
6. `push_recover inspect` reads evidence first, and mutating recovery modes only proceed when the journal and live hashes prove the action.

The fixture set is meant to be read as one production contract:

- `push-preflight-*` fixtures bind the persisted pull base to the live remote
  identity and a short-lived push session.
- `push-snapshot-hashes-*` fixtures show the cursorable live planning view and
  the coverage proof for the requested scope.
- `push-snapshot-hashes-page-contract.json` makes the partial-listing boundary
  explicit so tests can prove cursorable planning without treating a page as a
  lock.
- `push-dry-run-*` fixtures show the canonical plan upload and the resulting
  eligibility receipt, not a lock.
- `push-apply-batch-*` fixtures prove apply-time live revalidation on a batch
  boundary.
- `push-journal-*` fixtures expose durable claim, lease, and fencing evidence
  for lost-response recovery.
- `push-recovery-*` fixtures keep `inspect` read-only and require fresh live
  proof before any mutating repair.

The harness topology is the same proof in two packaging styles:

- Docker uses one private network with `remote-base`, `local-edited`,
  `remote-changed`, and `runner`.
- Playground uses the same role split with disposable blueprints instead of
  long-lived containers.
- In both harnesses, browser-visible inspection must go through the sandbox
  `8080` ingress and a local-only proxy, never through a remote tunnel.
- `remote-base` and `remote-changed` must be the same remote identity at
  different times so the stale-apply rejection proves live revalidation.

The pull handoff is equally explicit:

- exporter and importer create the immutable base package that push preflight
  binds to the live remote identity
- push snapshot hashes list live remote state for planning only
- push dry-run uploads the canonical plan as eligibility evidence only
- push batch apply revalidates the live remote before every batch and at the
  storage boundary
- push journal and push recover inspect read durable evidence before any
  mutating recovery mode can proceed

The auth proof is intentionally strict:

- read-only inspection uses the existing HMAC auth header family only
- dry-run, apply, and mutating recovery require the push session, idempotency key, and canonical push signature
- inspect stays read-only and must not be treated as a hidden mutation grant

Docker harnesses should wire this as one private network with a remote site
pair, a local site pair, and one runner container. Playground harnesses
should mirror the same role split with separate disposable blueprints for
`remote-base`, `local-edited`, and `remote-changed`. In both topologies,
browser-visible inspection must use only the sandbox-provided `8080` ingress
through a local-only proxy, never a tunnel.

The runtime split is intentionally narrow:

- `remote-base` is the remote source site that produced the persisted pull
  package.
- `local-edited` is the imported site after local edits are applied.
- `remote-changed` is the same remote after independent drift and exists only
  to prove that dry-run and apply are separate.
- the runner is the only actor allowed to compare, upload, inspect, or
  recover.

The test harness for these fixtures should use the same one-remote, one-local
shape described in the executor docs:

- `remote-base` supplies the pulled merge base and the persisted push base
  package.
- `local-edited` supplies the edited local state that becomes the candidate
  dry-run plan.
- `remote-changed` supplies the same remote after drift and must fail
  apply-time revalidation.

The topology is asymmetric on purpose:

- `remote-base` is the pulled merge base and the persisted push provenance.
- `local-edited` is the edited local source used to build the candidate plan.
- `remote-changed` is the same remote after drift that proves apply-time
  revalidation, journal inspection, and recovery are separate from dry-run.

For Docker verification, mirror the same shape with one source-site container,
one edited local container, and one runner container that holds the
persisted pull base package. For Playground verification, mirror it with one
`remote-base` server, one `local-edited` server, and the same runner process.
In both cases, keep the live drift state on the same remote site so stale-apply
tests prove a fresh revalidation boundary instead of a reused dry-run receipt.
`push_journal` and `push_recover inspect` are evidence reads only; any
mutating recovery step must still prove fresh live state before it can act.

The same topology is captured in `push-topology.json` so focused tests can
assert the intended role split without re-encoding prose assumptions.

The machine-checked topology proof should assert all four roles directly:

- `remote_base` seeds the persisted pull package and the live source identity
- `local_edited` carries the locally edited clone used for planning
- `remote_changed` is the same source site after drift and must fail stale
  apply revalidation
- `runner` is the only actor that may compare, upload, inspect, or recover

That check is what keeps the docs honest about the production topology instead
of leaving the one-remote, one-local proof in prose only.

The fixture contract is intentionally one remote, one local, one runner:

- `remote_base` is the persisted pull source of truth.
- `local_edited` is the imported and edited local site.
- `remote_changed` is the same remote site after drift and forces apply-time
  revalidation.
- `runner` is the only actor that may compare, upload, inspect, or recover.

`push-pull-mapping.json` is the compact handoff contract between the pull
exporter/importer pipeline and the push executor. It exists so tests can assert
that the stored pull base package is read-only provenance, not a hidden lock or
second export format.

The production push bridge is one-way:

- exporter and importer create the immutable pull base package once
- preflight is the first live bind after importer persistence
- snapshot listing is planning-only evidence
- dry-run is a receipt, not a lock
- apply revalidates fresh live evidence before every batch and at the storage boundary
- journal inspect stays read-only
- recovery starts with inspect before any mutating repair

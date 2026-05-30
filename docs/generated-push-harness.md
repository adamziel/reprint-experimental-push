# Generated Push Harness

Checked command:

```sh
npm run test:generated-push-harness
```

Direct summary command:

```sh
node scripts/harness/generated-push-cases.js
```

## Purpose

This harness generates deterministic Reprint push cases instead of exact-shaped
fixtures. The current default is 620 cases, with a hard minimum of 300. Cases
span 10 complexity tiers and 62 scenario families, then add seeded variation so
the planner and executor see mixed file, row, plugin-owned, graph, atomic,
delete, conflict, and remote-preservation surfaces.

The goal is not to bless a few named fixtures. The goal is to keep expanding a
general Reprint push contract where every generated case must satisfy the same
invariants:

- plan summaries match the actual mutation, decision, conflict, blocker, and
  atomic-group arrays;
- every mutation has a matching live-remote precondition whose hash matches the
  current remote resource;
- ready plans apply only planned local values and preserve every unplanned
  remote resource;
- ready plans reject stale remotes before mutation;
- non-ready plans refuse apply and leave the remote unchanged;
- conflicts and non-propagated blockers do not still carry mutations for the
  same blocked or conflicted resource;
- plugin-owned mutations carry explicit owner and driver evidence.

## Current Coverage

The default generated run covers:

- 620 total cases;
- 10 tiers, 62 cases per tier;
- ready, conflict, and blocked outcomes;
- tier-9 ready/apply cases;
- local edits, remote-only edits, independent merge, same independent content,
  independent local-file/remote-row and local-row/remote-file targets,
  large ready plan tiers with one ready case per tier, deletes, delete/edit
  conflicts, file topology conflicts, file create/update/
  delete mixes with ready and conflicting outcomes plus per-tier target counts,
  directory descendant deletes with ready and conflicting outcomes plus
  per-tier target counts, file type-swap cases with ready/conflict outcomes
  plus per-tier target counts, row create/update/delete mixes with
  ready/conflict outcomes plus per-tier target counts and stale replay rejection
  before mutation, non-plugin-owned `wp_options` scalar changes with per-tier
  target counts plus explicit variant-3 and variant-4 scalar option coverage,
  serialized option changes with per-tier target counts and
  explicit variant-4 regression coverage, and redacted hash-only evidence for
  private serialized payloads, `wp_posts`
  create/update/delete mixes with per-tier target counts, ready/conflict
  outcomes, and explicit variant-4 summary coverage, `wp_postmeta`
  create/update/delete mixes with per-tier target
  counts, ready/conflict outcomes, stale replay rejection before mutation, and
  explicit variant-3 postmeta coverage plus dedicated generated plugin-driver
  `wp_postmeta` semantics cases that label local/support-only and
  production-backed release-gate evidence scope while keeping final release
  `NO-GO`,
  `wp_comments` + `wp_commentmeta` graph cases with per-tier target counts and
  ready/stale non-ready outcomes, `wp_terms` + `wp_termmeta` graph cases
  with per-tier target counts, ready/stale non-ready outcomes, and explicit
  variant-3 terms/termmeta graph coverage, `wp_users` + `wp_usermeta` graph
  cases with per-tier target counts and
  ready/stale non-ready outcomes plus explicit variant-3 user/usermeta graph
  coverage, `wp_term_taxonomy` graph cases with per-tier target counts,
  ready/stale non-ready outcomes, and explicit variant-3 term-taxonomy graph
  coverage, `wp_term_relationships`
  graph cases with one target per tier, ready creates, stale taxonomy drift,
  redacted hash-only evidence, and explicit variant-3 and variant-4 relationship graph
  coverage, plugin-owned `wp_options` update cases with
  ready/conflict outcomes, stale replay rejection before mutation, and explicit
  variant-3 and variant-4 plugin-owned option coverage plus explicit
  variant-3 `wp-option` driver semantics coverage,
  `wp_posts.post_author` cases with per-tier ready/stale target counts and
  hash-only stale-user blockers, `wp_comments.user_id` author cases with
  per-tier ready/stale target counts and hash-only stale-user blockers,
  featured-image attachment references with ready postmeta/attachment closure
  and stale attachment blockers,
  supported and unsupported plugin-owned data, driver owner identity binding
  variant-3 generated cases with one supported exact-owner policy and four
  fail-closed unsupported owner-policy/context/apply-revalidation variants,
  plugin owner-context drift, explicit plugin-owned resource refusal
  variant-3 ready/changed/stale
  targets, supported forms-lab custom-table rows, plugin-owned custom-table
  update variant-1 cases, explicit plugin-owned custom-table variant-3
  and variant-4 update coverage, and delete refusal with per-tier target
  counts, atomic plugin install ready and missing-dependency paths with
  per-tier target counts, stale remote after dry-run target counts with
  explicit variant-3 and variant-4 hash-only replay refusal evidence,
  same-plan post-parent,
  taxonomy, comment, and usermeta graph closures, and stale graph references.

The `wpOptionsScalar` surface seeds regular, non-plugin-owned `wp_options` rows
with scalar string and number values. Ready cases update the scalar option while
preserving the live remote; conflict cases drift the same option remotely and
must refuse apply without plugin-owner evidence.

The `wpOptionsScalarChanges` target coverage records per-tier counts for the
regular scalar `wp_options.option_value` update surface. Ready cases apply the
local scalar while preserving unplanned remote resources and rejecting stale
replay before mutation; conflict cases drift the same scalar remotely and refuse
apply so local scalar options cannot overwrite newer remote values.

RPP-0145 adds `wpOptionsScalarChangesVariant3` coverage for the same regular
scalar option update surface with an explicit variant-3 target tag. The
deterministic roster emits 20 variant-3 target cases: 10 ready scalar option
updates and 10 non-ready remote-drift conflicts, with two cases in every tier.
The focused proof records only resource keys, scalar value kinds, counts, and
hashes, verifies the ready case applies the planned scalar option update and
rejects stale replay before mutation, then verifies the conflicting scalar
option refuses apply without mutating the remote digest.

RPP-0165 adds `wpOptionsScalarChangesVariant4` coverage as a focused regression
target for the same regular scalar option update surface with an explicit
variant-4 target tag. The deterministic roster emits 20 variant-4 target cases:
10 ready scalar option updates and 10 non-ready remote-drift conflicts, with
two cases in every tier. The focused proof recounts the summary, selects one
ready case and one non-ready case, and keeps the evidence hash-only while
verifying ready apply, live-remote preconditions, stale replay refusal, and
non-ready conflict apply refusal without mutating the remote digest.

The `wpOptionsSerialized` surface seeds regular, non-plugin-owned `wp_options`
rows with PHP-serialized option strings that include public labels plus private
fields such as `private_notes` and `auth_token`. Ready cases update the
serialized option while preserving the live remote; conflict cases drift the same
option remotely and must refuse apply without plugin-owner evidence.

The `wpOptionsSerializedChanges` target coverage records per-tier counts for
the serialized `wp_options.option_value` update surface. Ready cases apply the
local serialized payload while preserving unplanned remote resources and
rejecting stale replay before mutation; non-ready cases drift the same serialized
option remotely, fail closed, and keep private serialized payload evidence
redacted to hashes and metadata.

RPP-0146 adds `wpOptionsSerializedChangesVariant3` coverage for the same regular
serialized option update surface with an explicit variant-3 target tag. The
deterministic roster emits 20 variant-3 target cases: 10 ready serialized option
updates and 10 non-ready remote-drift conflicts, with two cases in every tier.
The focused proof records only resource keys, serialized shape kinds, counts,
redaction metadata, and hashes, verifies the ready case applies the planned
serialized option update and rejects stale replay before mutation, then verifies
the conflicting serialized option refuses apply without mutating the remote
digest.

RPP-0166 adds `wpOptionsSerializedChangesVariant4` coverage for the same regular
serialized option update surface with an explicit variant-4 target tag. The
deterministic roster emits 20 variant-4 target cases: 10 ready serialized option
updates and 10 non-ready remote-drift conflicts, with two cases in every tier.
The focused regression proof recounts the variant-4 summary, keeps private
serialized payloads hash-only, verifies the ready mutation carries a matching
precondition, applies the local serialized option hash, preserves unplanned
remote data, and rejects stale replay before mutation, then verifies the
conflicting serialized option refuses apply without mutating the remote digest.

The `pluginOwnedOptionChange` target coverage records per-tier counts for
plugin-owned `wp_options` rows that are explicitly allowed by the owning plugin
driver. Ready cases carry owner/driver evidence, apply the local option hash,
preserve unplanned remote resources, and reject stale replay before mutation;
conflict cases drift the same plugin-owned option remotely and refuse apply so
plugin-owned option data cannot overwrite newer remote values.

RPP-0154 adds `pluginOwnedOptionChangeVariant3` coverage for the same
plugin-owned `wp_options` update surface with an explicit variant-3 target tag.
The deterministic roster emits 20 variant-3 target cases: 10 ready
plugin-owned option updates and 10 non-ready remote-drift conflicts, with two
cases in every tier. The focused proof records only resource keys, owner/driver
metadata, counts, hashes, conflict hashes, and refusal hashes, verifies the
ready case applies the planned plugin-owned option update and rejects stale
replay before mutation, then verifies the conflicting plugin-owned option
refuses apply without mutating the remote digest.

RPP-0174 adds `pluginOwnedOptionChangeVariant4` coverage for the same
plugin-owned `wp_options` update surface with an explicit variant-4 target tag.
The deterministic roster emits 20 variant-4 target cases: 10 ready
plugin-owned option updates and 10 non-ready remote-drift conflicts, with two
cases in every tier. The focused proof keeps plugin-owned option payloads
hash-only, verifies the ready case carries owner/driver evidence, applies the
planned option hash, preserves unplanned remote resources, and rejects stale
replay with `PRECONDITION_FAILED` before mutation, then verifies the conflicting
plugin-owned option refuses apply without mutating the remote digest.

RPP-0442 adds `generateDriverOwnerIdentityBindingCases()` coverage for
driver owner identity binding variant 3. The generated case set emits five
plugin-owned `wp_options` cases: one supported exact-owner policy that plans and
applies a `forms`/`wp-option` mutation, plus four unsupported variants for a
wrong policy owner, missing owner policy, local owner drift caught by apply
revalidation, and stale owner plugin metadata. `test/generated-push-harness.test.js`
now validates those cases through `validateDriverOwnerIdentityBindingCase()`,
keeps evidence local-generated and non-production-backed, and asserts the
generated private markers stay out of mutation, blocker, error, and journal
evidence.

RPP-0444 adds `wpOptionsDriverSemanticsVariant3` coverage over the generated
plugin-owned `wp_options` surface with an explicit `wp-option` driver target
tag. The deterministic roster emits 20 variant-3 target cases: 10 ready
driver-backed option updates and 10 non-ready remote-drift conflicts, with two
cases in every tier. The proof selects one ready and one non-ready generated
case, records owner/driver metadata plus SHA-256 evidence hashes, verifies the
ready mutation is bound to the exact plugin-owned option row and live-remote
precondition, then drifts that row before apply and observes
`PRECONDITION_FAILED` while the drifted row hash and whole-remote hash remain
unchanged. The non-ready case refuses apply without mutating the remote digest.
This is local generated-model evidence only; release posture remains NO-GO.

The `fileCreateUpdateDeleteMix` target coverage records per-tier counts for the
file create/update/delete surface. Ready cases create one file, update one file,
and delete one file, then reject stale replay before mutation; conflict cases
drift the updated file remotely and refuse apply.

RPP-0141 adds `fileCreateUpdateDeleteMixVariant3` coverage for the same file
mix surface with an explicit variant-3 target tag. The deterministic roster
emits 20 variant-3 target cases: 10 ready cases and 10 non-ready conflict cases,
with two cases in every tier. The focused proof selects one ready case and one
non-ready case, records only resource keys and hashes, verifies the ready case
applies the planned create/update/delete while preserving the remote-only file,
and verifies the conflicting updated file refuses apply before mutation.

RPP-0161 adds `fileCreateUpdateDeleteMixVariant4` coverage as a focused
regression target for the same file mix surface with an explicit variant-4
target tag. The deterministic roster emits 20 variant-4 target cases: 10 ready
cases and 10 non-ready conflict cases, with two cases in every tier. The focused
proof recounts the summary, selects one ready case and one non-ready case, and
keeps the evidence hash-only while verifying ready apply, remote-only
preservation, stale replay refusal, and non-ready conflict apply refusal.

The `directoryDescendantConflict` target coverage records per-tier counts for
local directory deletes where the remote either still only has the directory or
has added a descendant beneath it. Ready cases delete the unchanged remote
directory, preserve unplanned remote data, and reject stale replay before
mutation; conflicting cases refuse apply so a local directory delete cannot
hide or overwrite a live remote descendant.

RPP-0142 adds `directoryDescendantConflictVariant3` coverage for the same
directory descendant target with an explicit variant-3 tag. The deterministic
roster emits 20 variant-3 target cases: 10 ready directory deletes and 10
non-ready descendant conflicts, with two cases in every tier. The focused proof
records only resource keys and hashes, verifies the ready directory delete
applies and rejects stale replay, and verifies the remote descendant conflict
refuses apply without mutating the remote digest.

RPP-0162 adds `directoryDescendantConflictVariant4` coverage for the same
directory descendant target with an explicit variant-4 tag. The deterministic
roster exposes the same 20-case ready/conflict surface with two cases in every
tier, then the focused proof recounts the variant-4 summary, verifies the ready
directory delete path applies and rejects stale replay, and verifies the remote
descendant conflict path refuses apply without mutating the remote digest.

The `wpPostsCreateUpdateDelete` target coverage records per-tier counts for the
`wp_posts` create/update/delete surface. Its invariant is that ready cases apply
only the planned post create, update, and delete while preserving every
unplanned remote resource, and every ready case rejects stale replay before any
mutation. Concurrent remote edits to the updated post remain `conflict` and
refuse apply so local `wp_posts` create/update/delete plans cannot overwrite
newer remote rows.

RPP-0147 adds `wpPostsCreateUpdateDeleteVariant3` coverage for the same
`wp_posts` create/update/delete surface with an explicit variant-3 target tag.
The deterministic roster emits 20 variant-3 target cases: 10 ready post
create/update/delete plans and 10 non-ready remote-drift conflicts, with two
cases in every tier. The focused proof records only resource keys, post types,
counts, and hashes, verifies the ready case applies the planned create, update,
and delete mutations and rejects stale replay before mutation, then verifies
the conflicting updated post refuses apply without mutating the remote digest.

RPP-0167 adds `wpPostsCreateUpdateDeleteVariant4` coverage for the same
`wp_posts` create/update/delete surface with an explicit variant-4 target tag.
The deterministic roster emits 20 variant-4 target cases: 10 ready post
create/update/delete plans and 10 non-ready remote-drift conflicts, with two
cases in every tier. The focused proof recounts the variant-4 summary,
verifies the ready create, update, and delete post mutations apply with
matching preconditions and stale replay refusal, and verifies the conflicting
updated post refuses apply without mutating the remote digest. Evidence remains
hash-only and omits generated post titles and content payloads.

The `fileTypeSwap` target coverage records per-tier counts for file topology
type swaps. Ready cases replace an empty directory with the planned file value
and preserve unplanned remote resources; conflict cases add a remote descendant
under the directory and refuse apply.

RPP-0163 adds `fileTypeSwapConflictVariant4` coverage for the same file
topology type-swap surface with an explicit variant-4 target tag. The
deterministic roster emits 20 variant-4 target cases: 10 ready directory-to-file
swaps and 10 non-ready remote-descendant conflicts, with two cases in every
tier. The focused proof records only resource keys, counts, decision hashes,
file hashes, conflict hashes, and refusal hashes. It verifies a ready type-swap
applies the planned file value while preserving an unplanned remote resource,
then verifies the remote descendant conflict refuses apply without mutating the
remote digest.

The `sameIndependentContent` target coverage records per-tier counts for local
and remote edits that independently converge on the same content. Its ready
cases produce no mutation for the already-synchronized row, still apply through
the harness, and preserve every unplanned remote resource. RPP-0138 adds a
variant-2 proof that independently recounts all 10 generated cases, checks the
local/remote/applied hashes for the shared row, and records hash-only evidence
that the row has no planned mutation or precondition.

RPP-0158 adds `sameIndependentContentVariant3` coverage for the same
already-synchronized `wp_posts` surface as an explicit variant-3 target. The
deterministic summary exposes 10 ready cases, one in every tier, and the
focused proof replays every target case to verify apply keeps the shared row on
the remote hash, emits no mutation or precondition for that row, and preserves
all unplanned remote resources. The evidence is hash-only: resource keys,
counts, decision hashes, row hashes, and unplanned-preservation proof hashes
are retained while generated row titles and payload values are omitted.

RPP-0178 adds `sameIndependentContentVariant4` coverage for the same
already-synchronized `wp_posts` surface as an explicit variant-4 target. The
deterministic summary exposes the same 10 ready cases, one in every tier, and
the focused proof replays every target case to verify every planned mutation
applies while the shared row stays on the remote hash with no mutation or
precondition. It also enumerates all resources after apply to prove every
unplanned remote resource still matches the pre-apply remote hash. Evidence
remains hash-only: resource keys, counts, row hashes, decision hashes,
apply-proof hashes, and unplanned-preservation proof hashes are retained while
generated row titles and payload values are omitted.

The `remoteOnlyPreservation` target coverage records mutation-bearing
`remote-only-post-update` cases where the remote changed a `wp_posts` row while
local changes target other resources. Tier 0 remains a zero-mutation preservation
case and is excluded from this stale replay target. RPP-0139 adds a variant-2
proof that independently recounts tiers 1 through 9, verifies the remote-only
row remains a hash-only `keep-remote` decision with no mutation/precondition,
checks apply preserves the remote row, and drifts a later planned mutation so
`PRECONDITION_FAILED` is raised before any remote mutation.

RPP-0159 adds `remoteOnlyPreservationVariant3` coverage for the same remote-only
post-update surface as an explicit variant-3 target. The deterministic summary
exposes the same 9 mutation-bearing ready cases across tiers 1 through 9, and
the focused proof recounts every target case, applies the ready plan, verifies
the remote-only row remains unplanned and preserved, then drifts the final
planned mutation after dry-run. The replay must fail with `PRECONDITION_FAILED`
and an unchanged remote digest, proving stale remote replay fails before any
mutation. Evidence remains hash-only: row/resource keys, tier/status counts,
decision hashes, precondition hashes, planned-value hashes, and refusal-detail
hashes are retained while generated row titles, local payloads, and stale replay
payloads are omitted.

The `independentLocalFileRemoteRow` target coverage records per-tier counts for
ready plans where a local file edit and remote row edit coexist. RPP-0221 proves
the file mutation carries a live-remote precondition, the remote row remains a
`keep-remote` decision with no mutation/precondition, apply preserves the row,
and generated evidence stays hash-only.

The `independentLocalRowRemoteFile` target coverage records per-tier counts for
the opposite ready merge shape: a local row edit plus remote file edit. RPP-0222
proves the row mutation carries the only live-remote precondition, the remote
file remains unplanned and preserved, stale row replay fails before mutation,
and generated evidence stays hash-only.

The `localDeleteRemoteEdit` target coverage records per-tier counts for local
row deletes when the same row has changed remotely. RPP-0223 proves every
generated delete/edit case stays `conflict`, emits no mutation or precondition
for the deleted row, refuses apply before mutation, and keeps remote row values
out of serialized evidence.

The `wpPostmetaCreateUpdateDelete` target coverage records per-tier counts for
the `wp_postmeta` create/update/delete surface. Its invariant is that ready
cases apply only the planned postmeta create, update, and delete while
preserving every unplanned remote resource; every ready case rejects stale
replay before mutation, and concurrent remote edits to the updated postmeta row
remain `conflict` and refuse apply so local postmeta plans cannot overwrite
newer remote rows.

RPP-0148 adds `wpPostmetaCreateUpdateDeleteVariant3` coverage for the same
`wp_postmeta` create/update/delete surface with an explicit variant-3 target
tag. The deterministic roster emits 20 variant-3 target cases: 10 ready
postmeta create/update/delete plans and 10 non-ready remote-drift conflicts,
with two cases in every tier. The focused proof records only resource keys,
parent post IDs, meta-key hashes, counts, and hashes, verifies the ready case
applies the planned postmeta create, update, and delete mutations and rejects
stale replay before mutation, then verifies the conflicting updated postmeta row
refuses apply without mutating the remote digest.

RPP-0445 adds generated plugin-driver `wp_postmeta` semantics coverage for
variant 3. The focused generated cases cover exact `post_id:<id>:meta_key:<key>`
rows, exact `meta_id:<id>` rows, and a mismatched postmeta row that fails closed
before mutation. The proof labels each generated case with release-gate evidence
scope: local/support-only cases say production-backed release-gate evidence is
still required, while the production-scoped remote-policy case records that it
is still only local generated evidence. The final release posture remains
`NO-GO`, and the generated evidence keeps private postmeta payloads hash-only.

RPP-0168 adds `wpPostmetaCreateUpdateDeleteVariant4` coverage for the same
`wp_postmeta` create/update/delete surface with an explicit variant-4 target
tag. The deterministic roster emits 20 variant-4 target cases: 10 ready
postmeta create/update/delete plans and 10 non-ready remote-drift conflicts,
with two cases in every tier. The focused proof keeps the evidence hash-only,
verifies the ready case applies the planned create, update, and delete
`wp_postmeta` mutations while preserving unplanned remote resources, rejects
stale replay with `PRECONDITION_FAILED` before mutation, and confirms the
conflicting updated postmeta row refuses apply without mutating the remote
digest.

The `wpCommentsCommentmetaGraph` target coverage records per-tier counts for
generated `wp_comments` rows and their `wp_commentmeta` graph relationships.
Ready cases create the comment and commentmeta row in one plan, preserve
unplanned remote resources, and reject stale replays before mutation; stale
cases keep the comment in the base, drift that comment remotely, and require the
new commentmeta reference to fail closed instead of overwriting the drifted
remote. RPP-0130 and RPP-0150 prove the ready and stale target cases across
every tier and keep generated comment/commentmeta row values out of the summary
evidence.

RPP-0170 adds `wpCommentsCommentmetaGraphVariant4` coverage for the same
`wp_comments` and `wp_commentmeta` graph surface with an explicit variant-4
target tag. The deterministic roster emits 20 variant-4 target cases: 10 ready
comment/commentmeta graph creates and 10 stale non-ready comment drift cases,
with two cases in every tier. The focused proof recounts the variant-4 summary,
verifies the ready comment and commentmeta mutations apply with matching
preconditions and stale replay refusal, and verifies the stale comment target
blocks the new commentmeta row and refuses apply without mutating the remote
digest. Evidence remains hash-only and omits generated comment content,
commentmeta keys, and commentmeta values.

The `wpTermsTermmetaGraph` target coverage records per-tier counts for generated
`wp_terms` rows and their `wp_termmeta` graph relationships. Ready cases create
the term and termmeta row in one plan, preserve unplanned remote resources, and
reject stale replays before mutation; stale cases keep the term in the base,
drift that term remotely, and require the new termmeta reference to fail closed
instead of overwriting the drifted remote. RPP-0131 now runs in the 620-case
roster and proves one ready and one stale terms/termmeta graph case in every
tier.

RPP-0151 adds `wpTermsTermmetaGraphVariant3` coverage for the same `wp_terms`
and `wp_termmeta` graph surface with an explicit variant-3 target tag. The
deterministic roster emits 20 variant-3 target cases: 10 ready term/termmeta
graph creates and 10 stale non-ready term drift cases, with two cases in every
tier. The focused proof records only resource keys, term-id hashes, term-slug
hashes, meta-key hashes, counts, blocker hashes, and refusal hashes; verifies
the ready case applies both graph rows and rejects stale replay before
mutation; then verifies the stale term reference refuses apply without mutating
the remote digest.

RPP-0171 adds `wpTermsTermmetaGraphVariant4` coverage for the same `wp_terms`
and `wp_termmeta` graph surface with an explicit variant-4 target tag. The
deterministic roster emits 20 variant-4 target cases: 10 ready term/termmeta
graph creates and 10 stale non-ready term drift cases, with two cases in every
tier. The focused proof keeps the evidence hash-only, verifies the ready case
applies both graph row creates while preserving unplanned remote resources,
rejects stale replay with `PRECONDITION_FAILED` before mutation, and confirms
the stale term reference refuses apply without mutating the remote digest.

The `wpUsersUsermetaGraph` target coverage records per-tier counts for
generated `wp_users` rows and their `wp_usermeta` graph relationships. Ready
cases create the user and usermeta row in one plan, preserve unplanned remote
resources, and reject stale replays before mutation; stale cases keep the user
in the base, drift that user remotely, and require the new usermeta reference to
fail closed instead of overwriting the drifted remote. RPP-0129 also keeps
private user password, activation-token, and usermeta payload values out of
summary and planner evidence by checking only redacted hashes and metadata.

RPP-0149 adds `wpUsersUsermetaGraphVariant3` coverage for the same `wp_users`
and `wp_usermeta` graph surface with an explicit variant-3 target tag. The
deterministic roster emits 20 variant-3 target cases: 10 ready user/usermeta
graph creates and 10 stale non-ready graph references, with two cases in every
tier. The focused proof records only resource keys, user-id/meta-key hashes,
counts, and planner hashes, verifies the ready case applies the planned user
and usermeta creates and rejects stale replay before mutation, then verifies
the stale graph blocker refuses apply without mutating the remote digest.

RPP-0169 adds `wpUsersUsermetaGraphVariant4` coverage as focused regression
coverage for the same `wp_users` and `wp_usermeta` graph surface with an
explicit variant-4 target tag. The deterministic roster emits 20 variant-4
target cases: 10 ready user/usermeta graph creates and 10 stale non-ready graph
references, with two cases in every tier. The focused proof mirrors the
variant-3 invariants, records only resource keys, user-id/meta-key hashes,
counts, blocker/decision/refusal hashes, and planner hashes, verifies the ready
case applies the planned graph rows and rejects stale replay before mutation,
then verifies the stale graph blocker refuses apply without mutating the remote
digest.

The `rowCreateUpdateDeleteMix` target coverage records per-tier counts for the
generic row create/update/delete surface. Ready cases create, update, and delete
rows, preserve unplanned remote resources, and reject stale replay before
mutation; conflict cases drift the updated row remotely and refuse apply.

RPP-0144 adds `rowCreateUpdateDeleteMixVariant3` coverage for the same generic
row mix surface with an explicit variant-3 target tag. The deterministic roster
emits 20 variant-3 target cases: 10 ready cases and 10 non-ready conflict cases,
with two cases in every tier. The focused proof records only resource keys and
hashes, verifies the ready case applies the planned create/update/delete rows,
preserves the remote-only row, and rejects stale replay before mutation, then
verifies the conflicting updated row refuses apply without mutating the remote
digest.

RPP-0164 adds `rowCreateUpdateDeleteMixVariant4` coverage over the same generic
row mix surface with an explicit variant-4 target tag. The deterministic roster
emits 20 variant-4 target cases: 10 ready cases and 10 non-ready conflict cases,
with two cases in every tier. The focused proof mirrors the variant-3 row-mix
invariants and records only resource keys, planner summaries, refusal hashes,
decision hashes, and model proof hashes.

The `wpTermTaxonomyGraph` target coverage records per-tier counts for generated
`wp_term_taxonomy` rows and their `wp_terms` graph relationships. Ready cases
create the term and taxonomy row in one plan, preserve unplanned remote
resources, and reject a stale replay before mutation; stale cases keep the term
in the base, drift that term remotely, and require the new taxonomy reference to
fail closed instead of overwriting the drifted remote. RPP-0132 now runs in the
620-case roster and proves 20 term-taxonomy graph cases across all 10 tiers,
including 10 ready cases, 10 stale non-ready cases, and hash-only redacted
evidence for generated taxonomy descriptions and stale term drift values.

RPP-0152 adds `wpTermTaxonomyGraphVariant3` coverage for the same `wp_terms`
and `wp_term_taxonomy` graph surface with an explicit variant-3 target tag. The
deterministic roster emits 20 variant-3 target cases: 10 ready term/taxonomy
graph creates and 10 stale non-ready term drift cases, with two cases in every
tier. The focused proof records only resource keys, term-id hashes, term-slug
hashes, taxonomy/description hashes, counts, blocker hashes, and refusal
hashes; verifies the ready case applies both graph rows and rejects stale replay
before mutation; then verifies the stale term reference refuses apply without
mutating the remote digest.

RPP-0172 adds `wpTermTaxonomyGraphVariant4` coverage as focused regression
coverage for the same `wp_terms` and `wp_term_taxonomy` graph surface with an
explicit variant-4 target tag. The deterministic roster emits 20 variant-4
target cases: 10 ready term/taxonomy graph creates and 10 stale non-ready term
drift cases, with two cases in every tier. The focused proof mirrors the
variant-3 invariants, records only resource keys, term-id hashes, term-slug
hashes, taxonomy/description hashes, counts, blocker/decision/refusal hashes,
and planner hashes, verifies the ready case applies both graph rows and rejects
stale replay before mutation, then verifies the stale graph blocker refuses
apply without mutating the remote digest.

The `wpTermRelationshipsGraph` target coverage records per-tier counts for
generated `wp_term_relationships` rows and their `wp_term_taxonomy` targets.
Ready cases create the term, taxonomy, and relationship in one plan, preserve
unplanned remote resources, and reject stale replay before mutation; stale
cases keep the term and taxonomy in the base, drift the taxonomy remotely, and
require the new relationship row to fail closed instead of applying partial
graph mutations. RPP-0133 now runs in the 620-case roster and proves one
relationship target in every tier: five ready cases, five stale blocked cases,
and hash-only redacted evidence for generated relationship target values.

RPP-0153 adds `wpTermRelationshipsGraphVariant3` coverage for the same
`wp_term_relationships` graph surface with an explicit variant-3 target tag.
The deterministic roster emits 10 variant-3 target cases: five ready
term/taxonomy/relationship graph creates and five stale non-ready taxonomy
drift cases, with one relationship target in every tier. The focused proof
records only resource keys, term-id hashes, taxonomy/description hashes,
relationship field hashes, blocker hashes, refusal hashes, and the hash of the
remote-only preservation file; verifies each ready graph row applies with a
matching precondition; verifies the ready case preserves the unplanned
remote-only file and rejects stale replay before mutation; then verifies the
stale taxonomy reference refuses apply without mutating the remote digest.

RPP-0173 adds `wpTermRelationshipsGraphVariant4` focused regression coverage
for the same `wp_term_relationships` graph surface with an explicit variant-4
target tag. The deterministic roster emits 10 variant-4 target cases: five
ready term/taxonomy/relationship graph creates and five stale non-ready
taxonomy drift cases, with one relationship target in every tier. The focused
proof replays the variant-3 graph invariants under the variant-4 target tag,
verifies each ready graph row carries a matching precondition and applies the
local hash without overwriting the unplanned remote-only file, rejects stale
replay before mutation, and verifies the stale taxonomy reference refuses apply
without mutating the remote digest. The evidence remains hash-only for term,
taxonomy, relationship, blocker, refusal, and remote-only preservation data.

The `pluginOwnedOptionChange` target coverage records per-tier counts for
generated plugin-owned `wp_options` rows using the supported forms driver.
Ready cases apply the local option update with owner/driver evidence and reject
stale replays before mutation; conflict cases drift the same plugin-owned option
remotely and must refuse apply without losing the remote value. RPP-0134 keeps
private plugin-owned option tokens and notes out of summary and planner evidence
while retaining redacted hashes and plugin owner/driver metadata. RPP-0174 adds
the variant-4 target and proves the ready replay guard still fails before the
plugin-owned option mutation.

The `pluginOwnedCustomTableChanges` target coverage records per-tier counts for
forms-lab custom table rows owned by the forms plugin. Ready cases apply through
the `fixture-forms-lab-table` driver with hash-only audit evidence and reject a
stale replay before mutation; delete attempts remain non-ready because the
driver does not support deletes, so no custom-table delete mutation is applied.

The `pluginOwnedCustomTableVariant1` target coverage records the RPP-0115
generated model for plugin-owned forms-lab custom-table updates. Each target row
is an existing positive-id `wp_reprint_push_forms_lab` row owned by `forms`,
with an exact local push-policy allowlist binding that row to the
`fixture-forms-lab-table` driver. Ready variant-1 cases apply one `put`
mutation with owner, driver, delete-policy, owner-context, and hash-only audit
evidence, preserve unplanned remote files, and reject stale replay before any
mutation. Stale variant-1 cases drift the same row remotely, record refusal
evidence, and carry no planned mutation for that custom-table row.

RPP-0155 adds `pluginOwnedCustomTableChangesVariant3` coverage for the same
plugin-owned forms-lab custom-table update surface with an explicit variant-3
target tag. The deterministic roster emits 10 variant-3 target cases: five
ready custom-table updates and five stale non-ready remote-drift conflicts,
with one target in every tier. The focused proof records only resource keys,
owner/driver metadata, row-id and field hashes, audit/refusal hashes, and the
hash of the remote-only preservation file; verifies the ready case applies the
planned `fixture-forms-lab-table` mutation with a matching live-remote
precondition; verifies the ready case preserves the unplanned remote-only file
and rejects stale replay before mutation; then verifies the stale custom-table
row refuses apply without mutating the remote digest.

RPP-0175 adds `pluginOwnedCustomTableChangesVariant4` coverage as focused
regression coverage over the same plugin-owned forms-lab custom-table update
surface with an explicit variant-4 target tag. The deterministic roster emits
10 variant-4 target cases: five ready custom-table updates and five stale
non-ready remote-drift conflicts, with one target in every tier. The focused
proof reuses the variant-3 custom-table model invariant and separately checks
the variant-4 ready, stale, and non-ready tags: ready cases apply the
`fixture-forms-lab-table` mutation with matching live-remote preconditions,
preserve the unplanned remote-only file, and reject stale replay before
mutation; stale cases record plugin-data conflicts and refuse apply without
mutating the remote digest. Evidence remains hash-only for row ids, row fields,
owner/driver metadata, audit/refusal data, and remote-only preservation data.

RPP-0143 adds `pluginOwnedResourceRefusalVariant3` coverage for plugin-owned
`wp_options` rows owned by `forms`. The deterministic roster emits 30 target
cases: one ready, one changed/blocked, and one stale/conflict case in every
tier. Ready cases include an explicit `wp-option` driver policy and apply with
owner/driver evidence, then reject stale replay before mutation. Changed cases
omit the driver policy and fail closed as `UNKNOWN_PLUGIN_OWNED_RESOURCE` with
hash-only refusal evidence. Stale cases drift the same plugin-owned target
remotely, stay `conflict`, carry no mutation or precondition for that target,
and refuse apply without exposing private option tokens.

The `largeReadyPlanTier` target coverage records one large ready plan per tier.
Each case combines post-row creates, updates, deletes, file creates, updates,
deletes, same-plan taxonomy/comment graph rows, and remote-only row/file drift.
The invariant is that all 10 cases stay `ready`, apply only planned resources,
preserve the remote-only drift, and reject stale replay before mutation.
RPP-0140 adds a variant-2 proof that independently recounts every tier, records
exact surface counts for the row/file/taxonomy/comment graph mix, verifies that
the planned mutation and precondition key sets match that generated surface,
checks the row/file `keep-remote` decisions, and drifts a non-initial planned
resource after dry-run to prove `PRECONDITION_FAILED` occurs before mutation
without serializing generated row titles, file payloads, or stale replay data.
RPP-0160 adds `largeReadyPlanTierVariant3` coverage for the same deterministic
large-ready surface with an explicit variant-3 target tag. The proof
cross-checks the variant-3 summary against the legacy `largeReadyPlanTier`
target, verifies all 10 tiered cases remain ready, and records only counts,
resource-key hashes, precondition hashes, decision hashes, and stale-replay
refusal hashes while the release gate remains NO-GO.
RPP-0180 adds `largeReadyPlanTierVariant4` coverage as focused regression
coverage over the same deterministic large-ready surface with explicit
variant-4 target and ready tags. The proof cross-checks the variant-4 summary
against both `largeReadyPlanTierVariant3` and the legacy `largeReadyPlanTier`
target, verifies all 10 tiered cases remain ready, applies only the planned
post/file/taxonomy/comment graph resources, preserves the remote-only row/file
drift, and rejects stale replay before mutation. Evidence remains hash-only for
resource-key sets, preconditions, keep-remote decisions, planned values, and
refusal details.

The `postAuthorGraph` target coverage records per-tier counts for generated
`wp_posts.post_author` references to `wp_users` rows. Ready cases create the
user and authored post in one plan, preserve unplanned remote resources, and
reject stale replay before mutation; stale cases keep the user in the base,
drift that user remotely, and require the post reference to fail closed with
hash-only target evidence. RPP-0303 records 10 ready and 10 stale post-author
graph cases across every tier.

The `staleRemoteAfterDryRun` target coverage records per-tier counts for ready
plans whose live-remote preconditions reject a stale remote replay before any
mutation. Zero-mutation ready plans are excluded because there is no planned
target to drift after dry-run. RPP-0137 adds a variant-2 proof that independently
recounts the target cases from the generated roster, cross-checks the summary
per-tier counts, and records one hash-only `PRECONDITION_FAILED` replay refusal
for every tier without serializing local, remote, or stale payload values.

RPP-0157 adds `staleRemoteAfterDryRunVariant3` coverage for the same ready-plan
precondition surface as an explicit variant-3 target. The deterministic summary
exposes the same 344 ready replay-refusal cases across all 10 tiers
(`34, 34, 35, 34, 35, 34, 35, 34, 35, 34`), while the focused proof recounts
the target, selects one large multi-mutation ready case per tier, drifts the
final planned mutation after dry-run, and verifies `PRECONDITION_FAILED` leaves
the remote digest unchanged before any mutation. The evidence is hash-only:
resource keys, mutation/precondition hashes, refusal-detail hashes, tier counts,
and status counts are retained, while generated payload values are omitted.

RPP-0177 adds `staleRemoteAfterDryRunVariant4` coverage for the same ready-plan
precondition surface as an explicit variant-4 target. The deterministic summary
exposes the same 344 ready replay-refusal cases across all 10 tiers, and the
focused regression proof independently recounts the target, selects the
highest-mutation-count ready case in each tier, drifts a midpoint planned
mutation after dry-run, and verifies `PRECONDITION_FAILED` leaves the remote
digest unchanged before mutation. The evidence remains hash-only: resource keys,
mutation/precondition hashes, refusal-detail hashes, tier counts, and status
counts are retained, while generated payload values are omitted.

The `commentUserGraph` target coverage records per-tier counts for generated
`wp_comments.user_id` author references. Ready cases create the user and comment
in one plan and reject a stale replay before mutation; stale cases keep the user
in the base, drift that user remotely, and require the comment reference to fail
closed with hash-only target evidence.

The `featuredImageAttachmentGraph` target coverage records per-tier counts for
generated `_thumbnail_id` postmeta references to attachment posts. Ready cases
create the attachment and thumbnail postmeta in one plan, preserve unplanned
remote resources, and reject stale replay before mutation; stale cases keep the
attachment in the base, drift that attachment remotely, and require the
thumbnail reference to fail closed with hash-only target evidence. RPP-0342
proves 10 ready and 10 stale featured-image graph cases across every tier.

The `atomicPluginInstallStack` target coverage records per-tier counts for the
atomic plugin install stack. Ready cases install dependency and dependent plugin
files, plugin metadata, and plugin-owned option data inside one atomic group;
the dependency proof is same-group and stale replay fails before mutation.
Missing-dependency cases remain non-ready, propagate blockers to every group
mutation, and keep private install option values hash-only/redacted.

The `atomicPluginInstallStackV1` target coverage records the same generated
atomic plugin install stack under variant-1 tags for RPP-0116. Its focused
model evidence samples one ready stack and one non-ready missing-dependency
stack from the real generated harness while retaining hash-only resource and
blocker summaries.

The `atomicPluginInstallStackV4` target coverage records the same generated
atomic plugin install stack under variant-4 tags for RPP-0176. Its focused
regression proof samples one ready stack and one non-ready missing-dependency
stack from the real generated harness, checks per-tier summary counts, and
keeps dependency hashes, resource keys, and blockers without serializing plugin
file contents or private install option values.

At the time this note was refreshed, `node scripts/harness/generated-push-cases.js` reported 620 total cases with 345 ready, 201 conflict, and 74 blocked outcomes. The target coverage includes 10 `independentLocalFileRemoteRow` cases, 10 `independentLocalRowRemoteFile` cases, 10 `localDeleteRemoteEdit` cases, 10 `sameIndependentContent` cases, 10 `sameIndependentContentVariant3` cases, 20 `postAuthorGraph` cases, 20 `wpCommentsCommentmetaGraph` cases, 20 `featuredImageAttachmentGraph` cases, 20 `atomicPluginInstallStack` cases, 20 `atomicPluginInstallStackV1` cases, 20 `atomicPluginInstallStackV2` cases, 20 `atomicPluginInstallStackV4` cases, 20 `wpOptionsDriverSemanticsVariant3` cases, 10 `pluginOwnedCustomTableChanges` cases, 10 `pluginOwnedCustomTableVariant1` cases, 9 `remoteOnlyPreservation` cases, 9 `remoteOnlyPreservationVariant3` cases, 344 `staleRemoteAfterDryRun` ready-plan stale-replay precondition cases, 344 `staleRemoteAfterDryRunVariant3` ready-plan stale-replay precondition cases, and 344 `staleRemoteAfterDryRunVariant4` ready-plan stale-replay precondition cases. Use the direct summary command above for the full current JSON.

## Extension Rule

Add new scenario families or seeded operations when a new Reprint push behavior
is needed. Do not add one-off expected snapshots for a single case unless the
case exposes a reusable generator capability. If a case needs an exact fixture,
it belongs in a narrow regression test beside the generated harness, not inside
the harness itself.

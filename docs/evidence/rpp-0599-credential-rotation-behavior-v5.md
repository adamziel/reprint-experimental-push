# RPP-0599 credential rotation behavior, variant 5

Date: 2026-05-31

Status: local generated executor/auth support evidence only. Final release
remains **NO-GO** until the same behavior is proven against a checked
production-owned boundary with production-owned access material.

## Claim

Apply revalidates the live source before mutation. Missing, malformed, stale,
drifted, invalidated, or rotated-away credential/session evidence fails before
apply JSON parsing, receipt validation work, mutation-capable work, or release
movement.

## Hash-Only Proof Record

- testArtifactHash: 5ff5630bbb7d7eb26ec61ad9045ced33c8a13cd5c51365d54f53795b2a03cbc8
- proofClassHash: 17ce1a9301af2ffb6ff6333050e9b38bd0c13120ba57dc21d41d73288fcd1b54
- credentialBindingProofHash: 5db3b595aae199dcde1f37bc47dc50597fafee380fa4f8eb71c6f8089bad0130
- preParseRejectProofHash: 6a312f8bdb68887255f7dffd50b58d508d6ba73791765b530d48db5fa37f9c1f
- invalidatedRejectProofHash: 7b1925afb098c3a33bec5e0b48b227ed36f2a40d14644113f60c5a814f7d3f23
- rotatedAwayRejectProofHash: 31483129a09e585290eca5869aa2477a600f77e29698beb8a0a09d329c01d944
- acceptedRevalidationProofHash: c3fcb7b281e8e284ed3a09b64a2840c4c7fdf657850ac7f80f7bc0cb489f448f
- orderingProofHash: 8ba14b3eef8c55af9c4ea8ea0488590881102b8c04d7d55462f5c9ef4387b510
- noMutationBeforeRejectProofHash: 0e2139388dd02bae2a0febc697a6de931d886611dd7300b50a5f1bcd19cb86bd
- releaseGateHash: 10bf9e9cb62fd3d04f11e79946cca1afd690594aebdf75b0e0465ab913f87701

## Proven Behavior

- Missing and malformed credential evidence returns an auth/evidence failure
  before apply body parsing.
- Stale or drifted session identity evidence returns a session binding failure
  before apply body parsing.
- Invalidated and rotated-away access material returns a failure before apply
  body parsing, receipt validation attempts, mutation executor entry, mutation
  application, and release movement.
- The accepted path records apply start, live-source revalidation, mutation
  executor entry, first mutation, and commit in that order.
- Accepted support evidence reports the before-first-mutation phase, live-remote
  check target, verified count equal to mutation count, and hash-only bindings
  for credential, user, session, receipt, plan, request, source, preconditions,
  mutation set, and journal cursor material.

## Boundary

This is support-only generated evidence. It does not claim production
durability, external endpoint coverage, or release readiness. The release gate
remains **NO-GO** until executor/auth credential rotation and before-mutation
live-source revalidation are checked on the production boundary.

## Validation

Raw command strings and artifact locations are omitted from this evidence
record. Each command is recorded by SHA-256 of the exact local command string.

| index | commandHash | result |
| --- | --- | --- |
| 1 | a97bac96c182d81fd19bb66e59fcd6ba8582bc6b904187c8749071df7c2e4e48 | exit 0 |
| 2 | 248407f81fb8bf91d7cd17b6ad9de4695ce7d47b970fa82a60596f734749cee4 | exit 0; 2 pass / 0 fail |
| 3 | a9e0858c52ec1e8146dd8a99cd75c7691a2b4459186db464bebfa1bb34835c8b | exit 0; 2 pass / 0 fail |
| 4 | 13bbae39072c69425531224533c176391e1f76bf116618880d9b2421e90ef9c0 | exit 0; 2 pass / 0 fail |
| 5 | 093047a92517527859a4f8a9b9029118ca780369f837fb19b332d3bba3d6e779 | exit 0; 2 pass / 0 fail |
| 6 | ada8beefd555a619da53e6dd67cc71a18ce54fe92c88e5c9c74d905a33d781ba | exit 0; 2 pass / 0 fail |
| 7 | 34e6ca62e22ac40f39965a3c9d0f32fdf4ea580ac5d5ade307a1629f86568371 | exit 0; ok true |
| 8 | 466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b | exit 0 |
| 9 | 3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd | exit 0 |

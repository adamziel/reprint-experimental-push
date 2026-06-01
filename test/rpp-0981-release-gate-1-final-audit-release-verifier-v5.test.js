import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(
  repoRoot,
  'docs/evidence/rpp-0981-release-gate-1-final-audit-release-verifier-v5.md',
);
const baselineAuditPath = path.join(repoRoot, 'docs/evidence/rpp-0961-release-gate-1-final-audit-v4.md');
const releaseGatesPath = path.join(repoRoot, '.agents/RELEASE_GATES.md');

const auditedHead = '6e4a7033a1e5eaa5701ce385d1c9aa81c4641dca';
const staleRpp0961Head = '0aaee05deff176f836cabd691cba2bca8dbc838f';
const staleRpp0941Head = 'bf27d9e3a0523d3d6e69eba9116b832644610456';
const staleRpp0921Head = 'efe30e4f97f10ed72a132b599ff3937693bfb3d2';

const exactCommands = [
  'git rev-parse HEAD',
  'git log --oneline --max-count=80 -- .agents/RELEASE_GATES.md docs/evidence/ao-release-gates.md docs/evidence src/release-gates.js scripts/release/check-release-gates.mjs scripts/release/verify-release.mjs test',
  "git show -s --format='%H %s' 3ff789513 bb40db8c1 2849d0398 6e3ab6f3c e837c3b90 adc70a4fc 847a4281c bb01b0552 d5e8bb491 45da34eca c3f7a3703 4b459c956 2891399d3 8feb206da 2244808a 7552dcf84 92130e8dc d21ba1fe3 026c5d5b e91640595 dd9c889c3 e0643400e 37898f069 bf37c4e2f 838638074 43a818b14 4393d034d ff533e449 ca82bf5d7 9f75b738a d08b484a 00df4484 4d6600f2a 3fd76ca37 bb4d8be67 025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a a355bb8652e16bef94dd1b37fa76109ec480c92c b51d6f00bf1f530af753a04faf09e79410e8734f 0da2d08aabfaebfeb38aeaf7c8d613edfcf9002d 89130d02c43963bea8dd40cbf22a4b67f47d2e5a 302f62b6086890c40395ed61244dde6162ed0dfa 29fd81e1fef3270877a7b16ba5e2fb6c337ced9b 9add88d7ce97416ce1477e2d9bcdf8983627ba4a f2b94aca7f6df910a13b1dcb06d50f30726c220a 1986075fadadaa0dccf87d29743e397defe9e0ab e4b6606d00a5577a79246a95aa74c3e798ec2407 63946dbed87dd9c05b508c86def46ef41120462e 90f7d7ddd4200d9f9d153919a4b3ebd5341bfb01 ed679ac0ef9ae690cee11500c86a897862481f3e 0034604877dc3ed9392fb50c3b22a77783f192c5 cf8c202d76e1b1a99d27f5dccb8787e040720005 9682d763be7fb0157deebff36c177bcaf37b5e21 6e4a7033a1e5eaa5701ce385d1c9aa81c4641dca",
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T04:10:00.000Z',
  'timeout 300s npm run verify:release',
  'node --check test/rpp-0981-release-gate-1-final-audit-release-verifier-v5.test.js',
  'node --test --test-name-pattern RPP-0981 test/rpp-0981-release-gate-1-final-audit-release-verifier-v5.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0981-release-gate-1-final-audit-release-verifier-v5.md',
  'git diff --check',
];

const exactCommits = [
  ['3ff7895136b46cd2998b28c5d148a242cb41107c', 'Prove auth session live source boundary'],
  ['bb40db8c1d97a4971fe8483b7acb8ae8b6e66d77', 'Prove executor read-only inspect auth'],
  ['2849d0398a3afb3c79eaea06b5a5bd1adb19904b', 'fix: reconcile auth and recovery integration evidence'],
  ['6e3ab6f3c2cd6b0a873562eb60acf2d33aca9c4a', 'Fail closed on underscore cleanup flags'],
  ['e837c3b9043f3ce2ebf5d8605a47253fc33570c5', 'Carry release verifier auth readback evidence'],
  ['adc70a4fc034f72d6bc0897552f930df3d5a00b8', 'Carry release verifier missing secret evidence'],
  ['847a4281c6de4e4fef22d247e66435453292b28a', 'Add RPP-0088 verifier credential binding proof'],
  ['bb01b0552c115548554d435745a83f5daf6fee79', 'Add RPP-0089 verifier manage options proof'],
  ['d5e8bb491d29712d3580b7a08aa0bad22c10a869', 'Add manage options scenario matrix evidence'],
  ['45da34eca069d2e96297e9018928a2c415d90870', 'fix: carry same-source identity through release verifier'],
  ['c3f7a37037f6d4f2455d3ac24078a0e1288bf87a', 'fix: carry preflight route identity verifier evidence'],
  ['4b459c9568ad980eca641f49ab028d83984bc26d', 'test: carry dry-run route eligibility through verifier'],
  ['2891399d3661798021bd156f0799268c1671497e', 'test: add RPP-0093 apply route verifier carry-through'],
  ['8feb206da7478fe41ebece6f2c50c20fca72b251', 'test: cover RPP-0094 journal route carry-through'],
  ['2244808a0837b0a1241e85376a379cdfd74bca7c', 'test: cover RPP-0095 recovery inspect carry-through'],
  ['7552dcf84583112a9e6c011c78c4e5721519614f', 'test: add releaseMovement carry-through regression'],
  ['92130e8dc90bc8393dfac756fb3cb170aae9931c', 'test: cover rpp-0097 verifier tmux marker carry-through'],
  ['d21ba1fe3157dbe4e02fd6c2d7695a4bb5664f0b', 'test: add RPP-0098 progress timestamp verifier carry-through'],
  ['026c5d5b893a1a1bd0def2623f862d54402f4b94', 'test: add RPP-0099 status row carry-through evidence'],
  ['e91640595062c3280fca64ec1fdf37947e0787c2', 'test: add RPP-0100 verifier failure reason carry-through'],
  ['dd9c889c32fa52a7fc82bc659f937908779d4f03', 'Add focused route recovery release gate regressions'],
  ['e0643400eca11641ad346be3937529aad54be613', 'Add tmux marker focused release gate regression'],
  ['37898f0697d913c8f442a7c3751ef698e334fc5f', 'Add focused progress timestamp regression'],
  ['bf37c4e2f2dc6bb27a7d67470ed28f201c30f80f', 'Add focused status row regression'],
  ['838638074261df44ac1ef7a509bb7cd5d3212b19', 'Add focused verify release failure regression'],
  ['43a818b14a27857ac6c4b38c09b81e57b9ee8b5b', 'Add release verifier source gate carry-through'],
  ['4393d034d013dd21f82583d8395246db84c64070', 'Add release verifier topology gate carry-through'],
  ['ff533e449171194c0dd8b0ad97c3a675a20b958d', 'Carry release verifier packaged fallback evidence'],
  ['ca82bf5d7f3503a0b109f89cdb616a7cbcb9df5b', 'Carry release verifier wrong alias evidence'],
  ['9f75b738ae3d900fd0c02f7ff7e5cd2a4dd0d4b3', 'Add RPP-0581 preflight release verifier proof'],
  ['d08b484aed06dc917da489e9a0327929badf3277', 'Add RPP-0586 recovery inspect verifier proof'],
  ['00df4484df7e620f054aed0682f81fe88982ed4b', 'Add RPP-0591 application password verifier proof'],
  ['4d6600f2a9155b33bb9a3035e63ffc55133b9704', 'chore: persist orchestrator validation cadence'],
  ['3fd76ca37e7a314e3d5fe8d65179c105190c4dda', 'Add RPP-0921 gate 1 final audit v2 evidence'],
  ['bb4d8be6753e95a2c41a4aea19ee857d7734e1b3', 'Add RPP-0941 release gate 1 final audit v3'],
  ['025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a', 'Add RPP-0961 release gate 1 final audit v4'],
  ['a355bb8652e16bef94dd1b37fa76109ec480c92c', 'Add RPP-0960 go/no-go release decision record v3'],
  ['b51d6f00bf1f530af753a04faf09e79410e8734f', 'Add RPP-0962 release gate 2 audit evidence'],
  ['0da2d08aabfaebfeb38aeaf7c8d613edfcf9002d', 'Add RPP-0963 release gate 3 final audit v4'],
  ['89130d02c43963bea8dd40cbf22a4b67f47d2e5a', 'Add RPP-0964 gate 4 final audit evidence'],
  ['302f62b6086890c40395ed61244dde6162ed0dfa', 'RPP-0965 objective audit update v4'],
  ['29fd81e1fef3270877a7b16ba5e2fb6c337ced9b', 'Add RPP-0966 critic audit update v4 evidence'],
  ['9add88d7ce97416ce1477e2d9bcdf8983627ba4a', 'Add RPP-0967 security review checklist v4 evidence'],
  ['f2b94aca7f6df910a13b1dcb06d50f30726c220a', 'Add RPP-0968 privacy redaction review evidence'],
  ['1986075fadadaa0dccf87d29743e397defe9e0ab', 'Add RPP-0969 operator runbook evidence'],
  ['e4b6606d00a5577a79246a95aa74c3e798ec2407', 'Add RPP-0970 failure triage runbook v4 evidence'],
  ['63946dbed87dd9c05b508c86def46ef41120462e', 'Add RPP-0971 rollback repair runbook v4 evidence'],
  ['90f7d7ddd4200d9f9d153919a4b3ebd5341bfb01', 'Add RPP-0972 CI required checks evidence'],
  ['ed679ac0ef9ae690cee11500c86a897862481f3e', 'Add RPP-0973 progress publish proof coverage'],
  ['0034604877dc3ed9392fb50c3b22a77783f192c5', 'Add RPP-0974 release artifact package v4 evidence'],
  ['cf8c202d76e1b1a99d27f5dccb8787e040720005', 'Add RPP-0975 versioned protocol docs v4 evidence'],
  ['9682d763be7fb0157deebff36c177bcaf37b5e21', 'Add RPP-0976 migration docs v4 evidence'],
  [auditedHead, 'Merge published progress page state'],
];

const carriedContractPatterns = [
  /GATE-1 is the Production Executor\/Auth Boundary/,
  /requires a production-owned, non-lab-backed source boundary/,
  /support-only evidence\s+does not satisfy final release movement/,
  /This audit does not move any release-gate status\./,
  /No remote tunnel was used for this audit\./,
];

const releaseVerifierAnchors = [
  'docs/evidence/rpp-0096-release-verifier-release-movement-carry-through.md',
  'docs/evidence/rpp-0099-release-verifier-agents-status-row-carry-through.md',
  'docs/evidence/rpp-0100-release-verifier-failure-reason-carry-through.md',
  'test/release-verifier-journal-route-carry-through-focused-regression.test.js',
  'test/release-verifier-recovery-inspect-carry-through-focused-regression.test.js',
  'test/release-verifier-release-movement-summary-carry-through-focused-regression.test.js',
  'test/release-verifier-agents-status-row-carry-through-focused-regression.test.js',
  'test/release-verifier-failure-reason-carry-through-focused-regression.test.js',
];

function readAudit() {
  return fs.readFileSync(auditPath, 'utf8');
}

test('RPP-0981 verifier audit v5 is anchored to the current lane head without moving gates', () => {
  const text = readAudit();

  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Issue: RPP-0981$/m);
  assert.match(text, /^Worker: `rpp-981`$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-981`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.match(text, /Checklist item: RPP-0981 - Release gate 1 final audit, release-verifier variant 5\./);
  assert.doesNotMatch(text, /^Audited local branch: `session\/rpp-961`$/m);
  assert.doesNotMatch(text, /^Audited local branch: `session\/rpp-941`$/m);
  assert.doesNotMatch(text, new RegExp(staleRpp0961Head));
  assert.doesNotMatch(text, new RegExp(staleRpp0941Head));
  assert.doesNotMatch(text, new RegExp(staleRpp0921Head));

  assert.match(text, /GATE-1 therefore remains `support_only`/);
  assert.match(text, /`release_verdict: 0\/4`/);
  assert.match(text, /final release recommendation remains `NO-GO`/);
  assert.match(text, /This audit does not move any release-gate status\./);
});

test('RPP-0981 verifier audit v5 links exact audit and validation commands', () => {
  const text = readAudit();

  for (const command of exactCommands) {
    assert.ok(text.includes(`\`${command}\``), `missing exact command: ${command}`);
  }

  assert.match(text, /`primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`/);
  assert.ok(
    text.includes('[release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]'),
  );
  assert.match(
    text,
    /`\[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false\]`/,
  );
  assert.match(text, /`mutationAttempted: false`/);
  assert.match(text, /`releaseMovement\.allowed: false`/);
  assert.match(text, /`gates: 0\/4`/);
  assert.match(text, /`finalGates: 3\/20`/);
});

test('RPP-0981 verifier audit v5 links exact support commits and lane context commits', () => {
  const text = readAudit();

  for (const [hash, subject] of exactCommits) {
    assert.ok(text.includes(`\`${hash}\``), `missing exact commit hash: ${hash}`);
    assert.ok(text.includes(subject), `missing commit subject: ${subject}`);
  }
});

test('RPP-0981 verifier audit v5 carries forward the RPP-0961 v4 final-audit contract', () => {
  const text = readAudit();
  const baselineText = fs.readFileSync(baselineAuditPath, 'utf8');

  assert.match(text, /Pattern carried forward: RPP-0961 v4 release gate 1 final-audit contract/);
  assert.match(text, /`docs\/evidence\/rpp-0961-release-gate-1-final-audit-v4\.md`/);
  assert.match(text, /`025d87ec271db5dfb3d9f47cb0c2acd0cb3b5c2a` - Add RPP-0961 release gate 1 final audit v4/);

  for (const pattern of carriedContractPatterns) {
    assert.match(baselineText, pattern, `baseline audit missing carried contract: ${pattern}`);
    assert.match(text, pattern, `current audit missing carried contract: ${pattern}`);
  }
});

test('RPP-0981 verifier audit v5 records release-verifier carry-through anchors', () => {
  const text = readAudit();

  for (const anchor of releaseVerifierAnchors) {
    assert.ok(text.includes(anchor), `missing release-verifier anchor: ${anchor}`);
  }

  assert.match(text, /releaseMovement summaries/);
  assert.match(text, /status-row carry-through/);
  assert.match(text, /verifier\s+failure-reason carry-through/);
  assert.match(text, /Journal route read-only carry-through/);
  assert.match(text, /Recovery inspect read-only carry-through/);
  assert.match(text, /does not convert it into release movement/);
});

test('RPP-0981 verifier audit v5 requires production-backed proof before gate movement', () => {
  const text = readAudit();

  assert.match(text, /Before any\s+release-gate movement, a fresh final run must prove production-backed\s+source\/local\/changed topology/);
  assert.match(text, /`REPRINT_PUSH_SOURCE_URL`/);
  assert.match(text, /`REPRINT_PUSH_LOCAL_URL`/);
  assert.match(text, /`REPRINT_PUSH_REMOTE_CHANGED_URL`/);
  assert.match(text, /production-owned source boundary/);
  assert.match(text, /production auth\/session/);
  assert.match(text, /durable journal readback proof/);
  assert.match(text, /production-backed\s+source\/auth\/durability evidence/);
  assert.match(text, /final production source\/auth evidence is absent/);
  assert.match(text, /Required production-backed topology proof is absent/);
});

test('RPP-0981 verifier audit v5 and release-gate status remain final NO-GO support-only', () => {
  const text = readAudit();
  const releaseGates = fs.readFileSync(releaseGatesPath, 'utf8');

  assert.match(text, /Final\s+release should remain `NO-GO`/);
  assert.match(text, /This audit records the current lane state only/);
  assert.match(text, /It does not move GATE-1 out\s+of `support_only`/);
  assert.match(text, /No remote tunnel was used for this audit/);
  assert.doesNotMatch(text, /releaseStatus: GO/);
  assert.doesNotMatch(text, /releaseEligible: true/);
  assert.doesNotMatch(text, /releaseMovement\.allowed: true/);
  assert.match(releaseGates, /`release_verdict`: `0\/4`/);
  assert.match(releaseGates, /## GATE-1: Production Executor\/Auth Boundary\s+Status: `support_only`/);
  assert.match(releaseGates, /## Gate Movement Rule/);
});

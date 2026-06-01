import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = path.join(repoRoot, 'docs/evidence/rpp-0921-release-gate-1-final-audit-v2.md');

const auditedHead = 'efe30e4f97f10ed72a132b599ff3937693bfb3d2';
const staleRpp0901Head = '13a0d0a293b5ba2c65045931ac404e332acf470a';
const olderStaleHead = '93c391cd9913af4019fcf962b60e871982b347ef';

const exactCommands = [
  'git rev-parse HEAD',
  'git log --oneline --max-count=40 -- .agents/RELEASE_GATES.md docs/evidence/ao-release-gates.md src/release-gates.js scripts/release/check-release-gates.mjs test/authenticated-http-push-client.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-missing-production-secret-regression.test.js test/release-gate-application-password-binding-regression.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-same-source-identity-regression.test.js test/release-gate-preflight-route-identity-regression.test.js test/release-gate-dry-run-route-eligibility-regression.test.js test/release-gate-route-recovery-focused-regression.test.js test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-verifier-missing-production-secret-carry-through-focused-regression.test.js test/release-verifier-application-password-binding-carry-through-focused-regression.test.js test/release-verifier-manage-options-carry-through-focused-regression.test.js test/release-verifier-same-source-carry-through-focused-regression.test.js test/release-verifier-preflight-route-carry-through-focused-regression.test.js test/release-verifier-dry-run-route-carry-through-focused-regression.test.js test/release-verifier-apply-route-carry-through-focused-regression.test.js',
  "git show -s --format='%H %s' 3ff789513 bb40db8c1 2849d0398 6e3ab6f3c e837c3b90 adc70a4fc 847a4281c bb01b0552 d5e8bb491 45da34eca c3f7a3703 4b459c956 2891399d3 dd9c889c3 e0643400e 37898f069 bf37c4e2f 838638074 43a818b14 4393d034d ff533e449 ca82bf5d7 4d6600f2a efe30e4f97f10ed72a132b599ff3937693bfb3d2 6a8b87ae01ad5ae1d4b7d61cd340695f71e41f53 6f6e634e61e283c0a91a8fda6b7958ed647a66a5",
  'node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md',
  'node scripts/release/check-release-gates.mjs --scope final-release --now 2026-06-01T02:10:00.000Z',
  'timeout 300s npm run verify:release',
  'node --check test/rpp-0921-release-gate-1-final-audit-v2.test.js',
  'node --test --test-name-pattern RPP-0921 test/rpp-0921-release-gate-1-final-audit-v2.test.js',
  'node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0921-release-gate-1-final-audit-v2.md',
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
  ['dd9c889c32fa52a7fc82bc659f937908779d4f03', 'Add focused route recovery release gate regressions'],
  ['e0643400eca11641ad346be3937529aad54be613', 'Add tmux marker focused release gate regression'],
  ['37898f0697d913c8f442a7c3751ef698e334fc5f', 'Add focused progress timestamp regression'],
  ['bf37c4e2f2dc6bb27a7d67470ed28f201c30f80f', 'Add focused status row regression'],
  ['838638074261df44ac1ef7a509bb7cd5d3212b19', 'Add focused verify release failure regression'],
  ['43a818b14a27857ac6c4b38c09b81e57b9ee8b5b', 'Add release verifier source gate carry-through'],
  ['4393d034d013dd21f82583d8395246db84c64070', 'Add release verifier topology gate carry-through'],
  ['ff533e449171194c0dd8b0ad97c3a675a20b958d', 'Carry release verifier packaged fallback evidence'],
  ['ca82bf5d7f3503a0b109f89cdb616a7cbcb9df5b', 'Carry release verifier wrong alias evidence'],
  ['4d6600f2a9155b33bb9a3035e63ffc55133b9704', 'chore: persist orchestrator validation cadence'],
  [auditedHead, 'Merge published progress page state'],
  ['6a8b87ae01ad5ae1d4b7d61cd340695f71e41f53', 'Add RPP-0898 TLS HTTPS source proof v5 evidence'],
  ['6f6e634e61e283c0a91a8fda6b7958ed647a66a5', 'Add RPP-0900 no tunnel policy v5 evidence'],
];

function auditText() {
  return fs.readFileSync(auditPath, 'utf8');
}

test('RPP-0921 audit v2 is anchored to the current lane head without moving gates', () => {
  const text = auditText();

  assert.match(text, /^Date: 2026-06-01$/m);
  assert.match(text, /^Audited local branch: `session\/rpp-921`$/m);
  assert.match(text, new RegExp(`^Audited lane head before this evidence file: \`${auditedHead}\`$`, 'm'));
  assert.match(text, /Checklist item: RPP-0921 - Release gate 1 final audit, variant 2\./);
  assert.doesNotMatch(text, /session\/rpp-901/);
  assert.doesNotMatch(text, new RegExp(staleRpp0901Head));
  assert.doesNotMatch(text, new RegExp(olderStaleHead));

  assert.match(text, /GATE-1 therefore remains `support_only`/);
  assert.match(text, /`release_verdict: 0\/4`/);
  assert.match(text, /final release recommendation remains `NO-GO`/);
  assert.match(text, /This audit does not move any release gate status\./);
});

test('RPP-0921 audit v2 links exact commands used for evidence and validation', () => {
  const text = auditText();

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
  assert.match(text, /`gates: 0\/4`/);
});

test('RPP-0921 audit v2 links exact support commits and current lane head commits', () => {
  const text = auditText();

  for (const [hash, subject] of exactCommits) {
    assert.ok(text.includes(`\`${hash}\``), `missing exact commit hash: ${hash}`);
    assert.ok(text.includes(subject), `missing commit subject: ${subject}`);
  }
});

test('RPP-0921 audit v2 records production-backed evidence gap and integration recommendation', () => {
  const text = auditText();

  assert.match(text, /production\s+backed source\/auth evidence/);
  assert.match(text, /final source URL evidence is absent/);
  assert.match(text, /no production credential artifact is recorded in this audit/);
  assert.match(text, /No remote tunnel was used for this audit/);
  assert.match(text, /Integrate this file as release-ops evidence for RPP-0921 only/);
  assert.match(text, /Final release\s+should remain `NO-GO`/);
});

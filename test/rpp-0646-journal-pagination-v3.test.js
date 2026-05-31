import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  appendJournalCompleted,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readRecoveryJournalPage,
  readRecoveryJournalPaged,
  readSqliteRecoveryJournalTable,
} from '../src/recovery-journal.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const cursorPattern = /^rpp-0646:([a-f0-9]{16}):(\d+)$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedPaginationCases = Object.freeze([
  {
    id: 'rpp-0646-window-three-v3',
    mutationCount: 7,
    filePageSize: 3,
    sqlitePageLimit: 4,
  },
  {
    id: 'rpp-0646-window-five-v3',
    mutationCount: 11,
    filePageSize: 5,
    sqlitePageLimit: 6,
  },
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0646-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0646-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= generatedCase.mutationCount + 1; index++) {
    base.files[`${generatedCase.id}-file-${index}.txt`] =
      `base-raw-rpp-0646-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-file-${index}.txt`] =
      `local-raw-rpp-0646-${generatedCase.id}-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const current = cloneJson(remote);
  for (const mutation of plan.mutations) {
    setResource(current, mutation.resource, deserializeResourceValue(mutation.value));
  }

  return {
    plan,
    remote,
    current,
    rawSiteValues: rawSiteValuesFor(base, local, remote, current),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0646',
    'local-raw-rpp-0646',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function seedCompletedProductionJournal(generatedCase) {
  const filePath = tempJournalPath();
  const { plan, remote, current, rawSiteValues } = generatedSites(generatedCase);
  const artifactRefs = {
    releaseProof: `artifact://rpp-0646/${generatedCase.id}/journal-pagination-v3`,
    recoverySupport: `artifact://rpp-0646/${generatedCase.id}/local-recovery-support`,
  };
  const claimId = `${generatedCase.id}-claim`;
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  appendJournalCompleted(journal, { plan, current, artifactRefs });
  const productionInspection = journal.inspect();
  journal.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.journal.path, filePath);
  assert.deepEqual(productionInspection.journal.checked, [filePath]);
  assert.equal(productionInspection.journal.restartReadable, true);
  assertNoRawSiteValues(productionInspection, rawSiteValues);

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.filePath, filePath);
  assertHashOnlyRecords(restarted.records, rawSiteValues);

  return {
    filePath,
    plan,
    current,
    rawSiteValues,
    records: restarted.records,
  };
}

function assertNoRawSiteValues(value, rawSiteValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `Unexpected raw site value in RPP-0646 pagination evidence: ${rawValue}`,
    );
  }
}

function assertHashOnlyRecords(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    if (record.beforeHash !== undefined) {
      assert.match(record.beforeHash, hashPattern);
    }
    if (record.afterHash !== undefined) {
      assert.match(record.afterHash, hashPattern);
    }
    if (record.observedHash !== undefined) {
      assert.match(record.observedHash, hashPattern);
    }
  }
  assertNoRawSiteValues(records, rawSiteValues);
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function readFilePageWindows(filePath, pageSize) {
  const windows = [];
  let offset = 0;

  do {
    const page = readRecoveryJournalPage(filePath, { offset, limit: pageSize });
    windows.push(page);
    offset = page.page.nextOffset ?? offset;
  } while (windows.at(-1).page.hasMore);

  return windows;
}

function assertPageWindowsPreserveOrder(windows, {
  pageSize,
  totalRecords,
  rawSiteValues,
}) {
  assert.ok(windows.length > 1);
  assert.deepEqual(
    windows.flatMap((page) => page.records.map((record) => record.sequence)),
    expectedSequences(totalRecords),
  );

  let expectedOffset = 0;
  for (const [index, page] of windows.entries()) {
    assert.equal(page.integrity.status, 'ok');
    assert.equal(page.page.offset, expectedOffset);
    assert.equal(page.page.limit, pageSize);
    assert.equal(page.page.totalRecords, totalRecords);
    assert.equal(page.page.returned, page.records.length);
    assert.equal(page.records.length <= pageSize, true);
    assert.equal(page.page.hasMore, index < windows.length - 1);
    assert.equal(
      page.page.nextOffset,
      index < windows.length - 1 ? expectedOffset + page.records.length : null,
    );
    assertHashOnlyRecords(page.records, rawSiteValues);
    assertNoRawSiteValues(page.page, rawSiteValues);
    expectedOffset += page.records.length;
  }
  assert.equal(expectedOffset, totalRecords);
}

function assertFilePageRequestsFailClosed(filePath, {
  pageSize,
  totalRecords,
  plan,
  current,
}) {
  const before = readRecoveryJournal(filePath);
  const failingRequests = [
    {
      options: { offset: -1, limit: pageSize },
      pattern: /offset must be a non-negative integer/,
    },
    {
      options: { offset: 1.5, limit: pageSize },
      pattern: /offset must be a non-negative integer/,
    },
    {
      options: { offset: `db-journal:${totalRecords + 1}`, limit: pageSize },
      pattern: /offset must be a non-negative integer/,
    },
    {
      options: { offset: 0, limit: 0 },
      pattern: /limit must be a positive integer/,
    },
    {
      options: { offset: 0, limit: pageSize, cursor: `db-journal:${totalRecords}` },
      pattern: /unsupported option keys: cursor/,
    },
  ];

  for (const { options, pattern } of failingRequests) {
    assert.throws(() => readRecoveryJournalPage(filePath, options), pattern);
  }

  const after = readRecoveryJournal(filePath);
  assert.deepEqual(
    after.records.map((record) => record.sequence),
    before.records.map((record) => record.sequence),
  );
  assert.equal(after.records.length, totalRecords);
  assert.equal(inspectRecoveryJournal({ journal: after, plan, current }).status, 'fully-updated-remote');
}

function writeSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, schema_version, record_json) VALUES (?, ?, ?)',
  );
  for (const record of records) {
    insert.run(record.sequence, record.schemaVersion, JSON.stringify(record));
  }
}

function journalPathCursorPrefix(journalPath) {
  return digest({ journalPath }).slice(0, 16);
}

function journalCursorFor(journalPath, offset) {
  return `rpp-0646:${journalPathCursorPrefix(journalPath)}:${offset}`;
}

function cursorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function offsetFromJournalCursor(cursor, journalPath) {
  if (cursor === null || cursor === undefined || cursor === '') {
    return 0;
  }
  const match = typeof cursor === 'string' ? cursor.match(cursorPattern) : null;
  if (!match) {
    throw cursorError(
      'RPP-0646 journal page cursor is invalid.',
      'RPP0646_JOURNAL_CURSOR_INVALID',
      { cursorHash: digest({ cursor }) },
    );
  }
  if (match[1] !== journalPathCursorPrefix(journalPath)) {
    throw cursorError(
      'RPP-0646 journal page cursor belongs to a different checked journal path.',
      'RPP0646_JOURNAL_CURSOR_STALE',
      { cursorHash: digest({ cursor }) },
    );
  }
  return Number.parseInt(match[2], 10);
}

function readSqliteJournalPage(database, {
  journalPath,
  cursor = null,
  limit,
}) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw cursorError(
      'RPP-0646 SQLite journal page limit must be a positive integer.',
      'RPP0646_JOURNAL_PAGE_LIMIT_INVALID',
      { limit },
    );
  }

  const restarted = readSqliteRecoveryJournalTable(database);
  const offset = offsetFromJournalCursor(cursor, journalPath);
  if (offset > restarted.records.length) {
    throw cursorError(
      'RPP-0646 journal page cursor is outside the restarted recovery journal.',
      'RPP0646_JOURNAL_CURSOR_STALE',
      { cursorHash: digest({ cursor }), totalRecords: restarted.records.length },
    );
  }

  const records = restarted.records.slice(offset, offset + limit);
  const nextOffset = offset + records.length < restarted.records.length
    ? offset + records.length
    : null;
  const nextCursor = nextOffset === null ? null : journalCursorFor(journalPath, nextOffset);

  return {
    ...restarted,
    records,
    page: {
      storage: 'sqlite',
      cursor: cursor || null,
      cursorHash: cursor ? digest({ cursor }) : null,
      offset,
      limit,
      returned: records.length,
      totalRecords: restarted.records.length,
      nextOffset,
      nextCursor,
      nextCursorHash: nextCursor ? digest({ cursor: nextCursor }) : null,
      hasMore: nextCursor !== null,
    },
  };
}

function readSqlitePageWindows(database, {
  journalPath,
  limit,
}) {
  const windows = [];
  let cursor = null;

  do {
    const page = readSqliteJournalPage(database, { journalPath, cursor, limit });
    windows.push(page);
    cursor = page.page.nextCursor;
  } while (windows.at(-1).page.hasMore);

  return windows;
}

function assertSqliteCursorFailure(error, expectedCode) {
  assert.equal(error.code, expectedCode);
  assert.match(error.details.cursorHash, hashPattern);
  return true;
}

test('RPP-0646 generated file-backed journal pagination variant 3 preserves recovery state', () => {
  for (const generatedCase of generatedPaginationCases) {
    const seeded = seedCompletedProductionJournal(generatedCase);
    const totalRecords = seeded.records.length;
    const windows = readFilePageWindows(seeded.filePath, generatedCase.filePageSize);
    const restartCursor = windows[0].page.nextOffset;

    assertPageWindowsPreserveOrder(windows, {
      pageSize: generatedCase.filePageSize,
      totalRecords,
      rawSiteValues: seeded.rawSiteValues,
    });

    const restartedCursorPage = readRecoveryJournalPage(seeded.filePath, {
      offset: restartCursor,
      limit: generatedCase.filePageSize,
    });
    assert.deepEqual(
      restartedCursorPage.records.map((record) => record.sequence),
      windows[1].records.map((record) => record.sequence),
    );

    const paged = readRecoveryJournalPaged(seeded.filePath, {
      pageSize: generatedCase.filePageSize,
    });
    assert.equal(paged.integrity.status, 'ok');
    assert.equal(paged.filePath, seeded.filePath);
    assert.equal(paged.page.mode, 'paged-readback');
    assert.equal(paged.page.pages, windows.length);
    assert.deepEqual(
      paged.page.ranges,
      windows.map((page) => ({
        offset: page.page.offset,
        returned: page.page.returned,
        nextOffset: page.page.nextOffset,
      })),
    );
    assert.deepEqual(
      paged.records.map((record) => record.sequence),
      expectedSequences(totalRecords),
    );
    assertHashOnlyRecords(paged.records, seeded.rawSiteValues);

    const inspection = inspectRecoveryJournal({
      journal: paged,
      plan: seeded.plan,
      current: seeded.current,
    });
    assert.equal(inspection.status, 'fully-updated-remote');
    assert.deepEqual(inspection.counts, {
      old: 0,
      new: generatedCase.mutationCount,
      blockedUnknown: 0,
    });
    assert.equal(inspection.journal.filePath, seeded.filePath);
    assert.equal(inspection.journal.page.mode, 'paged-readback');
    assertNoRawSiteValues(inspection, seeded.rawSiteValues);

    assertFilePageRequestsFailClosed(seeded.filePath, {
      pageSize: generatedCase.filePageSize,
      totalRecords,
      plan: seeded.plan,
      current: seeded.current,
    });
  }
});

test('RPP-0646 generated SQLite journal pagination variant 3 keeps restart cursors on the checked path', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  for (const generatedCase of generatedPaginationCases) {
    const sqlitePath = tempSqlitePath();
    const seeded = seedCompletedProductionJournal(generatedCase);
    let database = new DatabaseSync(sqlitePath);
    writeSqliteJournalTable(database, seeded.records);
    database.close();

    database = new DatabaseSync(sqlitePath);
    try {
      const restarted = readSqliteRecoveryJournalTable(database);
      assert.equal(restarted.storage, 'sqlite');
      assert.equal(restarted.integrity.status, 'ok');
      assert.deepEqual(
        restarted.records.map((record) => record.sequence),
        expectedSequences(seeded.records.length),
      );
      assertHashOnlyRecords(restarted.records, seeded.rawSiteValues);

      const windows = readSqlitePageWindows(database, {
        journalPath: seeded.filePath,
        limit: generatedCase.sqlitePageLimit,
      });
      assertPageWindowsPreserveOrder(windows, {
        pageSize: generatedCase.sqlitePageLimit,
        totalRecords: seeded.records.length,
        rawSiteValues: seeded.rawSiteValues,
      });
      assert.ok(windows.slice(0, -1).every((page) => page.page.nextCursorHash.match(hashPattern)));

      const restartCursor = windows[0].page.nextCursor;
      const restartedCursorPage = readSqliteJournalPage(database, {
        journalPath: seeded.filePath,
        cursor: restartCursor,
        limit: generatedCase.sqlitePageLimit,
      });
      assert.deepEqual(
        restartedCursorPage.records.map((record) => record.sequence),
        windows[1].records.map((record) => record.sequence),
      );
      assert.equal(restartedCursorPage.page.cursor, restartCursor);
      assert.match(restartedCursorPage.page.cursorHash, hashPattern);

      assert.throws(
        () => readSqliteJournalPage(database, {
          journalPath: seeded.filePath,
          cursor: 'not-a-rpp-0646-cursor',
          limit: generatedCase.sqlitePageLimit,
        }),
        (error) => assertSqliteCursorFailure(error, 'RPP0646_JOURNAL_CURSOR_INVALID'),
      );
      assert.throws(
        () => readSqliteJournalPage(database, {
          journalPath: seeded.filePath,
          cursor: journalCursorFor(`${seeded.filePath}.stale`, generatedCase.sqlitePageLimit),
          limit: generatedCase.sqlitePageLimit,
        }),
        (error) => assertSqliteCursorFailure(error, 'RPP0646_JOURNAL_CURSOR_STALE'),
      );
      assert.throws(
        () => readSqliteJournalPage(database, {
          journalPath: seeded.filePath,
          cursor: journalCursorFor(seeded.filePath, seeded.records.length + 1),
          limit: generatedCase.sqlitePageLimit,
        }),
        (error) => assertSqliteCursorFailure(error, 'RPP0646_JOURNAL_CURSOR_STALE'),
      );
      assert.throws(
        () => readSqliteJournalPage(database, {
          journalPath: seeded.filePath,
          cursor: restartCursor,
          limit: 0,
        }),
        (error) => {
          assert.equal(error.code, 'RPP0646_JOURNAL_PAGE_LIMIT_INVALID');
          return true;
        },
      );

      const afterFailures = readSqliteRecoveryJournalTable(database);
      assert.equal(afterFailures.integrity.status, 'ok');
      assert.deepEqual(
        afterFailures.records.map((record) => record.sequence),
        expectedSequences(seeded.records.length),
      );

      const inspection = inspectRecoveryJournal({
        journal: afterFailures,
        plan: seeded.plan,
        current: seeded.current,
      });
      assert.equal(inspection.status, 'fully-updated-remote');
      assert.deepEqual(inspection.counts, {
        old: 0,
        new: generatedCase.mutationCount,
        blockedUnknown: 0,
      });
      assertNoRawSiteValues(inspection, seeded.rawSiteValues);
    } finally {
      database.close();
    }
  }
});

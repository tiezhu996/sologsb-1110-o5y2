import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';
import Dexie from 'dexie';

/** 先按 v2 形态建库并写入旧数据（无 reworks 表） */
const factory = new FDBFactory();
(globalThis as Record<string, unknown>).indexedDB = factory;

const oldDb = new Dexie('gbguqin-db');
oldDb.version(1).stores({
  boards: 'id, boardNo, guqinNo',
  chambers: 'id, guqinNo',
  lacquers: 'id, guqinNo, seq, appliedAt',
  stringings: 'id, guqinNo, strungAt',
  meta: 'key',
});
oldDb.version(2).stores({
  boards: 'id, boardNo, guqinNo',
  chambers: 'id, guqinNo',
  lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
  stringings: 'id, guqinNo, strungAt',
  meta: 'key',
});
await oldDb.boards.put({ id: 'b1', boardNo: 'MB-1', guqinNo: 'Q-OLD', part: '面板' });
await oldDb.stringings.put({ id: 's1', guqinNo: 'Q-OLD', sanNote: '旧评语', noteVersions: [] });
await oldDb.meta.put({ key: 'seeded', value: '2026-01-01' });
await oldDb.close();

/** 再以应用当前形态（v3，含 reworks）打开同一库 */
const { db } = await import('../src/utils/db');
const boards = await db.boards.toArray();
const stringings = await db.stringings.toArray();
assert.equal(boards.length, 1, '旧 boards 数据必须保留');
assert.equal(boards[0].guqinNo, 'Q-OLD');
assert.equal(stringings[0].sanNote, '旧评语');
assert.equal(await db.reworks.count(), 0, '新表为空：旧数据按未返工处理');
// 新表可正常读写
await db.reworks.put({ id: 'r1', orderNo: 'FG-X', guqinNo: 'Q-OLD', stage: 'string', master: 'm', issue: '', status: 'draft', linkedId: 's1', linkedLabel: '', createdAt: new Date().toISOString() });
assert.equal(await db.reworks.count(), 1);
console.log('✓ v2 旧库升级 v3：原数据照常打开，按未返工处理，reworks 可正常使用');
process.exit(0);

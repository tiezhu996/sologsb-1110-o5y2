import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { db } from '../src/utils/db';
import { useReworkStore } from '../src/stores/reworkStore';
import { useStringingStore } from '../src/stores/stringingStore';
import { useLacquerStore } from '../src/stores/lacquerStore';
import { importBackup } from '../src/utils/export';
import type { LacquerLayer } from '../src/types/lacquer-layer';
import type { Stringing } from '../src/types/stringing';

let pass = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log(`  ✓ ${name}`);
    });
}

const layer = (id: string, guqinNo: string, seq: number): LacquerLayer => ({
  id,
  guqinNo,
  seq,
  mixRatio: '1:1',
  curingTemp: 24,
  curingHumidity: 78,
  polishGrit: 320,
  layerThickness: 0.1,
  totalThickness: 0.1 * seq,
  appliedAt: new Date().toISOString(),
  operator: '林听雪',
});

const stringing = (id: string, guqinNo: string): Stringing => ({
  id,
  guqinNo,
  stringType: '丝弦',
  nut: '红木雁足',
  stringGap: 17,
  sanNote: '散音宽厚',
  anNote: '按音顺滑',
  fanNote: '泛音清亮',
  nineVirtues: '奇古透',
  defects: ['无'],
  strungAt: new Date().toISOString(),
  operator: '周砚秋',
  noteVersions: [],
});

async function setup() {
  setActivePinia(createPinia());
  await db.lacquers.bulkPut([layer('L1', 'Q-1', 1), layer('L2', 'Q-1', 2), layer('L3', 'Q-2', 1)]);
  await db.stringings.bulkPut([stringing('S1', 'Q-1'), stringing('S2', 'Q-2')]);
}

await setup();
const rework = useReworkStore();
const stringingStore = useStringingStore();
const lacquerStore = useLacquerStore();
await Promise.all([rework.hydrate(), stringingStore.hydrate(), lacquerStore.hydrate()]);

console.log('返工单生命周期与原值快照');

await check('登记生成草稿：无快照、不影响上弦', async () => {
  const draft = await rework.saveDraft({
    guqinNo: 'Q-1',
    stage: 'lacquer',
    master: '林听雪',
    issue: '发皱',
    linkedId: 'L1',
  });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.snapshot, undefined);
  assert.equal(rework.hasPending('Q-1'), false);
  // 草稿不拦截上弦评价：更新已有 S1 评语应正常
  await stringingStore.updateStringing('S1', { nut: '红木雁足（草稿阶段可改）' });
});

await check('同一关联记录不能重复登记返工', async () => {
  await assert.rejects(
    () => rework.saveDraft({ guqinNo: 'Q-1', stage: 'lacquer', master: '周砚秋', issue: '', linkedId: 'L1' }),
    /已登记返工/,
  );
});

await check('确认返工：原子事务留原值快照、进入待复核', async () => {
  const draft = rework.reworks[0];
  const done = await rework.confirmOrder(draft.id);
  assert.equal(done.status, 'pending');
  assert.equal(done.linkedLabel, '髹漆第 1 遍');
  assert.ok(done.snapshot);
  assert.equal(done.snapshot?.stage, 'lacquer');
  if (done.snapshot?.stage === 'lacquer') {
    assert.equal(done.snapshot.layer.id, 'L1');
    assert.equal(done.snapshot.layer.mixRatio, '1:1');
  }
  assert.ok(done.confirmedAt);
  // 库里同样落上了
  const inDb = await db.reworks.get(draft.id);
  assert.equal(inDb?.status, 'pending');
  assert.ok(inDb?.snapshot);
});

await check('快照不随后续原值编辑而改变', async () => {
  await lacquerStore.updateLayer('L1', { mixRatio: '1:2' });
  const order = rework.reworks[0];
  if (order.snapshot?.stage === 'lacquer') {
    assert.equal(order.snapshot.layer.mixRatio, '1:1');
  }
});

console.log('\n待复核与上弦页拒收');

await check('存在待复核返工时，上弦新增/编辑评价被拒绝', async () => {
  assert.equal(rework.hasPending('Q-1'), true);
  // Q-1 此前没有上弦记录以外的新单：新增评价同样要被拦截
  await assert.rejects(
    () =>
      stringingStore.addStringing({
        guqinNo: 'Q-1',
        stringType: '钢弦',
        nut: 'x',
        stringGap: 18,
        sanNote: 'a',
        anNote: 'b',
        fanNote: 'c',
        nineVirtues: 'd',
        defects: ['无'],
        operator: '周砚秋',
      }),
    /待复核返工/,
  );
  await assert.rejects(() => stringingStore.updateStringing('S1', { nut: '乌木雁足' }), /待复核返工/);
  // 无待复核的琴号不受影响
  await stringingStore.updateStringing('S2', { nut: '乌木雁足' });
});

await check('已被返工关联的工序记录不能删除（髹漆/上弦）', async () => {
  // 当前待复核返工关联的是髹漆 L1
  await assert.rejects(() => lacquerStore.removeLayer('L1'), /已关联返工单/);
  // 未关联的髹漆遍次可删
  await lacquerStore.removeLayer('L3');
  // 为 S1 再建一张上弦工序的待复核返工，验证上弦记录删除保护
  const draft = await rework.saveDraft({ guqinNo: 'Q-1', stage: 'string', master: '周砚秋', issue: '七弦紧', linkedId: 'S1' });
  await rework.confirmOrder(draft.id);
  await assert.rejects(() => stringingStore.removeStringing('S1'), /已关联返工单/);
  // 未被关联的上弦记录可删
  await stringingStore.removeStringing('S2');
});

console.log('\n原子事务：写入失败不留半套档案');

await check('确认事务中途失败则整体回滚（状态/快照不变）', async () => {
  // 用一张全新的上弦记录做关联，避免与前序用例互相影响
  await db.stringings.put(stringing('S3', 'Q-3'));
  await stringingStore.hydrate();
  const draft = await rework.saveDraft({ guqinNo: 'Q-3', stage: 'string', master: '周砚秋', issue: '沙音', linkedId: 'S3' });
  const origPut = db.reworks.put.bind(db.reworks);
  let calls = 0;
  // 事务内 reworks.put 仅在最终落单那一次抛错（get/where 不走 put）
  db.reworks.put = ((...args: unknown[]) => {
    calls += 1;
    if (calls >= 1) throw new Error('模拟磁盘写入失败');
    return origPut(...(args as [never]));
  }) as typeof db.reworks.put;
  await assert.rejects(() => rework.confirmOrder(draft.id), /模拟磁盘写入失败/);
  db.reworks.put = origPut;
  const after = await db.reworks.get(draft.id);
  assert.equal(after?.status, 'draft', '状态必须仍是草稿');
  assert.equal(after?.snapshot, undefined, '不能留下快照');
  assert.equal(after?.confirmedAt, undefined, '不能留下确认时间');
  // store 内存中也未被污染
  assert.equal(rework.reworks.find((r) => r.id === draft.id)?.status, 'draft');
  // 失败后可重新确认成功（不留半套，也不卡死）
  await rework.confirmOrder(draft.id);
  assert.equal(rework.reworks.find((r) => r.id === draft.id)?.status, 'pending');
});

console.log('\n复核完成');

await check('复核结论缺失不能完成；填写后锁定', async () => {
  const order = rework.pendingOrders[rework.pendingOrders.length - 1];
  assert.ok(order, '应至少有一张待复核单');
  await assert.rejects(() => rework.completeReview(order.id, { reviewer: '', conclusion: '' }), /复核人/);
  await rework.completeReview(order.id, { reviewer: '周砚秋', conclusion: '返工合格，同意结案' });
  assert.equal(rework.reworks.find((r) => r.id === order.id)?.status, 'completed');
  // 完成后不能再改、再复核、删除
  await assert.rejects(() => rework.updateDraft(order.id, { issue: '改' }), /只有草稿/);
  await assert.rejects(() => rework.completeReview(order.id, { reviewer: 'x', conclusion: 'y' }), /只有待复核/);
  await assert.rejects(() => rework.removeOrder(order.id), /归档保留/);
});

await check('Q-1 全部待复核单完成后，上弦评价才恢复', async () => {
  const remaining = rework.pendingOrders.filter((o) => o.guqinNo === 'Q-1');
  for (const order of remaining) {
    await rework.completeReview(order.id, { reviewer: '周砚秋', conclusion: '复核通过' });
  }
  assert.equal(rework.hasPending('Q-1'), false);
  await stringingStore.updateStringing('S1', { nut: '乌木雁足' });
});

console.log('\n旧备份恢复兼容');

await check('恢复无 reworks 的旧备份：原数据照常打开、按未返工处理、已有返工关联不被覆盖', async () => {
  const keptReworks = await db.reworks.toArray();
  assert.ok(keptReworks.length >= 2);
  const oldBackup = JSON.stringify({
    app: 'gbguqin',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    boards: [],
    chambers: [],
    lacquers: [layer('L9', 'Q-9', 1)],
    stringings: [stringing('S9', 'Q-9')],
  });
  const counts = await importBackup(oldBackup);
  assert.equal(counts.reworks, null, '旧备份返工计数应为 null');
  // 四张原表按备份恢复
  assert.equal(await db.lacquers.count(), 1);
  assert.equal(await db.stringings.count(), 1);
  assert.equal((await db.lacquers.toArray())[0].id, 'L9');
  // reworks 未被清空覆盖
  const after = await db.reworks.toArray();
  assert.equal(after.length, keptReworks.length);
  assert.deepEqual(after.map((r) => r.id).sort(), keptReworks.map((r) => r.id).sort());
  // 恢复后的数据按未返工处理
  await rework.hydrate();
  assert.equal(rework.hasPending('Q-9'), false);
});

await check('恢复带 reworks 的新备份：整表替换为备份内容', async () => {
  const newBackup = JSON.stringify({
    app: 'gbguqin',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    boards: [],
    chambers: [],
    lacquers: [],
    stringings: [],
    reworks: [],
  });
  const counts = await importBackup(newBackup);
  assert.equal(counts.reworks, 0);
  assert.equal(await db.reworks.count(), 0);
});

console.log(`\n全部 ${pass} 项断言通过`);
process.exit(0);

<script setup lang="ts">
import { computed } from 'vue';
import type { ReworkSnapshot } from '../../types/rework';
import type { LacquerLayer } from '../../types/lacquer-layer';
import type { Stringing } from '../../types/stringing';

const props = defineProps<{
  snapshot: ReworkSnapshot;
  /** 关联记录的当前值（若仍在原表中）；传入后与快照逐项对比并标出现值 */
  current?: LacquerLayer | Stringing;
}>();

interface SnapshotRow {
  label: string;
  oldText: string;
  newText?: string;
  changed: boolean;
}

const rows = computed<SnapshotRow[]>(() => {
  if (props.snapshot.stage === 'lacquer') {
    const old = props.snapshot.layer;
    const now = props.current as LacquerLayer | undefined;
    const list: SnapshotRow[] = [
      { label: '遍次', oldText: `第 ${old.seq} 遍`, newText: now ? `第 ${now.seq} 遍` : undefined, changed: false },
      { label: '灰胎配比', oldText: old.mixRatio, newText: now?.mixRatio, changed: false },
      { label: '荫房温度', oldText: `${old.curingTemp}℃`, newText: now ? `${now.curingTemp}℃` : undefined, changed: false },
      { label: '荫房湿度', oldText: `${old.curingHumidity}%`, newText: now ? `${now.curingHumidity}%` : undefined, changed: false },
      { label: '打磨目数', oldText: `${old.polishGrit} 目`, newText: now ? `${now.polishGrit} 目` : undefined, changed: false },
      { label: '本遍厚度', oldText: `${old.layerThickness}mm`, newText: now ? `${now.layerThickness}mm` : undefined, changed: false },
      { label: '累计厚度', oldText: `${old.totalThickness}mm`, newText: now ? `${now.totalThickness}mm` : undefined, changed: false },
      { label: '髹漆人', oldText: old.operator, newText: now?.operator, changed: false },
      { label: '备注', oldText: old.remark ?? '—', newText: now ? now.remark ?? '—' : undefined, changed: false },
    ];
    return list.map((row) => ({ ...row, changed: row.newText !== undefined && row.newText !== row.oldText }));
  }
  const old = props.snapshot.stringing;
  const now = props.current as Stringing | undefined;
  const list: SnapshotRow[] = [
    { label: '弦材质', oldText: old.stringType, newText: now?.stringType, changed: false },
    { label: '雁足与绒扣', oldText: old.nut, newText: now?.nut, changed: false },
    { label: '弦距', oldText: `${old.stringGap}mm`, newText: now ? `${now.stringGap}mm` : undefined, changed: false },
    { label: '散音评语', oldText: old.sanNote, newText: now?.sanNote, changed: false },
    { label: '按音评语', oldText: old.anNote, newText: now?.anNote, changed: false },
    { label: '泛音评语', oldText: old.fanNote, newText: now?.fanNote, changed: false },
    { label: '九德简述', oldText: old.nineVirtues, newText: now?.nineVirtues, changed: false },
    { label: '缺陷标记', oldText: old.defects.join(' / '), newText: now ? now.defects.join(' / ') : undefined, changed: false },
    { label: '上弦人', oldText: old.operator, newText: now?.operator, changed: false },
  ];
  return list.map((row) => ({ ...row, changed: row.newText !== undefined && row.newText !== row.oldText }));
});

const changedCount = computed(() => rows.value.filter((r) => r.changed).length);
const sourceMissing = computed(() => props.current === undefined);
</script>

<template>
  <div class="snapshot-view">
    <div class="snapshot-head">
      <el-tag size="small" type="info" effect="plain">确认返工当时的原值快照</el-tag>
      <el-tag v-if="sourceMissing" size="small" type="danger">原工序记录已不存在</el-tag>
      <el-tag v-else-if="changedCount" size="small" type="warning">现值已有 {{ changedCount }} 处改动</el-tag>
      <el-tag v-else size="small" type="success">与现值一致</el-tag>
    </div>
    <el-table :data="rows" size="small" border class="snapshot-table">
      <el-table-column prop="label" label="项目" width="110" />
      <el-table-column label="原值（快照）" min-width="200">
        <template #default="scope">
          <span :class="{ 'changed-cell': scope.row.changed }">{{ scope.row.oldText }}</span>
        </template>
      </el-table-column>
      <el-table-column v-if="!sourceMissing" label="现值" min-width="200">
        <template #default="scope">
          <span v-if="scope.row.changed" class="changed-cell">{{ scope.row.newText }}</span>
          <span v-else class="same-cell">{{ scope.row.newText }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.snapshot-head {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.snapshot-table {
  width: 100%;
}
.changed-cell {
  color: #c62828;
  font-weight: 600;
}
.same-cell {
  color: #a3968a;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useReworkStore } from '../stores/reworkStore';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { formatDate } from '../utils/layer';
import { MASTER_OPTIONS, REVIEWER_OPTIONS, REWORK_STAGE_LABELS, snapshotLines } from '../utils/rework';
import { REWORK_STAGES, type ReworkOrder, type ReworkStage } from '../types/rework';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';

const route = useRoute();
const reworkStore = useReworkStore();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();

/* ---------------- 筛选 ---------------- */

const stageParam = computed(() => (typeof route.query.stage === 'string' ? route.query.stage : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const keyword = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));

const visible = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return reworkStore.reworks.filter((r) => {
    if (stageParam.value && REWORK_STAGE_LABELS[r.stage] !== stageParam.value) return false;
    if (statusParam.value === '待复核' && r.status !== 'pending') return false;
    if (statusParam.value === '已完成' && r.status !== 'done') return false;
    if (kw) {
      const hay = [r.orderNo, r.guqinNo, r.responsible, r.reason, r.registrar, r.reviewer ?? '', r.conclusion ?? '', r.ref?.refLabel ?? '']
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
});

/* ---------------- 候选：琴号 / 髹漆遍次 / 上弦 ---------------- */

const guqinOptions = computed(() =>
  Array.from(
    new Set([
      ...boardStore.guqinNos,
      ...chamberStore.chambers.map((c) => c.guqinNo),
      ...lacquerStore.guqinNos,
      ...stringingStore.stringings.map((s) => s.guqinNo),
    ]),
  ).sort(),
);

const layersOf = (guqinNo: string): LacquerLayer[] => lacquerStore.layersOf(guqinNo);
const stringingOf = (guqinNo: string): Stringing | undefined => stringingStore.byGuqin(guqinNo);

/** 当前琴号 + 工序下可关联 / 取快照的候选 */
interface RefOption {
  id: string;
  label: string;
}
const refOptions = computed<RefOption[]>(() => {
  const no = form.value.guqinNo.trim();
  if (!no) return [];
  if (form.value.stage === 'lacquer') {
    return layersOf(no).map((l) => ({ id: l.id, label: `髹漆第 ${l.seq} 遍 · ${formatDate(l.appliedAt)} · ${l.operator}` }));
  }
  if (form.value.stage === 'string') {
    const s = stringingOf(no);
    return s ? [{ id: s.id, label: `上弦 · ${formatDate(s.strungAt)} · ${s.operator}` }] : [];
  }
  // 选材 / 掏膛：可关联该琴任意髹漆或上弦记录
  return [
    ...layersOf(no).map((l) => ({ id: l.id, label: `髹漆第 ${l.seq} 遍 · ${formatDate(l.appliedAt)}` })),
    ...(() => {
      const s = stringingOf(no);
      return s ? [{ id: s.id, label: `上弦 · ${formatDate(s.strungAt)}` }] : [];
    })(),
  ];
});

/** 登记确认前的原值快照预览（取自当前内存档案；落库时事务内重读） */
const previewLines = computed<string[]>(() => {
  const no = form.value.guqinNo.trim();
  if (!no) return [];
  if (form.value.stage === 'select') {
    const boards = boardStore.boardsOf(no);
    const panel = boards.find((b) => b.part === '面板') ?? null;
    const base = boards.find((b) => b.part === '底板') ?? null;
    return snapshotLines({ stage: 'select', takenAt: '', panel, base, record: null });
  }
  if (form.value.stage === 'carve') {
    return snapshotLines({ stage: 'carve', takenAt: '', record: chamberStore.byGuqin(no) ?? null });
  }
  if (form.value.stage === 'lacquer') {
    return snapshotLines({ stage: 'lacquer', takenAt: '', record: layersOf(no).find((l) => l.id === form.value.refId) ?? null });
  }
  return snapshotLines({ stage: 'string', takenAt: '', record: stringingOf(no) ?? null });
});

/** 该工序是否具备可留存的原值（不具备则禁止确认） */
const snapshotMissing = computed(() => previewLines.value.some((line) => line.includes('缺失')));

/* ---------------- 登记 / 草稿编辑 ---------------- */

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();

interface ReworkForm {
  guqinNo: string;
  stage: ReworkStage;
  responsible: string;
  reason: string;
  refId: string;
  registrar: string;
}

function emptyForm(): ReworkForm {
  return {
    guqinNo: guqinOptions.value[0] ?? '',
    stage: 'lacquer',
    responsible: MASTER_OPTIONS[0],
    reason: '',
    refId: '',
    registrar: '档案员',
  };
}

const form = ref<ReworkForm>(emptyForm());

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请选择琴号', trigger: 'change' }],
  stage: [{ required: true, message: '请选择问题工序', trigger: 'change' }],
  responsible: [{ required: true, message: '请选择责任师傅', trigger: 'change' }],
  reason: [{ required: true, message: '请填写问题描述', trigger: 'blur' }],
};

// 琴号 / 工序变化后，若已选关联不在候选内则重选第一条（灰胎、上弦的关联即快照来源）
watch([() => form.value.guqinNo, () => form.value.stage], () => {
  if (form.value.refId && !refOptions.value.some((o) => o.id === form.value.refId)) {
    form.value.refId = '';
  }
});

const isCreate = computed(() => !editingId.value);
// 上弦 / 灰胎草稿编辑时，快照来源即关联，登记后不允许换工序/琴号，关联也锁定
const refLockedInEdit = computed(() => !isCreate.value && (form.value.stage === 'lacquer' || form.value.stage === 'string'));

function openCreate() {
  editingId.value = '';
  form.value = emptyForm();
  form.value.refId = refOptions.value[0]?.id ?? '';
  dialogVisible.value = true;
}

function openEdit(order: ReworkOrder) {
  if (order.status !== 'pending') return;
  editingId.value = order.id;
  form.value = {
    guqinNo: order.guqinNo,
    stage: order.stage,
    responsible: order.responsible,
    reason: order.reason,
    refId: order.ref?.refId ?? '',
    registrar: order.registrar,
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (snapshotMissing.value) {
    ElMessage.error('该琴在此工序还没有原值档案，无法留存快照，请先补齐对应工序记录');
    return;
  }
  // 选材 / 掏膛在存在可关联记录时必须关联；灰胎 / 上弦关联即快照来源，必有
  if (!form.value.refId && refOptions.value.length > 0) {
    ElMessage.error('请关联一条髹漆遍次或上弦记录');
    return;
  }
  try {
    if (editingId.value) {
      await reworkStore.updateDraft(editingId.value, {
        responsible: form.value.responsible,
        reason: form.value.reason,
        refId: form.value.refId || null,
      });
      ElMessage.success('已保存草稿修改（原值快照保持不变）');
    } else {
      const created = await reworkStore.registerOrder({
        guqinNo: form.value.guqinNo,
        stage: form.value.stage,
        responsible: form.value.responsible,
        reason: form.value.reason,
        refId: form.value.refId || undefined,
        registrar: form.value.registrar,
      });
      ElMessage.success(`已登记返工单 ${created.orderNo}，原值快照已留存，进度表显示待复核`);
    }
    dialogVisible.value = false;
  } catch (error) {
    // 事务回滚，不会留下半套档案
    ElMessage.error(`返工单登记失败，已整体回滚：${(error as Error).message}`);
  }
}

async function remove(order: ReworkOrder) {
  const confirmed = await ElMessageBox.confirm(`确认删除返工单 ${order.orderNo}（${order.guqinNo}）？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await reworkStore.remove(order.id);
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------------- 复核 ---------------- */

const reviewVisible = ref(false);
const reviewingId = ref('');
const reviewForm = ref({ reviewer: REVIEWER_OPTIONS[0], conclusion: '' });

function openReview(order: ReworkOrder) {
  reviewingId.value = order.id;
  reviewForm.value = { reviewer: REVIEWER_OPTIONS[0], conclusion: '' };
  reviewVisible.value = true;
}

async function submitReview() {
  if (!reviewForm.value.conclusion.trim()) {
    ElMessage.error('请填写复核结论');
    return;
  }
  try {
    await reworkStore.completeReview(reviewingId.value, reviewForm.value);
    ElMessage.success('复核结论已填写，返工单完成');
    reviewVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------------- 详情 ---------------- */

const detailVisible = ref(false);
const detail = ref<ReworkOrder | null>(null);
const detailLines = computed(() => (detail.value ? snapshotLines(detail.value.snapshot) : []));

function openDetail(order: ReworkOrder) {
  detail.value = order;
  detailVisible.value = true;
}
</script>

<template>
  <div>
    <h2 class="page-title">返工处置单</h2>
    <p class="page-desc">
      登记时选择琴号、问题工序与责任师傅；确认后对应工序原值以快照留存，进度表显示「待复核」，并关联髹漆遍次或上弦记录。
      复核人填写结论后返工单才算完成，草稿仍可修改。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记返工处置单</el-button>
      <el-tag type="warning" effect="plain">待复核 {{ reworkStore.pendingCount }} 单</el-tag>
      <el-tag type="info" effect="plain">共 {{ reworkStore.reworks.length }} 单</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'stage', label: '问题工序', options: REWORK_STAGES.map((s) => REWORK_STAGE_LABELS[s]), width: 120 },
        { key: 'status', label: '状态', options: ['待复核', '已完成'], width: 110 },
      ]"
      keyword-placeholder="搜索单号 / 琴号 / 责任师傅 / 问题描述"
      :result-count="visible.length"
      :total-count="reworkStore.reworks.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的返工处置单" action-text="登记返工处置单" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column prop="orderNo" label="返工单号" width="130" />
        <el-table-column prop="guqinNo" label="琴号" width="100" />
        <el-table-column label="问题工序" width="90">
          <template #default="scope">{{ REWORK_STAGE_LABELS[scope.row.stage as ReworkStage] }}</template>
        </el-table-column>
        <el-table-column prop="responsible" label="责任师傅" width="90" />
        <el-table-column prop="reason" label="问题描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="关联记录" min-width="180" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.ref?.refLabel ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.status === 'pending' ? 'warning' : 'success'" size="small">
              {{ scope.row.status === 'pending' ? '待复核' : '已完成' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="登记日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.registeredAt) }}</template>
        </el-table-column>
        <el-table-column label="复核人" width="90">
          <template #default="scope">{{ scope.row.reviewer ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openDetail(scope.row)">详情</el-button>
            <el-button
              v-if="scope.row.status === 'pending'"
              link
              type="warning"
              @click="openEdit(scope.row)"
            >修改草稿</el-button>
            <el-button
              v-if="scope.row.status === 'pending'"
              link
              type="success"
              @click="openReview(scope.row)"
            >复核</el-button>
            <el-button
              v-if="scope.row.status === 'pending'"
              link
              type="danger"
              @click="remove(scope.row)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 登记 / 草稿编辑 -->
    <el-dialog v-model="dialogVisible" :title="isCreate ? '登记返工处置单' : `修改草稿 · ${form.guqinNo}`" width="720px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-select v-model="form.guqinNo" filterable allow-create :disabled="!isCreate" placeholder="选择或输入琴号" style="width: 240px">
            <el-option v-for="no in guqinOptions" :key="no" :label="no" :value="no" />
          </el-select>
          <span v-if="!isCreate" class="form-hint">草稿不可改琴号与工序（如需请另开返工单）</span>
        </el-form-item>
        <el-form-item label="问题工序" prop="stage">
          <el-radio-group v-model="form.stage" :disabled="!isCreate">
            <el-radio-button v-for="s in REWORK_STAGES" :key="s" :value="s">{{ REWORK_STAGE_LABELS[s] }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="责任师傅" prop="responsible">
          <el-select v-model="form.responsible" filterable allow-create placeholder="选择或输入责任师傅" style="width: 220px">
            <el-option v-for="m in MASTER_OPTIONS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="关联记录">
          <el-select
            v-model="form.refId"
            :disabled="refLockedInEdit"
            clearable
            filterable
            placeholder="关联髹漆遍次或上弦记录"
            style="width: 420px"
          >
            <el-option v-for="opt in refOptions" :key="opt.id" :label="opt.label" :value="opt.id" />
          </el-select>
          <div class="form-hint">
            灰胎/上弦返工关联即问题原值来源；选材/掏膛在有髹漆或上弦记录时需关联。
            <span v-if="refLockedInEdit">该关联登记后锁定。</span>
          </div>
        </el-form-item>
        <el-form-item label="问题描述" prop="reason">
          <el-input v-model="form.reason" type="textarea" :rows="2" maxlength="80" show-word-limit placeholder="如：打磨后局部返砂，需补灰重磨" />
        </el-form-item>
        <el-form-item label="原值快照">
          <div class="snapshot-box">
            <div v-for="(line, i) in previewLines" :key="i" class="snapshot-line">{{ line }}</div>
            <el-alert
              v-if="snapshotMissing"
              type="error"
              :closable="false"
              show-icon
              title="该琴在此工序还没有原值档案，无法登记"
              style="margin-top: 6px"
            />
          </div>
        </el-form-item>
        <el-form-item v-if="isCreate" label="登记人">
          <el-input v-model="form.registrar" maxlength="16" style="width: 200px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">{{ isCreate ? '确认登记' : '保存草稿' }}</el-button>
      </template>
    </el-dialog>

    <!-- 复核 -->
    <el-dialog v-model="reviewVisible" title="返工复核" width="560px">
      <el-form label-width="90px">
        <el-form-item label="复核人" required>
          <el-select v-model="reviewForm.reviewer" filterable allow-create placeholder="选择或输入复核人" style="width: 220px">
            <el-option v-for="m in REVIEWER_OPTIONS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="复核结论" required>
          <el-input
            v-model="reviewForm.conclusion"
            type="textarea"
            :rows="4"
            maxlength="120"
            show-word-limit
            placeholder="填写结论后返工单才算完成"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="success" @click="submitReview">提交复核结论</el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailVisible" title="返工处置单详情" width="640px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small" class="detail-desc">
          <el-descriptions-item label="返工单号">{{ detail.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="detail.status === 'pending' ? 'warning' : 'success'" size="small">
              {{ detail.status === 'pending' ? '待复核' : '已完成' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="琴号">{{ detail.guqinNo }}</el-descriptions-item>
          <el-descriptions-item label="问题工序">{{ REWORK_STAGE_LABELS[detail.stage] }}</el-descriptions-item>
          <el-descriptions-item label="责任师傅">{{ detail.responsible }}</el-descriptions-item>
          <el-descriptions-item label="登记人">{{ detail.registrar }}</el-descriptions-item>
          <el-descriptions-item label="关联记录" :span="2">{{ detail.ref?.refLabel ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="问题描述" :span="2">{{ detail.reason }}</el-descriptions-item>
          <el-descriptions-item label="原值快照" :span="2">
            <div class="snapshot-box">
              <div v-for="(line, i) in detailLines" :key="i" class="snapshot-line">{{ line }}</div>
              <div class="snapshot-meta">快照留存于 {{ formatDate(detail.snapshot.takenAt) }}，原工序档案不改动</div>
            </div>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.status === 'done'" label="复核人">{{ detail.reviewer }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.status === 'done'" label="复核时间">
            {{ detail.reviewedAt ? formatDate(detail.reviewedAt) : '' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.status === 'done'" label="复核结论" :span="2">{{ detail.conclusion }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 14px;
  color: #8a7a68;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.form-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #a3968a;
}
.snapshot-box {
  width: 100%;
  background: #faf6ef;
  border: 1px solid #e7dcc9;
  border-radius: 6px;
  padding: 8px 10px;
}
.snapshot-line {
  font-size: 13px;
  color: #5c4d3d;
  line-height: 1.9;
}
.snapshot-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #a3968a;
}
.detail-desc {
  margin-top: 4px;
}
</style>

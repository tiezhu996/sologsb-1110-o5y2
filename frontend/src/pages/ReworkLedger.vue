<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ReworkSnapshotView from '../components/common/ReworkSnapshotView.vue';
import { useReworkStore } from '../stores/reworkStore';
import { useBoardStore } from '../stores/boardStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { formatDate, formatDateTime } from '../utils/layer';
import {
  REWORK_MASTERS,
  REWORK_STAGE_LABELS,
  REWORK_STAGES,
  REWORK_STATUS_LABELS,
  type ReworkOrder,
  type ReworkStage,
  type ReworkStatus,
} from '../types/rework';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';

const route = useRoute();
const reworkStore = useReworkStore();
const boardStore = useBoardStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();

/* ---------------- 筛选（路由 query） ---------------- */

const keyword = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const stageParam = computed(() => (typeof route.query.stage === 'string' ? route.query.stage : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));

const visible = computed(() =>
  reworkStore.search(keyword.value).filter((order) => {
    if (stageParam.value && REWORK_STAGE_LABELS[order.stage] !== stageParam.value) return false;
    if (statusParam.value && REWORK_STATUS_LABELS[order.status] !== statusParam.value) return false;
    return true;
  }),
);

/* ---------------- 可选琴号与关联记录 ---------------- */

/** 有髹漆或上弦记录的琴号才能登记返工（要有关联对象） */
const guqinOptions = computed(() =>
  Array.from(new Set([...lacquerStore.guqinNos, ...stringingStore.stringings.map((s) => s.guqinNo)])).sort(),
);

const linkedLayers = computed<LacquerLayer[]>(() =>
  form.value.guqinNo ? lacquerStore.layersOf(form.value.guqinNo) : [],
);
const linkedStringing = computed<Stringing | undefined>(() =>
  form.value.guqinNo ? stringingStore.byGuqin(form.value.guqinNo) : undefined,
);

/** 该琴是否已有待复核返工（上弦工序在复核完成前不能再登记新单） */
const guqinBlocked = computed(() => reworkStore.hasPending(form.value.guqinNo));

/* ---------------- 登记 / 草稿编辑弹窗 ---------------- */

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();

interface ReworkForm {
  guqinNo: string;
  stage: ReworkStage;
  master: string;
  issue: string;
  linkedId: string;
}

const form = ref<ReworkForm>({
  guqinNo: '',
  stage: 'lacquer',
  master: REWORK_MASTERS[0],
  issue: '',
  linkedId: '',
});

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请选择琴号', trigger: 'change' }],
  stage: [{ required: true, message: '请选择问题工序', trigger: 'change' }],
  master: [{ required: true, message: '请选择责任师傅', trigger: 'change' }],
  linkedId: [{ required: true, message: '请选择问题工序记录', trigger: 'change' }],
};

// 琴号或工序切换后，原关联记录可能已不在候选中，自动重选或清空
watch(
  () => [form.value.guqinNo, form.value.stage],
  () => {
    const exists =
      form.value.stage === 'lacquer'
        ? linkedLayers.value.some((l) => l.id === form.value.linkedId)
        : linkedStringing.value?.id === form.value.linkedId;
    if (!exists) {
      form.value.linkedId =
        form.value.stage === 'lacquer'
          ? linkedLayers.value[linkedLayers.value.length - 1]?.id ?? ''
          : linkedStringing.value?.id ?? '';
    }
  },
);

/** 该关联记录是否已被别的返工单占用（含全部状态） */
function linkedOccupied(linkedId: string, selfId = ''): ReworkOrder | undefined {
  const order = reworkStore.linkedOrder(linkedId);
  return order && order.id !== selfId ? order : undefined;
}

const linkedConflict = computed(() => {
  if (!form.value.linkedId) return undefined;
  return linkedOccupied(form.value.linkedId, editingId.value);
});

function resetForm(guqinNo = '') {
  form.value = {
    guqinNo: guqinNo || guqinOptions.value[0] || '',
    stage: 'lacquer',
    master: REWORK_MASTERS[0],
    issue: '',
    linkedId: '',
  };
  // watch 会按琴号 / 工序自动带出默认关联记录
}

function openCreate() {
  editingId.value = '';
  resetForm();
  dialogVisible.value = true;
}

function openEdit(order: ReworkOrder) {
  if (order.status !== 'draft') {
    ElMessage.warning('只有草稿返工单可以修改');
    return;
  }
  editingId.value = order.id;
  form.value = {
    guqinNo: order.guqinNo,
    stage: order.stage,
    master: order.master,
    issue: order.issue,
    linkedId: order.linkedId,
  };
  dialogVisible.value = true;
}

async function submitDraft() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (linkedConflict.value) {
    ElMessage.error(`该工序记录已关联返工单 ${linkedConflict.value.orderNo}，请改选其他记录`);
    return;
  }
  try {
    if (editingId.value) {
      await reworkStore.updateDraft(editingId.value, { ...form.value });
      ElMessage.success('草稿已保存');
    } else {
      await reworkStore.saveDraft({ ...form.value });
      ElMessage.success('返工单已存为草稿，确认后才会留原值快照并进入待复核');
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error(`保存失败：${(error as Error).message}`);
  }
}

/** 确认返工：原子事务内留原值快照 + 置待复核，失败不留半套档案 */
async function confirm(order: ReworkOrder) {
  const confirmed = await ElMessageBox.confirm(
    `确认 ${order.guqinNo} 的${REWORK_STAGE_LABELS[order.stage]}返工单 ${order.orderNo}？确认时将固化关联记录原值快照并进入待复核，之后不可修改。`,
    '确认返工',
    { type: 'warning', confirmButtonText: '确认并留快照' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await reworkStore.confirmOrder(order.id);
    ElMessage.success('已留原值快照，进度表已显示待复核');
  } catch (error) {
    ElMessage.error(`确认失败：${(error as Error).message}`);
  }
}

async function remove(order: ReworkOrder) {
  const confirmed = await ElMessageBox.confirm(`确认删除返工单 ${order.orderNo}？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await reworkStore.removeOrder(order.id);
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------------- 复核弹窗 ---------------- */

const reviewVisible = ref(false);
const reviewingId = ref('');
const reviewForm = ref({ reviewer: '', conclusion: '' });
const reviewRef = ref<FormInstance>();
const reviewRules: FormRules = {
  reviewer: [{ required: true, message: '请填写复核人', trigger: 'blur' }],
  conclusion: [{ required: true, message: '请填写复核结论', trigger: 'blur' }],
};

function openReview(order: ReworkOrder) {
  reviewingId.value = order.id;
  reviewForm.value = { reviewer: order.reviewer ?? '', conclusion: order.conclusion ?? '' };
  reviewVisible.value = true;
}

async function submitReview() {
  const ok = await reviewRef.value?.validate().catch(() => false);
  if (!ok) return;
  try {
    await reworkStore.completeReview(reviewingId.value, { ...reviewForm.value });
    ElMessage.success('复核结论已填写，返工单完成');
    reviewVisible.value = false;
  } catch (error) {
    ElMessage.error(`复核失败：${(error as Error).message}`);
  }
}

/* ---------------- 查看（原值快照）弹窗 ---------------- */

const viewVisible = ref(false);
const viewing = ref<ReworkOrder | null>(null);

function openView(order: ReworkOrder) {
  viewing.value = order;
  viewVisible.value = true;
}

const viewSnapshot = computed(() => viewing.value?.snapshot);
const viewCurrent = computed<LacquerLayer | Stringing | undefined>(() => {
  const order = viewing.value;
  if (!order?.snapshot) return undefined;
  if (order.snapshot.stage === 'lacquer') return lacquerStore.layers.find((l) => l.id === order.linkedId);
  return stringingStore.stringings.find((s) => s.id === order.linkedId);
});

function statusTagType(status: ReworkStatus): 'info' | 'warning' | 'success' {
  return status === 'draft' ? 'info' : status === 'pending' ? 'warning' : 'success';
}

function linkedText(order: ReworkOrder): string {
  if (order.linkedLabel) return order.linkedLabel;
  if (order.stage === 'lacquer') {
    const layer = lacquerStore.layers.find((l) => l.id === order.linkedId);
    return layer ? `髹漆第 ${layer.seq} 遍` : '髹漆记录（已删除）';
  }
  return stringingStore.stringings.some((s) => s.id === order.linkedId) ? '上弦记录' : '上弦记录（已删除）';
}
</script>

<template>
  <div>
    <h2 class="page-title">返工处置单</h2>
    <p class="page-desc">
      选琴号、问题工序与责任师傅登记返工单；确认后自动留下对应工序的原值快照、琴坯进度显示待复核，并关联髹漆遍次或上弦记录。
      复核人填写结论后返工单才算完成，草稿仍可修改。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记返工单</el-button>
      <el-tag type="warning" effect="plain">待复核 {{ reworkStore.pendingTotal }} 单</el-tag>
      <el-tag type="info" effect="plain">草稿 {{ reworkStore.reworks.filter((r) => r.status === 'draft').length }} 单</el-tag>
      <el-tag type="success" effect="plain">已完成 {{ reworkStore.reworks.filter((r) => r.status === 'completed').length }} 单</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'stage', label: '问题工序', options: REWORK_STAGES.map((s) => REWORK_STAGE_LABELS[s]), width: 120 },
        { key: 'status', label: '状态', options: Object.values(REWORK_STATUS_LABELS), width: 110 },
      ]"
      keyword-placeholder="搜索返工单号 / 琴号 / 师傅 / 问题 / 结论"
      :result-count="visible.length"
      :total-count="reworkStore.reworks.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的返工处置单" action-text="登记返工单" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column prop="orderNo" label="返工单号" width="150" />
        <el-table-column prop="guqinNo" label="琴号" width="100" />
        <el-table-column label="问题工序" width="90">
          <template #default="scope">{{ REWORK_STAGE_LABELS[scope.row.stage as ReworkStage] }}</template>
        </el-table-column>
        <el-table-column label="关联记录" width="110">
          <template #default="scope">{{ linkedText(scope.row) }}</template>
        </el-table-column>
        <el-table-column prop="master" label="责任师傅" width="90" />
        <el-table-column prop="issue" label="问题描述" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="statusTagType(scope.row.status)" size="small">
              {{ REWORK_STATUS_LABELS[scope.row.status as ReworkStatus] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="登记/确认" width="150">
          <template #default="scope">
            <div>登 {{ formatDateTime(scope.row.createdAt) }}</div>
            <div v-if="scope.row.confirmedAt" class="sub-text">确 {{ formatDateTime(scope.row.confirmedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="复核人 / 结论" min-width="180" show-overflow-tooltip>
          <template #default="scope">
            <span v-if="scope.row.status === 'completed'">{{ scope.row.reviewer }}：{{ scope.row.conclusion }}</span>
            <span v-else class="sub-text">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="scope">
            <el-button v-if="scope.row.status === 'draft'" link type="primary" @click="openEdit(scope.row)">编辑草稿</el-button>
            <el-button v-if="scope.row.status === 'draft'" link type="warning" @click="confirm(scope.row)">确认返工</el-button>
            <el-button v-if="scope.row.status === 'pending'" link type="success" @click="openReview(scope.row)">填写复核</el-button>
            <el-button v-if="scope.row.status !== 'draft'" link type="primary" @click="openView(scope.row)">原值快照</el-button>
            <el-button
              v-if="scope.row.status !== 'completed'"
              link
              type="danger"
              @click="remove(scope.row)"
            >删除</el-button>
            <span v-if="scope.row.status === 'completed'" class="sub-text">已归档</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 登记 / 草稿编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '修改返工草稿' : '登记返工单'" width="620px">
      <el-alert
        v-if="guqinBlocked"
        type="error"
        :closable="false"
        show-icon
        title="该琴号存在待复核返工，且上弦评价已暂停；请先在返工台账完成复核。"
        class="form-alert"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-select v-model="form.guqinNo" filterable placeholder="选择琴号" style="width: 240px">
            <el-option v-for="no in guqinOptions" :key="no" :label="no" :value="no" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题工序" prop="stage">
          <el-radio-group v-model="form.stage">
            <el-radio v-for="stage in REWORK_STAGES" :key="stage" :value="stage">
              {{ REWORK_STAGE_LABELS[stage] }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="关联记录" prop="linkedId">
          <el-select v-if="form.stage === 'lacquer'" v-model="form.linkedId" placeholder="选择髹漆遍次" style="width: 320px">
            <el-option
              v-for="layer in linkedLayers"
              :key="layer.id"
              :label="`第 ${layer.seq} 遍 · ${formatDate(layer.appliedAt)} · ${layer.operator} · ${layer.mixRatio}`"
              :value="layer.id"
            />
          </el-select>
          <el-select v-else-if="linkedStringing" v-model="form.linkedId" style="width: 320px">
            <el-option
              :label="`上弦记录 · ${formatDate(linkedStringing.strungAt)} · ${linkedStringing.operator} · ${linkedStringing.stringType}`"
              :value="linkedStringing.id"
            />
          </el-select>
          <el-text v-else type="info" size="small">该琴号暂无上弦记录，请改选工序或琴号</el-text>
        </el-form-item>
        <el-form-item label="责任师傅" prop="master">
          <el-select v-model="form.master" filterable allow-create default-first-option placeholder="选择或输入师傅" style="width: 200px">
            <el-option v-for="master in REWORK_MASTERS" :key="master" :label="master" :value="master" />
          </el-select>
        </el-form-item>
        <el-form-item label="问题描述">
          <el-input v-model="form.issue" type="textarea" :rows="3" maxlength="120" show-word-limit placeholder="如：荫房温度偏低致灰胎发皱 / 四弦沙音" />
        </el-form-item>
      </el-form>
      <el-alert
        v-if="linkedConflict"
        type="warning"
        :closable="false"
        show-icon
        :title="`该记录已关联返工单 ${linkedConflict.orderNo}（${REWORK_STATUS_LABELS[linkedConflict.status]}），不能重复关联`"
        class="form-alert"
      />
      <el-alert
        type="info"
        :closable="false"
        title="先存草稿可继续修改；点「确认返工」后会在同一事务内抓取关联记录原值快照并进入待复核，写入失败不会留下半套档案。"
        class="form-alert"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitDraft">{{ editingId ? '保存草稿' : '存为草稿' }}</el-button>
      </template>
    </el-dialog>

    <!-- 复核 -->
    <el-dialog v-model="reviewVisible" title="返工复核" width="560px">
      <el-form ref="reviewRef" :model="reviewForm" :rules="reviewRules" label-width="90px">
        <el-form-item label="复核人" prop="reviewer">
          <el-select v-model="reviewForm.reviewer" filterable allow-create default-first-option placeholder="选择或输入复核人" style="width: 200px">
            <el-option v-for="master in REWORK_MASTERS" :key="master" :label="master" :value="master" />
          </el-select>
        </el-form-item>
        <el-form-item label="复核结论" prop="conclusion">
          <el-input v-model="reviewForm.conclusion" type="textarea" :rows="4" maxlength="200" show-word-limit placeholder="返工后的处置结论；填写后返工单即完成并锁定" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="success" @click="submitReview">完成复核</el-button>
      </template>
    </el-dialog>

    <!-- 查看原值快照 -->
    <el-dialog v-model="viewVisible" title="返工原值快照" width="760px">
      <div v-if="viewing" class="view-meta">
        <el-tag size="small">{{ viewing.orderNo }}</el-tag>
        <el-tag size="small" type="info">{{ viewing.guqinNo }} · {{ REWORK_STAGE_LABELS[viewing.stage] }} · {{ linkedText(viewing) }}</el-tag>
        <el-tag size="small" :type="statusTagType(viewing.status)">{{ REWORK_STATUS_LABELS[viewing.status] }}</el-tag>
        <span v-if="viewing.confirmedAt" class="sub-text">确认于 {{ formatDateTime(viewing.confirmedAt) }}</span>
      </div>
      <ReworkSnapshotView v-if="viewSnapshot" :snapshot="viewSnapshot" :current="viewCurrent" />
      <el-empty v-else description="草稿尚未确认，暂无原值快照" :image-size="80" />
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
  margin: 0 0 12px;
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
.sub-text {
  color: #a3968a;
  font-size: 12px;
}
.form-alert {
  margin-top: 8px;
}
.view-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
</style>

import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import {
  REWORK_STAGE_LABELS,
  type ReworkInput,
  type ReworkOrder,
  type ReworkReviewInput,
  type ReworkStage,
  type ReworkStatus,
  type ReworkSnapshot,
} from '../types/rework';

interface ReworkState {
  reworks: ReworkOrder[];
  hydrated: boolean;
}

/** 生成返工单号：FG-YYYYMM-流水（按当月已登记单数） */
function nextOrderNo(existing: ReworkOrder[], now = new Date()): string {
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `FG-${ym}-`;
  const seq = existing.reduce((max, order) => {
    if (order.orderNo.startsWith(prefix)) {
      const n = Number(order.orderNo.slice(prefix.length));
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }
    return max;
  }, 0) + 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

function normalizeInput(input: ReworkInput) {
  return {
    guqinNo: input.guqinNo.trim(),
    stage: input.stage,
    master: input.master.trim(),
    issue: input.issue.trim(),
    linkedId: input.linkedId.trim(),
  };
}

/** 返工处置单：草稿可改 → 确认后留原值快照并待复核 → 复核人填结论后完成 */
export const useReworkStore = defineStore('rework', {
  state: (): ReworkState => ({ reworks: [], hydrated: false }),

  getters: {
    ordersOf(state) {
      return (guqinNo: string): ReworkOrder[] =>
        state.reworks
          .filter((r) => r.guqinNo === guqinNo)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    /** 该琴是否存在待复核返工（上弦页据此拒收评价） */
    hasPending(state) {
      return (guqinNo: string): boolean => state.reworks.some((r) => r.guqinNo === guqinNo && r.status === 'pending');
    },
    /** 该琴待复核返工单数（进度表展示） */
    pendingCount(state) {
      return (guqinNo: string): number =>
        state.reworks.filter((r) => r.guqinNo === guqinNo && r.status === 'pending').length;
    },
    /** 该关联工序记录是否已挂在任何返工单上（草稿也算占用，避免重复登记） */
    linkedOrder(state) {
      return (linkedId: string): ReworkOrder | undefined => state.reworks.find((r) => r.linkedId === linkedId);
    },
    pendingOrders(state): ReworkOrder[] {
      return state.reworks
        .filter((r) => r.status === 'pending')
        .sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));
    },
    pendingTotal(state): number {
      return state.reworks.filter((r) => r.status === 'pending').length;
    },
    search(state) {
      return (keyword: string): ReworkOrder[] => {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return state.reworks;
        return state.reworks.filter((r) =>
          [r.orderNo, r.guqinNo, r.master, r.issue, r.linkedLabel, r.reviewer ?? '', r.conclusion ?? '']
            .join(' ')
            .toLowerCase()
            .includes(kw),
        );
      };
    },
  },

  actions: {
    async hydrate() {
      this.reworks = await db.reworks.orderBy('createdAt').reverse().toArray();
      this.hydrated = true;
    },

    /** 新增草稿；linkedId 已被其他返工单占用时拒绝，避免一张工序记录挂两套返工 */
    async saveDraft(input: ReworkInput): Promise<ReworkOrder> {
      const data = normalizeInput(input);
      if (!data.guqinNo) throw new Error('请选择琴号');
      if (!data.master) throw new Error('请选择责任师傅');
      if (!data.linkedId) throw new Error('请选择问题工序记录');
      if (this.reworks.some((r) => r.linkedId === data.linkedId)) {
        throw new Error('该工序记录已登记返工，不能重复关联');
      }
      const order: ReworkOrder = {
        id: uid('rework'),
        orderNo: nextOrderNo(this.reworks),
        guqinNo: data.guqinNo,
        stage: data.stage,
        master: data.master,
        issue: data.issue,
        status: 'draft',
        linkedId: data.linkedId,
        linkedLabel: '',
        createdAt: new Date().toISOString(),
      };
      await db.reworks.put(toPlain(order));
      this.reworks = [order, ...this.reworks];
      return order;
    },

    /** 修改草稿（仅草稿可改）；改关联记录时同样查重 */
    async updateDraft(id: string, patch: Partial<ReworkInput>): Promise<ReworkOrder> {
      const current = this.reworks.find((r) => r.id === id);
      if (!current) throw new Error('返工单不存在');
      if (current.status !== 'draft') throw new Error('只有草稿返工单可以修改');
      const data = normalizeInput({
        guqinNo: patch.guqinNo ?? current.guqinNo,
        stage: patch.stage ?? current.stage,
        master: patch.master ?? current.master,
        issue: patch.issue ?? current.issue,
        linkedId: patch.linkedId ?? current.linkedId,
      });
      if (!data.guqinNo) throw new Error('请选择琴号');
      if (!data.master) throw new Error('请选择责任师傅');
      if (!data.linkedId) throw new Error('请选择问题工序记录');
      if (this.reworks.some((r) => r.linkedId === data.linkedId && r.id !== id)) {
        throw new Error('该工序记录已登记返工，不能重复关联');
      }
      const next: ReworkOrder = {
        ...current,
        guqinNo: data.guqinNo,
        stage: data.stage,
        master: data.master,
        issue: data.issue,
        linkedId: data.linkedId,
        linkedLabel: '',
        snapshot: undefined,
      };
      await db.reworks.put(toPlain(next));
      this.reworks = this.reworks.map((r) => (r.id === id ? next : r));
      return next;
    },

    /**
     * 确认返工：在单个读写事务内读取对应工序记录并固化原值快照，然后写入待复核返工单。
     * 任一步失败（记录被删 / 关联重复 / 落库异常）事务整体回滚，不会留下半套档案。
     */
    async confirmOrder(id: string): Promise<ReworkOrder> {
      const draft = this.reworks.find((r) => r.id === id);
      if (!draft) throw new Error('返工单不存在');
      if (draft.status !== 'draft') throw new Error('只有草稿返工单可以确认');

      const confirmed = await db.transaction('rw', db.reworks, db.lacquers, db.stringings, async () => {
        const fresh = await db.reworks.get(id);
        if (!fresh) throw new Error('返工单已被删除');
        if (fresh.status !== 'draft') throw new Error('返工单已确认，请勿重复操作');
        const occupied = await db.reworks.where('linkedId').equals(fresh.linkedId).first();
        if (occupied && occupied.id !== id) throw new Error('该工序记录已关联其他返工单');

        let snapshot: ReworkSnapshot;
        let linkedLabel: string;
        if (fresh.stage === 'lacquer') {
          const layer = await db.lacquers.get(fresh.linkedId);
          if (!layer) throw new Error('关联的髹漆遍次记录不存在，无法留原值快照');
          linkedLabel = `髹漆第 ${layer.seq} 遍`;
          snapshot = { stage: 'lacquer', layer: toPlain(layer) as LacquerLayer };
        } else {
          const stringing = await db.stringings.get(fresh.linkedId);
          if (!stringing) throw new Error('关联的上弦记录不存在，无法留原值快照');
          linkedLabel = '上弦记录';
          snapshot = { stage: 'string', stringing: toPlain(stringing) as Stringing };
        }

        const next: ReworkOrder = {
          ...fresh,
          linkedLabel,
          snapshot,
          status: 'pending' as ReworkStatus,
          confirmedAt: new Date().toISOString(),
        };
        await db.reworks.put(toPlain(next));
        return next;
      });

      this.reworks = this.reworks.map((r) => (r.id === id ? confirmed : r));
      return confirmed;
    },

    /** 复核人填写结论后返工单才算完成 */
    async completeReview(id: string, input: ReworkReviewInput): Promise<ReworkOrder> {
      const reviewer = input.reviewer.trim();
      const conclusion = input.conclusion.trim();
      if (!reviewer) throw new Error('请填写复核人');
      if (!conclusion) throw new Error('请填写复核结论');
      const current = this.reworks.find((r) => r.id === id);
      if (!current) throw new Error('返工单不存在');
      if (current.status !== 'pending') throw new Error('只有待复核返工单可以填写结论');
      const next: ReworkOrder = {
        ...current,
        status: 'completed',
        reviewer,
        conclusion,
        reviewedAt: new Date().toISOString(),
      };
      await db.reworks.put(toPlain(next));
      this.reworks = this.reworks.map((r) => (r.id === id ? next : r));
      return next;
    },

    /** 已完成返工单归档保留不可删；草稿 / 待复核可删 */
    async removeOrder(id: string): Promise<void> {
      const current = this.reworks.find((r) => r.id === id);
      if (!current) return;
      if (current.status === 'completed') throw new Error('已完成的返工单需归档保留，不能删除');
      await db.reworks.delete(id);
      this.reworks = this.reworks.filter((r) => r.id !== id);
    },

    /** 上弦登记前的硬校验：存在待复核返工时不接受评价 */
    assertStringingAllowed(guqinNo: string): void {
      if (this.hasPending(guqinNo.trim())) {
        throw new Error(`琴号 ${guqinNo} 存在待复核返工，复核完成前不接受上弦评价`);
      }
    },

    stageLabel(stage: ReworkStage): string {
      return REWORK_STAGE_LABELS[stage];
    },
  },
});

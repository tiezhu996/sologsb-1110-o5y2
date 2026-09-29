import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { describeRef } from '../utils/rework';
import type {
  ReworkOrder,
  ReworkRefType,
  ReworkSnapshot,
  ReworkStage,
  ReworkStatus,
} from '../types/rework';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { SoundChamber } from '../types/sound-chamber';
import type { Stringing } from '../types/stringing';
import type { WoodBoard } from '../types/wood-board';

export interface ReworkInput {
  guqinNo: string;
  stage: ReworkStage;
  responsible: string;
  reason: string;
  registrar: string;
  /** 关联的髹漆 / 上弦记录 id；该琴两类记录都不存在时允许为空 */
  refId?: string;
  registeredAt?: string;
}

export interface ReworkPatch {
  responsible?: string;
  reason?: string;
  /** 草稿可改关联：refId 为空表示解除关联 */
  refId?: string | null;
}

export interface ReviewInput {
  reviewer: string;
  conclusion: string;
}

interface ReworkState {
  reworks: ReworkOrder[];
  hydrated: boolean;
}

/** 返工处置单：登记留原值快照 + 关联髹漆/上弦，复核填结论后完成 */
export const useReworkStore = defineStore('rework', {
  state: (): ReworkState => ({ reworks: [], hydrated: false }),

  getters: {
    /** 该琴全部待复核返工单 */
    pendingOf(state) {
      return (guqinNo: string): ReworkOrder[] =>
        state.reworks.filter((r) => r.guqinNo === guqinNo && r.status === 'pending');
    },
    /** 该琴是否存在待复核返工（上弦页据此拒收评价） */
    hasPending(state) {
      return (guqinNo: string): boolean =>
        state.reworks.some((r) => r.guqinNo === guqinNo && r.status === 'pending');
    },
    pendingCount(state): number {
      return state.reworks.filter((r) => r.status === 'pending').length;
    },
    /** 指向某条髹漆 / 上弦记录的待复核返工 */
    pendingByRef(state) {
      return (refType: ReworkRefType, refId: string): ReworkOrder | undefined =>
        state.reworks.find((r) => r.status === 'pending' && r.ref?.refType === refType && r.ref.refId === refId);
    },
  },

  actions: {
    async hydrate() {
      this.reworks = await db.reworks.orderBy('registeredAt').reverse().toArray();
      this.hydrated = true;
    },

    /**
     * 登记返工处置单：读取对应工序原值快照、解析髹漆/上弦关联、写入返工单，
     * 全部放在同一个 Dexie 读写事务内，任一环节失败则整体回滚，绝不留下半套档案。
     */
    async registerOrder(input: ReworkInput): Promise<ReworkOrder> {
      const guqinNo = input.guqinNo.trim();
      const responsible = input.responsible.trim();
      const reason = input.reason.trim();
      const registrar = input.registrar.trim() || '档案员';
      const refId = input.refId?.trim() || undefined;
      if (!guqinNo) throw new Error('请选择琴号');
      if (!responsible) throw new Error('请填写责任师傅');
      if (!reason) throw new Error('请填写问题描述');

      let created: ReworkOrder;

      await db.transaction(
        'rw',
        db.boards,
        db.chambers,
        db.lacquers,
        db.stringings,
        db.reworks,
        async () => {
          // 1. 对应工序留下原值快照（只读，不改动原档案）
          const snapshot = await this.buildSnapshot(guqinNo, input.stage, refId);

          // 2. 解析髹漆 / 上弦关联
          let ref: ReworkOrder['ref'] = null;
          if (refId) {
            ref = await this.resolveRef(refId, snapshot);
          }

          // 3. 生成单号并写入返工单（与上两步同一事务，失败一起回滚）
          const year = new Date(input.registeredAt ?? Date.now()).getFullYear();
          const yearlyCount = await db.reworks.filter((r) => r.orderNo.startsWith(`RW-${year}-`)).count();
          created = {
            id: uid('rework'),
            orderNo: `RW-${year}-${String(yearlyCount + 1).padStart(3, '0')}`,
            guqinNo,
            stage: input.stage,
            responsible,
            reason,
            snapshot,
            ref,
            status: 'pending',
            registeredAt: input.registeredAt ?? new Date().toISOString(),
            registrar,
          };
          await db.reworks.put(toPlain(created));
        },
      );

      this.reworks = [created!, ...this.reworks];
      return created!;
    },

    /** 事务内：按工序读取原值，原档案不存在直接抛错中止登记 */
    async buildSnapshot(guqinNo: string, stage: ReworkStage, refId?: string): Promise<ReworkSnapshot> {
      const takenAt = new Date().toISOString();
      if (stage === 'select') {
        const boards = await db.boards.where('guqinNo').equals(guqinNo).toArray();
        const panel = boards.find((b) => b.part === '面板') ?? null;
        const base = boards.find((b) => b.part === '底板') ?? null;
        if (!panel || !base) throw new Error(`${guqinNo} 面板/底板尚未配对，选材工序无原值可留存`);
        return { stage, takenAt, panel: panel as WoodBoard, base: base as WoodBoard, record: null };
      }
      if (stage === 'carve') {
        const chamber = await db.chambers.where('guqinNo').equals(guqinNo).first();
        if (!chamber) throw new Error(`${guqinNo} 尚无槽腹记录，掏膛工序无原值可留存`);
        return { stage, takenAt, record: chamber as SoundChamber };
      }
      if (stage === 'lacquer') {
        if (!refId) throw new Error('灰胎返工需指定问题遍次');
        const layer = await db.lacquers.get(refId);
        if (!layer || layer.guqinNo !== guqinNo) throw new Error('所选髹漆遍次不存在或不属于该琴');
        return { stage, takenAt, record: layer as LacquerLayer };
      }
      // string
      const stringing = refId ? await db.stringings.get(refId) : await db.stringings.where('guqinNo').equals(guqinNo).first();
      if (!stringing || stringing.guqinNo !== guqinNo) throw new Error(`${guqinNo} 尚无上弦记录，上弦工序无原值可留存`);
      return { stage, takenAt, record: stringing as Stringing };
    },

    /** 事务内：把关联 id 解析为髹漆 / 上弦记录并固化简述 */
    async resolveRef(refId: string, snapshot: ReworkSnapshot): Promise<NonNullable<ReworkOrder['ref']>> {
      const layer = await db.lacquers.get(refId);
      if (layer) {
        if (snapshot.stage === 'lacquer' && snapshot.record && (snapshot.record as LacquerLayer).id !== layer.id) {
          throw new Error('灰胎返工只能关联所选问题遍次');
        }
        return { refType: 'lacquer', refId, refLabel: describeRef('lacquer', layer as LacquerLayer) };
      }
      const stringing = await db.stringings.get(refId);
      if (stringing) {
        // 上弦工序返工，关联必须就是其快照记录
        if (snapshot.stage === 'string' && snapshot.record && (snapshot.record as Stringing).id !== stringing.id) {
          throw new Error('上弦返工只能关联本琴的上弦记录');
        }
        return { refType: 'stringing', refId, refLabel: describeRef('stringing', stringing as Stringing) };
      }
      throw new Error('所选关联记录不存在');
    },

    /** 草稿（待复核）可修改责任师傅、问题描述与关联；原值快照登记后不可改 */
    async updateDraft(id: string, patch: ReworkPatch) {
      const current = this.reworks.find((r) => r.id === id);
      if (!current) return;
      if (current.status !== 'pending') throw new Error('返工单已复核完成，不能再修改');

      let ref: ReworkOrder['ref'] = current.ref ?? null;
      await db.transaction('rw', db.lacquers, db.stringings, db.reworks, async () => {
        if (patch.refId !== undefined) {
          ref = patch.refId ? await this.resolveRef(patch.refId, current.snapshot) : null;
        }
        const next: ReworkOrder = {
          ...current,
          responsible: patch.responsible?.trim() || current.responsible,
          reason: patch.reason?.trim() || current.reason,
          ref,
        };
        await db.reworks.put(toPlain(next));
        this.reworks = this.reworks.map((r) => (r.id === id ? next : r));
      });
    },

    /** 复核人填写结论，返工单才算完成；之后锁定 */
    async completeReview(id: string, review: ReviewInput) {
      const current = this.reworks.find((r) => r.id === id);
      if (!current) return;
      if (current.status === 'done') throw new Error('返工单已复核完成');
      const reviewer = review.reviewer.trim();
      const conclusion = review.conclusion.trim();
      if (!reviewer) throw new Error('请填写复核人');
      if (!conclusion) throw new Error('请填写复核结论');

      const next: ReworkOrder = {
        ...current,
        status: 'done' as ReworkStatus,
        reviewer,
        conclusion,
        reviewedAt: new Date().toISOString(),
      };
      await db.reworks.put(toPlain(next));
      this.reworks = this.reworks.map((r) => (r.id === id ? next : r));
    },

    async remove(id: string) {
      const current = this.reworks.find((r) => r.id === id);
      if (!current) return;
      if (current.status !== 'pending') throw new Error('已复核完成的返工单不能删除');
      await db.reworks.delete(id);
      this.reworks = this.reworks.filter((r) => r.id !== id);
    },
  },
});

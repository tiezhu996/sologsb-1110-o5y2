/** 返工问题工序（目前返工来源仅髹漆 / 上弦两页） */
export type ReworkStage = 'lacquer' | 'string';

/** 返工单状态：草稿可改 → 待复核（已留原值快照）→ 已完成（复核人填结论） */
export type ReworkStatus = 'draft' | 'pending' | 'completed';

export const REWORK_STAGES: ReworkStage[] = ['lacquer', 'string'];

export const REWORK_STAGE_LABELS: Record<ReworkStage, string> = {
  lacquer: '髹漆',
  string: '上弦',
};

export const REWORK_STATUS_LABELS: Record<ReworkStatus, string> = {
  draft: '草稿',
  pending: '待复核',
  completed: '已完成',
};

/** 责任师傅候选（登记时可自行补充） */
export const REWORK_MASTERS = ['周砚秋', '林听雪'];

/**
 * 确认返工时留下的原值快照。
 * 快照为当时整份工序记录的纯数据副本，之后髹漆 / 上弦记录再被编辑也不影响返工原值。
 * stage 与快照内容对应：lacquer → LacquerLayer，string → Stringing。
 */
export type ReworkSnapshot =
  | { stage: 'lacquer'; layer: import('./lacquer-layer').LacquerLayer }
  | { stage: 'string'; stringing: import('./stringing').Stringing };

/** 返工处置单 */
export interface ReworkOrder {
  id: string;
  /** 返工单号（按年月流水） */
  orderNo: string;
  /** 琴号 */
  guqinNo: string;
  /** 问题工序 */
  stage: ReworkStage;
  /** 责任师傅 */
  master: string;
  /** 问题描述 */
  issue: string;
  /** 草稿 / 待复核 / 已完成 */
  status: ReworkStatus;
  /**
   * 关联的髹漆遍次或上弦记录 id（'lacquer' → lacquers.id；'string' → stringings.id）。
   * 关联只登记在返工单上，不回写原表，保证恢复旧备份后原数据照常打开。
   */
  linkedId: string;
  /** 关联记录的可读标签（确认时固化，如「第 3 遍」/「上弦记录」） */
  linkedLabel: string;
  /** 确认时留下的原值快照；草稿阶段尚未留快照 */
  snapshot?: ReworkSnapshot;
  /** 登记时间 ISO */
  createdAt: string;
  /** 确认时间 ISO（草稿 → 待复核） */
  confirmedAt?: string;
  /** 复核人（已完成时必填） */
  reviewer?: string;
  /** 复核结论（已完成时必填） */
  conclusion?: string;
  /** 完成复核时间 ISO */
  reviewedAt?: string;
}

/** 登记 / 修改草稿时的表单输入 */
export interface ReworkInput {
  guqinNo: string;
  stage: ReworkStage;
  master: string;
  issue: string;
  linkedId: string;
}

/** 复核结论输入 */
export interface ReworkReviewInput {
  reviewer: string;
  conclusion: string;
}

import type { WoodBoard } from './wood-board';
import type { SoundChamber } from './sound-chamber';
import type { LacquerLayer } from './lacquer-layer';
import type { Stringing } from './stringing';

/** 返工涉及的问题工序（与进度四阶段对应） */
export type ReworkStage = 'select' | 'carve' | 'lacquer' | 'string';

/** 返工单状态：登记后即待复核；复核人填写结论后才完成 */
export type ReworkStatus = 'pending' | 'done';

/** 可关联的工序记录类型：髹漆遍次或上弦记录 */
export type ReworkRefType = 'lacquer' | 'stringing';

/** 某道工序的单条原值档案 */
export type StageRecord = WoodBoard | SoundChamber | LacquerLayer | Stringing;

/**
 * 返工登记时对应工序留下的原值快照。
 * 快照只做留存与回看，绝不回写或改动原工序档案；选材工序留存面板/底板配对，
 * 掏膛留存槽腹记录，灰胎留存问题遍次，上弦留存上弦与评语。
 */
export interface ReworkSnapshot {
  stage: ReworkStage;
  /** 快照留存时间 ISO */
  takenAt: string;
  /** 单道工序档案：掏膛 / 问题髹漆遍次 / 上弦 */
  record?: StageRecord | null;
  /** 选材：面板原值（可能缺料为 null） */
  panel?: WoodBoard | null;
  /** 选材：底板原值（可能缺料为 null） */
  base?: WoodBoard | null;
}

/** 与髹漆遍次 / 上弦记录的关联（冗余 label，原记录删除后仍可回看） */
export interface ReworkRef {
  refType: ReworkRefType;
  refId: string;
  /** 关联时固化的简述，如「髹漆第 3 遍 · 2026-09-01」 */
  refLabel: string;
}

/** 返工处置单 */
export interface ReworkOrder {
  id: string;
  /** 返工单号，如 RW-2026-001 */
  orderNo: string;
  /** 琴号 */
  guqinNo: string;
  /** 问题工序 */
  stage: ReworkStage;
  /** 责任师傅 */
  responsible: string;
  /** 问题描述 */
  reason: string;
  /** 对应工序原值快照 */
  snapshot: ReworkSnapshot;
  /** 关联的髹漆或上弦记录；该琴两类记录都不存在时允许为空 */
  ref?: ReworkRef | null;
  /** 待复核 / 已完成 */
  status: ReworkStatus;
  /** 登记时间 ISO */
  registeredAt: string;
  /** 登记人 */
  registrar: string;
  /** 复核时间 ISO（复核后才有） */
  reviewedAt?: string;
  /** 复核人 */
  reviewer?: string;
  /** 复核结论：填写后返工单才算完成 */
  conclusion?: string;
}

export const REWORK_STAGES: ReworkStage[] = ['select', 'carve', 'lacquer', 'string'];

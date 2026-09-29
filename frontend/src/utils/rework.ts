import type { LacquerLayer } from '../types/lacquer-layer';
import type { SoundChamber } from '../types/sound-chamber';
import type { Stringing } from '../types/stringing';
import type { WoodBoard } from '../types/wood-board';
import { formatDate } from './layer';
import type { ReworkRefType, ReworkSnapshot, ReworkStage, StageRecord } from '../types/rework';

/** 返工工序标签（与进度表四阶段一致） */
export const REWORK_STAGE_LABELS: Record<ReworkStage, string> = {
  select: '选材',
  carve: '掏膛',
  lacquer: '灰胎',
  string: '上弦',
};

/** 责任师傅候选（来自种子数据中出现的师傅，仍可手填） */
export const MASTER_OPTIONS: string[] = ['周砚秋', '林听雪'];

/** 复核人候选 */
export const REVIEWER_OPTIONS: string[] = ['周砚秋', '林听雪'];

/** 生成髹漆 / 上弦关联的固化简述 */
export function describeRef(refType: ReworkRefType, record: StageRecord): string {
  if (refType === 'lacquer') {
    const layer = record as LacquerLayer;
    return `髹漆第 ${layer.seq} 遍 · ${formatDate(layer.appliedAt)}`;
  }
  const stringing = record as Stringing;
  return `上弦 · ${formatDate(stringing.strungAt)}`;
}

function boardLine(label: string, board?: WoodBoard | null): string {
  if (!board) return `${label}：缺失`;
  return `${label}：${board.boardNo} ${board.species}，厚 ${board.thicknessMm}mm，阴干 ${board.dryYears} 年，${board.grain}，缺陷 ${board.defect}`;
}

function chamberLine(chamber?: SoundChamber | null): string[] {
  if (!chamber) return ['槽腹记录缺失'];
  return [
    `纳音 ${chamber.nayinThickness}mm / 龙池 ${chamber.longchiThickness}mm / 凤沼 ${chamber.fengzhaoThickness}mm`,
    `槽腹深 ${chamber.chamberDepth}mm，天地柱 ${chamber.postPos}，龙池凤沼 ${chamber.poolSize}`,
    `掏膛日期 ${formatDate(chamber.carvedAt)}，掏膛人 ${chamber.carver}`,
  ];
}

function layerLine(layer?: LacquerLayer | null): string[] {
  if (!layer) return ['髹漆遍次记录缺失'];
  return [
    `第 ${layer.seq} 遍，配比 ${layer.mixRatio}，本遍 ${layer.layerThickness}mm，累计 ${layer.totalThickness}mm`,
    `荫房 ${layer.curingTemp}℃ / ${layer.curingHumidity}%，打磨 ${layer.polishGrit} 目`,
    `施工日期 ${formatDate(layer.appliedAt)}，髹漆人 ${layer.operator}`,
  ];
}

function stringingLine(stringing?: Stringing | null): string[] {
  if (!stringing) return ['上弦记录缺失'];
  return [
    `${stringing.stringType}，${stringing.nut}，弦距 ${stringing.stringGap}mm，缺陷 ${stringing.defects.join('/')}`,
    `散音：${stringing.sanNote}`,
    `按音：${stringing.anNote}`,
    `泛音：${stringing.fanNote}`,
    `九德：${stringing.nineVirtues}`,
    `上弦日期 ${formatDate(stringing.strungAt)}，上弦人 ${stringing.operator}`,
  ];
}

/** 把原值快照转成只读回显行（返工单详情 / 登记确认预览使用） */
export function snapshotLines(snapshot: ReworkSnapshot): string[] {
  switch (snapshot.stage) {
    case 'select':
      return [boardLine('面板', snapshot.panel), boardLine('底板', snapshot.base)];
    case 'carve':
      return chamberLine(snapshot.record as SoundChamber | null | undefined);
    case 'lacquer':
      return layerLine(snapshot.record as LacquerLayer | null | undefined);
    case 'string':
      return stringingLine(snapshot.record as Stringing | null | undefined);
    default:
      return [];
  }
}

import { db, SCHEMA_VERSION } from './db';
import type { ReworkOrder } from '../types/rework';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
  /** v3 新增；旧备份没有此字段，恢复时按「未返工」处理且不覆盖现有返工关联 */
  reworks?: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings, reworks] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
    db.reworks.toArray(),
  ]);
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    boards,
    chambers,
    lacquers,
    stringings,
    reworks,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（工序档案打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

export interface ImportCounts {
  boards: number;
  chambers: number;
  lacquers: number;
  stringings: number;
  /** 导入的返工单数；旧备份无返工表时为 0，且现有返工单原样保留 */
  reworks: number;
  /** 旧备份（无返工表）时为 true：原数据照常恢复，返工关联保持现状 */
  legacy: boolean;
}

/**
 * 恢复 JSON 备份。
 * 旧备份（v1/v2，无 reworks 字段）：原四表照常打开，按未返工处理，
 * 不清空也不覆盖已有的返工关联；新备份则连返工单一并整体恢复。
 */
export async function importBackup(text: string): Promise<ImportCounts> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }
  const legacy = !Array.isArray(payload.reworks);
  const counts: ImportCounts = {
    boards: payload.boards?.length ?? 0,
    chambers: payload.chambers?.length ?? 0,
    lacquers: payload.lacquers?.length ?? 0,
    stringings: payload.stringings?.length ?? 0,
    reworks: legacy ? 0 : (payload.reworks?.length ?? 0),
    legacy,
  };

  const tables = legacy
    ? [db.boards, db.chambers, db.lacquers, db.stringings]
    : [db.boards, db.chambers, db.lacquers, db.stringings, db.reworks];

  await db.transaction('rw', tables, async () => {
    await Promise.all([db.boards.clear(), db.chambers.clear(), db.lacquers.clear(), db.stringings.clear()]);
    if (payload.boards?.length) await db.boards.bulkPut(payload.boards as never[]);
    if (payload.chambers?.length) await db.chambers.bulkPut(payload.chambers as never[]);
    if (payload.lacquers?.length) await db.lacquers.bulkPut(payload.lacquers as never[]);
    if (payload.stringings?.length) await db.stringings.bulkPut(payload.stringings as never[]);
    // 仅当备份本身含返工表时才整表替换；旧备份不动 reworks，已有返工关联不被覆盖
    if (!legacy) {
      await db.reworks.clear();
      if (payload.reworks?.length) await db.reworks.bulkPut(payload.reworks as ReworkOrder[]);
    }
  });
  return counts;
}

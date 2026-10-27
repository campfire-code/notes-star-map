// 扫描笔记文件夹的流程：列文件 → 读文本 → 生成星图。读文件的函数由外部传入，便于用假文件系统测试。
import { buildGraph, type NoteInput } from './graph';
import { SUPPORTED_EXT } from './parse';
import type { Graph, ParsedNote } from './types';

export interface ScanIo {
  /** 列出文件夹里（含子文件夹）的笔记文件的完整路径 */
  list(folder: string, extensions: string[]): Promise<{ path: string; size?: number }[]>;
  readText(path: string): Promise<string>;
}

export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ScanResult {
  graph: Graph;
  notes: ParsedNote[];
  skipped: { path: string; reason: string }[];
}

const norm = (p: string) => p.replace(/\\/g, '/');

export function relativeTo(folder: string, path: string): string {
  const f = norm(folder).replace(/\/+$/, '');
  const p = norm(path);
  return p.startsWith(f + '/') ? p.slice(f.length + 1) : p.split('/').pop() ?? p;
}

export async function scanFolder(io: ScanIo, folder: string, onProgress?: (done: number, total: number) => void): Promise<ScanResult> {
  const files = await io.list(folder, SUPPORTED_EXT);
  if (!files.length) throw new Error('这个文件夹里没有 .md 或 .txt 笔记（只看 3 层以内的子文件夹）');
  const skipped: ScanResult['skipped'] = [];
  const picked = files.slice(0, MAX_FILES);
  if (files.length > MAX_FILES) skipped.push({ path: '', reason: `文件太多，只读取前 ${MAX_FILES} 个` });
  const inputs: NoteInput[] = [];
  let done = 0;
  for (const f of picked) {
    const rel = relativeTo(folder, f.path);
    try {
      if (f.size != null && f.size > MAX_FILE_BYTES) throw new Error('文件超过 2 MB');
      const text = await io.readText(f.path);
      inputs.push({ path: rel, text, abs: f.path });
    } catch (e) {
      skipped.push({ path: rel, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(++done, picked.length);
  }
  if (!inputs.length) throw new Error('笔记都没能读取，请检查文件夹权限');
  const { graph, notes } = buildGraph(inputs);
  return { graph, notes, skipped };
}

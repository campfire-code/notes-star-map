// 扫描文件夹的流程：用内存文件系统模拟
import { describe, expect, it } from 'vitest';
import { relativeTo, scanFolder, type ScanIo } from './flow';

function fakeIo(files: Record<string, string | Error>, sizes: Record<string, number> = {}): ScanIo {
  return {
    list: async () => Object.keys(files).map((path) => ({ path, size: sizes[path] })),
    readText: async (p) => {
      const f = files[p];
      if (f instanceof Error) throw f;
      return f;
    },
  };
}

describe('scanFolder', () => {
  it('相对路径、分组与出处的完整路径', async () => {
    const io = fakeIo({ '/笔记/菜单/a.md': '# A\n## 点\n正文 [[b]]', '/笔记/b.md': '# B\n正文' });
    const r = await scanFolder(io, '/笔记');
    expect(r.notes.map((n) => n.path).sort()).toEqual(['b.md', '菜单/a.md']);
    const p = r.graph.nodes.find((n) => n.label === '点')!;
    expect(p.group).toBe('菜单');
    expect(p.sources[0].abs).toBe('/笔记/菜单/a.md');
    expect(r.graph.stats.byType.wikilink).toBe(1);
  });
  it('Windows 路径', async () => {
    expect(relativeTo('C:\\笔记', 'C:\\笔记\\菜单\\a.md')).toBe('菜单/a.md');
  });
  it('读不了的文件、过大的文件跳过并说明原因，其余照常', async () => {
    const io = fakeIo({ '/n/ok.md': '# ok\n正文', '/n/bad.md': new Error('没有权限'), '/n/big.md': 'x' }, { '/n/big.md': 3 * 1024 * 1024 });
    const r = await scanFolder(io, '/n');
    expect(r.notes).toHaveLength(1);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['文件超过 2 MB', '没有权限']);
  });
  it('没有笔记、全部读取失败时给出中文提示', async () => {
    await expect(scanFolder(fakeIo({}), '/n')).rejects.toThrow('没有 .md 或 .txt');
    await expect(scanFolder(fakeIo({ '/n/a.md': new Error('x') }), '/n')).rejects.toThrow('没能读取');
  });
  it('回调进度', async () => {
    const seen: number[] = [];
    await scanFolder(fakeIo({ '/n/a.md': '# a', '/n/b.md': '# b' }), '/n', (d) => seen.push(d));
    expect(seen).toEqual([1, 2]);
  });
});

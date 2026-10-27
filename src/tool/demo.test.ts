// 示例数据：samples/ 与 demo.ts 一致，且星图结果与 README「验收用例」一致。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEMO_NOTES } from './demo';
import { buildGraph } from './graph';

const DIR = 'samples/咖啡店经营示例/';

describe('示例笔记', () => {
  it.runIf(process.env.MAKE_SAMPLES === '1')('生成 samples/ 里的示例文件', () => {
    for (const n of DEMO_NOTES) {
      mkdirSync(dirname(DIR + n.path), { recursive: true });
      writeFileSync(DIR + n.path, n.text);
    }
  });
  it('samples/ 里的文件与 demo.ts 一致', () => {
    for (const n of DEMO_NOTES) {
      expect(existsSync(DIR + n.path), n.path).toBe(true);
      expect(readFileSync(DIR + n.path, 'utf8')).toBe(n.text);
    }
  });
  it('每篇都标明「示例」且内容为虚构', () => {
    for (const n of DEMO_NOTES) expect(n.text).toContain('示例笔记');
  });
  it('验收用例的数字', () => {
    const { graph } = buildGraph(DEMO_NOTES);
    expect(graph.stats.files).toBe(10);
    expect(graph.nodes.filter((n) => n.kind === 'theme')).toHaveLength(10);
    expect(graph.stats.byType.wikilink).toBeGreaterThanOrEqual(10);
    expect(graph.stats.byType.keyword).toBeGreaterThan(0);
    expect(graph.stats.unresolved).toBe(0);
    console.log(JSON.stringify(graph.stats));
  });
});

describe('从真实文件夹扫描 samples/', () => {
  it('结果与内置示例一致', async () => {
    const { readdirSync, readFileSync: rf, statSync } = await import('node:fs');
    const { scanFolder } = await import('./flow');
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(d + '/' + f).isDirectory() ? walk(d + '/' + f) : [d + '/' + f]));
    const root = process.cwd() + '/samples/咖啡店经营示例';
    const r = await scanFolder({ list: async () => walk(root).map((path) => ({ path })), readText: async (p) => rf(p, 'utf8') }, root);
    const demo = buildGraph(DEMO_NOTES).graph;
    expect(r.graph.stats).toEqual(demo.stats);
    expect([...new Set(r.graph.nodes.map((n) => n.group))].sort()).toEqual(['日记', '根目录', '标签', '菜单', '运营', '选址', '采购'].sort());
  });
});

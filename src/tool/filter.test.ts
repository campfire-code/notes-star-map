import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { allFilters, computeVisibility, queryTokens } from './filter';
import { fallbackTokenizer } from './parse';

const { graph } = buildGraph([
  { path: '菜单/定价.md', text: '# 定价\n#菜单\n## 毛利\n毛利率 咖啡豆 成本' },
  { path: '采购/进货.md', text: '# 进货\n## 供应商\n咖啡豆 成本 价格 [[定价]]' },
], { tokenizer: fallbackTokenizer });

describe('筛选与搜索', () => {
  it('默认全部可见，没有搜索词时 matches 为 null', () => {
    const v = computeVisibility(graph, allFilters());
    expect(v.nodes.size).toBe(graph.nodes.length);
    expect(v.links.size).toBe(graph.links.length);
    expect(v.matches).toBeNull();
  });
  it('按节点类型筛选：去掉标签后相关连线也消失', () => {
    const f = allFilters();
    f.kinds.delete('tag');
    const v = computeVisibility(graph, f);
    expect(graph.nodes.filter((n) => v.nodes.has(n.id)).every((n) => n.kind !== 'tag')).toBe(true);
    expect([...v.links].every((i) => graph.links[i].type !== 'tag')).toBe(true);
  });
  it('按连接类型筛选', () => {
    const f = allFilters();
    f.linkTypes = new Set(['wikilink']);
    const v = computeVisibility(graph, f);
    expect([...v.links].every((i) => graph.links[i].type === 'wikilink')).toBe(true);
    expect(v.links.size).toBe(graph.stats.byType.wikilink);
  });
  it('按文件夹筛选：标签不受影响', () => {
    const f = allFilters();
    f.groups = new Set(['采购']);
    const v = computeVisibility(graph, f);
    const shown = graph.nodes.filter((n) => v.nodes.has(n.id));
    expect(shown.filter((n) => n.kind !== 'tag').every((n) => n.group === '采购')).toBe(true);
    expect(shown.some((n) => n.kind === 'tag')).toBe(true);
  });
  it('搜索：多个词都要命中，不区分大小写，可搜正文与标签', () => {
    const f = allFilters();
    f.query = '  咖啡豆   成本 ';
    const hit = computeVisibility(graph, f).matches!;
    expect(hit.size).toBeGreaterThanOrEqual(2);
    f.query = '#菜单';
    const tag = computeVisibility(graph, f).matches!;
    expect([...tag].some((id) => id.startsWith('t:'))).toBe(true);
    f.query = '不存在的词';
    expect(computeVisibility(graph, f).matches!.size).toBe(0);
  });
  it('queryTokens 去空白', () => {
    expect(queryTokens('  A  b ')).toEqual(['a', 'b']);
  });
});

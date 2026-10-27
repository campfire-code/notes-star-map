import { describe, expect, it } from 'vitest';
import { buildGraph, dedupeLinks, hierarchyLinks, keywordLinks, noteId, sectionId, tagLinks, wikiLinks } from './graph';
import { fallbackTokenizer, parseNote } from './parse';

const P = (path: string, text: string) => parseNote(path, text);
const all = () => true;

describe('规则：标题层级', () => {
  const n = P('a.md', '# A\n## 一\n正文\n### 一点一\n正文\n## 二\n正文');
  it('笔记 → 一级 → 下级', () => {
    const l = hierarchyLinks([n], all);
    expect(l.map((x) => [x.source, x.target])).toEqual([[noteId(n), sectionId(n, n.sections[0])], [sectionId(n, n.sections[0]), sectionId(n, n.sections[1])], [noteId(n), sectionId(n, n.sections[2])]]);
    expect(l.every((x) => x.type === 'hierarchy')).toBe(true);
  });
});

describe('规则：[[双链]]', () => {
  const a = P('文件夹/甲.md', '# 甲\n开头 [[乙]]\n## 小节\n见 [[丙#目标]] 和 [[不存在]]');
  const b = P('乙.md', '# 乙\n正文');
  const c = P('丙.md', '# 丙\n## 目标\n正文\n## 其他\n正文');
  it('指向被链接的笔记；带 #标题 指向知识点；找不到的计入 unresolved', () => {
    const { links, unresolved } = wikiLinks([a, b, c], all);
    expect(unresolved).toBe(1);
    expect(links.map((x) => [x.source, x.target])).toEqual([[noteId(a), noteId(b)], [sectionId(a, a.sections[0]), sectionId(c, c.sections[0])]]);
  });
  it('链接自己不算', () => {
    expect(wikiLinks([P('x.md', '# x\n[[x]]')], all).links).toEqual([]);
  });
  it('大小写、别名、带路径的写法都能匹配', () => {
    const r = wikiLinks([P('s.md', '# s\n[[文件夹/甲.md|看这个]] [[YI]]'), a, P('yi.md', '# yi\n')], all);
    expect(r.links.map((x) => x.target)).toEqual([noteId(a), 'n:yi.md']);
  });
});

describe('规则：标签', () => {
  it('标签连到笔记与知识点；层级标签连上级标签；同一标签重复使用不重复连线', () => {
    const n = P('t.md', '---\ntags: [项目/咖啡]\n---\n# t\n## 节\n#咖啡 正文');
    const { tags, links } = tagLinks([n], all);
    expect([...tags.keys()].sort()).toEqual(['t:咖啡', 't:项目', 't:项目/咖啡']);
    expect(links.map((l) => `${l.source}>${l.target}`).sort()).toEqual(['t:咖啡>s:t.md#0', 't:项目/咖啡>n:t.md', 't:项目>t:项目/咖啡'].sort());
  });
});

describe('规则：共同关键词', () => {
  const kw = new Map([['a', ['咖啡', '成本', '损耗']], ['b', ['成本', '损耗', '定价']], ['c', ['定价']], ['d', ['成本', '损耗']]]);
  const idf = new Map([['咖啡', 2], ['成本', 1], ['损耗', 1.5], ['定价', 1]]);
  const note = new Map([['a', '1'], ['b', '2'], ['c', '3'], ['d', '2']]);
  it('至少共有两个关键词才连，同一篇笔记内不连，强度为 idf 之和', () => {
    const l = keywordLinks(kw, idf, note, { perNode: 5, minShared: 2 });
    expect(l.map((x) => `${x.source}-${x.target}`).sort()).toEqual(['a-b', 'a-d']);
    expect(l.find((x) => x.target === 'b')?.reason).toBe('成本、损耗');
  });
  it('每个节点只保留最强的几条', () => {
    const l = keywordLinks(kw, idf, note, { perNode: 1, minShared: 2 });
    expect(l).toHaveLength(1);
  });
});

describe('去重', () => {
  it('同对节点同类型只留一条，保留较大权重', () => {
    const l = dedupeLinks([{ source: 'a', target: 'b', type: 'wikilink', weight: 1 }, { source: 'b', target: 'a', type: 'wikilink', weight: 3 }, { source: 'a', target: 'b', type: 'tag', weight: 1 }]);
    expect(l).toHaveLength(2);
    expect(l.find((x) => x.type === 'wikilink')?.weight).toBe(3);
  });
});

describe('buildGraph', () => {
  const inputs = [
    { path: '菜单/定价.md', text: '# 定价\n#菜单\n## 毛利\n毛利率 损耗 成本 咖啡豆\n[[采购]]' },
    { path: '采购.md', text: '# 采购\n## 成本\n毛利率 损耗 成本 咖啡豆 供应商' },
    { path: '空.md', text: '' },
  ];
  const { graph, notes } = buildGraph(inputs, { tokenizer: fallbackTokenizer });
  it('节点：每篇笔记一个主题，非空标题一个知识点，标签一个', () => {
    expect(notes).toHaveLength(3);
    const kinds = (k: string) => graph.nodes.filter((n) => n.kind === k).map((n) => n.label).sort();
    expect(kinds('theme')).toEqual(['定价', '采购', '空'].sort());
    expect(kinds('point')).toEqual(['成本', '毛利']);
    expect(kinds('tag')).toEqual(['#菜单']);
  });
  it('分组取第一级文件夹，根目录的归「根目录」', () => {
    expect(graph.nodes.find((n) => n.label === '毛利')?.group).toBe('菜单');
    expect(graph.nodes.find((n) => n.label === '采购')?.group).toBe('根目录');
  });
  it('出处带文件与行号', () => {
    const p = graph.nodes.find((n) => n.label === '毛利')!;
    expect(p.sources[0]).toMatchObject({ file: '菜单/定价.md', line: 3 });
  });
  it('四类连接都出现，统计一致', () => {
    expect(graph.stats.byType.hierarchy).toBe(2);
    expect(graph.stats.byType.wikilink).toBe(1);
    expect(graph.stats.byType.tag).toBe(1);
    expect(graph.stats.byType.keyword).toBeGreaterThanOrEqual(1);
    expect(graph.stats.links).toBe(graph.links.length);
    expect(graph.stats.nodes).toBe(graph.nodes.length);
  });
  it('所有连线两端都存在', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(graph.links.every((l) => ids.has(l.source) && ids.has(l.target))).toBe(true);
  });
  it('超过节点上限时先丢小的知识点，主题和标签不丢', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `n${i}.md`, text: `# n${i}\n## 点${i}\n${'正文'.repeat(i + 1)}` }));
    const r = buildGraph(many, { maxNodes: 60, tokenizer: fallbackTokenizer }).graph;
    expect(r.nodes.length).toBeLessThanOrEqual(60);
    expect(r.nodes.filter((n) => n.kind === 'theme')).toHaveLength(40);
    expect(r.nodes.some((n) => n.label === '点39')).toBe(true);
    expect(r.nodes.some((n) => n.label === '点0')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAi, buildMessages, parseAiReply, runAi, type Chat } from './ai';
import { buildGraph } from './graph';
import { fallbackTokenizer } from './parse';

const { graph, notes } = buildGraph([
  { path: 'a.md', text: '# A\n## 点\n咖啡' },
  { path: 'b.md', text: '# B\n## 点二\n咖啡' },
  { path: 'c.md', text: '# C\n正文' },
], { tokenizer: fallbackTokenizer });

describe('parseAiReply', () => {
  it('标准 JSON', () => {
    expect(parseAiReply('{"topic":"成本管理","summary":"讲成本","keywords":["成本","损耗"]}')).toEqual({ topic: '成本管理', summary: '讲成本', keywords: ['成本', '损耗'] });
  });
  it('容错：代码围栏、前后废话、末尾标点', () => {
    expect(parseAiReply('好的：\n```json\n{"topic":"选址。","summary":"x","keywords":"错类型"}\n```\n以上')).toEqual({ topic: '选址', summary: 'x', keywords: [] });
  });
  it('没有主题、不是 JSON 返回 null', () => {
    expect(parseAiReply('{"summary":"x"}')).toBeNull();
    expect(parseAiReply('抱歉')).toBeNull();
    expect(parseAiReply('{坏的')).toBeNull();
  });
});

describe('runAi（假大模型）', () => {
  it('带上笔记内容；单篇失败不影响其他；回调进度', async () => {
    const seen: string[] = [];
    const chat: Chat = async (m) => {
      const user = m[1].content;
      seen.push(user);
      if (user.includes('b.md')) throw new Error('网络错误');
      if (user.includes('c.md')) return '不是 JSON';
      return '{"topic":"咖啡","summary":"s","keywords":["k"]}';
    };
    const prog: number[] = [];
    const r = await runAi(notes, chat, { onProgress: (d) => prog.push(d) });
    expect(r.results.size).toBe(1);
    expect(r.failed).toBe(2);
    expect(prog.sort()).toEqual([1, 2, 3]);
    expect(seen.some((s) => s.includes('咖啡'))).toBe(true);
  });
  it('maxNotes 限制篇数', async () => {
    const r = await runAi(notes, async () => '{"topic":"x"}', { maxNotes: 1 });
    expect(r.results.size).toBe(1);
    expect(r.skipped).toBe(2);
  });
  it('提示词里带文件名与正文', () => {
    expect(buildMessages(notes[0])[1].content).toContain('a.md');
  });
});

describe('applyAi', () => {
  const results = new Map([
    ['n:a.md', { topic: '咖啡', summary: '甲摘要', keywords: ['拿铁'] }],
    ['n:b.md', { topic: '咖啡', summary: '', keywords: [] }],
    ['n:不存在', { topic: '无', summary: '', keywords: [] }],
  ]);
  const g = applyAi(graph, results);
  it('同名主题合并成一个节点，连到各笔记', () => {
    const topics = g.nodes.filter((n) => n.ai);
    expect(topics).toHaveLength(1);
    expect(g.links.filter((l) => l.type === 'topic').map((l) => l.target).sort()).toEqual(['n:a.md', 'n:b.md']);
    expect(g.stats.byType.topic).toBe(2);
  });
  it('笔记摘要与关键词被替换，原图不被修改', () => {
    expect(g.nodes.find((n) => n.id === 'n:a.md')?.summary).toBe('甲摘要');
    expect(g.nodes.find((n) => n.id === 'n:a.md')?.keywords).toContain('拿铁');
    expect(graph.nodes.some((n) => n.ai)).toBe(false);
    expect(graph.nodes.find((n) => n.id === 'n:a.md')?.summary).not.toBe('甲摘要');
  });
});

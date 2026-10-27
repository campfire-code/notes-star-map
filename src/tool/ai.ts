// 可选：用户在设置里填了大模型，就让它给每篇笔记提炼主题。不填也能用，本文件只做提示词、容错解析和合并。
import { noteId, dedupeLinks, statsOf } from './graph';
import type { GLink, GNode, Graph, ParsedNote } from './types';

export interface AiNote {
  topic: string;
  summary: string;
  keywords: string[];
}
export type Chat = (messages: { role: 'system' | 'user' | 'assistant'; content: string }[], opts?: { json?: boolean; temperature?: number }) => Promise<string>;

const MAX_CHARS = 2500;

export function buildMessages(n: ParsedNote) {
  const body = [n.title, ...n.sections.map((s) => `${'#'.repeat(Math.max(2, s.level))} ${s.heading}\n${s.text}`), n.intro].join('\n').slice(0, MAX_CHARS);
  return [
    { role: 'system' as const, content: '你是笔记整理助手。阅读一篇笔记，提炼它所属的主题。只输出 JSON：{"topic":"主题名，2 到 8 个字，不要标点","summary":"一句话概括，不超过 50 字","keywords":["3 到 6 个关键词"]}。同类笔记要用同一个主题名。' },
    { role: 'user' as const, content: `文件：${n.path}\n\n${body}` },
  ];
}

/** 容错解析：去掉代码围栏，取第一个 { 到最后一个 } */
export function parseAiReply(text: string): AiNote | null {
  const s = text.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>;
    const topic = String(o.topic ?? '').trim().replace(/[。.，,！!？?]+$/, '').slice(0, 16);
    if (!topic) return null;
    const kw = Array.isArray(o.keywords) ? o.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 8) : [];
    return { topic, summary: String(o.summary ?? '').trim().slice(0, 120), keywords: kw };
  } catch {
    return null;
  }
}

export async function runAi(
  notes: ParsedNote[],
  chat: Chat,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; concurrency?: number; maxNotes?: number } = {},
): Promise<{ results: Map<string, AiNote>; failed: number; skipped: number }> {
  const list = notes.slice(0, opts.maxNotes ?? 80);
  const results = new Map<string, AiNote>();
  let failed = 0, done = 0, next = 0;
  const worker = async () => {
    while (next < list.length) {
      if (opts.signal?.aborted) return;
      const n = list[next++];
      try {
        const r = parseAiReply(await chat(buildMessages(n), { json: true, temperature: 0.2 }));
        if (r) results.set(noteId(n), r);
        else failed++;
      } catch {
        failed++;
      }
      opts.onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, list.length) }, worker));
  return { results, failed, skipped: notes.length - list.length };
}

const topicId = (t: string) => `a:${t.toLowerCase()}`;

/** 把 AI 提炼的主题并进图：同名主题合并成一个主题节点，连到各笔记；笔记摘要和关键词用 AI 的 */
export function applyAi(g: Graph, results: Map<string, AiNote>): Graph {
  const nodes: GNode[] = g.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: GLink[] = g.links.slice();
  const topics = new Map<string, { label: string; notes: string[] }>();
  for (const [id, r] of results) {
    const n = byId.get(id);
    if (!n) continue;
    if (r.summary) n.summary = r.summary;
    if (r.keywords.length) n.keywords = [...new Set([...r.keywords, ...n.keywords])].slice(0, 8);
    n.search = `${n.search} ${r.summary} ${r.keywords.join(' ')} ${r.topic}`.toLowerCase();
    const k = topicId(r.topic);
    const t = topics.get(k) ?? { label: r.topic, notes: [] };
    t.notes.push(id);
    topics.set(k, t);
  }
  for (const [id, t] of topics) {
    nodes.push({
      id, kind: 'theme', label: t.label, group: '主题', weight: 2 + Math.min(4, t.notes.length * 0.8), ai: true,
      summary: `AI 提炼的主题，包含 ${t.notes.length} 篇笔记`, keywords: [], sources: [], search: t.label.toLowerCase(),
    });
    for (const nid of t.notes) links.push({ source: id, target: nid, type: 'topic', weight: 2.5, reason: 'AI 主题' });
  }
  const out = dedupeLinks(links);
  return { nodes, links: out, stats: statsOf(nodes, out, g.stats.files, g.stats.chars, g.stats.unresolved) };
}

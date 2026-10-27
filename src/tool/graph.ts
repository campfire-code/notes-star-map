// 纯函数：由解析好的笔记按规则生成节点与连接。
// 规则：标题层级、[[双链]]、标签、共同关键词；各规则独立成函数，便于单独测试。
import { extractKeywords, normName, parseNote, defaultTokenizer, type Tokenizer } from './parse';
import type { GLink, GNode, Graph, LinkType, ParsedLink, ParsedNote, Section, Source } from './types';

export interface BuildOptions {
  /** 节点上限，超出时丢掉最不重要的知识点 */
  maxNodes?: number;
  /** 每个节点最多保留几条关键词连接 */
  keywordLinksPerNode?: number;
  /** 两个节点至少共有几个关键词才连接 */
  minShared?: number;
  tokenizer?: Tokenizer;
}

export interface NoteInput {
  path: string;
  text: string;
  abs?: string;
}

export const noteId = (n: ParsedNote) => `n:${n.path}`;
export const sectionId = (n: ParsedNote, s: Section) => `s:${n.path}#${s.index}`;
export const tagId = (t: string) => `t:${t.toLowerCase()}`;

const snippetOf = (text: string, max = 110) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
};
const summaryOf = (text: string, max = 140) => snippetOf(text.split('\n').slice(0, 3).join(' '), max);
const weightOf = (chars: number) => 1 + Math.min(5, Math.log(1 + chars / 60));

/** 一个节点对应的「文档」：用于关键词提取 */
interface Unit {
  id: string;
  note: ParsedNote;
  heading: string;
  body: string;
}

export function unitsOf(notes: ParsedNote[]): Unit[] {
  const out: Unit[] = [];
  for (const n of notes) {
    out.push({ id: noteId(n), note: n, heading: n.title, body: n.intro });
    for (const s of n.sections) out.push({ id: sectionId(n, s), note: n, heading: s.heading, body: s.text });
  }
  return out;
}

/** 规则一：标题层级。笔记 → 一级知识点 → 下级知识点 */
export function hierarchyLinks(notes: ParsedNote[], keep: (id: string) => boolean): GLink[] {
  const out: GLink[] = [];
  for (const n of notes) {
    for (const s of n.sections) {
      const id = sectionId(n, s);
      if (!keep(id)) continue;
      const parent = s.parent >= 0 ? sectionId(n, n.sections[s.parent]) : noteId(n);
      out.push({ source: parent, target: id, type: 'hierarchy', weight: 2 });
    }
  }
  return out;
}

/** 笔记名 / 标题 → 笔记，用于解析双链 */
export function buildNoteIndex(notes: ParsedNote[]): Map<string, ParsedNote> {
  const idx = new Map<string, ParsedNote>();
  for (const n of notes) {
    for (const k of [normName(n.path), normName(n.name), normName(n.title)]) if (k && !idx.has(k)) idx.set(k, n);
    const noExt = n.path.replace(/\.[^.]+$/, '').toLowerCase();
    if (!idx.has(noExt)) idx.set(noExt, n);
  }
  return idx;
}

/** 规则二：[[双链]]。从双链所在的知识点指向被链接的笔记（带 #标题 时指向对应知识点） */
export function wikiLinks(notes: ParsedNote[], keep: (id: string) => boolean): { links: GLink[]; unresolved: number } {
  const idx = buildNoteIndex(notes);
  const out: GLink[] = [];
  let unresolved = 0;
  const resolve = (from: string, l: ParsedLink, fromNote: ParsedNote) => {
    const raw = l.target;
    const target = idx.get(raw) ?? idx.get(raw.replace(/\.[^.]+$/, ''));
    if (!target) { unresolved++; return; }
    let to = noteId(target);
    if (l.heading) {
      const h = l.heading.toLowerCase();
      const sec = target.sections.find((s) => s.heading.toLowerCase() === h);
      if (sec && keep(sectionId(target, sec))) to = sectionId(target, sec);
    }
    if (to === from || (target === fromNote && to === noteId(fromNote) && from === noteId(fromNote))) return;
    out.push({ source: from, target: to, type: 'wikilink', weight: 3, reason: `[[${raw}]]` });
  };
  for (const n of notes) {
    for (const l of n.introLinks) resolve(noteId(n), l, n);
    for (const s of n.sections) {
      const id = sectionId(n, s);
      const from = keep(id) ? id : noteId(n);
      for (const l of s.links) resolve(from, l, n);
    }
  }
  return { links: out, unresolved };
}

/** 规则三：标签。标签节点连到用了它的笔记 / 知识点；a/b 这样的层级标签连到上级标签 */
export function tagLinks(notes: ParsedNote[], keep: (id: string) => boolean): { tags: Map<string, { name: string; uses: number }>; links: GLink[] } {
  const tags = new Map<string, { name: string; uses: number }>();
  const links: GLink[] = [];
  const use = (name: string, nodeId: string) => {
    const id = tagId(name);
    const cur = tags.get(id) ?? { name, uses: 0 };
    cur.uses++;
    tags.set(id, cur);
    links.push({ source: id, target: nodeId, type: 'tag', weight: 2, reason: `#${name}` });
    const slash = name.lastIndexOf('/');
    if (slash > 0) {
      const parent = name.slice(0, slash);
      if (!tags.has(tagId(parent))) tags.set(tagId(parent), { name: parent, uses: 0 });
      links.push({ source: tagId(parent), target: id, type: 'tag', weight: 1.5, reason: `#${parent}` });
    }
  };
  for (const n of notes) {
    for (const t of n.tags) use(t, noteId(n));
    for (const s of n.sections) {
      const id = sectionId(n, s);
      for (const t of s.tags) use(t, keep(id) ? id : noteId(n));
    }
  }
  // 重复的「上级标签」连线去重
  const seen = new Set<string>();
  const uniqueLinks = links.filter((l) => {
    const k = `${l.source}|${l.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { tags, links: uniqueLinks };
}

/**
 * 规则四：共同关键词。不同笔记里的两个节点共有至少 minShared 个关键词就连接，
 * 连接强度为共有关键词的 idf 之和；每个节点只保留强度最高的几条，避免连成一团。
 */
export function keywordLinks(
  keywords: Map<string, string[]>,
  idf: Map<string, number>,
  noteOf: Map<string, string>,
  opts: { perNode: number; minShared: number },
): GLink[] {
  const inverted = new Map<string, string[]>();
  for (const [id, ws] of keywords) for (const w of ws) (inverted.get(w) ?? inverted.set(w, []).get(w)!).push(id);
  const pair = new Map<string, { a: string; b: string; shared: string[]; score: number }>();
  for (const [w, ids] of inverted) {
    if (ids.length > 40) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (noteOf.get(ids[i]) === noteOf.get(ids[j])) continue;
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const k = `${a}|${b}`;
        const p = pair.get(k) ?? { a, b, shared: [], score: 0 };
        p.shared.push(w);
        p.score += idf.get(w) ?? 1;
        pair.set(k, p);
      }
    }
  }
  const cands = [...pair.values()].filter((p) => p.shared.length >= opts.minShared).sort((x, y) => y.score - x.score || (x.a + x.b < y.a + y.b ? -1 : 1));
  const count = new Map<string, number>();
  const out: GLink[] = [];
  for (const p of cands) {
    if ((count.get(p.a) ?? 0) >= opts.perNode || (count.get(p.b) ?? 0) >= opts.perNode) continue;
    count.set(p.a, (count.get(p.a) ?? 0) + 1);
    count.set(p.b, (count.get(p.b) ?? 0) + 1);
    out.push({ source: p.a, target: p.b, type: 'keyword', weight: Math.min(3, p.score / 2), reason: p.shared.slice(0, 4).join('、') });
  }
  return out;
}

/** 同一对节点同一种连接只留一条，权重取大 */
export function dedupeLinks(links: GLink[]): GLink[] {
  const m = new Map<string, GLink>();
  for (const l of links) {
    const [a, b] = l.source < l.target ? [l.source, l.target] : [l.target, l.source];
    const k = `${a}|${b}|${l.type}`;
    const cur = m.get(k);
    if (!cur) m.set(k, l);
    else if (l.weight > cur.weight) cur.weight = l.weight;
  }
  return [...m.values()];
}

export function emptyStats(): Graph['stats'] {
  return { files: 0, chars: 0, nodes: 0, links: 0, unresolved: 0, byType: { hierarchy: 0, wikilink: 0, tag: 0, keyword: 0, topic: 0 } };
}

export function statsOf(nodes: GNode[], links: GLink[], files: number, chars: number, unresolved: number): Graph['stats'] {
  const byType: Record<LinkType, number> = { hierarchy: 0, wikilink: 0, tag: 0, keyword: 0, topic: 0 };
  for (const l of links) byType[l.type]++;
  return { files, chars, nodes: nodes.length, links: links.length, unresolved, byType };
}

const searchText = (parts: (string | string[])[]) => parts.flat().join(' ').toLowerCase();

export function buildGraph(inputs: NoteInput[], opts: BuildOptions = {}): { graph: Graph; notes: ParsedNote[] } {
  const maxNodes = opts.maxNodes ?? 500;
  const tokenizer = opts.tokenizer ?? defaultTokenizer;
  const notes = inputs.map((i) => parseNote(i.path, i.text)).sort((a, b) => (a.path < b.path ? -1 : 1));
  const absOf = new Map(inputs.map((i) => [i.path.replace(/\\/g, '/'), i.abs]));

  // 1. 决定保留哪些知识点：去掉没有正文又没有下级的空标题；超过上限时先丢小的叶子
  const hasChild = new Set<string>();
  for (const n of notes) for (const s of n.sections) if (s.parent >= 0) hasChild.add(sectionId(n, n.sections[s.parent]));
  const points: { n: ParsedNote; s: Section; id: string; w: number }[] = [];
  for (const n of notes) for (const s of n.sections) {
    const id = sectionId(n, s);
    if (!s.text && !hasChild.has(id)) continue;
    points.push({ n, s, id, w: weightOf(s.text.length) });
  }
  const dropped = new Set<string>();
  const tagCount = new Set(notes.flatMap((n) => [...n.tags, ...n.sections.flatMap((s) => s.tags)].map((t) => t.toLowerCase()))).size;
  let over = notes.length + points.length + tagCount - maxNodes;
  if (over > 0) {
    const leaves = points.filter((p) => !hasChild.has(p.id)).sort((a, b) => a.w - b.w || (a.id < b.id ? 1 : -1));
    for (const p of leaves) {
      if (over <= 0) break;
      dropped.add(p.id);
      over--;
    }
  }
  const kept = points.filter((p) => !dropped.has(p.id));
  const keepSet = new Set(kept.map((p) => p.id));
  const keep = (id: string) => keepSet.has(id);

  // 2. 关键词
  const units = unitsOf(notes).filter((u) => u.id.startsWith('n:') || keepSet.has(u.id));
  const { keywords, idf } = extractKeywords(units, 6, tokenizer);
  const noteOf = new Map(units.map((u) => [u.id, u.note.path]));

  // 3. 节点
  const nodes: GNode[] = [];
  for (const n of notes) {
    const total = n.chars;
    const kw = keywords.get(noteId(n)) ?? [];
    const group = n.folder || '根目录';
    nodes.push({
      id: noteId(n), kind: 'theme', label: n.title, group, weight: weightOf(total) + 1,
      summary: summaryOf(n.intro) || `${n.sections.length} 个知识点`,
      keywords: kw,
      sources: [{ file: n.path, line: 1, snippet: snippetOf(n.intro) || n.title, abs: absOf.get(n.path) }],
      search: searchText([n.title, n.path, n.intro, kw, n.tags]),
    });
  }
  for (const p of kept) {
    const kw = keywords.get(p.id) ?? [];
    nodes.push({
      id: p.id, kind: 'point', label: p.s.heading, group: p.n.folder || '根目录', weight: p.w,
      summary: summaryOf(p.s.text) || '（只有下级标题）',
      keywords: kw,
      sources: [{ file: p.n.path, line: p.s.line, snippet: snippetOf(p.s.text) || p.s.heading, abs: absOf.get(p.n.path) }],
      search: searchText([p.s.heading, p.n.title, p.s.text, kw, p.s.tags]),
    });
  }

  // 4. 连接
  const wiki = wikiLinks(notes, keep);
  const tg = tagLinks(notes, keep);
  for (const [id, t] of tg.tags) {
    nodes.push({ id, kind: 'tag', label: `#${t.name}`, group: '标签', weight: 1 + Math.min(4, t.uses * 0.6), summary: `被 ${t.uses} 处笔记或知识点使用`, keywords: [], sources: [], search: `#${t.name}`.toLowerCase() });
  }
  let links = dedupeLinks([
    ...hierarchyLinks(notes, keep),
    ...wiki.links,
    ...tg.links,
    ...keywordLinks(keywords, idf, noteOf, { perNode: opts.keywordLinksPerNode ?? 3, minShared: opts.minShared ?? 2 }),
  ]);
  const ids = new Set(nodes.map((n) => n.id));
  links = links.filter((l) => ids.has(l.source) && ids.has(l.target));
  // 标签节点的使用次数以最终连线为准
  const tagUse = new Map<string, number>();
  for (const l of links) if (l.type === 'tag' && l.source.startsWith('t:') && l.target.startsWith('t:') === false) tagUse.set(l.source, (tagUse.get(l.source) ?? 0) + 1);
  for (const n of nodes) if (n.kind === 'tag') {
    const u = tagUse.get(n.id) ?? 0;
    n.weight = 1 + Math.min(4, u * 0.6);
    if (u) n.summary = `被 ${u} 处笔记或知识点使用`;
  }
  const stats = statsOf(nodes, links, notes.length, notes.reduce((a, n) => a + n.chars, 0), wiki.unresolved);
  return { graph: { nodes, links, stats }, notes };
}

export type { Source };

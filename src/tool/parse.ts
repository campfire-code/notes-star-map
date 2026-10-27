// 纯函数：把一篇 md / txt 笔记拆成标题段落、标签、双链，并提取关键词。
import type { ParsedLink, ParsedNote, Section } from './types';

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;
const WIKI = /\[\[([^\[\]|#]*)(?:#([^\[\]|]*))?(?:\|([^\[\]]*))?\]\]/g;
const TAG = /(?:^|[\s,，。;；、(（])#([\p{L}\p{N}_\-/]+)/gu;

export const SUPPORTED_EXT = ['md', 'markdown', 'txt'];

const baseName = (p: string) => (p.split('/').pop() ?? p).replace(/\.[^.]+$/, '');

/** 笔记名规范化，用于双链匹配：去路径、去 .md、去首尾空白、转小写 */
export function normName(s: string): string {
  return baseName(s.trim().replace(/\\/g, '/')).trim().toLowerCase();
}

function parseFrontMatter(lines: string[]): { end: number; tags: string[]; title: string } {
  if (lines[0]?.trim() !== '---') return { end: 0, tags: [], title: '' };
  let close = -1;
  for (let i = 1; i < Math.min(lines.length, 80); i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') { close = i; break; }
  }
  if (close < 0) return { end: 0, tags: [], title: '' };
  const tags: string[] = [];
  let title = '';
  for (let i = 1; i < close; i++) {
    const m = /^(tags?|标签)\s*[:：]\s*(.*)$/i.exec(lines[i]);
    if (m) {
      const v = m[2].trim();
      if (v) {
        v.replace(/^\[|\]$/g, '').split(/[,，、]/).forEach((t) => tags.push(t));
      } else {
        while (i + 1 < close && /^\s*-\s+/.test(lines[i + 1])) tags.push(lines[++i].replace(/^\s*-\s+/, ''));
      }
      continue;
    }
    const t = /^(title|标题)\s*[:：]\s*(.+)$/i.exec(lines[i]);
    if (t) title = t[2].trim().replace(/^["']|["']$/g, '');
  }
  return { end: close + 1, tags: tags.map(cleanTag).filter(Boolean), title };
}

export function cleanTag(t: string): string {
  return t.trim().replace(/^#+/, '').replace(/^["']|["']$/g, '').replace(/\/+$/, '').trim();
}

/** 去掉格式符号，只留可读文字 */
export function cleanLine(s: string): string {
  return s
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => (b || a || '').trim())
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\s*>+\s?/, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/(?:^|\s)#[\p{L}\p{N}_\-/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scanInline(line: string, lineNo: number, tags: string[], links: ParsedLink[]) {
  const noCode = line.replace(/`[^`]*`/g, ' ');
  for (const m of noCode.matchAll(WIKI)) {
    const target = normName(m[1] ?? '');
    if (target) links.push({ target, heading: (m[2] ?? '').trim(), line: lineNo });
  }
  const noWiki = noCode.replace(WIKI, ' ').replace(/https?:\/\/\S+/g, ' ');
  for (const m of noWiki.matchAll(TAG)) {
    const t = cleanTag(m[1]);
    if (t && !/^\d+$/.test(t)) tags.push(t);
  }
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

export function parseNote(path: string, raw: string): ParsedNote {
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/');
  const name = baseName(norm);
  const folder = parts.length > 1 ? parts[0] : '';
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const fm = parseFrontMatter(lines);

  const isTxt = /\.txt$/i.test(norm);
  const sections: Section[] = [];
  const stack: Section[] = [];
  const introLines: string[] = [];
  const noteTags: string[] = [...fm.tags];
  const introLinks: ParsedLink[] = [];
  let title = '';
  let current: { text: string[]; tags: string[]; links: ParsedLink[] } = { text: introLines, tags: noteTags, links: introLinks };
  let inFence = false;

  for (let i = fm.end; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = isTxt ? null : HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const heading = cleanLine(h[2]);
      if (level === 1 && !title && sections.length === 0) {
        title = heading;
        continue;
      }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const sec: Section = { index: sections.length, level, heading, parent: stack.length ? stack[stack.length - 1].index : -1, line: i + 1, text: '', tags: [], links: [] };
      sections.push(sec);
      stack.push(sec);
      const bucket = { text: [] as string[], tags: sec.tags, links: sec.links };
      current = bucket;
      (sec as Section & { _b?: string[] })._b = bucket.text;
      continue;
    }
    scanInline(line, i + 1, current.tags, current.links);
    const c = cleanLine(line);
    if (c) current.text.push(c);
  }
  for (const s of sections) {
    const b = (s as Section & { _b?: string[] })._b ?? [];
    s.text = b.join('\n');
    s.tags = uniq(s.tags);
    delete (s as Section & { _b?: string[] })._b;
  }
  const intro = introLines.join('\n');
  return {
    path: norm,
    name,
    folder,
    title: title || fm.title || name,
    tags: uniq(noteTags),
    intro,
    introLinks,
    sections,
    chars: raw.length,
  };
}

// ---------------- 关键词 ----------------

const STOP = new Set(
  ('我们 你们 他们 它们 自己 这个 那个 这些 那些 这样 那样 这里 那里 什么 怎么 如何 为什么 可以 可能 需要 应该 必须 已经 还是 或者 但是 因为 所以 如果 然后 以及 并且 而且 不是 没有 就是 也是 都是 一个 一些 一种 一下 一样 一定 比较 非常 特别 还有 以后 之前 之后 时候 现在 今天 本周 每天 每周 每次 通过 进行 使用 根据 对于 关于 其中 其他 之一 部分 方面 情况 问题 内容 方法 工作 目前 主要 只是 不要 不能 能够 来说 起来 出来 下来 上来 看到 觉得 知道 开始 继续 完成 提高 增加 减少 保持 确保 注意 例如 比如 包括 同时 另外 同样 其实 当然 尽量 大概 大约 左右 以上 以下 或是 还要 不会 只有 只要 即使 虽然 不过 而是 的话 之间 之中 里面 外面 上面 下面 前面 后面 第一 第二 第三 这种 那种 每个 各个 多少 几个 很多 许多 大家 别人 对方 自身 本身 一般 通常 经常 往往 总是 一直 马上 立刻 直接 简单 容易 重要 基本 相关 示例 虚构 演示 仅用于 用于 先把 多半 多半是 主要是 之内 之二 笔记 内容 the and for are but not you all can had her was one our out has have that this with from they will your what when who how why been were their there which about into more other some than then them these those would could should also just like only over such very each most many much any')
    .split(/\s+/),
);

export type Tokenizer = (text: string) => string[];

const CJK = /[㐀-鿿]/;

/** 默认分词：优先用系统自带的中文分词（Intl.Segmenter），没有就退回到「中文二字组 + 英文单词」 */
export const defaultTokenizer: Tokenizer = (text) => {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment(s: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Seg) {
    const out: string[] = [];
    for (const s of new Seg('zh-CN', { granularity: 'word' }).segment(text)) {
      if (s.isWordLike) out.push(s.segment);
    }
    return out;
  }
  return fallbackTokenizer(text);
};

export const fallbackTokenizer: Tokenizer = (text) => {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9\-+.#]*|[㐀-鿿]+/g)) {
    const w = m[0];
    if (CJK.test(w)) {
      if (w.length <= 2) out.push(w);
      for (let i = 0; i + 2 <= w.length && w.length > 2; i++) out.push(w.slice(i, i + 2));
    } else out.push(w);
  }
  return out;
};

/** 过滤后的词表：中文至少 2 字，英文至少 3 个字母，去掉纯数字与停用词 */
export function terms(text: string, tokenize: Tokenizer = defaultTokenizer): string[] {
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    const w = raw.toLowerCase();
    if (/^[\d.,%:\-+/]+$/.test(w)) continue;
    if (STOP.has(w)) continue;
    if (CJK.test(w) ? w.length < 2 : w.length < 3) continue;
    out.push(w);
  }
  return out;
}

export interface KeywordDoc {
  id: string;
  /** 标题（权重高） */
  heading: string;
  body: string;
}

/**
 * 给每个文档提取关键词：词频 × 逆文档频率，标题里的词算 3 次。
 * 只在一个文档里出现且不在标题里的词、以及出现在超过一半文档里的词（文档数 ≥ 6 时）都不要。
 */
export function extractKeywords(docs: KeywordDoc[], perDoc = 6, tokenize: Tokenizer = defaultTokenizer): { keywords: Map<string, string[]>; idf: Map<string, number> } {
  const inHeading = docs.map((d) => new Set(terms(d.heading, tokenize)));
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of terms(d.heading, tokenize)) tf.set(w, (tf.get(w) ?? 0) + 3);
    for (const w of terms(d.body, tokenize)) tf.set(w, (tf.get(w) ?? 0) + 1);
    return tf;
  });
  const df = new Map<string, number>();
  for (const tf of tfs) for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [w, c] of df) idf.set(w, Math.log(1 + n / c));
  const keywords = new Map<string, string[]>();
  docs.forEach((d, i) => {
    const scored = [...tfs[i]]
      // 只在这一处出现、又不在标题里的词多半是零碎用语，不当关键词；太泛的词也丢掉
      .filter(([w]) => (df.get(w) ?? 0) >= 2 || inHeading[i].has(w))
      .filter(([w]) => !(n >= 6 && (df.get(w) ?? 0) / n > 0.5))
      .map(([w, f]) => [w, (1 + Math.log(f)) * (idf.get(w) ?? 0)] as const)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    keywords.set(d.id, scored.slice(0, perDoc).map(([w]) => w));
  });
  return { keywords, idf };
}

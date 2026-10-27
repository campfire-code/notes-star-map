// 纯函数：搜索与筛选。筛选会隐藏节点，搜索只把不匹配的淡化。
import type { Graph, LinkType, NodeKind } from './types';

export interface FilterState {
  kinds: Set<NodeKind>;
  linkTypes: Set<LinkType>;
  /** 为空表示全部文件夹 */
  groups: Set<string>;
  query: string;
}

export const allFilters = (): FilterState => ({
  kinds: new Set<NodeKind>(['theme', 'point', 'tag']),
  linkTypes: new Set<LinkType>(['hierarchy', 'wikilink', 'tag', 'keyword', 'topic']),
  groups: new Set(),
  query: '',
});

export interface Visibility {
  nodes: Set<string>;
  /** 搜索命中的节点；没有搜索词时为 null */
  matches: Set<string> | null;
  links: Set<number>;
}

export function queryTokens(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

export function computeVisibility(g: Graph, f: FilterState): Visibility {
  const nodes = new Set<string>();
  for (const n of g.nodes) {
    if (!f.kinds.has(n.kind)) continue;
    // 标签没有自己的文件夹，不受文件夹筛选影响
    if (f.groups.size && n.kind !== 'tag' && !f.groups.has(n.group)) continue;
    nodes.add(n.id);
  }
  const links = new Set<number>();
  g.links.forEach((l, i) => {
    if (f.linkTypes.has(l.type) && nodes.has(l.source) && nodes.has(l.target)) links.add(i);
  });
  const tokens = queryTokens(f.query);
  let matches: Set<string> | null = null;
  if (tokens.length) {
    matches = new Set();
    for (const n of g.nodes) if (nodes.has(n.id) && tokens.every((t) => n.search.includes(t))) matches.add(n.id);
  }
  return { nodes, matches, links };
}

// 把 Graph 变成可绘制、可布局的场景：节点序号、相邻表、预热后的位置。
import { initPositions, stepLayout, type SimLink } from './layout';
import { colorOf, nodeRadius, type RLink, type RNode } from './render';
import type { Graph } from './types';
import { computeVisibility, type FilterState } from './filter';

export interface SceneData {
  nodes: RNode[];
  links: RLink[];
  sim: SimLink[];
  groups: string[];
  adj: number[][];
  index: Map<string, number>;
}

export function buildScene(g: Graph, warmSteps = 320): SceneData {
  const groups = [...new Set(g.nodes.map((n) => n.group))].filter((x) => x !== '标签' && x !== '主题').sort();
  const nodes: RNode[] = g.nodes.map((n) => ({
    id: n.id, kind: n.kind, group: n.group, x: 0, y: 0, vx: 0, vy: 0,
    r: nodeRadius(n), g: n, color: colorOf(n.group, groups), match: false, target: 1, scale: 1, hidden: false,
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const sim: SimLink[] = [];
  const links: RLink[] = [];
  const adj: number[][] = nodes.map(() => []);
  for (const l of g.links) {
    const a = index.get(l.source), b = index.get(l.target);
    if (a == null || b == null) continue;
    sim.push({ a, b, type: l.type, weight: l.weight });
    links.push({ a, b, type: l.type, weight: l.weight, visible: true });
    adj[a].push(b);
    adj[b].push(a);
  }
  initPositions(nodes);
  for (let i = 0; i < warmSteps; i++) stepLayout(nodes, sim, Math.max(0.04, 1 - i / warmSteps));
  return { nodes, links, sim, groups, adj, index };
}

/** 把筛选与搜索结果写到场景上 */
export function applyVisibility(sc: SceneData, g: Graph, f: FilterState): { shown: number; matches: number | null } {
  const v = computeVisibility(g, f);
  sc.nodes.forEach((n) => {
    n.hidden = !v.nodes.has(n.id);
    n.match = v.matches ? v.matches.has(n.id) : false;
  });
  g.links.forEach((_, i) => { if (sc.links[i]) sc.links[i].visible = v.links.has(i); });
  return { shown: v.nodes.size, matches: v.matches ? v.matches.size : null };
}

import { describe, expect, it } from 'vitest';
import { allFilters } from './filter';
import { buildGraph } from './graph';
import { applyVisibility, buildScene } from './scene';
import { DEMO_NOTES } from './demo';
import { pickNode, worldToScreen, fitView } from './view';

const { graph } = buildGraph(DEMO_NOTES);

describe('buildScene', () => {
  const sc = buildScene(graph);
  it('位置全是有限数；相邻表对称', () => {
    expect(sc.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    sc.adj.forEach((list, i) => list.forEach((j) => expect(sc.adj[j]).toContain(i)));
  });
  it('每个连接都对应场景里的一条线', () => {
    expect(sc.links).toHaveLength(graph.links.length);
  });
  it('适应窗口后每个节点都能在屏幕上被点到（用屏幕位置反查）', () => {
    const view = fitView(sc.nodes, 900, 600);
    const misses = sc.nodes.filter((n) => {
      const p = worldToScreen(view, n.x, n.y);
      const hit = pickNode(sc.nodes, view, p.x, p.y);
      // 极少数完全重叠的节点会被另一个同位置的挡住，要求命中的圆心离得很近
      return !hit || Math.hypot(hit.x - n.x, hit.y - n.y) * view.scale > 6;
    });
    expect(misses).toHaveLength(0);
  });
});

describe('applyVisibility', () => {
  it('筛选与搜索写到节点上', () => {
    const sc = buildScene(graph, 10);
    const f = allFilters();
    f.kinds.delete('tag');
    f.query = '损耗';
    const r = applyVisibility(sc, graph, f);
    expect(r.shown).toBe(graph.nodes.filter((n) => n.kind !== 'tag').length);
    expect(r.matches).toBeGreaterThan(0);
    expect(sc.nodes.filter((n) => n.hidden).every((n) => n.kind === 'tag')).toBe(true);
    expect(sc.nodes.filter((n) => n.match).length).toBe(r.matches);
  });
});

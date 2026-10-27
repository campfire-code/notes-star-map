import { describe, expect, it } from 'vitest';
import { drawScene, nodeRadius, type RLink, type RNode } from './render';
import type { GNode } from './types';

function fakeCtx() {
  const calls: Record<string, number> = {};
  const target: Record<string, unknown> = {};
  return {
    calls,
    ctx: new Proxy(target, {
      get(t, k: string) {
        if (k in t) return t[k];
        return (...args: unknown[]) => {
          calls[k] = (calls[k] ?? 0) + 1;
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
          return args.length ? undefined : undefined;
        };
      },
      set(t, k: string, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D,
  };
}
const g = (id: string, kind: GNode['kind']): GNode => ({ id, kind, label: id, group: 'g', weight: 2, summary: '', keywords: [], sources: [], search: id });
const node = (id: string, x: number, hidden = false): RNode => ({ id, kind: 'point', group: 'g', x, y: 0, vx: 0, vy: 0, r: nodeRadius(g(id, 'point')), hidden, g: g(id, 'point'), color: '#fff', match: false, target: 1, scale: 1 });

describe('drawScene', () => {
  const nodes = [node('a', 0), node('b', 100), node('c', 200, true)];
  const links: RLink[] = [{ a: 0, b: 1, type: 'wikilink', weight: 1, visible: true }, { a: 1, b: 2, type: 'tag', weight: 1, visible: false }];
  it('只画可见的节点和连线', () => {
    const { ctx, calls } = fakeCtx();
    const drawn = drawScene(ctx, 800, 600, { nodes, links, view: { tx: 300, ty: 300, scale: 1 }, hover: null, selected: null, neighbors: new Set(), searching: false });
    expect(drawn).toBe(2);
    expect(calls.stroke).toBeGreaterThanOrEqual(1 + 2);
  });
  it('悬停、选中、搜索、导出都不报错', () => {
    const { ctx } = fakeCtx();
    const base = { nodes, links, view: { tx: 300, ty: 300, scale: 0.5 }, neighbors: new Set([1]), searching: true };
    expect(() => drawScene(ctx, 800, 600, { ...base, hover: nodes[0], selected: nodes[1] })).not.toThrow();
    expect(() => drawScene(ctx, 800, 600, { ...base, hover: null, selected: null, exporting: true, caption: '示例' })).not.toThrow();
  });
  it('视野外的节点不画', () => {
    const { ctx } = fakeCtx();
    const drawn = drawScene(ctx, 800, 600, { nodes, links, view: { tx: 5000, ty: 5000, scale: 1 }, hover: null, selected: null, neighbors: new Set(), searching: false });
    expect(drawn).toBe(0);
  });
  it('主题节点比知识点、标签大', () => {
    expect(nodeRadius(g('t', 'theme'))).toBeGreaterThan(nodeRadius(g('p', 'point')));
  });
});

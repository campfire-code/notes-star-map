import { describe, expect, it } from 'vitest';
import { hash01, initPositions, stepLayout, type SimLink, type SimNode } from './layout';

const mk = (id: string, group = 'g', kind: SimNode['kind'] = 'point'): SimNode => ({ id, kind, group, x: 0, y: 0, vx: 0, vy: 0 });

describe('布局', () => {
  it('hash01 稳定且在 [0,1) 内', () => {
    expect(hash01('abc')).toBe(hash01('abc'));
    expect(hash01('abc')).not.toBe(hash01('abd'));
    for (const s of ['', 'x', '咖啡']) expect(hash01(s)).toBeGreaterThanOrEqual(0), expect(hash01(s)).toBeLessThan(1);
  });
  it('初始位置可重复，不同文件夹落在不同扇区', () => {
    const a = [mk('1', 'A'), mk('2', 'B')], b = [mk('1', 'A'), mk('2', 'B')];
    initPositions(a);
    initPositions(b);
    expect(a.map((n) => [n.x, n.y])).toEqual(b.map((n) => [n.x, n.y]));
    expect(Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)).toBeGreaterThan(10);
  });
  it('迭代后没有 NaN；有连线的节点比无连线的更近；速度收敛', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => mk(`n${i}`, i < 6 ? 'A' : 'B'));
    const links: SimLink[] = [];
    for (let i = 0; i < 5; i++) links.push({ a: i, b: i + 1, type: 'hierarchy', weight: 2 });
    initPositions(nodes);
    let speed = 0;
    for (let i = 0; i < 400; i++) speed = stepLayout(nodes, links, Math.max(0.05, 1 - i / 300));
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    const d = (i: number, j: number) => Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
    expect(d(0, 1)).toBeLessThan(d(0, 11));
    expect(speed).toBeLessThan(1);
  });
  it('固定的节点不动；重叠的节点会被推开', () => {
    const a = mk('a'), b = mk('b');
    a.fixed = true;
    stepLayout([a, b], [], 1);
    expect([a.x, a.y]).toEqual([0, 0]);
    expect(Math.hypot(b.x, b.y)).toBeGreaterThan(0);
  });
});

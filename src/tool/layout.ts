// 纯函数：力导向布局。初始位置按文件夹分扇区，之后用弹簧 + 斥力 + 向心力迭代。
import type { LinkType } from './types';

export interface SimNode {
  id: string;
  kind: 'theme' | 'point' | 'tag';
  group: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}
export interface SimLink { a: number; b: number; type: LinkType; weight: number }

const REST: Record<LinkType, number> = { hierarchy: 85, wikilink: 190, tag: 140, keyword: 220, topic: 150 };
const STRENGTH: Record<LinkType, number> = { hierarchy: 0.09, wikilink: 0.03, tag: 0.04, keyword: 0.012, topic: 0.05 };

/** 字符串 → 0~1 的稳定小数，让初始位置可重复 */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export function initPositions<T extends SimNode>(nodes: T[]): void {
  const groups = [...new Set(nodes.map((n) => n.group))].sort();
  groups.forEach((g, gi) => {
    const base = (gi / groups.length) * Math.PI * 2;
    const span = (Math.PI * 2) / groups.length;
    for (const n of nodes) {
      if (n.group !== g) continue;
      const a = base + hash01(n.id + 'a') * span;
      const r = (n.kind === 'theme' ? 120 : n.kind === 'tag' ? 260 : 190) + hash01(n.id + 'r') * 140;
      n.x = Math.cos(a) * r;
      n.y = Math.sin(a) * r;
      n.vx = 0;
      n.vy = 0;
    }
  });
}

/** 迭代一步，返回平均速度（越小越稳定） */
export function stepLayout(nodes: SimNode[], links: SimLink[], alpha: number): number {
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 360000) continue;
      if (d2 < 0.01) { dx = hash01(a.id + b.id) - 0.5; dy = hash01(b.id + a.id) - 0.5; d2 = dx * dx + dy * dy + 0.01; }
      const f = (3200 / d2) * alpha;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
      if (!b.fixed) { b.vx += fx; b.vy += fy; }
    }
  }
  for (const l of links) {
    const a = nodes[l.a], b = nodes[l.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = (d - REST[l.type]) * STRENGTH[l.type] * Math.min(1.5, 0.7 + l.weight * 0.3) * alpha;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    if (!a.fixed) { a.vx += fx; a.vy += fy; }
    if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
  }
  let sum = 0;
  for (const p of nodes) {
    if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
    p.vx -= p.x * 0.0018 * alpha;
    p.vy -= p.y * 0.011 * alpha;
    p.vx *= 0.82;
    p.vy *= 0.82;
    p.x += p.vx;
    p.y += p.vy;
    sum += Math.hypot(p.vx, p.vy);
  }
  return n ? sum / n : 0;
}

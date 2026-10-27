// 画布绘制：屏幕预览与导出 PNG 共用同一套代码。节点位置、半径一律经 view.ts 的函数换算，与命中检测一致。
import type { SimNode } from './layout';
import type { GNode, LinkType } from './types';
import { screenRadius, worldToScreen, type HitNode, type View } from './view';

export interface RNode extends SimNode, HitNode {
  g: GNode;
  color: string;
  match: boolean;
  /** 悬停动画目标 */
  target: number;
}
export interface RLink { a: number; b: number; type: LinkType; weight: number; visible: boolean }

export interface Scene {
  nodes: RNode[];
  links: RLink[];
  view: View;
  hover: RNode | null;
  selected: RNode | null;
  /** 悬停或选中节点的相邻节点序号 */
  neighbors: Set<number>;
  searching: boolean;
  /** 导出时为 true：不画悬停效果，标签更全 */
  exporting?: boolean;
  caption?: string;
}

const PALETTE = ['#5aa9ff', '#ff8a5c', '#6fd6a0', '#c58bff', '#ffd166', '#ff6f91', '#4dd0e1', '#a3c76d'];
export const TAG_COLOR = '#9aa7c2';
export const AI_COLOR = '#ffd166';
export const colorOf = (group: string, groups: string[]) => (group === '标签' ? TAG_COLOR : group === '主题' ? AI_COLOR : PALETTE[Math.max(0, groups.indexOf(group)) % PALETTE.length]);

const LINK_STYLE: Record<LinkType, { color: string; width: number; dash?: number[] }> = {
  hierarchy: { color: 'rgba(160,178,210,0.40)', width: 1.2 },
  wikilink: { color: 'rgba(255,209,102,0.60)', width: 1.8 },
  tag: { color: 'rgba(154,167,194,0.28)', width: 1, dash: [3, 4] },
  keyword: { color: 'rgba(111,214,160,0.40)', width: 1.2, dash: [6, 4] },
  topic: { color: 'rgba(255,209,102,0.45)', width: 1.4, dash: [2, 3] },
};
export const LINK_COLOR = (t: LinkType) => LINK_STYLE[t].color.replace(/0\.\d+\)$/, '1)');

export const nodeRadius = (g: GNode) => (g.kind === 'theme' ? 11 + g.weight * 1.4 : g.kind === 'tag' ? 5 + g.weight * 0.8 : 4 + g.weight * 1.1);

function background(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0a1020');
  bg.addColorStop(1, '#171a35');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // 背景小星点：位置由序号决定，不随机，截图可重复
  for (let i = 0; i < 70; i++) {
    const x = ((i * 977) % 1000) / 1000 * w;
    const y = ((i * 613 + 211) % 1000) / 1000 * h;
    ctx.globalAlpha = 0.15 + ((i * 7) % 5) * 0.06;
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + ((i * 3) % 4) * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, bold: boolean, alpha: number) {
  ctx.font = `${bold ? 700 : 500} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const t = text.length > 12 ? text.slice(0, 11) + '…' : text;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8,12,28,0.85)';
  ctx.strokeText(t, x, y);
  ctx.fillStyle = '#eef3ff';
  ctx.fillText(t, x, y);
  ctx.globalAlpha = 1;
}

/** 在 (w × h) 的布局像素范围内画整幅星图；调用前由调用方设置好 dpr 变换 */
export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: Scene): number {
  background(ctx, w, h);
  const focus = s.exporting ? null : s.hover ?? s.selected;
  const focusIdx = focus ? s.nodes.indexOf(focus) : -1;

  for (const l of s.links) {
    if (!l.visible) continue;
    const a = s.nodes[l.a], b = s.nodes[l.b];
    const pa = worldToScreen(s.view, a.x, a.y), pb = worldToScreen(s.view, b.x, b.y);
    const active = focusIdx >= 0 && (l.a === focusIdx || l.b === focusIdx);
    const st = LINK_STYLE[l.type];
    const dim = (focusIdx >= 0 && !active) || (s.searching && !(a.match && b.match));
    ctx.setLineDash(active ? [] : st.dash ?? []);
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.85)' : st.color;
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.lineWidth = active ? st.width + 1 : st.width;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // 先画普通节点，再画高亮节点，让被强调的圆盖在上面
  let drawn = 0;
  const order = s.nodes.map((_, i) => i).filter((i) => !s.nodes[i].hidden);
  const rank = (i: number) => (s.nodes[i] === focus ? 3 : s.nodes[i] === s.selected ? 2 : s.neighbors.has(i) || s.nodes[i].match ? 1 : 0);
  order.sort((x, y) => rank(x) - rank(y));
  for (const i of order) {
    const n = s.nodes[i];
    const p = worldToScreen(s.view, n.x, n.y);
    if (p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) continue;
    const r = screenRadius(n, s.view.scale);
    const emphasized = n === focus || n === s.selected || s.neighbors.has(i) || n.match;
    const dim = (s.searching && !n.match && n !== s.selected) || (focusIdx >= 0 && !emphasized);
    ctx.globalAlpha = dim ? 0.28 : 1;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    glow.addColorStop(0, n.color + 'aa');
    glow.addColorStop(1, n.color + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = n === focus || n === s.selected ? 2.5 : n.g.kind === 'theme' ? 1.6 : 1;
    ctx.strokeStyle = n === focus || n === s.selected ? '#ffffff' : 'rgba(255,255,255,0.55)';
    ctx.stroke();
    const showLabel = s.exporting ? n.g.kind !== 'point' || s.view.scale > 0.5 : n.g.kind !== 'point' || s.view.scale >= 0.85 || emphasized;
    if (showLabel) label(ctx, n.g.label, p.x, p.y + r + 5, n.g.kind === 'theme' ? 13 : 11.5, n.g.kind === 'theme' || n === focus, dim ? 0.4 : 1);
    ctx.globalAlpha = 1;
    drawn++;
  }
  if (s.caption) {
    ctx.font = '500 12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(207,224,255,0.7)';
    ctx.fillText(s.caption, w - 14, h - 10);
  }
  return drawn;
}

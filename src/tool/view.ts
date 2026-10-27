// 纯函数：画布坐标换算与命中检测。
// 原则：鼠标事件坐标 → 画布「布局像素」(CSS px) → 世界坐标，全程只用一套换算；
// 绘制时用同一个 View 把世界坐标换回布局像素，所以星点圆心与鼠标位置在数学上重合。
// 换算考虑：画布在页面里的位置、页面或祖先元素的缩放（getBoundingClientRect 与布局尺寸不一致）、
// devicePixelRatio（只影响画布内部像素，用实际像素比设置变换）、平移与缩放。

export interface View { tx: number; ty: number; scale: number }
export interface Pt { x: number; y: number }
export interface Rect { left: number; top: number; width: number; height: number }

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export const worldToScreen = (v: View, x: number, y: number): Pt => ({ x: x * v.scale + v.tx, y: y * v.scale + v.ty });
export const screenToWorld = (v: View, x: number, y: number): Pt => ({ x: (x - v.tx) / v.scale, y: (y - v.ty) / v.scale });

/**
 * 鼠标 clientX/Y → 画布布局像素。
 * rect 是 getBoundingClientRect()，layoutW/H 是 clientWidth/clientHeight（不受 CSS transform 影响）；
 * 二者不等说明页面被缩放，要按比例换回来。
 */
export function clientToCanvas(clientX: number, clientY: number, rect: Rect, layoutW: number, layoutH: number): Pt {
  const kx = rect.width > 0 ? layoutW / rect.width : 1;
  const ky = rect.height > 0 ? layoutH / rect.height : 1;
  return { x: (clientX - rect.left) * kx, y: (clientY - rect.top) * ky };
}

/** 反过来：布局像素 → clientX/Y（测试与调试用） */
export function canvasToClient(x: number, y: number, rect: Rect, layoutW: number, layoutH: number): Pt {
  return { x: rect.left + (x * rect.width) / layoutW, y: rect.top + (y * rect.height) / layoutH };
}

/** 画布内部像素尺寸与绘制变换。像素比取实际的整数像素尺寸 / 布局尺寸，避免取整带来亚像素偏移 */
export function backingStore(cssW: number, cssH: number, dpr: number, maxDpr = 3) {
  const d = Math.min(Math.max(dpr || 1, 1), maxDpr);
  const pxW = Math.max(1, Math.round(cssW * d));
  const pxH = Math.max(1, Math.round(cssH * d));
  return { pxW, pxH, kx: pxW / Math.max(cssW, 1), ky: pxH / Math.max(cssH, 1) };
}

/** 以屏幕点 (sx, sy) 为中心缩放，该点下的世界坐标保持不动 */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const k = scale / v.scale;
  return { scale, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
}

export function fitView(points: Pt[], w: number, h: number, pad = 60): View {
  if (!points.length || w <= 0 || h <= 0) return { tx: w / 2, ty: h / 2, scale: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
  const scale = Math.min(1.6, Math.max(MIN_SCALE, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
  return { scale, tx: w / 2 - ((x0 + x1) / 2) * scale, ty: h / 2 - ((y0 + y1) / 2) * scale };
}

export function centerOn(v: View, wx: number, wy: number, w: number, h: number): View {
  return { ...v, tx: w / 2 - wx * v.scale, ty: h / 2 - wy * v.scale };
}

export interface HitNode { id: string; x: number; y: number; r: number; hidden?: boolean; scale?: number }

/** 屏幕上的半径（布局像素）。绘制与命中都用这个函数，保证看到的圆就是点得到的圆 */
export const screenRadius = (n: { r: number; scale?: number }, viewScale: number) => n.r * Math.min(2, Math.max(0.6, viewScale)) * (n.scale ?? 1);

/** 找出鼠标下的节点：屏幕距离不超过「显示半径 + 容差」，多个重叠时取离圆心最近的 */
export function pickNode<T extends HitNode>(nodes: T[], v: View, sx: number, sy: number, slack = 4): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    if (n.hidden) continue;
    const p = worldToScreen(v, n.x, n.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= Math.max(8, screenRadius(n, v.scale)) + slack && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

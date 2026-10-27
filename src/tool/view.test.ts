// 命中检测与坐标换算：覆盖 devicePixelRatio、画布位置、页面缩放、视图平移与缩放。
// 这是「悬停时星点圆心与鼠标位置偏移」问题的回归测试。
import { describe, expect, it } from 'vitest';
import { backingStore, canvasToClient, centerOn, clientToCanvas, fitView, pickNode, screenRadius, screenToWorld, worldToScreen, zoomAt, type HitNode, type View } from './view';

const nodes = (): HitNode[] => [
  { id: 'a', x: 0, y: 0, r: 10 },
  { id: 'b', x: 100, y: 40, r: 6 },
  { id: 'c', x: 104, y: 40, r: 8 },
  { id: 'h', x: -80, y: -80, r: 10, hidden: true },
];

describe('坐标换算', () => {
  const v: View = { tx: 200, ty: 120, scale: 1.7 };
  it('世界 ↔ 屏幕互为逆运算', () => {
    const p = worldToScreen(v, 33.3, -41.7);
    const w = screenToWorld(v, p.x, p.y);
    expect(w.x).toBeCloseTo(33.3, 9);
    expect(w.y).toBeCloseTo(-41.7, 9);
  });
  it('clientToCanvas 扣掉画布位置', () => {
    expect(clientToCanvas(350, 260, { left: 50, top: 60, width: 800, height: 500 }, 800, 500)).toEqual({ x: 300, y: 200 });
  });
  it('页面被缩放时（rect 比布局尺寸小）按比例换回', () => {
    const p = clientToCanvas(50 + 400 * 0.8, 60 + 250 * 0.8, { left: 50, top: 60, width: 640, height: 400 }, 800, 500);
    expect(p.x).toBeCloseTo(400, 9);
    expect(p.y).toBeCloseTo(250, 9);
  });
  it('clientToCanvas 与 canvasToClient 互逆', () => {
    const rect = { left: 13.5, top: 77.25, width: 612.4, height: 301.1 };
    const c = canvasToClient(120.5, 44.25, rect, 800, 390);
    const back = clientToCanvas(c.x, c.y, rect, 800, 390);
    expect(back.x).toBeCloseTo(120.5, 9);
    expect(back.y).toBeCloseTo(44.25, 9);
  });
});

describe('画布内部像素', () => {
  it.each([1, 1.25, 1.5, 2, 3])('dpr=%s 时变换后的像素范围恰好铺满画布', (dpr) => {
    const css = { w: 801.5, h: 503.3 };
    const b = backingStore(css.w, css.h, dpr);
    expect(css.w * b.kx).toBeCloseTo(b.pxW, 9);
    expect(css.h * b.ky).toBeCloseTo(b.pxH, 9);
    expect(Math.abs(b.kx - dpr)).toBeLessThan(1 / css.w + 1e-9);
  });
  it('像素比限制在 1~3', () => {
    expect(backingStore(100, 100, 0.5).pxW).toBe(100);
    expect(backingStore(100, 100, 5).pxW).toBe(300);
  });
});

describe('命中检测', () => {
  const v: View = { tx: 300, ty: 200, scale: 1 };
  it('点在圆心上命中', () => {
    expect(pickNode(nodes(), v, 300, 200)?.id).toBe('a');
  });
  it('超出半径加容差不命中', () => {
    expect(pickNode(nodes(), v, 300 + 10 + 4 + 1, 200)).toBeNull();
    expect(pickNode(nodes(), v, 300 + 10 + 4 - 0.5, 200)?.id).toBe('a');
  });
  it('隐藏的节点点不到', () => {
    expect(pickNode(nodes(), v, 300 - 80, 200 - 80)).toBeNull();
  });
  it('重叠时取离圆心最近的', () => {
    expect(pickNode(nodes(), v, 300 + 100, 200 + 40)?.id).toBe('b');
    expect(pickNode(nodes(), v, 300 + 104, 200 + 40)?.id).toBe('c');
    expect(pickNode(nodes(), v, 300 + 102.5, 200 + 40)?.id).toBe('c');
  });
  it('悬停放大后的圆更大，命中范围随之变大', () => {
    const ns = nodes();
    ns[0].scale = 1.5;
    expect(screenRadius(ns[0], 1)).toBe(15);
    expect(pickNode(ns, v, 300 + 15 + 3, 200)?.id).toBe('a');
  });
  it('缩得很小的节点也有 8 像素的最小点击范围', () => {
    const tiny: HitNode[] = [{ id: 't', x: 0, y: 0, r: 2 }];
    expect(pickNode(tiny, { tx: 0, ty: 0, scale: 0.2 }, 9, 0)?.id).toBe('t');
  });
});

describe('端到端：星点圆心 → 画布像素 → 鼠标 client 坐标 → 命中，误差为 0', () => {
  const cases = [
    { name: '无缩放', dpr: 1, zoom: 1, page: 1, left: 0, top: 0, tx: 0, ty: 0 },
    { name: 'Retina', dpr: 2, zoom: 1, page: 1, left: 212.5, top: 88, tx: 40, ty: -30 },
    { name: 'Windows 125%', dpr: 1.25, zoom: 1.8, page: 1, left: 17.2, top: 63.8, tx: -120, ty: 75 },
    { name: '页面整体缩小 85%', dpr: 2, zoom: 0.6, page: 0.85, left: 99, top: 41, tx: 310, ty: 12 },
    { name: '页面放大 125% + 3 倍屏', dpr: 3, zoom: 2.4, page: 1.25, left: 5.5, top: 120.25, tx: -500, ty: -400 },
  ];
  it.each(cases)('$name', (c) => {
    const layoutW = 937, layoutH = 611;
    const rect = { left: c.left, top: c.top, width: layoutW * c.page, height: layoutH * c.page };
    const b = backingStore(layoutW, layoutH, c.dpr);
    const view: View = { tx: c.tx + layoutW / 2, ty: c.ty + layoutH / 2, scale: c.zoom };
    const ns: HitNode[] = [
      { id: 'n1', x: -40.3, y: 12.9, r: 9 },
      { id: 'n2', x: 22.8, y: -61.1, r: 7 },
      { id: 'n3', x: 3.1, y: 90.4, r: 12 },
    ];
    for (const n of ns) {
      const s = worldToScreen(view, n.x, n.y);
      const drawnPx = { x: s.x * b.kx, y: s.y * b.ky };
      const client = canvasToClient(drawnPx.x / b.kx, drawnPx.y / b.ky, rect, layoutW, layoutH);
      const back = clientToCanvas(client.x, client.y, rect, layoutW, layoutH);
      expect(back.x).toBeCloseTo(s.x, 6);
      expect(back.y).toBeCloseTo(s.y, 6);
      expect(pickNode(ns, view, back.x, back.y)?.id).toBe(n.id);
      const w = screenToWorld(view, back.x, back.y);
      expect(w.x).toBeCloseTo(n.x, 6);
      expect(w.y).toBeCloseTo(n.y, 6);
    }
  });
});

describe('缩放与适应窗口', () => {
  it('以光标为中心缩放：光标下的世界点不动', () => {
    const v: View = { tx: 10, ty: 20, scale: 1 };
    const before = screenToWorld(v, 400, 300);
    const z = zoomAt(v, 400, 300, 1.5);
    const after = screenToWorld(z, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(z.scale).toBeCloseTo(1.5, 9);
  });
  it('缩放有上下限', () => {
    expect(zoomAt({ tx: 0, ty: 0, scale: 3.9 }, 0, 0, 10).scale).toBe(4);
    expect(zoomAt({ tx: 0, ty: 0, scale: 0.25 }, 0, 0, 0.01).scale).toBe(0.2);
  });
  it('fitView 把所有点放进画布并居中', () => {
    const pts = [{ x: -500, y: -200 }, { x: 500, y: 200 }];
    const v = fitView(pts, 800, 600, 50);
    for (const p of pts) {
      const s = worldToScreen(v, p.x, p.y);
      expect(s.x).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(s.x).toBeLessThanOrEqual(750 + 1e-9);
    }
    const c = worldToScreen(v, 0, 0);
    expect(c.x).toBeCloseTo(400, 9);
    expect(c.y).toBeCloseTo(300, 9);
  });
  it('centerOn 让指定点落在画布中心', () => {
    const v = centerOn({ tx: 0, ty: 0, scale: 2 }, 30, -10, 800, 600);
    const s = worldToScreen(v, 30, -10);
    expect([s.x, s.y]).toEqual([400, 300]);
  });
  it('没有节点时 fitView 不出 NaN', () => {
    expect(fitView([], 800, 600)).toEqual({ tx: 400, ty: 300, scale: 1 });
  });
});

// 主界面：选文件夹 → 星图（搜索、筛选、点击看详情、导出 PNG）。没有选文件夹时显示示例笔记生成的星图。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, FolderOpen, LocateFixed, RefreshCw, Search, Sparkles, X, FileText, Square } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { expandPaths, pickFolder, reveal, settingsStore } from '../kit/platform';
import { llmReady, useSettings } from '../kit/settings';
import { applyAi, runAi } from './ai';
import { DEMO_NOTES } from './demo';
import { allFilters, type FilterState } from './filter';
import { scanFolder, type ScanIo } from './flow';
import { buildGraph } from './graph';
import { drawScene, LINK_COLOR, type Scene } from './render';
import { applyVisibility, buildScene, type SceneData } from './scene';
import { KIND_NAME, LINK_NAME, type Graph, type LinkType, type NodeKind, type ParsedNote } from './types';
import { stepLayout } from './layout';
import { backingStore, centerOn, clientToCanvas, fitView, pickNode, screenToWorld, zoomAt, type View } from './view';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
const LAST_KEY = 'notes-star-map.lastFolder';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Loaded { graph: Graph; notes: ParsedNote[]; source: 'demo' | string; skipped: number }

function demoLoaded(): Loaded {
  const { graph, notes } = buildGraph(DEMO_NOTES);
  return { graph, notes, source: 'demo', skipped: 0 };
}

const scanIo = (ctx: Ctx | undefined): ScanIo => ({
  list: async (folder, exts) => (await expandPaths([folder], exts)).map((i) => ({ path: i.path!, size: i.size })),
  readText: (p) => ctx!.readText(p),
});

/** 画布与交互状态放在 ref 里，每帧读取，不触发 React 重新渲染 */
interface Live {
  sc: SceneData | null;
  view: View;
  w: number;
  h: number;
  alpha: number;
  hover: number;
  selected: number;
  dirty: boolean;
  down: null | { x: number; y: number; node: number; moved: boolean; px: number; py: number };
  searching: boolean;
}

export function Main({ ctx }: { ctx?: Ctx }) {
  const [loaded, setLoaded] = useState<Loaded>(demoLoaded);
  const [filters, setFilters] = useState<FilterState>(allFilters);
  const [selected, setSelected] = useState<number>(-1);
  const [status, setStatus] = useState<{ kind: 'info' | 'err' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [aiProg, setAiProg] = useState<string>('');
  const [lastFolder, setLastFolder] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const settings = useSettings();
  const aiAbort = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ sc: null, view: { tx: 0, ty: 0, scale: 1 }, w: 0, h: 0, alpha: 0.12, hover: -1, selected: -1, dirty: true, down: null, searching: false });
  const matchCursor = useRef(0);

  const graph = loaded.graph;
  const sc = useMemo(() => buildScene(graph), [graph]);

  // 场景换了：重置视图
  useEffect(() => {
    const L = live.current;
    L.sc = sc;
    L.hover = -1;
    L.selected = -1;
    L.alpha = 0.12;
    L.view = fitView(sc.nodes, L.w || 900, L.h || 560);
    L.dirty = true;
    setSelected(-1);
  }, [sc]);

  // 筛选 / 搜索
  useEffect(() => {
    const r = applyVisibility(sc, graph, filters);
    live.current.searching = r.matches != null;
    live.current.dirty = true;
    setMatchCount(r.matches);
    matchCursor.current = 0;
  }, [sc, graph, filters]);

  useEffect(() => {
    void (async () => {
      try {
        const v = await (await settingsStore()).get<string>(LAST_KEY);
        if (v) setLastFolder(v);
      } catch { /* 预览页没有设置文件 */ }
    })();
  }, []);

  const select = useCallback((i: number, center = false) => {
    const L = live.current;
    L.selected = i;
    if (center && i >= 0 && L.sc) {
      const n = L.sc.nodes[i];
      L.view = centerOn(L.view, n.x, n.y, L.w, L.h);
    }
    L.dirty = true;
    setSelected(i);
  }, []);

  // 画布尺寸、绘制循环
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const g = canvas.getContext('2d')!;
    const L = live.current;
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const first = !L.w;
      const b = backingStore(w, h, window.devicePixelRatio);
      canvas.width = b.pxW;
      canvas.height = b.pxH;
      L.w = w;
      L.h = h;
      if (first && L.sc) L.view = fitView(L.sc.nodes, w, h);
      L.dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    window.addEventListener('resize', resize);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const s = L.sc;
      if (!s || !L.w) return;
      let moving = false;
      if (L.alpha > 0.015) {
        stepLayout(s.nodes, s.sim, L.alpha);
        L.alpha *= 0.992;
        moving = true;
      }
      const nb = new Set<number>();
      const focus = L.hover >= 0 ? L.hover : -1;
      if (focus >= 0) s.adj[focus].forEach((j) => nb.add(j));
      else if (L.selected >= 0) s.adj[L.selected].forEach((j) => nb.add(j));
      s.nodes.forEach((n, i) => {
        n.target = i === focus ? 1.55 : nb.has(i) && focus >= 0 ? 1.22 : i === L.selected ? 1.25 : 1;
        const d = n.target - (n.scale ?? 1);
        if (Math.abs(d) > 0.004) { n.scale = (n.scale ?? 1) + d * 0.3; moving = true; }
        else n.scale = n.target;
      });
      if (!moving && !L.dirty) return;
      L.dirty = false;
      const b = backingStore(L.w, L.h, window.devicePixelRatio);
      g.setTransform(b.kx, 0, 0, b.ky, 0, 0);
      const scene: Scene = {
        nodes: s.nodes, links: s.links, view: L.view, hover: focus >= 0 ? s.nodes[focus] : null,
        selected: L.selected >= 0 ? s.nodes[L.selected] : null, neighbors: nb, searching: L.searching,
      };
      drawScene(g, L.w, L.h, scene);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', resize); };
  }, []);

  // 仅开发调试：浏览器自动化用它读取节点的屏幕位置与当前悬停
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __smDebug?: () => unknown }).__smDebug = () => {
      const L = live.current;
      return { hover: L.hover >= 0 ? L.sc?.nodes[L.hover].g.label : null, nodes: L.sc?.nodes.map((n) => ({ label: n.g.label, x: n.x * L.view.scale + L.view.tx, y: n.y * L.view.scale + L.view.ty, hidden: n.hidden })) };
    };
  }, []);

  // ---- 指针：所有坐标都经 clientToCanvas，再用 view 换算 ----
  const local = (e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!;
    return clientToCanvas(e.clientX, e.clientY, c.getBoundingClientRect(), c.clientWidth, c.clientHeight);
  };
  const pick = (x: number, y: number) => {
    const L = live.current;
    if (!L.sc) return -1;
    const n = pickNode(L.sc.nodes, L.view, x, y);
    return n ? L.sc.nodes.indexOf(n) : -1;
  };
  const onDown = (e: React.PointerEvent) => {
    const L = live.current;
    const p = local(e);
    L.down = { x: p.x, y: p.y, node: pick(p.x, p.y), moved: false, px: p.x, py: p.y };
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const L = live.current;
    const p = local(e);
    const d = L.down;
    if (!d) {
      const h = pick(p.x, p.y);
      if (h !== L.hover) { L.hover = h; L.dirty = true; canvasRef.current!.style.cursor = h >= 0 ? 'pointer' : 'grab'; }
      return;
    }
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.node >= 0 && L.sc) {
      const n = L.sc.nodes[d.node];
      const w = screenToWorld(L.view, p.x, p.y);
      n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0; n.fixed = true;
      L.alpha = Math.max(L.alpha, 0.25);
    } else {
      L.view = { ...L.view, tx: L.view.tx + (p.x - d.px), ty: L.view.ty + (p.y - d.py) };
      canvasRef.current!.style.cursor = 'grabbing';
    }
    d.px = p.x; d.py = p.y;
    L.dirty = true;
  };
  const onUp = (e: React.PointerEvent) => {
    const L = live.current;
    const d = L.down;
    L.down = null;
    canvasRef.current!.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.node >= 0 && L.sc) L.sc.nodes[d.node].fixed = false;
    if (!d.moved && d.node >= 0) select(d.node);
    canvasRef.current!.style.cursor = L.hover >= 0 ? 'pointer' : 'grab';
  };
  const onLeave = () => { const L = live.current; if (!L.down) { L.hover = -1; L.dirty = true; } };

  useEffect(() => {
    const c = canvasRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const L = live.current;
      const p = local(e);
      L.view = zoomAt(L.view, p.x, p.y, Math.exp(-e.deltaY * 0.0015));
      L.dirty = true;
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') select(-1); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [select]);

  const fit = () => {
    const L = live.current;
    if (L.sc) { L.view = fitView(L.sc.nodes.filter((n) => !n.hidden), L.w, L.h); L.dirty = true; }
  };
  const relayout = () => {
    const L = live.current;
    L.sc?.nodes.forEach((n) => { n.x += (Math.random() - 0.5) * 60; n.y += (Math.random() - 0.5) * 60; });
    L.alpha = 0.8;
  };

  // ---- 读取文件夹 ----
  const load = async (folder: string) => {
    if (!ctx) return;
    setBusy(true);
    setStatus({ kind: 'info', text: '正在读取笔记…' });
    try {
      const r = await scanFolder(scanIo(ctx), folder, (d, t) => setStatus({ kind: 'info', text: `正在读取笔记 ${d}/${t}` }));
      let graph = r.graph;
      let msg = `读取了 ${r.notes.length} 篇笔记`;
      if (r.skipped.length) msg += `，跳过 ${r.skipped.length} 个（${r.skipped.slice(0, 2).map((s) => s.reason).join('；')}）`;
      if (aiOn && llmReady(settings.llm)) {
        aiAbort.current = new AbortController();
        const ai = await runAi(r.notes, ctx.llm, {
          signal: aiAbort.current.signal,
          onProgress: (d, t) => setAiProg(`AI 提炼主题 ${d}/${t}`),
        });
        setAiProg('');
        graph = applyAi(graph, ai.results);
        msg += `；AI 提炼了 ${ai.results.size} 篇` + (ai.failed ? `，${ai.failed} 篇失败（已用本地规则）` : '') + (ai.skipped ? `，另有 ${ai.skipped} 篇超出上限未提炼` : '');
      }
      setLoaded({ graph, notes: r.notes, source: folder, skipped: r.skipped.length });
      setFilters(allFilters());
      setStatus({ kind: 'ok', text: msg });
      setLastFolder(folder);
      try { await (await settingsStore()).set(LAST_KEY, folder); } catch { /* 忽略 */ }
    } catch (e) {
      setStatus({ kind: 'err', text: errText(e) });
    } finally {
      setBusy(false);
      setAiProg('');
    }
  };
  const choose = async () => {
    const f = await pickFolder();
    if (f) await load(f);
  };

  // ---- 导出 PNG ----
  const exportPng = async () => {
    const L = live.current;
    if (!L.sc || !ctx) return;
    try {
      const W = 1600, H = 1000;
      const c = document.createElement('canvas');
      c.width = W * 2; c.height = H * 2;
      const g = c.getContext('2d')!;
      g.setTransform(2, 0, 0, 2, 0, 0);
      const visible = L.sc.nodes.filter((n) => !n.hidden);
      drawScene(g, W, H, {
        nodes: L.sc.nodes, links: L.sc.links, view: fitView(visible, W, H, 90), hover: null, selected: null,
        neighbors: new Set(), searching: L.searching, exporting: true,
        caption: loaded.source === 'demo' ? '笔记知识星图 · 示例数据 · 篝火出品' : '笔记知识星图 · 篝火出品',
      });
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
      if (!blob) throw new Error('生成图片失败，节点太多时可以先用筛选缩小范围');
      const path = await save({ defaultPath: '笔记知识星图.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
      if (!path) return;
      await ctx.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      setStatus({ kind: 'ok', text: `已导出：${path}` });
    } catch (e) {
      setStatus({ kind: 'err', text: '导出失败：' + errText(e) });
    }
  };

  // ---- 搜索 ----
  const jumpMatch = () => {
    const L = live.current;
    if (!L.sc || !filters.query.trim()) return;
    const hits = L.sc.nodes.map((n, i) => (n.match && !n.hidden ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return;
    select(hits[matchCursor.current++ % hits.length], true);
  };

  const toggleSet = <T,>(s: Set<T>, v: T) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const sel = selected >= 0 ? sc.nodes[selected] : null;
  const st = graph.stats;
  const relatedOf = (i: number) => graph.links.map((l, k) => ({ l, k })).filter(({ k }) => sc.links[k].a === i || sc.links[k].b === i);

  return (
    <div className="sm-root">
      <div className="sm-bar">
        <button className="k-btn primary" onClick={choose} disabled={busy}><FolderOpen size={16} />选择笔记文件夹</button>
        {loaded.source !== 'demo' && <button className="k-btn" onClick={() => load(loaded.source)} disabled={busy} title="重新读取这个文件夹"><RefreshCw size={15} />重新扫描</button>}
        {loaded.source === 'demo' && lastFolder && <button className="k-btn" onClick={() => load(lastFolder)} disabled={busy} title={lastFolder}>打开上次的文件夹</button>}
        <label className="sm-search">
          <Search size={15} />
          <input className="k-input" placeholder="搜索标题、正文、标签（回车跳到下一个）" value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') jumpMatch(); }} />
          {matchCount != null && <span className="sm-count k-num">{matchCount} 个</span>}
        </label>
        <button className="k-btn" onClick={fit} title="把全部节点放进窗口"><LocateFixed size={15} />适应窗口</button>
        <button className="k-btn" onClick={relayout} title="打乱后重新排布">重新排布</button>
        <button className="k-btn" onClick={exportPng} disabled={busy}><Download size={15} />导出 PNG</button>
      </div>

      <div className="sm-ai">
        <label className={`sm-ai-toggle${aiOn ? ' on' : ''}`}>
          <input type="checkbox" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} />
          <Sparkles size={14} />用大模型提炼主题
        </label>
        <span className="k-muted sm-ai-hint">
          {aiOn
            ? llmReady(settings.llm)
              ? '下次读取文件夹时，会把每篇笔记的前 2500 字发送给你在「设置」里填写的模型接口；失败的笔记自动用本地规则。'
              : '还没设置大模型：到「设置」填写接口地址、密钥和模型名后才会生效，现在仍用本地规则。'
            : '不开启时完全在本机用规则解析，不联网。'}
        </span>
        {aiProg && <><span className="sm-ai-prog">{aiProg}</span><button className="k-btn ghost" onClick={() => aiAbort.current?.abort()}><Square size={12} />停止</button></>}
      </div>

      <div className="sm-filters" aria-label="筛选">
        <span className="sm-fl">节点</span>
        {(['theme', 'point', 'tag'] as NodeKind[]).map((k) => (
          <button key={k} className={`k-chip${filters.kinds.has(k) ? ' on' : ''}`} onClick={() => setFilters((f) => ({ ...f, kinds: toggleSet(f.kinds, k) }))}>{KIND_NAME[k]}</button>
        ))}
        <span className="sm-fl">连接</span>
        {(Object.keys(LINK_NAME) as LinkType[]).filter((t) => t !== 'topic' || st.byType.topic > 0).map((t) => (
          <button key={t} className={`k-chip${filters.linkTypes.has(t) ? ' on' : ''}`} onClick={() => setFilters((f) => ({ ...f, linkTypes: toggleSet(f.linkTypes, t) }))}>
            <i className="sm-dot" style={{ background: LINK_COLOR(t) }} />{LINK_NAME[t]}<span className="k-num sm-n">{st.byType[t]}</span>
          </button>
        ))}
        {sc.groups.length > 1 && <>
          <span className="sm-fl">文件夹</span>
          {sc.groups.map((g) => (
            <button key={g} className={`k-chip${!filters.groups.size || filters.groups.has(g) ? ' on' : ''}`} onClick={() => setFilters((f) => ({ ...f, groups: toggleSet(f.groups, g) }))}>
              <i className="sm-dot" style={{ background: sc.nodes.find((n) => n.group === g)?.color }} />{g}
            </button>
          ))}
          {filters.groups.size > 0 && <button className="k-link" onClick={() => setFilters((f) => ({ ...f, groups: new Set() }))}>显示全部</button>}
        </>}
      </div>

      {status && <div className={`sm-status ${status.kind}`} role="status">{status.text}</div>}

      <div className="sm-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="sm-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} aria-label="知识星图，可拖动、缩放、点击节点查看详情" />
        <div className="sm-badge">
          {loaded.source === 'demo' && <b className="sm-demo">示例数据 · 虚构的咖啡馆笔记</b>}
          <span className="k-num">{st.files} 篇笔记 · {st.nodes} 个节点 · {st.links} 条连接</span>
          {st.unresolved > 0 && <span>{st.unresolved} 个双链找不到对应笔记</span>}
        </div>
        <div className="sm-hint">滚轮缩放 · 拖空白处平移 · 拖星点移动 · 点击查看详情 · Esc 关闭</div>
        {sel && (
          <div className="sm-modal" onPointerDown={(e) => { if (e.target === e.currentTarget) select(-1); }}>
            <section className="sm-card" role="dialog" aria-label={sel.g.label}>
              <button className="k-icon-btn sm-x" onClick={() => select(-1)} aria-label="关闭"><X size={18} /></button>
              <div className="sm-meta"><i className="sm-dot" style={{ background: sel.color }} />{sel.g.ai ? 'AI 主题' : KIND_NAME[sel.g.kind]}{sel.g.kind !== 'tag' && !sel.g.ai ? ` · ${sel.g.group}` : ''}</div>
              <h3>{sel.g.label}</h3>
              <p className="sm-sum">{sel.g.summary}</p>
              {sel.g.keywords.length > 0 && <div className="sm-kws">{sel.g.keywords.map((k) => <button key={k} className="k-chip" onClick={() => { setFilters((f) => ({ ...f, query: k })); select(-1); }}>{k}</button>)}</div>}
              {sel.g.sources.length > 0 && <>
                <h4>出处</h4>
                <ul className="sm-src">
                  {sel.g.sources.map((s, i) => (
                    <li key={i}>
                      <div className="sm-src-hd"><FileText size={14} /><b>{s.file}</b><span className="k-muted k-num">第 {s.line} 行</span>
                        {s.abs && <button className="k-link" onClick={() => reveal(s.abs!)}>在文件夹中显示</button>}</div>
                      <blockquote>{s.snippet}</blockquote>
                    </li>
                  ))}
                </ul>
              </>}
              <h4>相邻节点</h4>
              <ul className="sm-nb">
                {relatedOf(selected).slice(0, 14).map(({ l, k }) => {
                  const lk = sc.links[k];
                  const other = lk.a === selected ? lk.b : lk.a;
                  return (
                    <li key={k}>
                      <button className="k-link" onClick={() => select(other, true)}>{sc.nodes[other].g.label}</button>
                      <span className="k-muted">{LINK_NAME[l.type]}{l.reason ? ` · ${l.reason}` : ''}</span>
                    </li>
                  );
                })}
                {relatedOf(selected).length === 0 && <li className="k-muted">没有连接</li>}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

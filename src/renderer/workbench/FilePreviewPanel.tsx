import { useEffect, useRef, useState } from 'react';
import type { DraftScope } from '../../shared/contracts/drafts';
import type { FilePreview, FilePreviewSource, ImagePreview } from '../../shared/contracts/file-preview';
import type { Spreadsheet } from '../../shared/contracts/spreadsheet';
import type { OfficeDocument } from '../../shared/contracts/document';
import type { PdfDocument } from '../../shared/contracts/pdf';
import { SpreadsheetView } from './SpreadsheetView';
import { PdfView } from './PdfView';

interface PreviewTab { key: string; scopeKey: string; source: FilePreviewSource; name: string; trigger: HTMLButtonElement }
const scopeKey = (scope: DraftScope) => JSON.stringify([scope.projectId, scope.taskId]);
export function useFilePreviews(scope: DraftScope) {
  const currentScope = scopeKey(scope);
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activeKeys, setActiveKeys] = useState<Record<string, string | null>>({});
  const visibleTabs = tabs.filter(tab => tab.scopeKey === currentScope);
  const active = visibleTabs.find(tab => tab.key === activeKeys[currentScope]);
  const select = (key: string | null) => setActiveKeys(previous => ({ ...previous, [currentScope]: key }));
  return { tabs: visibleTabs, active, select, hide: () => select(null),
    open(source: FilePreviewSource, name: string, trigger: HTMLButtonElement) {
      const key = tabs.find(tab => tab.scopeKey === currentScope && JSON.stringify(tab.source) === JSON.stringify(source))?.key ?? crypto.randomUUID();
      setTabs(previous => previous.some(tab => tab.key === key) ? previous.map(tab => tab.key === key ? { ...tab, trigger } : tab)
        : [...previous, { key, scopeKey: currentScope, source, name, trigger }]);
      select(key);
    },
    close(key?: string) {
      if (key) {
        const index = visibleTabs.findIndex(tab => tab.key === key);
        setTabs(previous => previous.filter(tab => tab.key !== key));
        if (active?.key !== key) return;
        const next = visibleTabs[index - 1] ?? visibleTabs[index + 1];
        if (next) { select(next.key); return; }
      }
      select(null);
      if (active?.trigger.isConnected) active.trigger.focus();
    },
    moveToTask(taskId: string) {
      const nextScope = { ...scope, taskId }, nextScopeKey = scopeKey(nextScope);
      // 首发确已创建任务后，原草稿授权转入该任务，已打开的材料视图随之迁移。
      setTabs(previous => previous.map(tab => tab.scopeKey === currentScope ? { ...tab, scopeKey: nextScopeKey,
        source: tab.source.kind === 'material' ? { ...tab.source, scope: nextScope } : tab.source } : tab));
      setActiveKeys(previous => ({ ...previous, [nextScopeKey]: previous[currentScope] ?? null, [currentScope]: null }));
    },
  };
}

interface PreviewCache { value?: FilePreview; text: string | null; spreadsheet?: Spreadsheet; document?: OfficeDocument; pdf?: PdfDocument; pdfData?: string; image?: ImagePreview; imageError?: string; imageLoading?: boolean; page?: number; sheet?: string; zoom: number; scroll: number; loading: boolean; error: string; action: string; actionBusy: boolean }
export function FilePreviewPanel({ tabs, active, visible, running, select, close }: ReturnType<typeof useFilePreviews> & { visible: boolean; running: boolean }) {
  const cache = useRef(new Map<string, PreviewCache>()), sequence = useRef(0);
  const [revision, redraw] = useState(0), [expanded, setExpanded] = useState(false), [width, setWidth] = useState(440);
  const content = useRef<HTMLDivElement>(null), tabList = useRef<HTMLDivElement>(null);
  function entry(key: string) {
    if (!cache.current.has(key)) cache.current.set(key, { text: null, zoom: 100, scroll: 0, loading: false, error: '', action: '', actionBusy: false });
    return cache.current.get(key)!;
  }
  async function load() {
    if (!active || !visible) return;
    const current = ++sequence.current, target = entry(active.key);
    target.loading = true; target.error = ''; redraw(previous => previous + 1);
    try {
      const value = await window.agentx.readFilePreview(active.source);
      if (JSON.stringify(value.source) !== JSON.stringify(active.source)) throw new Error('文件预览归属不匹配');
      if (current !== sequence.current) return;
      target.value = value;
      if (value.status === 'ready' && value.text !== null) target.text = value.text;
      if (value.status === 'ready' && value.spreadsheet) target.spreadsheet = value.spreadsheet;
      if (value.status === 'ready' && value.document) target.document = value.document;
      if (value.status === 'ready' && value.pdf && value.pdfData) { target.pdf = value.pdf; target.pdfData = value.pdfData; }
      if (value.status === 'ready' && value.image && target.image?.data !== value.image.data) {
        target.image = value.image; target.imageLoading = true; target.imageError = '';
      }
    } catch (cause) { if (current === sequence.current) target.error = cause instanceof Error ? cause.message : '预览读取失败'; }
    finally { if (current === sequence.current) { target.loading = false; redraw(previous => previous + 1); } }
  }
  useEffect(() => {
    if (!active || !visible) return;
    void load();
    const refresh = () => { if (!document.hidden && !entry(active.key).loading) void load(); };
    const timer = setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [active?.key, active?.source, visible]);
  useEffect(() => {
    if (active && visible) tabList.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
  }, [active?.key, visible]);
  useEffect(() => { if (active && content.current) content.current.scrollTop = entry(active.key).scroll; }, [active?.key, revision, visible]);
  if (!active) return null;
  const current = entry(active.key), value = current.value;
  const stale = (current.text !== null || !!current.spreadsheet || !!current.document || !!current.pdf || !!current.image) && (!!current.error || value?.status !== 'ready');
  async function fileAction(action: 'open' | 'reveal' | 'copy') {
    if (!active || current.actionBusy) return;
    current.actionBusy = true; current.action = ''; redraw(previous => previous + 1);
    try {
      if (action === 'copy') { if (!value) throw new Error('文件路径尚未核对'); await window.agentx.copyOutput(value.path); current.action = '路径已复制'; }
      else { await window.agentx.openFilePreview({ source: active.source, action }); current.action = action === 'open' ? '已向系统请求打开，请在本机应用检查' : '已向资源管理器请求定位'; }
    } catch (cause) { current.action = cause instanceof Error ? cause.message : '系统操作失败'; }
    finally { current.actionBusy = false; redraw(previous => previous + 1); }
  }
  const zoom = (amount: number) => { current.zoom = Math.max(80, Math.min(200, amount)); redraw(previous => previous + 1); };
  return <section className={`results-panel file-preview-panel${expanded ? ' results-expanded' : ''}`} aria-label="只读文件预览" style={{ width }} hidden={!visible}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <header><h2>文件</h2><button className="icon-button" aria-label={expanded ? '还原文件预览' : '放大文件预览'} onClick={() => setExpanded(!expanded)}>{expanded ? '↙' : '↗'}</button>
      <button className="icon-button" aria-label="关闭文件预览" onClick={() => close()}>×</button></header>
    {!expanded && <div className="results-divider" role="separator" aria-label="调整文件预览宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={360} aria-valuemax={640} aria-valuenow={width}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.max(360, Math.min(640, innerWidth - event.clientX))); }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setWidth(previous => event.key === 'Home' ? 360 : event.key === 'End' ? 640 : Math.max(360, Math.min(640, previous + (event.key === 'ArrowLeft' ? 16 : -16))));
      }} />}
    <div className="preview-tabs" role="tablist" aria-label="已打开文件" ref={tabList}>{tabs.map(tab => <div key={tab.key} className="preview-tab" data-active={tab.key === active.key}>
      <button role="tab" aria-selected={tab.key === active.key} tabIndex={tab.key === active.key ? 0 : -1} aria-controls="preview-content" onClick={() => select(tab.key)}
        title={tab.source.kind === 'result' ? `${tab.name} · 结果 ${tab.source.resultId}` : tab.name}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault(); const index = tabs.indexOf(tab);
          select(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length].key);
        }}>{tab.name}{tab.source.kind === 'result' ? ` · ${tab.source.resultId.slice(0, 8)}` : ''}</button><button className="icon-button" aria-label={`关闭标签：${tab.name}${tab.source.kind === 'result' ? ` · ${tab.source.resultId.slice(0, 8)}` : ''}`} onClick={() => {
          close(tab.key);
          if (tab.key !== active.key) tabList.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
        }}>×</button>
    </div>)}</div>
    <div className="preview-toolbar"><button className="text-button" disabled={current.loading} onClick={() => void load()} aria-label="重新核验预览">↻ 核验</button>
      <button className="text-button" disabled={current.actionBusy || current.loading || current.imageLoading || !!current.error || !!current.imageError || value?.status !== 'ready'} onClick={() => void fileAction('open')}>本机打开</button>
      <button className="text-button" disabled={current.actionBusy || !value || value.status === 'missing'} onClick={() => void fileAction('reveal')}>定位</button>
      <button className="text-button" disabled={current.actionBusy || !value} onClick={() => void fileAction('copy')}>复制路径</button>
      <div className="preview-zoom"><button className="icon-button" aria-label="缩小文字" disabled={current.zoom === 80} onClick={() => zoom(current.zoom - 10)}>−</button>
        <button className="text-button" aria-label="还原文字缩放" onClick={() => zoom(100)}>{current.zoom}%</button>
        <button className="icon-button" aria-label="放大文字" disabled={current.zoom === 200} onClick={() => zoom(current.zoom + 10)}>+</button></div></div>
    <div className="preview-meta">
      <p className="muted">只读 · {active.name}</p>
      {value && <details><summary>文件来源与版本</summary><p>{value.path}</p><p>{value.turnId ? `${value.source.kind === 'result' ? '来源轮次' : '最近关联轮次'}：${value.turnId}` : '当前草稿材料，尚无已确认轮次'}<br />所属任务：{value.taskId ?? '当前草稿'}<br />SHA-256：{value.version?.sha256 ?? '无文本版本'}<br />核验时间：{new Date(value.observedAt).toLocaleString()}</p></details>}
      {running && <p role="note">任务仍在运行，文件可能继续变化。</p>}
      {active.source.kind === 'result' && (current.spreadsheet || current.document || current.pdf || current.image) && <p role="note">可读取不等于已验证业务结果；中断或失败轮次的文件可能仅是部分产物，请独立核对。</p>}
      {current.image && <p className="muted" role="note">仅本地预览 · {current.image.mime} · 原始尺寸 {current.image.width} × {current.image.height}；不代表模型已识图或可发送图片。</p>}
      {current.imageError && <p className="error-message" role="alert">{current.imageError}</p>}
      {current.imageLoading && <p className="muted" role="status">正在解码本地图片…</p>}
      {current.document?.messages.map((message, index) => <p className="muted" role="note" key={index}>{message}</p>)}
      {current.pdf?.messages.map((message, index) => <p className="muted" role="note" key={index}>{message}</p>)}
      {current.loading && <p className="muted" role="status">正在核验实际文件…</p>}
      {current.error && <p className="error-message" role="alert">{current.error}</p>}
      {!current.error && value && value.status !== 'ready' && <p className="error-message" role="alert">{value.message}</p>}
      {stale && <p role="note">保留上次成功读取的{current.spreadsheet ? '表格' : current.document ? '文档' : current.pdf ? ' PDF' : current.image ? '图片' : '文本'}，不代表当前文件；{active.source.kind === 'result' ? '请重新检查文件改动，再打开新版本。' : '请核对材料后重新打开。'}</p>}
      {current.action && <p role="status">{current.action}</p>}
    </div>
    <div id="preview-content" role="tabpanel" aria-label={active.name} className={`preview-content${current.spreadsheet ? ' preview-spreadsheet' : ''}`} tabIndex={0} ref={content}
      onScroll={event => { current.scroll = event.currentTarget.scrollTop; }}>
      {current.text !== null && <pre style={{ fontSize: `${14 * current.zoom / 100}px` }}>{current.text || '（空文本文件）'}</pre>}
      {current.document && <article className="document-paper" aria-label="DOCX 文本内容" style={{ fontSize: `${14 * current.zoom / 100}px` }}>
        {current.document.paragraphs.map((paragraph, index) => <p key={index}>{paragraph || '\u00a0'}</p>)}
      </article>}
      {current.spreadsheet && <SpreadsheetView key={active.key} value={current.spreadsheet} zoom={current.zoom} selectedSheet={current.sheet ?? ''}
        selectSheet={name => { current.sheet = name; redraw(previous => previous + 1); }} />}
      {visible && current.image && <img key={active.key} className="local-image-preview" alt={`本地图片：${active.name}`}
        src={`data:${current.image.mime};base64,${current.image.data}`} style={{ width: `${current.zoom}%` }}
        onLoad={() => { current.imageLoading = false; current.imageError = ''; redraw(previous => previous + 1); }}
        onError={() => { current.imageLoading = false; current.imageError = '图片解码失败，文件可能损坏；没有以空白图冒充成功，请定位原件核对。'; redraw(previous => previous + 1); }} />}
      {visible && current.pdf && current.pdfData && <PdfView key={active.key} value={current.pdf} data={current.pdfData} zoom={current.zoom} page={current.page ?? 1}
        selectPage={page => { current.page = page; redraw(previous => previous + 1); }} />}
    </div>
  </section>;
}

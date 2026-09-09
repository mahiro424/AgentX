import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfDocument } from '../../shared/contracts/pdf';

const base = new URL('pdfjs/', location.href).href;
GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', base).href;

function PdfCanvas({ document, page, scale, thumbnail = false }: { document: PDFDocumentProxy; page: number; scale: number; thumbnail?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!thumbnail), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!thumbnail || !container.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    observer.observe(container.current); return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false, render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true); setError(''); container.current?.replaceChildren();
    void (async () => {
      let pdfPage: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined;
      try {
        pdfPage = await document.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        if (viewport.width * viewport.height > 16 * 1024 * 1024 || viewport.width > 16384 || viewport.height > 16384) throw new Error('PDF 页面尺寸超限，请缩小后重试');
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('aria-label', `PDF 第 ${page} 页`); canvas.setAttribute('role', 'img');
        render = pdfPage.render({ canvas, viewport }); await render.promise;
        if (!cancelled) { container.current?.replaceChildren(canvas); setLoading(false); }
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : 'PDF 页面绘制失败'); setLoading(false); }
      } finally { pdfPage?.cleanup(); }
    })();
    return () => { cancelled = true; render?.cancel(); };
  }, [document, page, scale, visible]);
  return <div className={thumbnail ? 'pdf-thumbnail' : 'pdf-page'}>
    {loading && !thumbnail && <p role="status">正在绘制第 {page} 页…</p>}
    {error && <p className="error-message" role="alert">PDF 第 {page} 页：{error}</p>}
    <div ref={container} />
  </div>;
}

export function PdfView({ value, data, zoom, page, selectPage }: { value: PdfDocument; data: string; zoom: number; page: number; selectPage: (page: number) => void }) {
  const [document, setDocument] = useState<PDFDocumentProxy>(), [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null), [availableWidth, setAvailableWidth] = useState(300);
  useEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(entries => setAvailableWidth(Math.max(80, entries[0].contentRect.width - 16)));
    observer.observe(scroll.current); return () => observer.disconnect();
  }, [document]);
  useEffect(() => {
    let cancelled = false;
    const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const loading = getDocument({ data: bytes, stopAtErrors: true, enableXfa: false,
      cMapUrl: new URL('cmaps/', base).href, cMapPacked: true, standardFontDataUrl: new URL('standard_fonts/', base).href,
      wasmUrl: new URL('wasm/', base).href, iccUrl: new URL('iccs/', base).href });
    setDocument(undefined); setError('');
    void loading.promise.then(document => { if (!cancelled) setDocument(document); }, cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 加载失败'); });
    return () => { cancelled = true; void loading.destroy().catch(cause => console.error('PDF 预览释放失败', cause)); };
  }, [data]);
  const current = Math.min(page, value.pages.length);
  return <section className="pdf-view" aria-label="PDF 只读页面">
    <div className="pdf-navigation">
      <button className="icon-button" aria-label="上一页 PDF" disabled={current <= 1} onClick={() => selectPage(current - 1)}>←</button>
      <span aria-live="polite">{current} / {value.pages.length} 页</span>
      <button className="icon-button" aria-label="下一页 PDF" disabled={current >= value.pages.length} onClick={() => selectPage(current + 1)}>→</button>
    </div>
    {error && <p role="alert" className="error-message">PDF 页面无法显示：{error}</p>}
    {!document && !error && <p role="status">正在加载 PDF 页面…</p>}
    {document && <div className="pdf-layout">
      <nav className="pdf-thumbnails" aria-label="PDF 页面缩略图">{value.pages.map(item => <button key={item.number} className="pdf-thumbnail-button" aria-label={`查看 PDF 第 ${item.number} 页`}
        aria-current={item.number === current ? 'page' : undefined} onClick={() => selectPage(item.number)}>
        <PdfCanvas document={document} page={item.number} scale={72 / item.width} thumbnail />
        <span>{item.number}</span>
      </button>)}</nav>
      <div className="pdf-page-scroll" ref={scroll}><PdfCanvas document={document} page={current} scale={Math.min(1, availableWidth / value.pages[current - 1].width) * zoom / 100} /></div>
    </div>}
  </section>;
}

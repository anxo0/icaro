import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import IconQuote from '~icons/solar/chat-square-arrow-linear';
import IconClose from '~icons/solar/close-circle-linear';
import { fmt, type AppStrings } from '@/i18n';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  t: AppStrings['preview'];
  name: string;
  data: ArrayBuffer;
  /** Página a la que saltar (cambia al pulsar una cita). */
  target: { page: number; nonce: number } | null;
  onMention: (text: string, page: number) => void;
  onClose: () => void;
}

interface Popover {
  x: number;
  y: number;
  text: string;
  page: number;
}

const PAGE_GAP = 12;
const PADDING = 16;

/**
 * Visor del PDF: pdf.js pinta cada página en un canvas cuando entra en pantalla y encima pone la
 * capa de texto para poder seleccionar. Seleccionar → «Mencionar» manda el texto al cuadro de pregunta.
 */
export function PdfViewer({ t, name, data, target, onMention, onClose }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const rendered = useRef(new Set<number>());
  const [pages, setPages] = useState<{ n: number; width: number; height: number }[]>([]);
  const [width, setWidth] = useState(0);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Abrir el documento (una copia: pdf.js se queda con el buffer).
  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: new Uint8Array(data.slice(0)), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true });
    task.promise
      .then(async (doc) => {
        if (cancelled) return;
        docRef.current = doc;
        const first = await doc.getPage(1);
        const v = first.getViewport({ scale: 1 });
        setPages(Array.from({ length: doc.numPages }, (_, i) => ({ n: i + 1, width: v.width, height: v.height })));
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
      rendered.current.clear();
      void task.destroy();
      docRef.current = null;
    };
  }, [data]);

  // Ancho disponible → escala. Con retardo: al plegar la barra el ancho cambia en cada fotograma.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.contentRect.width - PADDING * 2;
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const renderPage = useCallback(
    async (n: number, host: HTMLDivElement) => {
      const doc = docRef.current;
      if (!doc || rendered.current.has(n) || width <= 0) return;
      rendered.current.add(n);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvas, canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] }).promise;

      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      host.style.setProperty('--scale-factor', String(scale));
      host.replaceChildren(canvas, textDiv);
      host.style.height = `${viewport.height}px`;
      const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await layer.render();
    },
    [width],
  );

  // Se pinta lo que entra en pantalla (y un margen), no todo el documento.
  useEffect(() => {
    const root = scroller.current;
    const list = pagesRef.current;
    if (!root || !list || width <= 0 || pages.length === 0) return;
    rendered.current.clear();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const host = e.target as HTMLDivElement;
          void renderPage(Number(host.dataset.page), host);
        }
      },
      { root, rootMargin: '600px 0px' },
    );
    for (const host of list.querySelectorAll<HTMLDivElement>('[data-page]')) {
      host.replaceChildren();
      host.style.height = '';
      io.observe(host);
    }
    return () => io.disconnect();
  }, [pages, width, renderPage]);

  // Saltar a la página citada.
  useEffect(() => {
    if (!target) return;
    const host = pagesRef.current?.querySelector<HTMLDivElement>(`[data-page="${target.page}"]`);
    host?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    host?.classList.add('ring-2', 'ring-accent');
    const id = setTimeout(() => host?.classList.remove('ring-2', 'ring-accent'), 1600);
    return () => clearTimeout(id);
  }, [target, pages]);

  // Selección → botón «Mencionar» junto al texto (también con clic derecho).
  const showPopover = useCallback((clientX?: number, clientY?: number) => {
    const sel = window.getSelection();
    const root = scroller.current;
    if (!sel || sel.isCollapsed || !root) {
      setPopover(null);
      return false;
    }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const host = anchor?.closest<HTMLElement>('[data-page]');
    if (!text || !host || !root.contains(host)) {
      setPopover(null);
      return false;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const x = (clientX ?? rect.left + rect.width / 2) - box.left;
    const y = (clientY ?? rect.top) - box.top + root.scrollTop;
    setPopover({ x, y, text, page: Number(host.dataset.page) });
    return true;
  }, []);

  useEffect(() => {
    const hide = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPopover(null);
    };
    document.addEventListener('selectionchange', hide);
    return () => document.removeEventListener('selectionchange', hide);
  }, []);

  const mention = () => {
    if (!popover) return;
    onMention(popover.text, popover.page);
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hairline-b flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <p className="min-w-0 truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {pages.length > 0 && <span className="text-xs text-ink-3">{fmt(t.pages, { n: pages.length })}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            title={t.close}
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconClose className="size-5" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto bg-paper-2"
        style={{ padding: PADDING }}
        onMouseUp={() => showPopover()}
        onTouchEnd={() => setTimeout(() => showPopover(), 50)}
        onContextMenu={(e) => {
          if (showPopover(e.clientX, e.clientY)) e.preventDefault();
        }}
      >
        {error && <p className="text-sm text-bad">{error}</p>}
        <div ref={pagesRef} className="mx-auto" style={{ width: width > 0 ? width : undefined }}>
          {pages.map((p) => (
            <div
              key={p.n}
              data-page={p.n}
              className="pdf-page relative overflow-hidden rounded-md bg-white shadow-card"
              style={{ marginBottom: PAGE_GAP, aspectRatio: `${p.width} / ${p.height}` }}
            />
          ))}
        </div>

        {popover && (
          <div className="absolute z-10 -translate-x-1/2 -translate-y-full pb-2" style={{ left: popover.x, top: popover.y }}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={mention}
              className="settle inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper shadow-card transition-transform hover:scale-105"
            >
              <IconQuote className="size-3.5" />
              {t.mention} · {fmt(t.page, { n: popover.page })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

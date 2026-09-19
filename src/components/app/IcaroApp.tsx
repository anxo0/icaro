import { useEffect, useRef, useState } from 'react';
import IconUpload from '~icons/solar/file-send-linear';
import { fmt, type AppStrings, type Lang } from '@/i18n';
import { extractCitations } from '@/lib/prompt';
import type { Mention } from '@/lib/chats';
import type { Hit } from '@/lib/types';
import { Activity, type Step } from './Activity';
import { PdfViewer } from './PdfViewer';
import { PromptInput } from './PromptInput';
import { useIcaro, type Ingest, type Message, type ModelState } from './useIcaro';
import Wing from './Wing';

interface Props {
  lang: Lang;
  t: AppStrings;
}

const CITE_RE = /(\[\s*p(?:p|ágs?|ags?)?\.?\s*[\d\s,;\-–y&]+\])/giu;

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(0);
}

function seconds(from: number, to: number): string {
  return ((to - from) / 1000).toFixed(1);
}

/** «5 min 30 s» o «12,4 s». */
function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/* ── Actividad de carga del documento ─────────────────────────────────── */

function IngestActivity({ t, ingest, embed, llm, fallback }: { t: AppStrings; ingest: Ingest; embed: ModelState; llm: ModelState; fallback: boolean }) {
  const a = t.activity;
  const modelsReady = embed.status === 'ready' && llm.status === 'ready';
  const modelsError = embed.status === 'error' || llm.status === 'error';
  const downloading = embed.status === 'downloading' || llm.status === 'downloading';
  const loaded = embed.loaded + llm.loaded;
  const total = embed.total + llm.total;

  const read: Step = {
    key: 'read',
    label: a.readStep,
    status: ingest.read.status,
    detail:
      ingest.read.status === 'active'
        ? ingest.read.total
          ? fmt(a.readDetail, { page: ingest.read.page, total: ingest.read.total })
          : undefined
        : ingest.read.status === 'done'
          ? ingest.read.total === 1
            ? a.readDoneOne
            : fmt(a.readDone, { n: ingest.read.total })
          : undefined,
    progress: ingest.read.total ? (ingest.read.page / ingest.read.total) * 100 : 0,
  };
  const models: Step = {
    key: 'models',
    label: a.modelsStep,
    status: modelsError ? 'error' : modelsReady ? 'done' : embed.status === 'idle' && llm.status === 'idle' ? 'pending' : 'active',
    detail: modelsError
      ? (embed.error ?? llm.error)
      : modelsReady
        ? total === 0
          ? a.modelsCached
          : undefined
        : downloading && total > 0
          ? fmt(a.modelsDetail, { loaded: mb(loaded), total: mb(total) })
          : embed.status === 'loading' || llm.status === 'loading'
            ? a.modelsLoading
            : undefined,
    progress: total > 0 ? (loaded / total) * 100 : undefined,
  };
  const index: Step = {
    key: 'index',
    label: a.indexStep,
    status: ingest.index.status,
    detail:
      ingest.index.status === 'active'
        ? fmt(a.indexDetail, { done: ingest.index.done, total: ingest.index.total })
        : ingest.index.status === 'done'
          ? ingest.index.cached
            ? a.indexCached
            : fmt(a.indexDone, { n: ingest.index.total })
          : undefined,
    progress: ingest.index.total ? (ingest.index.done / ingest.index.total) * 100 : 0,
  };

  const failed = !!ingest.error || ingest.missing || ingest.noText || modelsError;
  const working = !failed && (!ingest.finishedAt || !modelsReady);
  const label = ingest.read.status === 'active' ? fmt(a.reading, { name: ingest.fileName }) : ingest.index.status === 'active' ? a.indexing : a.downloading;
  const summary = ingest.error
    ? `${a.failed}: ${ingest.error}`
    : ingest.missing
      ? a.missingIndex
      : ingest.noText
        ? a.noText
        : modelsError
          ? `${a.failed}: ${embed.error ?? llm.error ?? ''}`
          : ingest.restored
            ? a.readyCached
            : fmt(a.ready, { sec: seconds(ingest.startedAt, ingest.finishedAt ?? Date.now()) });

  return (
    <div className="settle flex gap-3">
      <Wing className="mt-1.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <Activity working={working} label={label} summary={summary} steps={ingest.missing || ingest.noText ? [] : [read, models, index]} tone={failed ? 'bad' : 'neutral'} />
        {fallback && <p className="mt-1 text-xs text-warn">{a.webgpuFallback}</p>}
      </div>
    </div>
  );
}

/* ── Mensajes ─────────────────────────────────────────────────────────── */

function Answer({ text, onCite }: { text: string; onCite: (page: number) => void }) {
  const parts = text.split(CITE_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const first = extractCitations(part)[0];
        if (first === undefined) return part;
        return (
          <button key={i} type="button" className="cite" onClick={() => onCite(first)} title={part}>
            {part.trim()}
          </button>
        );
      })}
    </>
  );
}

function SourceList({ t, sources, highlight }: { t: AppStrings['chat']; sources: Hit[]; highlight: number | null }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (highlight === null) return;
    list.current?.querySelector<HTMLElement>(`[data-page="${highlight}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlight]);
  if (sources.length === 0) return null;
  return (
    <div className="pt-1 pb-2">
      <p className="label mb-2">{t.sourcesLead}</p>
      <ol ref={list} className="space-y-2">
        {sources.map((s) => {
          const hit = highlight === s.page;
          return (
            <li key={s.id} data-page={s.page} className={`rounded-xl border p-3 text-[13px] transition-colors ${hit ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
              <p className="mb-1 flex items-center justify-between text-xs">
                <span className={`font-medium ${hit ? 'text-accent-ink' : 'text-ink-2'}`}>{fmt(t.page, { n: s.page })}</span>
                <span className="text-ink-3">{(s.score * 100).toFixed(0)}%</span>
              </p>
              <p className="answer leading-relaxed text-ink-2">{s.text || '…'}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function AssistantMessage({ t, m, highlight, onCite }: { t: AppStrings; m: Message; highlight: number | null; onCite: (page: number) => void }) {
  const a = t.activity;
  const working = m.phase === 'search' || m.phase === 'write';
  const n = m.sources?.length ?? 0;
  const steps: Step[] = [
    { key: 'search', label: a.searchStep, status: m.phase === 'search' ? 'active' : 'done', detail: m.phase !== 'search' ? fmt(a.searchDetail, { n }) : undefined },
    { key: 'write', label: a.writeStep, status: m.phase === 'search' ? 'pending' : m.phase === 'write' ? 'active' : m.phase === 'error' ? 'error' : 'done' },
  ];
  const summary = m.phase === 'error' ? `${a.failed}: ${m.error ?? ''}` : n > 0 ? fmt(a.answered, { n }) : a.answeredNone;
  // Tiempo total de la respuesta (búsqueda + generación); al reabrir un chat solo queda el de generación.
  const elapsed = m.startedAt && m.finishedAt ? m.finishedAt - m.startedAt : m.stats?.ms;

  return (
    <div className="settle flex gap-3">
      <Wing className="mt-1.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <Activity working={working} label={a.thinking} summary={summary} steps={working || m.phase === 'error' ? steps : []} tone={m.phase === 'error' ? 'bad' : 'neutral'} forceOpen={highlight !== null}>
          {m.phase === 'done' && m.sources && <SourceList t={t.chat} sources={m.sources} highlight={highlight} />}
        </Activity>
        {(m.content || m.phase === 'done') && (
          <p className={`answer mt-1 text-[15px] leading-7 ${m.phase === 'write' ? 'caret' : ''} ${m.notFound ? 'text-ink-2 italic' : ''}`}>
            {m.notFound ? t.chat.notFound : <Answer text={m.content} onCite={onCite} />}
          </p>
        )}
        {m.phase === 'done' && elapsed !== undefined && (
          <p className="mt-1.5 text-xs text-ink-3">
            {fmt(t.chat.took, { t: duration(elapsed) })}
            {m.interrupted && ` · ${t.chat.interrupted}`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── App ──────────────────────────────────────────────────────────────── */

export default function IcaroApp({ t }: Props) {
  const icaro = useIcaro();
  const { doc, ingest, messages, busy, embedModel, llmModel } = icaro;
  const [highlight, setHighlight] = useState<{ id: number; page: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const [target, setTarget] = useState<{ page: number; nonce: number } | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  const hasChat = ingest !== null;
  const modelsReady = embedModel.status === 'ready' && llmModel.status === 'ready';
  const generating = busy && messages.at(-1)?.phase !== undefined && messages.at(-1)?.phase !== 'done';
  const canAsk = doc !== null && !busy && modelsReady;

  // La bienvenida estática se oculta cuando hay un chat.
  useEffect(() => {
    document.documentElement.dataset.chat = hasChat ? 'active' : 'idle';
  }, [hasChat]);

  // Al cambiar de documento se cierra el visor y se vacían las menciones.
  const hash = doc?.hash;
  useEffect(() => {
    setPreview(false);
    setMentions([]);
    setTarget(null);
  }, [hash]);

  // Seguir el final de la conversación mientras llegan tokens, salvo que el usuario haya subido.
  const lastContent = messages.at(-1)?.content;
  useEffect(() => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    if (nearBottom) bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, lastContent]);

  // Soltar un PDF en cualquier punto de la página.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file && isPdf(file) && !busy) void icaro.openFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [busy, icaro.openFile]);

  /** Una cita [p. N] resalta la fuente y, si hay PDF, abre el visor en esa página. */
  const onCite = (id: number, page: number) => {
    setHighlight({ id, page });
    if (doc?.pdf) {
      setPreview(true);
      setTarget({ page, nonce: Date.now() });
    }
  };

  const ask = (q: string, m: Mention[]) => {
    void icaro.ask(q, m);
    setMentions([]);
  };

  const showPreview = preview && doc !== null;

  return (
    <div className={`flex min-h-0 ${hasChat ? 'flex-1' : 'mb-auto flex-none'}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hasChat && (
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-7 px-4 pt-2 pb-6 sm:px-6">
            {ingest && <IngestActivity t={t} ingest={ingest} embed={embedModel} llm={llmModel} fallback={icaro.fallbackNotice} />}

            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="settle flex flex-col items-end gap-1.5">
                  {m.mentions?.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onCite(m.id, q.page)}
                      className="hairline max-w-[85%] rounded-xl bg-surface px-3 py-2 text-left text-xs text-ink-2 transition-colors hover:border-line-strong"
                      title={q.text}
                    >
                      <span className="font-medium text-accent-ink">{fmt(t.preview.page, { n: q.page })}</span> «{q.text.length > 220 ? `${q.text.slice(0, 220)}…` : q.text}»
                    </button>
                  ))}
                  <p className="answer max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[15px] leading-6">{m.content}</p>
                </div>
              ) : (
                <AssistantMessage key={m.id} t={t} m={m} highlight={highlight?.id === m.id ? highlight.page : null} onCite={(page) => onCite(m.id, page)} />
              ),
            )}

            {doc && messages.length === 0 && modelsReady && (
              <div className="settle pl-8">
                <p className="label mb-2">{t.chat.suggestedTitle}</p>
                <ul className="flex flex-wrap gap-2">
                  {t.chat.suggested.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        disabled={!canAsk}
                        onClick={() => ask(q, [])}
                        className="hairline rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div ref={bottom} />
          </div>
        )}

        <div className={`sticky bottom-0 mx-auto w-full max-w-3xl px-4 pt-2 pb-4 sm:px-6 ${hasChat ? 'bg-gradient-to-t from-paper via-paper to-transparent' : ''}`}>
          <PromptInput
            t={t}
            doc={doc ? { name: doc.name, pages: doc.pages } : null}
            device={icaro.device}
            devicePref={icaro.devicePref}
            gpuAvailable={icaro.gpuAvailable}
            onDevicePref={icaro.setDevicePref}
            llmKey={icaro.llmKey}
            onLlmKey={icaro.setLlmKey}
            modelLocked={busy}
            generating={generating}
            canAsk={canAsk}
            onAsk={ask}
            onStop={icaro.stop}
            onFile={(f) => void icaro.openFile(f)}
            autoFocus={canAsk}
            mentions={mentions}
            onRemoveMention={(i) => setMentions((m) => m.filter((_, j) => j !== i))}
            onTogglePreview={() => setPreview((p) => !p)}
            previewOpen={showPreview}
          />
          <p className="mt-2 hidden text-center text-[11px] text-ink-3 sm:block">
            {t.prompt.shortcuts}
            {icaro.lowMemory && ` · ${t.device.lowMemory}`}
          </p>
        </div>
      </div>

      {showPreview && (
        <aside
          className="settle fixed inset-0 z-[46] bg-paper lg:sticky lg:z-auto lg:inset-auto lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-[44%] lg:max-w-3xl lg:min-w-[22rem] lg:border-l lg:border-line"
          aria-label={t.preview.open}
        >
          {doc.pdf ? (
            <PdfViewer
              t={t.preview}
              name={doc.name}
              data={doc.pdf}
              target={target}
              onMention={(text, page) => setMentions((m) => [...m, { text, page }])}
              onClose={() => setPreview(false)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="max-w-sm text-sm text-ink-2">{t.preview.unavailable}</p>
              <button type="button" onClick={() => setPreview(false)} className="hairline rounded-full px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
                {t.preview.close}
              </button>
            </div>
          )}
        </aside>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm" aria-hidden="true">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent px-12 py-10 text-center">
            <IconUpload className="size-10 text-accent" />
            <p className="text-lg font-medium">{t.drop.title}</p>
            <p className="text-sm text-ink-2">{t.drop.hint}</p>
          </div>
        </div>
      )}
    </div>
  );
}


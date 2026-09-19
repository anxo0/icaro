import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import IconArrowUp from '~icons/solar/arrow-up-linear';
import IconStop from '~icons/solar/stop-bold';
import IconPlus from '~icons/solar/add-circle-linear';
import IconFile from '~icons/solar/document-text-linear';
import IconQuote from '~icons/solar/chat-square-arrow-linear';
import IconX from '~icons/solar/close-circle-bold';
import { fmt, type AppStrings } from '@/i18n';
import type { Mention } from '@/lib/chats';
import type { LlmKey } from '@/lib/models';
import type { Device } from '@/lib/types';
import { ModelMenu } from './ModelMenu';
import type { DevicePref } from './useIcaro';

interface Props {
  t: AppStrings;
  /** Documento cargado: nombre y páginas para el chip. */
  doc: { name: string; pages: number } | null;
  device: Device;
  devicePref: DevicePref;
  gpuAvailable: boolean;
  onDevicePref: (pref: DevicePref) => void;
  llmKey: LlmKey;
  onLlmKey: (key: LlmKey) => void;
  modelLocked: boolean;
  generating: boolean;
  canAsk: boolean;
  onAsk: (question: string, mentions: Mention[]) => void;
  onStop: () => void;
  onFile: (file: File) => void;
  autoFocus?: boolean;
  /** Fragmentos señalados en el visor, pendientes de enviar con la próxima pregunta. */
  mentions: Mention[];
  onRemoveMention: (index: number) => void;
  /** Abre/cierra el visor del PDF (chip del documento). */
  onTogglePreview?: () => void;
  previewOpen?: boolean;
}

const MIN_ROWS = 1;
const MAX_ROWS = 8;
const LINE = 24;

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Cuadro de pregunta al estilo de los chats de IA: textarea que crece, barra de acciones debajo. */
export function PromptInput({ t, doc, device, devicePref, gpuAvailable, onDevicePref, llmKey, onLlmKey, modelLocked, generating, canAsk, onAsk, onStop, onFile, autoFocus, mentions, onRemoveMention, onTogglePreview, previewOpen }: Props) {
  const [draft, setDraft] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  /** Aviso al intentar enviar sin PDF o con el documento aún preparándose. */
  const [nudge, setNudge] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();

  // Atajos globales: Ctrl/⌘+K enfoca la pregunta, Esc para la generación.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        textarea.current?.focus();
      } else if (e.key === 'Escape' && generating) {
        onStop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [generating, onStop]);

  useEffect(() => {
    if (autoFocus) textarea.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (mentions.length > 0) textarea.current?.focus();
  }, [mentions.length]);

  const resize = () => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, LINE * MIN_ROWS), LINE * MAX_ROWS);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > LINE * MAX_ROWS ? 'auto' : 'hidden';
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = draft.trim();
    if (!q || generating) return;
    if (!canAsk) {
      setNudge(doc ? t.prompt.notReady : t.prompt.needPdf);
      setShaking(true);
      return;
    }
    setNudge(null);
    onAsk(q, mentions);
    setDraft('');
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!isPdf(file)) {
      setFileError(t.prompt.onlyPdf);
      return;
    }
    setFileError(null);
    onFile(file);
  };

  const placeholder = doc ? t.prompt.placeholder : t.prompt.placeholderNoDoc;

  useEffect(() => {
    if (!shaking) return;
    const id = setTimeout(() => setShaking(false), 450);
    return () => clearTimeout(id);
  }, [shaking]);

  useEffect(() => {
    if (!nudge) return;
    const id = setTimeout(() => setNudge(null), 4000);
    return () => clearTimeout(id);
  }, [nudge]);

  // En cuanto se puede preguntar, el aviso sobra.
  useEffect(() => {
    if (canAsk) setNudge(null);
  }, [canAsk]);

  return (
    <form onSubmit={submit} className={`glow-border rounded-2xl ${shaking ? 'shake' : ''}`}>
      <div className="hairline flex flex-col rounded-2xl bg-surface transition-colors focus-within:border-line-strong">
        {mentions.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label={t.prompt.mentionLabel}>
            {mentions.map((m, i) => (
              <li key={i} className="settle hairline flex max-w-full items-center gap-1.5 rounded-lg bg-surface-2 py-1 pr-1 pl-2 text-xs text-ink-2" title={m.text}>
                <IconQuote className="size-3.5 shrink-0 text-accent-ink" aria-hidden="true" />
                <span className="shrink-0 font-medium text-ink">{fmt(t.preview.page, { n: m.page })}</span>
                <span className="min-w-0 truncate">«{m.text}»</span>
                <button
                  type="button"
                  onClick={() => onRemoveMention(i)}
                  aria-label={t.prompt.removeMention}
                  title={t.prompt.removeMention}
                  className="shrink-0 rounded-full text-ink-3 transition-colors hover:text-bad"
                >
                  <IconX className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onInput={resize}
          onKeyDown={onKeyDown}
          rows={MIN_ROWS}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={generating}
          className="max-h-48 w-full resize-none overflow-hidden bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 placeholder:text-ink-3 focus:outline-none disabled:opacity-70"
        />
        <div className="flex min-h-8 items-center gap-1 px-2 pb-2">
          <input
            ref={fileInput}
            id={fileId}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={generating}
            title={t.prompt.attach}
            aria-label={t.prompt.attach}
            className="inline-flex size-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            <IconPlus className="size-5" />
          </button>

          <ModelMenu t={t} value={llmKey} onChange={onLlmKey} device={device} devicePref={devicePref} gpuAvailable={gpuAvailable} onDevicePref={onDevicePref} disabled={modelLocked} />

          {fileError && (
            <span role="alert" className="ml-2 text-xs text-bad">
              {fileError}
            </span>
          )}
          {nudge && !fileError && (
            <button
              type="button"
              role="alert"
              onClick={() => (doc ? setNudge(null) : fileInput.current?.click())}
              className="settle ml-2 truncate rounded-full bg-warn-soft px-2.5 py-1 text-left text-xs text-warn"
            >
              {nudge}
            </button>
          )}

          {doc && (
            <button
              type="button"
              onClick={onTogglePreview}
              aria-pressed={previewOpen}
              title={previewOpen ? t.preview.close : t.preview.open}
              className={`hairline ml-auto inline-flex max-w-56 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:border-line-strong hover:text-ink ${previewOpen ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
            >
              <IconFile className="size-3.5 shrink-0" />
              <span className="truncate">{doc.name}</span>
              <span className="shrink-0 text-ink-3">· {doc.pages}</span>
            </button>
          )}

          {generating ? (
            <button
              type="button"
              onClick={onStop}
              title={`${t.prompt.stop} (Esc)`}
              aria-label={t.prompt.stop}
              className={`${doc ? 'ml-1' : 'ml-auto'} inline-flex size-8 items-center justify-center rounded-full bg-ink text-paper transition-transform hover:scale-105`}
            >
              <IconStop className="size-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim()}
              title={t.prompt.send}
              aria-label={t.prompt.send}
              className={`${doc ? 'ml-1' : 'ml-auto'} inline-flex size-8 items-center justify-center rounded-full bg-ink text-paper transition-[transform,opacity] hover:scale-105 disabled:scale-100 disabled:opacity-30`}
            >
              <IconArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

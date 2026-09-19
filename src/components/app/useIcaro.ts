import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type Client } from '@/lib/rpc';
import { cacheKey, clearDocs, clearModelCache, getDoc, putDoc } from '@/lib/cache';
import { chatsStore, clearChats, newChatId, openChat, upsertChat, type Mention, type StoredChat, type StoredMessage } from '@/lib/chats';
import { DEFAULT_LLM, EMBED_MODEL, LLM_MODELS, detectDevice, isLowMemory, sha256, type LlmKey } from '@/lib/models';
import { buildMessages, ensureCitation, extractCitations, isNotFound } from '@/lib/prompt';
import { topK } from '@/lib/search';
import { useStore } from '@/lib/store';
import type { ChatMessage, Chunk, Device, Hit } from '@/lib/types';
import type { EmbedProtocol, LlmNotifications, LlmProtocol, LoadProgress, PdfProtocol } from '@/workers/protocols';
import type { StepStatus } from './Activity';

export interface ModelState {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
  /** 0–100 */
  progress: number;
  loaded: number;
  total: number;
  error?: string;
}

export interface DocState {
  hash: string;
  name: string;
  size: number;
  pages: number;
  chunks: Chunk[];
  vectors: Float32Array;
  dims: number;
  /** Bytes del PDF para el visor; null si el chat se reabrió y ya no están en la caché. */
  pdf: ArrayBuffer | null;
}

/** Traza de la carga de un documento: lo que enseña la actividad de Ícaro al soltar un PDF. */
export interface Ingest {
  fileName: string;
  startedAt: number;
  finishedAt?: number;
  read: { status: StepStatus; page: number; total: number };
  index: { status: StepStatus; done: number; total: number; cached: boolean };
  /** El documento se restauró de la caché al reabrir un chat. */
  restored?: boolean;
  /** El índice ya no está en IndexedDB: hay que volver a soltar el PDF. */
  missing?: boolean;
  noText?: boolean;
  error?: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Fragmentos del PDF señalados por el usuario junto a la pregunta. */
  mentions?: Mention[];
  /** Solo en respuestas de Ícaro. */
  phase?: 'search' | 'write' | 'done' | 'error';
  startedAt?: number;
  finishedAt?: number;
  interrupted?: boolean;
  notFound?: boolean;
  sources?: Hit[];
  citedPages?: number[];
  stats?: { tokens: number; ms: number };
  error?: string;
}

const TOP_K = 5;
/** Por encima de esto el PDF no se guarda en IndexedDB (el índice sí). */
const MAX_STORED_PDF = 50 * 1024 * 1024;
const LLM_KEY = 'icaro:llm';
const DEVICE_KEY = 'icaro:device';

export type DevicePref = 'auto' | 'webgpu' | 'wasm';

function readDevicePref(): DevicePref {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    if (v === 'webgpu' || v === 'wasm') return v;
  } catch {
    /* sin almacenamiento */
  }
  return 'auto';
}
const IDLE_MODEL: ModelState = { status: 'idle', progress: 0, loaded: 0, total: 0 };

interface Workers {
  pdf: Client<PdfProtocol>;
  embed: Client<EmbedProtocol>;
  llm: Client<LlmProtocol, LlmNotifications>;
}

function readStoredLlm(): LlmKey {
  try {
    const v = localStorage.getItem(LLM_KEY);
    if (v === 'qwen' || v === 'smol') return v;
  } catch {
    /* sin almacenamiento */
  }
  return isLowMemory() ? 'smol' : DEFAULT_LLM;
}

function toStored(messages: Message[]): StoredMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.phase === 'done')
    .map((m) => ({
      role: m.role,
      content: m.content,
      mentions: m.mentions,
      notFound: m.notFound,
      interrupted: m.interrupted,
      sources: m.sources?.map((s) => ({ id: s.id, page: s.page, score: s.score })),
      stats: m.stats,
    }));
}

function fromStored(stored: StoredMessage[], chunks: Chunk[] | null, startId: number): Message[] {
  return stored.map((m, i) => ({
    id: startId + i,
    role: m.role,
    content: m.content,
    mentions: m.mentions,
    phase: m.role === 'assistant' ? 'done' : undefined,
    notFound: m.notFound,
    interrupted: m.interrupted,
    stats: m.stats,
    citedPages: m.role === 'assistant' ? extractCitations(m.content) : undefined,
    sources: m.sources?.map((s) => ({ id: s.id, page: s.page, score: s.score, text: chunks?.[s.id]?.text ?? '' })),
  }));
}

export function useIcaro() {
  const [device, setDevice] = useState<Device>('wasm');
  const [gpuAvailable, setGpuAvailable] = useState(false);
  const [devicePref, setDevicePrefState] = useState<DevicePref>('auto');
  const [lowMemory, setLowMemory] = useState(false);
  const [llmKey, setLlmKeyState] = useState<LlmKey>(DEFAULT_LLM);
  const [embedModel, setEmbedModel] = useState<ModelState>(IDLE_MODEL);
  const [llmModel, setLlmModel] = useState<ModelState>(IDLE_MODEL);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [ingest, setIngest] = useState<Ingest | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState(false);
  const activeId = useStore(chatsStore, (s) => s.activeId);

  const workers = useRef<Workers | null>(null);
  const embedReady = useRef<Promise<void> | null>(null);
  const llmReady = useRef<Promise<void> | null>(null);
  const llmLoadedKey = useRef<LlmKey | null>(null);
  const deviceRef = useRef<Device>('wasm');
  const docRef = useRef<DocState | null>(null);
  const chatRef = useRef<StoredChat | null>(null);
  const seq = useRef(0);

  // Solo en cliente: navigator.gpu, deviceMemory y localStorage no existen en build.
  useEffect(() => {
    setLowMemory(isLowMemory());
    setLlmKeyState(readStoredLlm());
    const pref = readDevicePref();
    setDevicePrefState(pref);
    void detectDevice().then((d) => {
      setGpuAvailable(d === 'webgpu');
      const effective: Device = pref === 'auto' ? d : pref === 'webgpu' && d === 'webgpu' ? 'webgpu' : 'wasm';
      deviceRef.current = effective;
      setDevice(effective);
    });
    return () => {
      workers.current?.pdf.terminate();
      workers.current?.embed.terminate();
      workers.current?.llm.terminate();
      workers.current = null;
    };
  }, []);

  const spawnEmbed = () => createClient<EmbedProtocol>(new Worker(new URL('../../workers/embed.worker.ts', import.meta.url), { type: 'module' }));
  const spawnLlm = () =>
    createClient<LlmProtocol, LlmNotifications>(new Worker(new URL('../../workers/llm.worker.ts', import.meta.url), { type: 'module' }));

  /** Los workers se crean al primer uso (soltar un PDF), nunca al abrir la página. */
  const ensureWorkers = useCallback((): Workers => {
    if (!workers.current) {
      workers.current = {
        pdf: createClient<PdfProtocol>(new Worker(new URL('../../workers/pdf.worker.ts', import.meta.url), { type: 'module' })),
        embed: spawnEmbed(),
        llm: spawnLlm(),
      };
    }
    return workers.current;
  }, []);

  /**
   * Sustituye un worker de modelo por uno nuevo. Hace falta al reintentar tras un fallo de WebGPU:
   * transformers.js encadena las cargas de sesión en una promesa y, si una falla, todas las
   * siguientes en ese worker heredan el mismo error.
   */
  const respawn = useCallback((which: 'embed' | 'llm') => {
    const w = workers.current;
    if (!w) return;
    if (which === 'embed') {
      w.embed.terminate();
      w.embed = spawnEmbed();
    } else {
      w.llm.terminate();
      w.llm = spawnLlm();
    }
  }, []);

  const progressToState = (p: LoadProgress): ModelState => ({
    status: p.progress >= 100 ? 'loading' : 'downloading',
    progress: p.progress,
    loaded: p.loaded,
    total: p.total,
  });

  /** Carga un modelo con WebGPU y, si falla, reintenta con WASM en un worker nuevo. */
  const loadWithFallback = useCallback(
    async (which: 'embed' | 'llm', run: (device: Device) => Promise<void>): Promise<void> => {
      // Se recuerda el dispositivo con el que se intentó: las dos cargas van en paralelo y la
      // primera que falle cambia deviceRef, pero la otra también tiene que reintentar.
      const attempted = deviceRef.current;
      try {
        await run(attempted);
      } catch (err) {
        if (attempted !== 'webgpu') throw err;
        console.warn('[icaro] WebGPU failed, retrying with WASM', err);
        deviceRef.current = 'wasm';
        setDevice('wasm');
        setFallbackNotice(true);
        respawn(which);
        await run('wasm');
      }
    },
    [respawn],
  );

  const loadEmbed = useCallback((): Promise<void> => {
    if (!embedReady.current) {
      setEmbedModel({ ...IDLE_MODEL, status: 'downloading' });
      embedReady.current = loadWithFallback('embed', async (dev) => {
        await ensureWorkers().embed.call('load', { device: dev }, { onEvent: (p) => setEmbedModel(progressToState(p)) });
      })
        .then(() => setEmbedModel({ status: 'ready', progress: 100, loaded: 0, total: 0 }))
        .catch((err: Error) => {
          embedReady.current = null;
          setEmbedModel({ ...IDLE_MODEL, status: 'error', error: err.message });
          throw err;
        });
    }
    return embedReady.current;
  }, [ensureWorkers, loadWithFallback]);

  const loadLlm = useCallback(
    (key: LlmKey): Promise<void> => {
      if (!llmReady.current || llmLoadedKey.current !== key) {
        const spec = LLM_MODELS[key];
        llmLoadedKey.current = key;
        setLlmModel({ ...IDLE_MODEL, status: 'downloading' });
        llmReady.current = loadWithFallback('llm', async (dev) => {
          await ensureWorkers().llm.call(
            'load',
            { model: spec.id, dtype: spec.dtype, device: dev },
            { onEvent: (p) => setLlmModel(progressToState(p)) },
          );
        })
          .then(() => setLlmModel({ status: 'ready', progress: 100, loaded: 0, total: 0 }))
          .catch((err: Error) => {
            llmReady.current = null;
            llmLoadedKey.current = null;
            setLlmModel({ ...IDLE_MODEL, status: 'error', error: err.message });
            throw err;
          });
      }
      return llmReady.current;
    },
    [ensureWorkers, loadWithFallback],
  );

  const setLlmKey = useCallback(
    (key: LlmKey) => {
      setLlmKeyState(key);
      try {
        localStorage.setItem(LLM_KEY, key);
      } catch {
        /* sin almacenamiento */
      }
      if (chatRef.current) {
        chatRef.current = { ...chatRef.current, llmKey: key };
        upsertChat(chatRef.current);
      }
      // Si ya hay documento, el modelo se cambia en caliente.
      if (docRef.current) void loadLlm(key).catch(() => {});
    },
    [loadLlm],
  );

  /** Cambia la aceleración. Los modelos ya cargados se descartan y, si hay documento, se recargan. */
  const setDevicePref = useCallback(
    (pref: DevicePref) => {
      setDevicePrefState(pref);
      try {
        localStorage.setItem(DEVICE_KEY, pref);
      } catch {
        /* sin almacenamiento */
      }
      const next: Device = pref === 'wasm' ? 'wasm' : gpuAvailable ? 'webgpu' : 'wasm';
      if (next === deviceRef.current) return;
      deviceRef.current = next;
      setDevice(next);
      setFallbackNotice(false);
      if (workers.current) {
        respawn('embed');
        respawn('llm');
      }
      embedReady.current = null;
      llmReady.current = null;
      llmLoadedKey.current = null;
      setEmbedModel(IDLE_MODEL);
      setLlmModel(IDLE_MODEL);
      if (docRef.current) {
        loadEmbed().catch(() => {});
        loadLlm(llmKey).catch(() => {});
      }
    },
    [gpuAvailable, llmKey, loadEmbed, loadLlm, respawn],
  );

  /** Guarda el chat activo en localStorage con los mensajes dados. */
  const persist = useCallback((msgs: Message[]) => {
    const chat = chatRef.current;
    if (!chat) return;
    const next: StoredChat = { ...chat, messages: toStored(msgs), updatedAt: Date.now() };
    chatRef.current = next;
    upsertChat(next);
  }, []);

  /** Cambio de chat desde la barra lateral (o «Nuevo chat»). */
  useEffect(() => {
    if (activeId === (chatRef.current?.id ?? null)) return;
    if (busy) return;
    if (activeId === null) {
      chatRef.current = null;
      docRef.current = null;
      setDoc(null);
      setIngest(null);
      setMessages([]);
      return;
    }
    const chat = chatsStore.get().chats.find((c) => c.id === activeId);
    if (!chat) return;
    chatRef.current = chat;
    setLlmKeyState(chat.llmKey);
    setDoc(null);
    docRef.current = null;
    seq.current += chat.messages.length + 1;
    setMessages(fromStored(chat.messages, null, seq.current));
    setIngest({
      fileName: chat.pdfName,
      startedAt: Date.now(),
      read: { status: 'active', page: 0, total: chat.pages },
      index: { status: 'pending', done: 0, total: chat.chunks, cached: true },
    });
    let cancelled = false;
    void getDoc(cacheKey(chat.hash, EMBED_MODEL.id)).then((cached) => {
      if (cancelled) return;
      if (!cached) {
        setIngest((i) =>
          i ? { ...i, read: { ...i.read, status: 'error' }, index: { ...i.index, status: 'error' }, missing: true, finishedAt: Date.now() } : i,
        );
        return;
      }
      const restored: DocState = {
        hash: chat.hash,
        name: chat.pdfName,
        size: chat.size,
        pages: cached.pages,
        chunks: cached.chunks,
        vectors: new Float32Array(cached.vectors),
        dims: cached.dims,
        pdf: cached.pdf ?? null,
      };
      docRef.current = restored;
      setDoc(restored);
      setMessages(fromStored(chat.messages, cached.chunks, seq.current));
      setIngest({
        fileName: chat.pdfName,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        restored: true,
        read: { status: 'done', page: cached.pages, total: cached.pages },
        index: { status: 'done', done: cached.chunks.length, total: cached.chunks.length, cached: true },
      });
      loadEmbed().catch(() => {});
      loadLlm(chat.llmKey).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, busy, loadEmbed, loadLlm]);

  const openFile = useCallback(
    async (file: File) => {
      setBusy(true);
      const startedAt = Date.now();
      setMessages([]);
      setDoc(null);
      docRef.current = null;
      setIngest({
        fileName: file.name,
        startedAt,
        read: { status: 'active', page: 0, total: 0 },
        index: { status: 'pending', done: 0, total: 0, cached: false },
      });
      try {
        const { pdf } = ensureWorkers();
        const buffer = await file.arrayBuffer();
        const hash = await sha256(buffer);
        // El buffer se transfiere al worker de pdf.js; el visor necesita su propia copia.
        const pdfBytes = buffer.slice(0);

        // Los dos modelos se cargan en paralelo con la lectura del PDF.
        const embedLoad = loadEmbed();
        const llmLoad = loadLlm(llmKey);
        embedLoad.catch(() => {});
        llmLoad.catch(() => {});

        // Mismo PDF que el chat abierto (p. ej. tras perder el índice): se continúa ese chat.
        const sameChat = chatRef.current && chatRef.current.hash === hash ? chatRef.current : null;
        if (!sameChat) chatRef.current = null;

        const cached = await getDoc(cacheKey(hash, EMBED_MODEL.id));
        let next: DocState;
        if (cached) {
          next = {
            hash,
            name: file.name,
            size: file.size,
            pages: cached.pages,
            chunks: cached.chunks,
            vectors: new Float32Array(cached.vectors),
            dims: cached.dims,
            pdf: pdfBytes,
          };
          if (!cached.pdf && pdfBytes.byteLength <= MAX_STORED_PDF) void putDoc({ ...cached, pdf: pdfBytes });
          setIngest((i) =>
            i
              ? {
                  ...i,
                  read: { status: 'done', page: cached.pages, total: cached.pages },
                  index: { status: 'done', done: cached.chunks.length, total: cached.chunks.length, cached: true },
                }
              : i,
          );
        } else {
          const parsed = await pdf.call(
            'parse',
            { buffer },
            { transfer: [buffer], onEvent: (p) => setIngest((i) => (i ? { ...i, read: { status: 'active', ...p } } : i)) },
          );
          if (parsed.chunks.length === 0) {
            setIngest((i) =>
              i ? { ...i, read: { status: 'error', page: parsed.pages, total: parsed.pages }, noText: true, finishedAt: Date.now() } : i,
            );
            return;
          }
          setIngest((i) =>
            i
              ? {
                  ...i,
                  read: { status: 'done', page: parsed.pages, total: parsed.pages },
                  index: { status: 'active', done: 0, total: parsed.chunks.length, cached: false },
                }
              : i,
          );
          await embedLoad;
          const { vectors, dims } = await ensureWorkers().embed.call(
            'embed',
            { texts: parsed.chunks.map((c) => c.text), kind: 'passage' },
            { onEvent: (p) => setIngest((i) => (i ? { ...i, index: { ...i.index, status: 'active', ...p } } : i)) },
          );
          next = {
            hash,
            name: file.name,
            size: file.size,
            pages: parsed.pages,
            chunks: parsed.chunks,
            vectors: new Float32Array(vectors),
            dims,
            pdf: pdfBytes,
          };
          void putDoc({
            key: cacheKey(hash, EMBED_MODEL.id),
            hash,
            name: file.name,
            size: file.size,
            pages: parsed.pages,
            model: EMBED_MODEL.id,
            dims,
            chunks: parsed.chunks,
            vectors,
            pdf: pdfBytes.byteLength <= MAX_STORED_PDF ? pdfBytes : undefined,
            createdAt: Date.now(),
          });
          setIngest((i) => (i ? { ...i, index: { status: 'done', done: parsed.chunks.length, total: parsed.chunks.length, cached: false } } : i));
        }
        docRef.current = next;
        setDoc(next);

        const chat: StoredChat = sameChat
          ? { ...sameChat, pages: next.pages, chunks: next.chunks.length, size: next.size, updatedAt: Date.now() }
          : {
              id: newChatId(),
              hash,
              pdfName: file.name,
              pages: next.pages,
              size: next.size,
              chunks: next.chunks.length,
              llmKey,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: [],
            };
        chatRef.current = chat;
        if (sameChat) {
          seq.current += chat.messages.length + 1;
          setMessages(fromStored(chat.messages, next.chunks, seq.current));
        }
        upsertChat(chat);
        openChat(chat.id);

        // Se puede preguntar en cuanto estén los dos modelos; mientras, la actividad enseña el progreso.
        await Promise.all([embedLoad, llmLoad]);
        setIngest((i) => (i ? { ...i, finishedAt: Date.now() } : i));
      } catch (err) {
        setIngest((i) => (i ? { ...i, error: err instanceof Error ? err.message : String(err), finishedAt: Date.now() } : i));
      } finally {
        setBusy(false);
      }
    },
    [ensureWorkers, loadEmbed, loadLlm, llmKey],
  );

  const ask = useCallback(
    async (question: string, mentions: Mention[] = []) => {
      const current = docRef.current;
      const q = question.trim();
      if (!current || !q || busy) return;
      setBusy(true);
      const userId = ++seq.current;
      const answerId = ++seq.current;
      const startedAt = Date.now();
      setMessages((m) => [
        ...m,
        { id: userId, role: 'user', content: q, mentions: mentions.length ? mentions : undefined },
        { id: answerId, role: 'assistant', content: '', phase: 'search', startedAt },
      ]);
      const patch = (p: Partial<Message>) => setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, ...p } : msg)));
      try {
        await loadEmbed();
        const { vectors, dims } = await ensureWorkers().embed.call('embed', { texts: [q], kind: 'query' });
        const query = new Float32Array(vectors);
        // Lo que el usuario ha señalado en el visor va primero, como fragmento propio con su página.
        const mentioned: Hit[] = mentions.map((m, i) => ({ id: -1 - i, page: m.page, text: m.text, score: 1 }));
        const found: Hit[] = topK(query, current.vectors, dims, TOP_K)
          .map(({ index, score }) => {
            const chunk = current.chunks[index];
            return chunk ? { ...chunk, score } : null;
          })
          .filter((h): h is Hit => h !== null);
        const hits = [...mentioned, ...found];
        patch({ sources: hits, phase: 'write' });

        await loadLlm(llmKey);
        const result = await ensureWorkers().llm.call(
          'generate',
          { messages: buildMessages(q, hits, { mentions }) },
          { onEvent: ({ token }) => setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, content: msg.content + token } : msg))) },
        );
        const text = ensureCitation(result.text.trim(), hits);
        const finished: Partial<Message> = {
          content: text,
          phase: 'done',
          finishedAt: Date.now(),
          interrupted: result.interrupted,
          notFound: isNotFound(text),
          citedPages: extractCitations(text),
          stats: { tokens: result.tokens, ms: result.ms },
        };
        setMessages((m) => {
          const next = m.map((msg) => (msg.id === answerId ? { ...msg, ...finished } : msg));
          persist(next);
          return next;
        });
      } catch (err) {
        patch({ phase: 'error', finishedAt: Date.now(), error: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [busy, ensureWorkers, loadEmbed, loadLlm, llmKey, persist],
  );

  // Solo en desarrollo: permite probar prompts desde la consola sin pasar por la UI.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __icaro?: unknown }).__icaro = {
      generate: async (msgs: ChatMessage[]) => {
        await loadLlm(llmKey);
        return ensureWorkers().llm.call('generate', { messages: msgs });
      },
      doc: () => docRef.current,
    };
  }, [ensureWorkers, loadLlm, llmKey]);

  const stop = useCallback(() => {
    workers.current?.llm.notify('stop', undefined);
  }, []);

  /** Borra chats, documentos indexados y modelos descargados, y deja la app como recién abierta. */
  const clearAll = useCallback(async () => {
    stop();
    workers.current?.pdf.terminate();
    workers.current?.embed.terminate();
    workers.current?.llm.terminate();
    workers.current = null;
    embedReady.current = null;
    llmReady.current = null;
    llmLoadedKey.current = null;
    chatRef.current = null;
    docRef.current = null;
    setEmbedModel(IDLE_MODEL);
    setLlmModel(IDLE_MODEL);
    setDoc(null);
    setIngest(null);
    setMessages([]);
    clearChats();
    await Promise.all([clearDocs(), clearModelCache()]);
  }, [stop]);

  // El botón «Borrar todo» está en la barra lateral estática.
  useEffect(() => {
    const onClear = () => void clearAll();
    window.addEventListener('icaro:clear-all', onClear);
    return () => window.removeEventListener('icaro:clear-all', onClear);
  }, [clearAll]);

  return {
    device,
    devicePref,
    setDevicePref,
    gpuAvailable,
    lowMemory,
    fallbackNotice,
    llmKey,
    setLlmKey,
    embedModel,
    llmModel,
    doc,
    ingest,
    messages,
    busy,
    openFile,
    ask,
    stop,
  };
}

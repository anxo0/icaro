import type { Method } from '@/lib/rpc';
import type { ChatMessage, Chunk, Device } from '@/lib/types';

/** Progreso de descarga de un modelo, ya agregado a una sola barra. */
export interface LoadProgress {
  /** 0–100 */
  progress: number;
  loaded: number;
  total: number;
  /** Fichero en curso, por si se quiere enseñar. */
  file?: string;
}

export interface LoadRequest {
  device: Device;
}

/* ── pdf.worker ─────────────────────────────────────────────────────────── */

export type PdfProtocol = {
  parse: Method<{ buffer: ArrayBuffer }, { pages: number; chunks: Chunk[]; chars: number }, { page: number; total: number }>;
}

/* ── embed.worker ───────────────────────────────────────────────────────── */

export type EmbedProtocol = {
  load: Method<LoadRequest, { dims: number; device: Device }, LoadProgress>;
  embed: Method<
    { texts: string[]; kind: 'passage' | 'query' },
    { vectors: ArrayBuffer; dims: number },
    { done: number; total: number }
  >;
}

/* ── llm.worker ─────────────────────────────────────────────────────────── */

export type LlmProtocol = {
  load: Method<LoadRequest & { model: string; dtype: 'q4' | 'q8' }, { device: Device }, LoadProgress>;
  generate: Method<
    { messages: ChatMessage[]; maxNewTokens?: number },
    { text: string; tokens: number; ms: number; interrupted: boolean },
    { token: string }
  >;
}

export type LlmNotifications = {
  stop: void;
}

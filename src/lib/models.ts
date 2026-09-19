import type { Device } from './types';

export interface ModelSpec {
  id: string;
  dtype: 'q4' | 'q8';
  /** Peso aproximado de la descarga, en MB, para enseñarlo antes de bajarlo. */
  sizeMB: number;
}

/** Embeddings multilingües: los PDF serán en español. 384 dimensiones. */
export const EMBED_MODEL: ModelSpec & { dims: number } = {
  id: 'Xenova/multilingual-e5-small',
  dtype: 'q8',
  sizeMB: 120,
  dims: 384,
};

export type LlmKey = 'qwen' | 'smol';

export const LLM_MODELS: Record<LlmKey, ModelSpec & { label: string }> = {
  qwen: { id: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4', sizeMB: 400, label: 'Qwen2.5 0.5B' },
  smol: { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', dtype: 'q4', sizeMB: 250, label: 'SmolLM2 360M' },
};

export const DEFAULT_LLM: LlmKey = 'qwen';

/**
 * WebGPU si hay adaptador de verdad; si no, WASM (funciona, pero irá lento).
 * Tener `navigator.gpu` no basta: sin GPU utilizable `requestAdapter()` devuelve null.
 */
export async function detectDevice(): Promise<Device> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return 'wasm';
  // En portátiles con dos gráficas el adaptador por defecto a veces es null y el de alto rendimiento no.
  for (const options of [undefined, { powerPreference: 'high-performance' as const }, { powerPreference: 'low-power' as const }]) {
    try {
      const adapter = await navigator.gpu.requestAdapter(options);
      if (adapter) return 'webgpu';
    } catch {
      /* siguiente intento */
    }
  }
  return 'wasm';
}

/** Con menos de 4 GB, sugerir el modelo ligero. `deviceMemory` solo existe en Chromium. */
export function isLowMemory(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof mem === 'number' && mem < 4;
}

export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
}

/** SHA-256 en hexadecimal; nativo y asíncrono, no bloquea la UI. */
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

import { env, type ProgressInfo } from '@huggingface/transformers';
import type { LoadProgress } from './protocols';

/**
 * Configuración común de transformers.js para los dos workers de modelos.
 *
 * - Los pesos vienen de Hugging Face y se cachean en la Cache API del navegador (por defecto).
 * - El runtime WASM de ONNX se sirve desde nuestro propio origen (`/ort/`, copiado en build);
 *   si no, transformers.js lo bajaría de jsdelivr y rompería la regla «solo huggingface.co».
 */
export function configureTransformers(): void {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      mjs: new URL('/ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.origin).href,
      wasm: new URL('/ort/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
    };
    // Sin aislamiento cross-origin no hay SharedArrayBuffer: un solo hilo.
    if (typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated) wasm.numThreads = 1;
  }
}

/**
 * Convierte el chorro de eventos por fichero de `progress_callback` en un progreso agregado.
 * transformers.js ya emite `progress_total`; aquí solo se reenvía y se cierra al 100 con `ready`.
 */
export function progressAdapter(emit: (p: LoadProgress) => void): (info: ProgressInfo) => void {
  let last: LoadProgress = { progress: 0, loaded: 0, total: 0 };
  return (info) => {
    if (info.status === 'progress_total') {
      const file = Object.entries(info.files).find(([, f]) => f.loaded < f.total)?.[0];
      last = { progress: Math.min(100, info.progress), loaded: info.loaded, total: info.total, file };
      emit(last);
    } else if (info.status === 'ready') {
      emit({ ...last, progress: 100 });
    }
  };
}

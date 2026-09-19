/**
 * Embeddings con multilingual-e5-small. Un solo pipeline por worker, cargado una vez.
 * El modelo pide prefijar `query: ` a las preguntas y `passage: ` a los trozos.
 */
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { serve, Transfer } from '@/lib/rpc';
import { EMBED_MODEL } from '@/lib/models';
import type { Device } from '@/lib/types';
import type { EmbedProtocol, LoadProgress } from './protocols';
import { configureTransformers, progressAdapter } from './setup';

configureTransformers();

const BATCH = 16;

let instance: Promise<FeatureExtractionPipeline> | null = null;
let loadedDevice: Device = 'wasm';

function getPipeline(device: Device, onProgress?: (p: LoadProgress) => void): Promise<FeatureExtractionPipeline> {
  if (!instance) {
    loadedDevice = device;
    instance = pipeline('feature-extraction', EMBED_MODEL.id, {
      dtype: EMBED_MODEL.dtype,
      device,
      progress_callback: onProgress ? progressAdapter(onProgress) : undefined,
    }).catch((err: unknown) => {
      instance = null;
      throw err;
    });
  }
  return instance;
}

serve<EmbedProtocol>({
  async load({ device }, emit) {
    await getPipeline(device, emit);
    return { dims: EMBED_MODEL.dims, device: loadedDevice };
  },

  async embed({ texts, kind }, emit) {
    const extractor = await getPipeline(loadedDevice);
    const prefix = kind === 'query' ? 'query: ' : 'passage: ';
    let dims = EMBED_MODEL.dims;
    let out: Float32Array | null = null;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH).map((t) => prefix + t);
      const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
      const [rows, d] = tensor.dims as [number, number];
      dims = d;
      if (!out) out = new Float32Array(texts.length * dims);
      out.set(tensor.data as Float32Array, i * dims);
      tensor.dispose();
      emit({ done: Math.min(i + rows, texts.length), total: texts.length });
    }
    const vectors = out ?? new Float32Array(0);
    return new Transfer({ vectors: vectors.buffer as ArrayBuffer, dims }, [vectors.buffer as ArrayBuffer]);
  },
});

/**
 * Generación con Qwen2.5-0.5B-Instruct (o SmolLM2, la opción ligera) en streaming.
 * Un solo pipeline por worker; si se cambia de modelo se libera el anterior.
 */
import { pipeline, TextStreamer, InterruptableStoppingCriteria, type TextGenerationPipeline } from '@huggingface/transformers';
import { serve } from '@/lib/rpc';
import { GENERATION } from '@/lib/prompt';
import type { Device } from '@/lib/types';
import type { LlmNotifications, LlmProtocol, LoadProgress } from './protocols';
import { configureTransformers, progressAdapter } from './setup';

configureTransformers();

let instance: Promise<TextGenerationPipeline> | null = null;
let loadedModel = '';
let loadedDevice: Device = 'wasm';
const stopper = new InterruptableStoppingCriteria();

async function getPipeline(
  model: string,
  dtype: 'q4' | 'q8',
  device: Device,
  onProgress?: (p: LoadProgress) => void,
): Promise<TextGenerationPipeline> {
  if (instance && loadedModel !== model) {
    const old = await instance.catch(() => null);
    await old?.dispose();
    instance = null;
  }
  if (!instance) {
    loadedModel = model;
    loadedDevice = device;
    instance = pipeline('text-generation', model, {
      dtype,
      device,
      progress_callback: onProgress ? progressAdapter(onProgress) : undefined,
    }).catch((err: unknown) => {
      instance = null;
      throw err;
    });
  }
  return instance;
}

serve<LlmProtocol, LlmNotifications>(
  {
    async load({ model, dtype, device }, emit) {
      await getPipeline(model, dtype, device, emit);
      return { device: loadedDevice };
    },

    async generate({ messages, maxNewTokens }, emit) {
      if (!instance) throw new Error('Model not loaded');
      const generator = await instance;
      stopper.reset();
      let text = '';
      let tokens = 0;
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (piece: string) => {
          text += piece;
          tokens++;
          emit({ token: piece });
        },
      });
      const t0 = performance.now();
      await generator(messages, {
        ...GENERATION,
        max_new_tokens: maxNewTokens ?? GENERATION.max_new_tokens,
        streamer,
        stopping_criteria: stopper,
        return_full_text: false,
      });
      return { text, tokens, ms: Math.round(performance.now() - t0), interrupted: stopper.interrupted };
    },
  },
  {
    stop() {
      stopper.interrupt();
    },
  },
);

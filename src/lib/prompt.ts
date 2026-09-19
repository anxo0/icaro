import type { ChatMessage, Chunk } from './types';
import { estimateTokens } from './chunk';

/** El modelo devuelve esto, literal, cuando la respuesta no está en los fragmentos. La UI lo traduce. */
export const NOT_FOUND = 'No aparece en el documento';

/**
 * Con un 0.5B, «cita las páginas así: [p. 12]» a secas hace que responda solo «[3]». Explicar el
 * formato y enseñárselo con dos turnos de ejemplo (uno con cita, otro con «no aparece») funciona.
 */
export const SYSTEM_PROMPT = [
  'Eres un asistente que responde preguntas sobre un documento usando SOLO los fragmentos proporcionados.',
  'Cada fragmento empieza con su número de página, por ejemplo [p. 3].',
  'Responde en el idioma de la pregunta, con una o dos frases completas, y termina cada frase con la página de donde sale la información, con el formato [p. N].',
  `Si la información no está en los fragmentos, responde exactamente: ${NOT_FOUND}.`,
].join('\n');

const EXAMPLE_FRAGMENTS = 'Fragmentos:\n[p. 4] La sede de la empresa está en Sevilla desde 2019.\n[p. 9] El horario de atención es de 9 a 14 horas.';

/** Dos ejemplos cortos: así aprende el formato de cita y a decir «no aparece» sin inventar. */
export const FEW_SHOT: ChatMessage[] = [
  { role: 'user', content: `${EXAMPLE_FRAGMENTS}\n\nPregunta: ¿Dónde está la sede?` },
  { role: 'assistant', content: 'La sede de la empresa está en Sevilla desde 2019 [p. 4].' },
  { role: 'user', content: `${EXAMPLE_FRAGMENTS}\n\nPregunta: ¿Cuántos empleados tiene?` },
  { role: 'assistant', content: `${NOT_FOUND}.` },
];

export const GENERATION = {
  max_new_tokens: 300,
  temperature: 0.2,
  do_sample: false,
} as const;

/** Presupuesto de contexto para los fragmentos: un 0.5B se pierde con más. */
export const MAX_CONTEXT_TOKENS = 1500;

export interface PromptOptions {
  maxContextTokens?: number;
  /** Fragmentos que el usuario ha señalado en el visor: la pregunta va sobre ellos. */
  mentions?: Fragment[];
}

type Fragment = Pick<Chunk, 'page' | 'text'>;

/** Formatea un trozo tal y como lo ve el modelo. */
export function formatFragment(chunk: Fragment): string {
  return `[p. ${chunk.page}] ${chunk.text}`;
}

/**
 * Recorta la lista de trozos (ya ordenada por relevancia) al presupuesto de tokens.
 * Se descartan enteros los que no caben; si ni el primero cabe, se trunca.
 */
export function fitContext<T extends Fragment>(chunks: T[], maxTokens = MAX_CONTEXT_TOKENS): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const c of chunks) {
    const cost = estimateTokens(formatFragment(c));
    if (used + cost <= maxTokens) {
      kept.push(c);
      used += cost;
    } else if (kept.length === 0) {
      const room = Math.max(0, Math.floor(maxTokens * 3.5) - `[p. ${c.page}] `.length);
      kept.push({ ...c, text: c.text.slice(0, room) });
      break;
    }
  }
  return kept;
}

/**
 * Monta los mensajes para `tokenizer.apply_chat_template`: system, dos ejemplos y la pregunta real.
 * Si el usuario ha señalado un fragmento, se dice explícitamente: un 0.5B no deduce a qué se
 * refiere «esto» aunque el fragmento esté entre los del contexto.
 */
export function buildMessages(question: string, chunks: Fragment[], opts: PromptOptions = {}): ChatMessage[] {
  const fitted = fitContext(chunks, opts.maxContextTokens);
  const fragments = fitted.map(formatFragment).join('\n');
  const mentions = opts.mentions ?? [];
  const pointed = mentions.map((m) => `El usuario señala este fragmento de la página ${m.page}: «${m.text}»`).join('\n');
  const ask = mentions.length > 0 ? `Pregunta (sobre el fragmento señalado): ${question.trim()}` : `Pregunta: ${question.trim()}`;
  const user = [`Fragmentos:\n${fragments}`, pointed, ask].filter(Boolean).join('\n\n');
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...FEW_SHOT, { role: 'user', content: user }];
}

/** ¿La respuesta es el «no lo encuentro» del prompt? Tolera comillas, punto final y mayúsculas. */
export function isNotFound(answer: string): boolean {
  const a = answer.trim().toLowerCase().replace(/[«»"'.]/g, '');
  return a.startsWith(NOT_FOUND.toLowerCase());
}

/**
 * Extrae los números de página citados: [p. 12], [p. 3, 7], [pp. 4-6], [págs. 2 y 3].
 * Devuelve páginas únicas, en orden de aparición.
 */
export function extractCitations(text: string): number[] {
  const pages: number[] = [];
  const re = /\[\s*p(?:p|ágs?|ags?)?\.?\s*([\d\s,;\-–y&]+)\]/giu;
  for (const m of text.matchAll(re)) {
    const body = m[1] ?? '';
    for (const part of body.split(/[,;]|\s+y\s+|\s*&\s*/)) {
      const range = part.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        if (b >= a && b - a < 50) for (let p = a; p <= b; p++) pages.push(p);
        continue;
      }
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) pages.push(n);
    }
  }
  return [...new Set(pages)];
}

const STOPWORDS = new Set(
  'de la el los las en y a que un una es del al por con para se su sus lo como más o no the of and to in is it a an on for with that this'.split(' '),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Red de seguridad: si la respuesta no trae ninguna cita, se le añade la página del fragmento con
 * más palabras en común (mínimo 2). La cita siempre apunta a un trozo realmente recuperado.
 */
export function ensureCitation(answer: string, chunks: Fragment[]): string {
  const text = answer.trim();
  if (!text || isNotFound(text) || extractCitations(text).length > 0 || chunks.length === 0) return text;
  const answerWords = new Set(words(text));
  let best: { page: number; overlap: number } | null = null;
  for (const c of chunks) {
    const overlap = new Set(words(c.text).filter((w) => answerWords.has(w))).size;
    if (!best || overlap > best.overlap) best = { page: c.page, overlap };
  }
  if (!best || best.overlap < 2) return text;
  const end = /[.!?…]$/.test(text) ? text.slice(0, -1) : text;
  return `${end} [p. ${best.page}].`;
}

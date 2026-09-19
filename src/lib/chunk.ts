import type { Chunk, PageText } from './types';

export interface ChunkOptions {
  /** Tamaño objetivo de un trozo en caracteres (~350 tokens en español). */
  maxChars: number;
  /** Solapamiento entre trozos consecutivos (~60 tokens). */
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1200, overlapChars: 200 };

/**
 * Limpia el texto que devuelve pdf.js: une palabras partidas con guion al final de línea
 * («infor-\nmación» → «información»), colapsa espacios y deja como mucho una línea en blanco.
 */
export function cleanText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // guion de final de línea entre minúsculas: palabra partida
      .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
      // espacios y tabuladores repetidos
      .replace(/[ \t ]+/g, ' ')
      // espacios alrededor de saltos
      .replace(/ ?\n ?/g, '\n')
      // tres o más saltos → párrafo
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Divide en unidades: párrafos (separados por línea en blanco) y, dentro de cada párrafo,
 * frases. Las unidades se recomponen luego en trozos del tamaño objetivo.
 */
export function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const p = paragraph.trim();
    if (!p) continue;
    // Una frase termina en . ! ? … seguido de espacio y algo que parece inicio de frase.
    const sentences = p
      .replace(/\n/g, ' ')
      .split(/(?<=[.!?…])\s+(?=[\p{Lu}¿¡«"(\d])/u)
      .map((s) => s.trim())
      .filter(Boolean);
    units.push(...sentences);
  }
  return units;
}

/** Corta una unidad demasiado larga por espacios, sin pasarse de maxChars. */
function hardSplit(unit: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = unit;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Cola de un texto de ~n caracteres, empezando en una palabra entera. */
function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const start = text.indexOf(' ', text.length - n);
  return start === -1 ? text.slice(-n) : text.slice(start + 1);
}

/** Trocea el texto de UNA página. */
export function chunkPage(text: string, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const { maxChars, overlapChars } = opts;
  const units = splitUnits(cleanText(text)).flatMap((u) => (u.length > maxChars ? hardSplit(u, maxChars) : [u]));
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    // El siguiente trozo arranca con la cola del anterior para no cortar frases clave.
    const overlap = current && overlapChars > 0 ? tail(current, overlapChars) : '';
    current = overlap && overlap.length + 1 + unit.length <= maxChars ? `${overlap} ${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Trocea el documento entero. Los ids son correlativos y cada trozo pertenece a una sola página. */
export function chunkDocument(pages: PageText[], opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    for (const t of chunkPage(text, opts)) {
      chunks.push({ id: chunks.length, page, text: t });
    }
  }
  return chunks;
}

/** Estimación grosera de tokens para textos en español/inglés (~3,5 caracteres por token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

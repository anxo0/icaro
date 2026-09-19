import { describe, expect, it } from 'vitest';
import { chunkDocument, chunkPage, cleanText, estimateTokens, splitUnits } from './chunk';

const sentence = (i: number) => `Esta es la frase número ${i} del documento de prueba, con algo de relleno para que pese.`;
const longText = (n: number) => Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ');

describe('cleanText', () => {
  it('une palabras partidas con guion al final de línea', () => {
    expect(cleanText('la infor-\nmación llega')).toBe('la información llega');
  });

  it('no une guiones que no parten palabra (mayúscula o número después)', () => {
    expect(cleanText('Real Madrid-\nBarcelona')).toBe('Real Madrid-\nBarcelona');
    expect(cleanText('artículo 3-\n4')).toBe('artículo 3-\n4');
  });

  it('colapsa espacios dobles y espacios duros', () => {
    expect(cleanText('hola   mundo  ya')).toBe('hola mundo ya');
  });

  it('deja como mucho una línea en blanco y quita espacios junto a saltos', () => {
    expect(cleanText('a \n\n\n\n b')).toBe('a\n\nb');
  });

  it('normaliza saltos de Windows', () => {
    expect(cleanText('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('splitUnits', () => {
  it('separa por párrafos y por frases', () => {
    const units = splitUnits('Primera frase. Segunda frase.\n\nOtro párrafo. ¿Con pregunta? Sí.');
    expect(units).toEqual(['Primera frase.', 'Segunda frase.', 'Otro párrafo.', '¿Con pregunta?', 'Sí.']);
  });

  it('no parte en abreviaturas seguidas de minúscula', () => {
    expect(splitUnits('El art. tercero dice algo.')).toEqual(['El art. tercero dice algo.']);
  });
});

describe('chunkPage', () => {
  it('respeta el tamaño máximo', () => {
    const chunks = chunkPage(longText(60), { maxChars: 500, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
  });

  it('solapa trozos consecutivos: el principio de cada trozo está al final del anterior', () => {
    const chunks = chunkPage(longText(60), { maxChars: 500, overlapChars: 100 });
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const head = chunks[i]!.split(' ').slice(0, 3).join(' ');
      expect(prev.slice(-120).includes(head)).toBe(true);
      // y el solapamiento no pasa del límite pedido (más una palabra)
      const overlap = chunks[i]!.split(' ').findIndex((_, n, words) => !prev.endsWith(words.slice(0, n + 1).join(' ')));
      expect(chunks[i]!.split(' ').slice(0, overlap).join(' ').length).toBeLessThanOrEqual(100 + 20);
    }
  });

  it('no solapa cuando overlapChars es 0', () => {
    const chunks = chunkPage(longText(20), { maxChars: 300, overlapChars: 0 });
    const joined = chunks.join(' ');
    expect(joined).toBe(cleanText(longText(20)));
  });

  it('corta por palabras una unidad más larga que el máximo', () => {
    const word = 'palabra ';
    const chunks = chunkPage(word.repeat(200).trim(), { maxChars: 100, overlapChars: 0 });
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(100);
      expect(c.startsWith('palabra')).toBe(true);
      expect(c.endsWith('palabra')).toBe(true);
    }
  });

  it('devuelve vacío para texto vacío', () => {
    expect(chunkPage('   \n\n ')).toEqual([]);
  });

  it('con los valores por defecto un trozo ronda los 350 tokens', () => {
    const chunks = chunkPage(longText(80));
    const big = chunks.slice(0, -1);
    for (const c of big) expect(estimateTokens(c)).toBeGreaterThan(250);
    for (const c of big) expect(estimateTokens(c)).toBeLessThanOrEqual(400);
  });
});

describe('chunkDocument', () => {
  it('nunca mezcla páginas y numera los ids de forma correlativa', () => {
    const pages = [
      { page: 1, text: longText(30) },
      { page: 2, text: '' },
      { page: 3, text: longText(30) },
    ];
    const chunks = chunkDocument(pages, { maxChars: 400, overlapChars: 50 });
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 3]));
    for (const c of chunks) {
      const source = pages.find((p) => p.page === c.page)!.text;
      // cada trozo está contenido en el texto limpio de su página
      expect(cleanText(source).includes(c.text)).toBe(true);
    }
  });
});

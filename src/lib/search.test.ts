import { describe, expect, it } from 'vitest';
import { cosine, normalize, topK } from './search';

const vec = (...v: number[]) => normalize(new Float32Array(v));

function matrix(rows: Float32Array[]): Float32Array {
  const dims = rows[0]!.length;
  const m = new Float32Array(rows.length * dims);
  rows.forEach((r, i) => m.set(r, i * dims));
  return m;
}

describe('cosine', () => {
  it('vale 1 para vectores iguales, 0 para ortogonales y -1 para opuestos', () => {
    expect(cosine(vec(1, 0), vec(1, 0))).toBeCloseTo(1);
    expect(cosine(vec(1, 0), vec(0, 1))).toBeCloseTo(0);
    expect(cosine(vec(1, 0), vec(-1, 0))).toBeCloseTo(-1);
  });

  it('devuelve 0 si algún vector es nulo', () => {
    expect(cosine(new Float32Array([0, 0]), vec(1, 0))).toBe(0);
  });
});

describe('topK', () => {
  const rows = [vec(1, 0, 0), vec(0, 1, 0), vec(0.9, 0.1, 0), vec(0, 0, 1), vec(0.7, 0.7, 0)];
  const m = matrix(rows);

  it('devuelve los k más parecidos, ordenados de mayor a menor', () => {
    const hits = topK(vec(1, 0, 0), m, 3, 3);
    expect(hits.map((h) => h.index)).toEqual([0, 2, 4]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it('devuelve todas las filas si k es mayor que n', () => {
    const hits = topK(vec(0, 1, 0), m, 3, 10);
    expect(hits).toHaveLength(5);
    expect(hits[0]!.index).toBe(1);
  });

  it('funciona con k = 1', () => {
    expect(topK(vec(0, 0, 1), m, 3, 1)).toEqual([{ index: 3, score: expect.closeTo(1, 5) }]);
  });

  it('con muchas filas coincide con una ordenación completa', () => {
    const dims = 8;
    const n = 500;
    const seed = (i: number) => ((i * 9301 + 49297) % 233280) / 233280;
    const all = Array.from({ length: n }, (_, r) => vec(...Array.from({ length: dims }, (_, d) => seed(r * dims + d) - 0.5)));
    const big = matrix(all);
    const q = vec(...Array.from({ length: dims }, (_, d) => seed(d + 7) - 0.5));
    const expected = all
      .map((row, index) => ({ index, score: cosine(q, row) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((h) => h.index);
    expect(topK(q, big, dims, 5).map((h) => h.index)).toEqual(expected);
  });

  it('rechaza dimensiones incoherentes', () => {
    expect(() => topK(vec(1, 0), m, 3, 2)).toThrow();
  });
});

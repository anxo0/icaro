/**
 * Búsqueda por similitud coseno sobre un Float32Array plano (n × dims), sin librerías.
 * Los vectores llegan normalizados del modelo, así que el coseno es el producto escalar.
 */

export interface Match {
  index: number;
  score: number;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a));
}

/** Coseno entre dos vectores cualesquiera (normaliza por si acaso). */
export function cosine(a: Float32Array, b: Float32Array): number {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

/** Normaliza en sitio a norma 1. */
export function normalize(v: Float32Array): Float32Array {
  const n = norm(v);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

/**
 * Los k vectores más parecidos a `query` dentro de `matrix` (n filas de `dims`).
 * Devuelve índices de fila y puntuación, de mayor a menor.
 */
export function topK(query: Float32Array, matrix: Float32Array, dims: number, k: number): Match[] {
  if (dims <= 0 || query.length !== dims) throw new Error(`Dimensión inválida: query=${query.length}, dims=${dims}`);
  const n = Math.floor(matrix.length / dims);
  const best: Match[] = [];
  for (let row = 0; row < n; row++) {
    const off = row * dims;
    let s = 0;
    for (let i = 0; i < dims; i++) s += query[i]! * matrix[off + i]!;
    if (best.length < k) {
      best.push({ index: row, score: s });
      if (best.length === k) best.sort((a, b) => b.score - a.score);
      continue;
    }
    const last = best[k - 1];
    if (last && s > last.score) {
      // inserción ordenada: k es pequeño (5), no compensa nada más elaborado
      let pos = k - 1;
      while (pos > 0 && best[pos - 1]!.score < s) pos--;
      best.splice(pos, 0, { index: row, score: s });
      best.pop();
    }
  }
  if (best.length < k) best.sort((a, b) => b.score - a.score);
  return best;
}

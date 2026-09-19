import { describe, expect, it } from 'vitest';
import { buildMessages, ensureCitation, extractCitations, FEW_SHOT, fitContext, formatFragment, isNotFound, NOT_FOUND, SYSTEM_PROMPT } from './prompt';

const chunk = (page: number, text: string) => ({ page, text });

describe('buildMessages', () => {
  it('monta system + ejemplos + user con el formato del encargo', () => {
    const msgs = buildMessages('¿Qué dice?', [chunk(3, 'Texto tres.'), chunk(7, 'Texto siete.')]);
    expect(msgs).toHaveLength(2 + FEW_SHOT.length);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs.slice(1, -1)).toEqual(FEW_SHOT);
    const last = msgs.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toBe('Fragmentos:\n[p. 3] Texto tres.\n[p. 7] Texto siete.\n\nPregunta: ¿Qué dice?');
  });

  it('el system prompt exige citar y decir cuando no está; los ejemplos lo enseñan', () => {
    expect(SYSTEM_PROMPT).toContain(NOT_FOUND);
    expect(SYSTEM_PROMPT).toContain('[p. N]');
    expect(FEW_SHOT.some((m) => m.role === 'assistant' && /\[p\. \d+\]/.test(m.content))).toBe(true);
    expect(FEW_SHOT.some((m) => m.role === 'assistant' && isNotFound(m.content))).toBe(true);
  });

  it('recorta la pregunta', () => {
    const msgs = buildMessages('  hola  ', []);
    expect(msgs.at(-1)!.content.endsWith('Pregunta: hola')).toBe(true);
  });
});

describe('formatFragment', () => {
  it('prefija la página', () => {
    expect(formatFragment(chunk(12, 'abc'))).toBe('[p. 12] abc');
  });
});

describe('fitContext', () => {
  const big = 'x'.repeat(3500); // ~1000 tokens

  it('descarta los trozos que no caben, en orden', () => {
    const kept = fitContext([chunk(1, big), chunk(2, big), chunk(3, 'corto')], 1500);
    expect(kept.map((c) => c.page)).toEqual([1, 3]);
  });

  it('trunca el primero si ni ese cabe', () => {
    const kept = fitContext([chunk(1, 'y'.repeat(10000))], 100);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.text.length).toBeLessThan(400);
  });

  it('no toca listas que ya caben', () => {
    const list = [chunk(1, 'a'), chunk(2, 'b')];
    expect(fitContext(list)).toEqual(list);
  });
});

describe('isNotFound', () => {
  it('reconoce la frase literal y variantes con comillas o punto', () => {
    expect(isNotFound(NOT_FOUND)).toBe(true);
    expect(isNotFound('«No aparece en el documento».')).toBe(true);
    expect(isNotFound('no aparece en el documento')).toBe(true);
  });

  it('no se dispara con respuestas normales', () => {
    expect(isNotFound('El plazo es de 30 días [p. 4].')).toBe(false);
    expect(isNotFound('')).toBe(false);
  });
});

describe('extractCitations', () => {
  it('saca páginas sueltas, listas y rangos', () => {
    expect(extractCitations('Ver [p. 12] y [p. 3, 7] y [pp. 4-6].')).toEqual([12, 3, 7, 4, 5, 6]);
  });

  it('tolera variantes de formato', () => {
    expect(extractCitations('[p.12] [P. 2] [págs. 8 y 9] [pág. 1]')).toEqual([12, 2, 8, 9, 1]);
  });

  it('elimina duplicados y mantiene el orden', () => {
    expect(extractCitations('[p. 2] … [p. 2] … [p. 1]')).toEqual([2, 1]);
  });

  it('ignora corchetes que no son citas', () => {
    expect(extractCitations('array[0] y [nota]')).toEqual([]);
  });
});

describe('ensureCitation', () => {
  const chunks = [chunk(3, 'El presupuesto total del proyecto asciende a 4500 euros. La licencia es MIT.'), chunk(2, 'La reunión será el 3 de noviembre en Madrid.')];

  it('añade la página del fragmento con más solapamiento si no hay cita', () => {
    expect(ensureCitation('El presupuesto total asciende a 4500 euros.', chunks)).toBe('El presupuesto total asciende a 4500 euros [p. 3].');
  });

  it('no toca respuestas que ya citan, ni el «no aparece»', () => {
    expect(ensureCitation('Son 4500 euros [p. 3].', chunks)).toBe('Son 4500 euros [p. 3].');
    expect(ensureCitation(NOT_FOUND + '.', chunks)).toBe(NOT_FOUND + '.');
  });

  it('no inventa cita si no hay solapamiento suficiente', () => {
    expect(ensureCitation('Hola.', chunks)).toBe('Hola.');
  });
});

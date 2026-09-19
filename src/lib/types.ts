/** Texto de una página tal y como sale de pdf.js, ya limpio. */
export interface PageText {
  page: number;
  text: string;
}

/** Trozo de una página. Nunca mezcla páginas: la cita [p. N] tiene que ser exacta. */
export interface Chunk {
  id: number;
  page: number;
  text: string;
}

/** Trozo recuperado para una pregunta, con su similitud. */
export interface Hit extends Chunk {
  score: number;
}

export type Device = 'webgpu' | 'wasm';

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

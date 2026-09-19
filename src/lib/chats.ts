import type { LlmKey } from './models';
import { createStore } from './store';

/**
 * Chats guardados en localStorage. Cada chat pertenece a un PDF (por su hash): los trozos y
 * vectores viven en IndexedDB (ver cache.ts); aquí solo van los mensajes y los metadatos.
 * Las fuentes se guardan por id de trozo y se resuelven contra el documento al reabrir.
 */

export interface StoredSource {
  id: number;
  page: number;
  score: number;
}

export interface Mention {
  text: string;
  page: number;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  mentions?: Mention[];
  notFound?: boolean;
  interrupted?: boolean;
  sources?: StoredSource[];
  stats?: { tokens: number; ms: number };
}

export interface StoredChat {
  id: string;
  hash: string;
  pdfName: string;
  pages: number;
  size: number;
  chunks: number;
  llmKey: LlmKey;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const KEY = 'icaro:chats';
const MAX_CHATS = 50;

function read(): StoredChat[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredChat[]) : [];
  } catch {
    return [];
  }
}

function write(chats: StoredChat[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    /* sin espacio o modo privado */
  }
}

export interface ChatsState {
  chats: StoredChat[];
  /** Chat abierto en la app; null = pantalla de bienvenida. */
  activeId: string | null;
  /** true una vez leído localStorage (evita parpadeos en la lista). */
  hydrated: boolean;
}

export const chatsStore = createStore<ChatsState>({ chats: [], activeId: null, hydrated: false });

/** Carga la lista desde localStorage. Idempotente; lo llama la primera isla que se monte. */
export function hydrateChats(): void {
  if (chatsStore.get().hydrated) return;
  const chats = read().sort((a, b) => b.updatedAt - a.updatedAt);
  chatsStore.set({ chats, hydrated: true });
  // Cambios desde otra pestaña
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) chatsStore.set({ chats: read().sort((a, b) => b.updatedAt - a.updatedAt) });
  });
}

export function newChatId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function upsertChat(chat: StoredChat): void {
  const others = chatsStore.get().chats.filter((c) => c.id !== chat.id);
  const chats = [chat, ...others].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  chatsStore.set({ chats });
  write(chats);
}

export function deleteChat(id: string): void {
  const chats = chatsStore.get().chats.filter((c) => c.id !== id);
  chatsStore.set((s) => ({ chats, activeId: s.activeId === id ? null : s.activeId }));
  write(chats);
}

export function clearChats(): void {
  chatsStore.set({ chats: [], activeId: null });
  write([]);
}

export function openChat(id: string | null): void {
  chatsStore.set({ activeId: id });
}

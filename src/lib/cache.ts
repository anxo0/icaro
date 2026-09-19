import type { Chunk } from './types';

/**
 * Caché en IndexedDB: hash del PDF → trozos + vectores. La segunda vez que se suelta el mismo
 * fichero no hay que volver a extraer ni a embeber. La clave incluye el modelo de embeddings
 * para que un cambio de modelo invalide la entrada.
 */

const DB_NAME = 'icaro';
const DB_VERSION = 1;
const STORE = 'docs';

export interface CachedDoc {
  key: string;
  hash: string;
  name: string;
  size: number;
  pages: number;
  model: string;
  dims: number;
  chunks: Chunk[];
  /** Float32Array plano (chunks.length × dims), guardado como ArrayBuffer. */
  vectors: ArrayBuffer;
  /** Bytes del PDF, para el visor al reabrir un chat. Se omite si pesa demasiado. */
  pdf?: ArrayBuffer;
  createdAt: number;
}

export function cacheKey(hash: string, model: string): string {
  return `${hash}:${model}`;
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export async function getDoc(key: string): Promise<CachedDoc | undefined> {
  if (!hasIndexedDB()) return undefined;
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readonly');
    const doc = await request(tx.objectStore(STORE).get(key) as IDBRequest<CachedDoc | undefined>);
    db.close();
    return doc;
  } catch {
    return undefined;
  }
}

export async function putDoc(doc: CachedDoc): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).put(doc));
    db.close();
  } catch {
    /* sin espacio o modo privado: la app sigue funcionando sin caché */
  }
}

export async function clearDocs(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    await request(tx.objectStore(STORE).clear());
    db.close();
  } catch {
    /* nada que borrar */
  }
}

/** Borra también los pesos de los modelos que transformers.js guarda en la Cache API. */
export async function clearModelCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const name of await caches.keys()) await caches.delete(name);
  } catch {
    /* sin permisos */
  }
}

/** Tamaño aproximado de lo que ocupa la app en disco (modelos + documentos), si el navegador lo dice. */
export async function storageUsage(): Promise<number | undefined> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage;
  } catch {
    return undefined;
  }
}

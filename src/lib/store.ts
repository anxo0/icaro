import { useSyncExternalStore } from 'react';

/**
 * Almacén mínimo compartido entre islas. Las islas de una misma página comparten los módulos ES,
 * así que un store a nivel de módulo es un singleton para la lista de chats (barra lateral) y
 * la app (chat activo), sin contexto de React ni librerías.
 */
export interface Store<T> {
  get: () => T;
  set: (patch: Partial<T> | ((prev: T) => Partial<T>)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object, S>(store: Store<T>, selector: (state: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}

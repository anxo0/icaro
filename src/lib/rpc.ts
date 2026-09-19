/**
 * Mensajería tipada con los Web Workers.
 *
 * Cada worker declara un `Protocol`: por cada tipo de petición, el payload que recibe (`req`),
 * lo que devuelve al terminar (`res`) y los eventos intermedios que puede emitir mientras tanto
 * (`ev`: progreso, tokens…). El cliente en la UI hace `call()` y recibe una promesa; los eventos
 * llegan por `onEvent`. `notify()` es fuego y olvido (p. ej. «para de generar»).
 */

export interface Method<Req = void, Res = void, Ev = never> {
  req: Req;
  res: Res;
  ev: Ev;
}

export type Protocol = Record<string, Method<unknown, unknown, unknown>>;

type Envelope =
  | { kind: 'request'; id: number; type: string; payload: unknown }
  | { kind: 'notify'; type: string; payload: unknown }
  | { kind: 'event'; id: number; payload: unknown }
  | { kind: 'result'; id: number; payload: unknown }
  | { kind: 'error'; id: number; message: string };

export interface CallOptions<Ev> {
  transfer?: Transferable[];
  onEvent?: (event: Ev) => void;
}

export interface Client<P extends Protocol, N extends Record<string, unknown> = Record<string, never>> {
  call<K extends keyof P & string>(type: K, payload: P[K]['req'], opts?: CallOptions<P[K]['ev']>): Promise<P[K]['res']>;
  notify<K extends keyof N & string>(type: K, payload: N[K]): void;
  terminate(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onEvent?: (event: unknown) => void;
}

/** Lado UI. */
export function createClient<P extends Protocol, N extends Record<string, unknown> = Record<string, never>>(worker: Worker): Client<P, N> {
  const pending = new Map<number, Pending>();
  let seq = 0;

  worker.onmessage = (e: MessageEvent<Envelope>) => {
    const msg = e.data;
    if (msg.kind === 'request' || msg.kind === 'notify') return;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.kind === 'event') {
      p.onEvent?.(msg.payload);
    } else if (msg.kind === 'result') {
      pending.delete(msg.id);
      p.resolve(msg.payload);
    } else {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Worker error');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  return {
    call(type, payload, opts) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onEvent: opts?.onEvent as Pending['onEvent'] });
        const msg: Envelope = { kind: 'request', id, type, payload };
        worker.postMessage(msg, opts?.transfer ?? []);
      });
    },
    notify(type, payload) {
      const msg: Envelope = { kind: 'notify', type, payload };
      worker.postMessage(msg);
    },
    terminate() {
      const err = new Error('Worker terminated');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker.terminate();
    },
  };
}

/** Marca un resultado cuyos buffers deben transferirse en vez de copiarse. */
export class Transfer<T> {
  constructor(
    public readonly value: T,
    public readonly transferables: Transferable[],
  ) {}
}

export type Handlers<P extends Protocol> = {
  [K in keyof P]: (payload: P[K]['req'], emit: (event: P[K]['ev']) => void) => Promise<P[K]['res'] | Transfer<P[K]['res']>> | P[K]['res'] | Transfer<P[K]['res']>;
};

export type Notifications<N extends Record<string, unknown>> = {
  [K in keyof N]: (payload: N[K]) => void;
};

/** Lado worker. */
export function serve<P extends Protocol, N extends Record<string, unknown> = Record<string, never>>(handlers: Handlers<P>, notifications?: Notifications<N>): void {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<Envelope>) => void) | null; postMessage: Worker['postMessage'] };
  scope.onmessage = async (e) => {
    const msg = e.data;
    if (msg.kind === 'notify') {
      notifications?.[msg.type as keyof N]?.(msg.payload as N[keyof N]);
      return;
    }
    if (msg.kind !== 'request') return;
    const { id, type, payload } = msg;
    const handler = handlers[type as keyof P];
    if (!handler) {
      scope.postMessage({ kind: 'error', id, message: `Unknown request type: ${type}` } satisfies Envelope);
      return;
    }
    try {
      const out = await handler(payload as P[keyof P]['req'], (event) => {
        scope.postMessage({ kind: 'event', id, payload: event } satisfies Envelope);
      });
      if (out instanceof Transfer) {
        scope.postMessage({ kind: 'result', id, payload: out.value } satisfies Envelope, out.transferables);
      } else {
        scope.postMessage({ kind: 'result', id, payload: out } satisfies Envelope);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      scope.postMessage({ kind: 'error', id, message } satisfies Envelope);
    }
  };
}

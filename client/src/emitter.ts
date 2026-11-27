// Minimal typed event emitter.
export type Listener<T> = (payload: T) => void;

export class Emitter<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<Listener<any>>>();

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[emitter] listener for ${String(event)} failed`, err);
      }
    }
  }
}

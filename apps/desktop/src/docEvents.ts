import { VaultEvent } from "./api";

type Listener = (event: VaultEvent) => void;

/** Tiny pub/sub used to fan vault watcher events out to open documents. */
class DocEvents {
  private listeners = new Set<Listener>();

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: VaultEvent) {
    for (const fn of this.listeners) fn(event);
  }
}

export const docEvents = new DocEvents();

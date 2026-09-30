/**
 * Keyed one-shot timers. Scheduling a key that already exists replaces it, so
 * a room can never have two live turn timers.
 *
 * Timers are process-local. When scaling out with Redis, replace this with a
 * distributed scheduler (e.g. BullMQ delayed jobs or Redis keyspace expiry);
 * RoomManager only depends on `schedule` / `clear` / `clearPrefix`.
 */
export class TimerManager {
  private timers = new Map<string, NodeJS.Timeout>();

  schedule(key: string, at: number, fn: () => void): void {
    this.clear(key);
    const delay = Math.max(0, at - Date.now());
    const handle = setTimeout(() => {
      this.timers.delete(key);
      fn();
    }, delay);
    this.timers.set(key, handle);
  }

  clear(key: string): void {
    const handle = this.timers.get(key);
    if (handle) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  clearPrefix(prefix: string): void {
    for (const key of [...this.timers.keys()]) {
      if (key.startsWith(prefix)) this.clear(key);
    }
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }

  clearAll(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }
}

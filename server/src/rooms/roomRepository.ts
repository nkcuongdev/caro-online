import type { Room } from '../types.js';

/**
 * Storage boundary for room state. The API is async so a Redis (or Mongo)
 * implementation can be dropped in without touching RoomManager.
 */
export interface RoomRepository {
  get(id: string): Promise<Room | undefined>;
  save(room: Room): Promise<void>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  list(): Promise<Room[]>;
}

export class MemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, Room>();

  async get(id: string) {
    return this.rooms.get(id);
  }

  async save(room: Room) {
    this.rooms.set(room.id, room);
  }

  async delete(id: string) {
    this.rooms.delete(id);
  }

  async exists(id: string) {
    return this.rooms.has(id);
  }

  async list() {
    return [...this.rooms.values()];
  }
}

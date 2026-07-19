import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { GroupSnapshot, SyncOp } from "../types";

export interface DeviceGroup {
  slug: string;
  name: string;
  accentColor: string;
  baseCurrency: string;
  lastOpenedAt: number;
}

export interface OutboxItem {
  key?: number;
  op: SyncOp;
  addedAt: number;
}

interface SumUpDB extends DBSchema {
  snapshots: { key: string; value: GroupSnapshot };
  outbox: { key: number; value: OutboxItem };
  deviceGroups: { key: string; value: DeviceGroup };
}

let dbPromise: Promise<IDBPDatabase<SumUpDB>> | null = null;

function db() {
  dbPromise ??= openDB<SumUpDB>("sumup", 1, {
    upgrade(database) {
      database.createObjectStore("snapshots");
      database.createObjectStore("outbox", { autoIncrement: true });
      database.createObjectStore("deviceGroups", { keyPath: "slug" });
    },
  });
  return dbPromise;
}

export async function saveSnapshot(snapshot: GroupSnapshot): Promise<void> {
  await (await db()).put("snapshots", snapshot, snapshot.group.slug);
}

export async function getSnapshot(slug: string): Promise<GroupSnapshot | undefined> {
  return (await db()).get("snapshots", slug);
}

export async function deleteSnapshot(slug: string): Promise<void> {
  await (await db()).delete("snapshots", slug);
}

export async function enqueueOp(op: SyncOp): Promise<void> {
  await (await db()).add("outbox", { op, addedAt: Date.now() });
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const database = await db();
  const items: OutboxItem[] = [];
  let cursor = await database.transaction("outbox").store.openCursor();
  while (cursor) {
    items.push({ ...cursor.value, key: cursor.key });
    cursor = await cursor.continue();
  }
  return items;
}

export async function removeOutboxItems(keys: number[]): Promise<void> {
  const tx = (await db()).transaction("outbox", "readwrite");
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
}

export async function rememberDeviceGroup(group: DeviceGroup): Promise<void> {
  await (await db()).put("deviceGroups", group);
}

export async function forgetDeviceGroup(slug: string): Promise<void> {
  const database = await db();
  await database.delete("deviceGroups", slug);
  await database.delete("snapshots", slug);
}

export async function listDeviceGroups(): Promise<DeviceGroup[]> {
  const groups = await (await db()).getAll("deviceGroups");
  return groups.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

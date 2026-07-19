import { enqueueOp, listOutbox, removeOutboxItems } from "./idb";
import type { SyncOp, SyncResult } from "../types";

let flushing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

/** Subscribe to "outbox changed" (queued, flushed) for pending-count badges. */
export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

export async function pendingCount(slug?: string): Promise<number> {
  const items = await listOutbox();
  return slug ? items.filter((i) => i.op.slug === slug).length : items.length;
}

export async function pendingOps(slug: string): Promise<SyncOp[]> {
  return (await listOutbox()).filter((i) => i.op.slug === slug).map((i) => i.op);
}

/**
 * Queue an op and immediately try to flush. Resolves once the op is either
 * synced or safely persisted for later — the UI never waits on the network.
 */
export async function submitOp(op: SyncOp): Promise<void> {
  await enqueueOp(op);
  notify();
  void flushOutbox();
}

/** Replay the outbox against the server in order. Safe to call repeatedly. */
export function flushOutbox(): Promise<boolean> {
  flushing ??= drainOutbox().finally(() => {
    flushing = null;
  });
  return flushing;
}

// Loop until the outbox is empty or a round makes no progress — ops enqueued
// while a round is in flight are picked up by the next round.
async function drainOutbox(): Promise<boolean> {
  for (let round = 0; round < 10; round++) {
    const before = (await listOutbox()).length;
    if (before === 0) return true;
    await doFlush();
    const after = (await listOutbox()).length;
    if (after === 0) return true;
    if (after >= before) return false; // offline or rejected — stop, retry later
  }
  return false;
}

async function doFlush(): Promise<boolean> {
  const items = await listOutbox();
  if (items.length === 0) return true;
  try {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: items.map((i) => i.op) }),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as SyncResult;
    const doneIndices = new Set([
      ...result.applied.map(Number),
      ...result.rejected.map((r) => r.index),
    ]);
    await removeOutboxItems(
      items.filter((_, index) => doneIndices.has(index)).map((i) => i.key!),
    );
    notify();
    return doneIndices.size === items.length;
  } catch {
    return false; // offline — the queue stays put
  }
}

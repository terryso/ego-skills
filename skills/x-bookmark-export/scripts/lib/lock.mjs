// Exclusive archive lock. Crash recovery steals a dead same-host pid.
// A live holder is never stolen, including after the TTL.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowError } from "./pure.mjs";

export function pidAlive(pid, kill = (nextPid, signal) => process.kill(nextPid, signal)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

export function defaultProbe(pid) {
  return pidAlive(pid);
}

function readLock(lockPath, fsImpl) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(lockPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function lockIsStale(info, { now, host, ttlMs, probe }) {
  if (!info || typeof info.token !== "string" || info.token === "") return true;
  const created = Date.parse(info.created_at);
  const age = Number.isFinite(created) ? now - created : Number.POSITIVE_INFINITY;
  if (info.host === host && probe(info.pid)) return false;
  if (info.host === host) return true;
  return age > ttlMs;
}

export function acquireLock(dir, opts = {}) {
  const fsImpl = opts.fs || fs;
  const now = opts.now || (() => Date.now());
  const pid = opts.pid ?? process.pid;
  const host = opts.host || os.hostname();
  const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
  const probe = opts.probe || defaultProbe;
  const token = opts.token || crypto.randomBytes(16).toString("hex");
  const lockPath = path.join(dir, "lock.json");
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const payload = {
    schema: 1,
    token,
    pid,
    host,
    created_at: new Date(now()).toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fsImpl.openSync(lockPath, "wx", 0o600);
      try {
        fsImpl.writeSync(fd, `${JSON.stringify(payload)}\n`);
      } finally {
        fsImpl.closeSync(fd);
      }
      return {
        lockPath,
        token,
        release() {
          return releaseLock(dir, token, { fs: fsImpl });
        },
      };
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      const current = readLock(lockPath, fsImpl);
      if (!lockIsStale(current, { now: now(), host, ttlMs, probe })) {
        throw new WorkflowError("lock_busy", "archive lock is held by another worker", {
          holder_pid: current && current.pid,
          holder_host: current && current.host,
        });
      }
      try {
        fsImpl.unlinkSync(lockPath);
      } catch {
        // Another worker already removed it. Retry the exclusive create.
      }
    }
  }
  throw new WorkflowError("lock_busy", "archive lock is held by another worker");
}

export function releaseLock(dir, token, opts = {}) {
  const fsImpl = opts.fs || fs;
  const lockPath = path.join(dir, "lock.json");
  const current = readLock(lockPath, fsImpl);
  if (!current || current.token !== token) return false;
  fsImpl.unlinkSync(lockPath);
  return true;
}

const reentrant = new Map();

export function withLock(dir, fn, opts) {
  const key = path.resolve(dir);
  if ((reentrant.get(key) || 0) > 0) return fn();
  const lock = acquireLock(dir, opts);
  reentrant.set(key, 1);
  try {
    return fn();
  } finally {
    reentrant.set(key, 0);
    lock.release();
  }
}

interface LockEntry {
  instancePath: string;
  holder: string;
  acquiredAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class LockService {
  private locks = new Map<string, LockEntry>();

  acquire(instancePath: string, agentId: string, ttlMs = DEFAULT_TTL_MS): { acquired: boolean; holder: string; expiresAt: number } {
    this.cleanup();

    const existing = this.locks.get(instancePath);
    if (existing) {
      if (existing.holder === agentId) {
        existing.expiresAt = Date.now() + ttlMs;
        return { acquired: true, holder: agentId, expiresAt: existing.expiresAt };
      }
      return { acquired: false, holder: existing.holder, expiresAt: existing.expiresAt };
    }

    const now = Date.now();
    const entry: LockEntry = {
      instancePath,
      holder: agentId,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
    this.locks.set(instancePath, entry);
    return { acquired: true, holder: agentId, expiresAt: entry.expiresAt };
  }

  release(instancePath: string, agentId: string): { released: boolean; error?: string } {
    this.cleanup();

    const existing = this.locks.get(instancePath);
    if (!existing) {
      return { released: false, error: `No lock found for: ${instancePath}` };
    }
    if (existing.holder !== agentId) {
      return { released: false, error: `Lock held by ${existing.holder}, not ${agentId}` };
    }
    this.locks.delete(instancePath);
    return { released: true };
  }

  list(): LockEntry[] {
    this.cleanup();
    return Array.from(this.locks.values());
  }

  private cleanup() {
    const now = Date.now();
    for (const [path, entry] of this.locks) {
      if (entry.expiresAt <= now) {
        this.locks.delete(path);
      }
    }
  }
}

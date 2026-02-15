interface ActivityEntry {
  agentId: string;
  action: string;
  instancePath?: string;
  timestamp: number;
}

const MAX_ENTRIES = 50;

export class ActivityService {
  private buffer: ActivityEntry[] = [];

  report(agentId: string, action: string, instancePath?: string): ActivityEntry {
    const entry: ActivityEntry = {
      agentId,
      action,
      instancePath,
      timestamp: Date.now(),
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_ENTRIES) {
      this.buffer.shift();
    }

    return entry;
  }

  getAll(): ActivityEntry[] {
    return [...this.buffer];
  }
}

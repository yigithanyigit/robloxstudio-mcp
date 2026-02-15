import { ActivityService } from '../activity-service';

describe('ActivityService', () => {
  let activityService: ActivityService;

  beforeEach(() => {
    activityService = new ActivityService();
  });

  test('should return empty array initially', () => {
    expect(activityService.getAll()).toEqual([]);
  });

  test('should report an activity entry', () => {
    const entry = activityService.report('agent-1', 'edited script');
    expect(entry.agentId).toBe('agent-1');
    expect(entry.action).toBe('edited script');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.instancePath).toBeUndefined();
  });

  test('should include instancePath when provided', () => {
    const entry = activityService.report('agent-1', 'edited script', 'game.ServerScriptService.Main');
    expect(entry.instancePath).toBe('game.ServerScriptService.Main');
  });

  test('should return entries in insertion order', () => {
    activityService.report('agent-1', 'action-1');
    activityService.report('agent-2', 'action-2');
    activityService.report('agent-1', 'action-3');

    const all = activityService.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].action).toBe('action-1');
    expect(all[1].action).toBe('action-2');
    expect(all[2].action).toBe('action-3');
  });

  test('should cap buffer at 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      activityService.report('agent-1', `action-${i}`);
    }

    const all = activityService.getAll();
    expect(all).toHaveLength(50);
    // Oldest 5 should be dropped
    expect(all[0].action).toBe('action-5');
    expect(all[49].action).toBe('action-54');
  });

  test('should return a copy of the buffer', () => {
    activityService.report('agent-1', 'action-1');
    const all = activityService.getAll();
    all.pop();
    expect(activityService.getAll()).toHaveLength(1);
  });
});

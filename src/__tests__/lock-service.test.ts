import { LockService } from '../lock-service';

describe('LockService', () => {
  let lockService: LockService;

  beforeEach(() => {
    lockService = new LockService();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Acquire', () => {
    test('should acquire a lock successfully', () => {
      const result = lockService.acquire('game.Workspace.Part', 'agent-1');
      expect(result.acquired).toBe(true);
      expect(result.holder).toBe('agent-1');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    test('should reject lock when held by another agent', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');
      const result = lockService.acquire('game.Workspace.Part', 'agent-2');
      expect(result.acquired).toBe(false);
      expect(result.holder).toBe('agent-1');
    });

    test('should allow re-acquire by same agent and refresh TTL', () => {
      const first = lockService.acquire('game.Workspace.Part', 'agent-1');

      jest.advanceTimersByTime(60000); // 1 minute later

      const second = lockService.acquire('game.Workspace.Part', 'agent-1');
      expect(second.acquired).toBe(true);
      expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
    });

    test('should allow acquiring different paths independently', () => {
      const r1 = lockService.acquire('game.Workspace.Part1', 'agent-1');
      const r2 = lockService.acquire('game.Workspace.Part2', 'agent-2');
      expect(r1.acquired).toBe(true);
      expect(r2.acquired).toBe(true);
    });
  });

  describe('Release', () => {
    test('should release a lock held by the agent', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');
      const result = lockService.release('game.Workspace.Part', 'agent-1');
      expect(result.released).toBe(true);
    });

    test('should not release a lock held by another agent', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');
      const result = lockService.release('game.Workspace.Part', 'agent-2');
      expect(result.released).toBe(false);
      expect(result.error).toContain('agent-1');
    });

    test('should return error when releasing non-existent lock', () => {
      const result = lockService.release('game.Workspace.Nothing', 'agent-1');
      expect(result.released).toBe(false);
      expect(result.error).toContain('No lock found');
    });

    test('should allow new acquire after release', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');
      lockService.release('game.Workspace.Part', 'agent-1');
      const result = lockService.acquire('game.Workspace.Part', 'agent-2');
      expect(result.acquired).toBe(true);
      expect(result.holder).toBe('agent-2');
    });
  });

  describe('List', () => {
    test('should return all active locks', () => {
      lockService.acquire('game.Workspace.Part1', 'agent-1');
      lockService.acquire('game.Workspace.Part2', 'agent-2');
      const locks = lockService.list();
      expect(locks).toHaveLength(2);
      expect(locks.map(l => l.instancePath)).toContain('game.Workspace.Part1');
      expect(locks.map(l => l.instancePath)).toContain('game.Workspace.Part2');
    });

    test('should return empty array when no locks', () => {
      expect(lockService.list()).toHaveLength(0);
    });
  });

  describe('TTL Expiry', () => {
    test('should clean up expired locks', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');
      expect(lockService.list()).toHaveLength(1);

      // Advance past 5 minute TTL
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(lockService.list()).toHaveLength(0);
    });

    test('should allow acquire after lock expires', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1');

      jest.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = lockService.acquire('game.Workspace.Part', 'agent-2');
      expect(result.acquired).toBe(true);
      expect(result.holder).toBe('agent-2');
    });

    test('should support custom TTL', () => {
      lockService.acquire('game.Workspace.Part', 'agent-1', 1000); // 1 second TTL
      expect(lockService.list()).toHaveLength(1);

      jest.advanceTimersByTime(1001);
      expect(lockService.list()).toHaveLength(0);
    });
  });
});

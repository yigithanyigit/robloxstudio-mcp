import { RobloxStudioTools } from '../tools/index';
import { BridgeService } from '../bridge-service';

describe('New Tool Methods', () => {
  let tools: RobloxStudioTools;
  let bridge: BridgeService;

  beforeEach(() => {
    bridge = new BridgeService();
    tools = new RobloxStudioTools(bridge);
  });

  afterEach(() => {
    bridge.clearAllPendingRequests();
  });

  describe('Lock Tools (server-only)', () => {
    test('acquireLock should acquire and return MCP response', async () => {
      const result = await tools.acquireLock('game.Workspace.Part', 'agent-1');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text as string);
      expect(data.acquired).toBe(true);
      expect(data.holder).toBe('agent-1');
    });

    test('acquireLock should reject conflict', async () => {
      await tools.acquireLock('game.Workspace.Part', 'agent-1');
      const result = await tools.releaseLock('game.Workspace.Part', 'agent-1');
      const data = JSON.parse(result.content[0].text as string);
      expect(data.released).toBe(true);
    });

    test('acquireLock should throw without instancePath', async () => {
      await expect(tools.acquireLock('', 'agent-1')).rejects.toThrow('instancePath and agentId are required');
    });

    test('acquireLock should throw without agentId', async () => {
      await expect(tools.acquireLock('game.Workspace.Part', '')).rejects.toThrow('instancePath and agentId are required');
    });

    test('releaseLock should throw without params', async () => {
      await expect(tools.releaseLock('', '')).rejects.toThrow('instancePath and agentId are required');
    });

    test('listLocks should return empty array initially', async () => {
      const result = await tools.listLocks();
      const data = JSON.parse(result.content[0].text as string);
      expect(data).toEqual([]);
    });

    test('listLocks should return acquired locks', async () => {
      await tools.acquireLock('game.Workspace.Part1', 'agent-1');
      await tools.acquireLock('game.Workspace.Part2', 'agent-2');
      const result = await tools.listLocks();
      const data = JSON.parse(result.content[0].text as string);
      expect(data).toHaveLength(2);
    });
  });

  describe('Activity Tools (server-only)', () => {
    test('reportActivity should log entry and return it', async () => {
      const result = await tools.reportActivity('agent-1', 'edited script', 'game.ServerScriptService.Main');
      const data = JSON.parse(result.content[0].text as string);
      expect(data.agentId).toBe('agent-1');
      expect(data.action).toBe('edited script');
      expect(data.instancePath).toBe('game.ServerScriptService.Main');
    });

    test('reportActivity should throw without agentId', async () => {
      await expect(tools.reportActivity('', 'action')).rejects.toThrow('agentId and action are required');
    });

    test('reportActivity should throw without action', async () => {
      await expect(tools.reportActivity('agent-1', '')).rejects.toThrow('agentId and action are required');
    });

    test('getActivity should return all entries', async () => {
      await tools.reportActivity('agent-1', 'action-1');
      await tools.reportActivity('agent-2', 'action-2');
      const result = await tools.getActivity();
      const data = JSON.parse(result.content[0].text as string);
      expect(data).toHaveLength(2);
    });

    test('getActivity should return empty array initially', async () => {
      const result = await tools.getActivity();
      const data = JSON.parse(result.content[0].text as string);
      expect(data).toEqual([]);
    });
  });

  describe('Plugin-dispatched Tools (validation + dispatch)', () => {
    test('validateScript should throw when no instancePath or source', async () => {
      await expect(tools.validateScript()).rejects.toThrow('Either instancePath or source is required');
    });

    test('validateScript should dispatch to bridge with instancePath', async () => {
      const toolPromise = tools.validateScript('game.ServerScriptService.Script');
      const pending = bridge.getPendingRequest();
      expect(pending).toBeTruthy();
      expect(pending?.request.endpoint).toBe('/api/validate-script');
      expect(pending?.request.data).toEqual({ instancePath: 'game.ServerScriptService.Script', source: undefined });

      bridge.resolveRequest(pending!.requestId, { valid: true, errors: [] });
      const result = await toolPromise;
      expect(result.content[0].type).toBe('text');
      const data = JSON.parse(result.content[0].text as string);
      expect(data.valid).toBe(true);
    });

    test('validateScript should dispatch with raw source', async () => {
      const toolPromise = tools.validateScript(undefined, 'print("hello")');
      const pending = bridge.getPendingRequest();
      expect(pending?.request.data).toEqual({ instancePath: undefined, source: 'print("hello")' });
      bridge.resolveRequest(pending!.requestId, { valid: true, errors: [] });
      await toolPromise;
    });

    test('getScriptDeps should throw without instancePath', async () => {
      await expect(tools.getScriptDeps('')).rejects.toThrow('Instance path is required');
    });

    test('getScriptDeps should dispatch correct endpoint', async () => {
      const toolPromise = tools.getScriptDeps('game.ServerScriptService.Script');
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/get-script-deps');
      bridge.resolveRequest(pending!.requestId, { requires: [], requiredBy: [] });
      await toolPromise;
    });

    test('getModuleInfo should throw without instancePath', async () => {
      await expect(tools.getModuleInfo('')).rejects.toThrow('Instance path is required');
    });

    test('getModuleInfo should dispatch correct endpoint', async () => {
      const toolPromise = tools.getModuleInfo('game.ReplicatedStorage.Module');
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/get-module-info');
      bridge.resolveRequest(pending!.requestId, { exports: [], dependencies: [], lineCount: 10 });
      await toolPromise;
    });

    test('moveInstance should throw without instancePath', async () => {
      await expect(tools.moveInstance('', 'game.Workspace')).rejects.toThrow('Instance path is required');
    });

    test('moveInstance should throw without newParent and newName', async () => {
      await expect(tools.moveInstance('game.Workspace.Part')).rejects.toThrow('At least newParent or newName');
    });

    test('moveInstance should dispatch correct endpoint', async () => {
      const toolPromise = tools.moveInstance('game.Workspace.Part', 'game.ServerStorage', 'RenamedPart');
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/move-instance');
      expect(pending?.request.data).toEqual({
        instancePath: 'game.Workspace.Part',
        newParent: 'game.ServerStorage',
        newName: 'RenamedPart',
      });
      bridge.resolveRequest(pending!.requestId, { success: true, oldPath: 'game.Workspace.Part', newPath: 'game.ServerStorage.RenamedPart' });
      await toolPromise;
    });

    test('sendGameCommand should throw without command', async () => {
      await expect(tools.sendGameCommand('')).rejects.toThrow('command is required');
    });

    test('sendGameCommand should dispatch correct endpoint', async () => {
      const toolPromise = tools.sendGameCommand('move_player', { targetPosition: { X: 0, Y: 10, Z: 0 } });
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/send-game-command');
      bridge.resolveRequest(pending!.requestId, { success: true, result: 'Player moved' });
      await toolPromise;
    });

    test('getGameState should dispatch correct endpoint', async () => {
      const toolPromise = tools.getGameState('players');
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/get-game-state');
      expect(pending?.request.data).toEqual({ query: 'players' });
      bridge.resolveRequest(pending!.requestId, { isRunning: true, players: [] });
      await toolPromise;
    });

    test('getPlaytestOutput should dispatch with filter params', async () => {
      const toolPromise = tools.getPlaytestOutput('error', 12345, true);
      const pending = bridge.getPendingRequest();
      expect(pending?.request.endpoint).toBe('/api/get-playtest-output');
      expect(pending?.request.data).toEqual({ filter: 'error', since: 12345, clear: true });
      bridge.resolveRequest(pending!.requestId, { isRunning: false, output: [], outputCount: 0 });
      await toolPromise;
    });
  });
});

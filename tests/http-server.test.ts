import request from 'supertest';
import { createHttpServer } from '../src/http-server.js';
import { BridgeService } from '../src/bridge-service.js';


const mockTools = {} as any;

describe('HTTP Server - MCP connection state', () => {
  let bridge: BridgeService;
  let app: any;

  beforeEach(() => {
    bridge = new BridgeService();
    app = createHttpServer(mockTools, bridge);
  });

  describe('poll endpoint without MCP client', () => {
    it('should return mcpConnected: false when no MCP client has connected', async () => {

      const res = await request(app).get('/poll');

      expect(res.status).toBe(503);
      expect(res.body.mcpConnected).toBe(false);
    });

    it('should not get stuck reporting mcpConnected: true from polling alone', async () => {

      await request(app).get('/poll');
      await request(app).get('/poll');
      await request(app).get('/poll');

      const res = await request(app).get('/poll');

      expect(res.status).toBe(503);
      expect(res.body.mcpConnected).toBe(false);
    });
  });

  describe('poll endpoint with active MCP client', () => {
    beforeEach(() => {

      (app as any).setMCPServerActive(true);
    });

    it('should return mcpConnected: true when MCP is active', async () => {
      const res = await request(app).get('/poll');

      expect(res.status).toBe(200);
      expect(res.body.mcpConnected).toBe(true);
      expect(res.body.pluginConnected).toBe(true);
    });

    it('should return no request when bridge queue is empty', async () => {
      const res = await request(app).get('/poll');

      expect(res.status).toBe(200);
      expect(res.body.request).toBeNull();
    });
  });

  describe('MCP activity timeout', () => {
    it('should report mcpConnected: false after MCP activity times out', async () => {

      (app as any).setMCPServerActive(true);


      let res = await request(app).get('/poll');
      expect(res.status).toBe(200);
      expect(res.body.mcpConnected).toBe(true);


      (app as any).setMCPServerActive(false);


      res = await request(app).get('/poll');
      expect(res.status).toBe(503);
      expect(res.body.mcpConnected).toBe(false);
    });

    it('should recover when MCP tool call refreshes activity', async () => {
      (app as any).setMCPServerActive(true);

      (app as any).setMCPServerActive(false);

      let res = await request(app).get('/poll');
      expect(res.status).toBe(503);


      (app as any).setMCPServerActive(true);

      res = await request(app).get('/poll');
      expect(res.status).toBe(200);
      expect(res.body.mcpConnected).toBe(true);
    });
  });

  describe('plugin connection tracking', () => {
    it('should mark plugin as connected when it polls', async () => {
      const healthBefore = await request(app).get('/health');
      expect(healthBefore.body.pluginConnected).toBe(false);

      await request(app).get('/poll');

      const healthAfter = await request(app).get('/health');
      expect(healthAfter.body.pluginConnected).toBe(true);
    });

    it('should clear pending requests on disconnect', async () => {
      (app as any).setMCPServerActive(true);
      await request(app).post('/ready');


      const bridgePromise = bridge.sendRequest('/api/test', {}).catch(() => {});


      await request(app).post('/disconnect');


      await expect(bridgePromise).resolves.toBeUndefined();
    });
  });

  describe('MCP tool endpoints track activity', () => {
    it('should refresh MCP activity timestamp on tool endpoint calls', async () => {
      (app as any).setMCPServerActive(true);


      await request(app).post('/mcp/get_place_info').send({});


      const res = await request(app).get('/poll');
      expect(res.status).toBe(200);
      expect(res.body.mcpConnected).toBe(true);
    });
  });
});

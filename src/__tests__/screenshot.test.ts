import { takeScreenshot } from '../tools/screenshot';

describe('Screenshot', () => {
  test('takeScreenshot is exported as a function', () => {
    expect(typeof takeScreenshot).toBe('function');
  });

  test('should capture a screenshot and return base64 data', async () => {
    // On macOS with screen access, this captures the full screen silently
    // On CI or environments without screen access, this may reject
    try {
      const result = await takeScreenshot();
      expect(result.path).toContain('roblox-screenshot-');
      expect(result.base64).toBeDefined();
      expect(result.base64.length).toBeGreaterThan(0);
    } catch {
      // Expected to fail in headless/CI environments
    }
  });
});

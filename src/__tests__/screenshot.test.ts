import { takeScreenshot } from '../tools/screenshot';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Screenshot', () => {
  test('takeScreenshot is exported as a function', () => {
    expect(typeof takeScreenshot).toBe('function');
  });

  test('takeScreenshot returns a promise', () => {
    // Create a fake image file so readFile succeeds if exec somehow works
    // But on CI/test environments, exec will fail — that's expected
    const result = takeScreenshot();
    expect(result).toBeInstanceOf(Promise);
    // Let it reject naturally (no Roblox Studio window to capture)
    result.catch(() => {});
  });

  test('should reject when no Roblox Studio window is available', async () => {
    // In a test environment, screencapture will fail since there's no Studio window
    await expect(takeScreenshot()).rejects.toBeDefined();
  });
});

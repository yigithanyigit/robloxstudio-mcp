import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';

const execAsync = promisify(exec);

async function getWindowId(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get id of first window of (first process whose name contains "Roblox")'`
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function takeScreenshot(): Promise<{ path: string; base64: string }> {
  const filename = `roblox-screenshot-${Date.now()}.png`;
  const filepath = join(tmpdir(), filename);

  if (process.platform === 'darwin') {
    const windowId = await getWindowId();
    if (windowId) {
      await execAsync(`screencapture -l ${windowId} "${filepath}"`);
    } else {
      // Fallback: capture front window
      await execAsync(`screencapture -w "${filepath}"`);
    }
  } else if (process.platform === 'win32') {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
      $bitmap.Save('${filepath.replace(/\\/g, '\\\\')}')
      $graphics.Dispose()
      $bitmap.Dispose()
    `.trim();
    await execAsync(`powershell -Command "${psScript}"`);
  } else {
    // Linux
    await execAsync(`import -window root "${filepath}"`);
  }

  const buffer = await readFile(filepath);
  const base64 = buffer.toString('base64');

  // Clean up temp file
  await unlink(filepath).catch(() => {});

  return { path: filepath, base64 };
}

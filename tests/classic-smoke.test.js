import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { test, expect, _electron as electron } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
test('Spear preferences use local IPC and portable data', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spear-smoke-'));
  const app = await electron.launch({
    cwd: root,
    timeout: 25000,
    args: [root, '--no-sandbox', '--disable-gpu', ...(process.platform === 'linux' ? ['--headless', '--ozone-platform=headless'] : [])],
    env: { ...process.env, NODE_ENV: 'test', PORTABLE_EXECUTABLE_DIR: temporary },
  });
  try {
    await expect.poll(() => app.evaluate(({ Menu }) => !!Menu.getApplicationMenu()), { timeout: 30000 }).toBe(true);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(temporary, 'data'));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    const opened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items[0].click());
    const settings = await opened;
    await settings.waitForLoadState('domcontentloaded');
    await expect(settings.locator('h1')).toHaveText('Spear preferences');
    await expect(settings.locator('#content article')).not.toHaveCount(0);
    await expect(settings.locator('#error')).toHaveText('');
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
    await settings.getByLabel('Classic skin', { exact: true }).selectOption('amber');
    await expect(settings.getByLabel('Classic skin', { exact: true })).toHaveValue('amber');
    await settings.getByRole('searchbox').fill('Keep listening');
    await expect(settings.getByRole('heading', { name: 'Keep listening', exact: true })).toBeVisible();
    const checkbox = settings.getByLabel('Enable Keep listening', { exact: true });
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(settings.locator('#error')).toHaveText('');
    await settings.screenshot({ path: path.join(root, 'test-results', 'spear-preferences.png') });
    console.log('Preferences screenshot:', path.join(root, 'test-results', 'spear-preferences.png'));
  } finally {
    await app.close();
    // The test profile is outside the repository and never included in artifacts.
  }
});

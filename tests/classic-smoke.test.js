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
    args: [
      root,
      '--no-sandbox',
      '--disable-gpu',
      ...(process.platform === 'linux'
        ? ['--headless', '--ozone-platform=headless']
        : []),
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORTABLE_EXECUTABLE_DIR: temporary,
    },
  });
  app.process().stdout?.on('data', (chunk) => console.log(String(chunk)));
  app.process().stderr?.on('data', (chunk) => console.error(String(chunk)));
  app
    .process()
    .on('exit', (code, signal) =>
      console.log('Electron exited:', code, signal),
    );
  try {
    await expect
      .poll(
        () =>
          app
            .evaluate(
              ({ Menu }) =>
                Menu.getApplicationMenu()?.items[0]?.label === 'Settings',
            )
            .catch(() => false),
        { timeout: 30000 },
      )
      .toBe(true);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(
      path.join(temporary, 'data'),
    );
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isVisible(),
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    const opened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click(),
    );
    const settings = await opened;
    await settings.waitForLoadState('domcontentloaded');
    settings.on('pageerror', (error) =>
      console.error('Preferences:', error.message),
    );
    console.log(
      'Preferences initialization:',
      await settings.locator('#error').textContent(),
    );
    await expect(settings).toHaveTitle('YouTube Music Spear · Settings');
    await expect(settings.locator('header h1')).toHaveCount(0);
    await expect(settings.locator('#content article')).not.toHaveCount(0, {
      timeout: 15000,
    });
    await expect(settings.locator('#error')).toHaveText('');
    await expect(
      settings.getByLabel('Check for updates at startup', { exact: true }),
    ).toBeChecked();
    await expect(
      settings.getByLabel('Starting page', { exact: true }),
    ).toHaveJSProperty('tagName', 'SELECT');
    await settings
      .getByRole('button', { name: 'Connection', exact: true })
      .click();
    await expect(
      settings.getByLabel('Proxy server', { exact: true }),
    ).toBeVisible();
    await settings.getByRole('button', { name: 'About', exact: true }).click();
    await expect(
      settings.getByRole('heading', {
        name: 'YouTube Music Spear',
        exact: true,
      }),
    ).toBeVisible();
    await settings
      .getByRole('button', { name: 'Appearance', exact: true })
      .click();
    await settings
      .getByLabel('Classic skin', { exact: true })
      .selectOption('amber');
    await expect(
      settings.getByLabel('Classic skin', { exact: true }),
    ).toHaveValue('amber');
    await settings.getByRole('searchbox').fill('Keep listening');
    await expect(
      settings.getByRole('heading', { name: 'Keep listening', exact: true }),
    ).toBeVisible();
    const checkbox = settings.getByLabel('Enable Keep listening', {
      exact: true,
    });
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(settings.locator('#error')).toHaveText('');
    await settings.screenshot({
      path: path.join(root, 'test-results', 'spear-preferences.png'),
    });
    const consent = await app.firstWindow();
    await consent.route('https://consent.youtube.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Consent test</title></head><body><h1>Before continuing</h1><button>Review choices</button></body></html>',
      }),
    );
    await consent.goto('https://consent.youtube.com/spear-ui-test');
    await expect(consent.locator('h1')).toHaveCSS('color', 'rgb(0, 0, 0)');
    expect(await consent.evaluate(() => typeof window.ipcRenderer)).toBe(
      'undefined',
    );
    await expect(consent.locator('#ytmd-title-bar-main-panel')).toHaveCount(0);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor(),
      ),
    ).toBe('#ffffff');
  } finally {
    await app.close();
    // The test profile is outside the repository and never included in artifacts.
  }
});

// Reuse a completed first-run profile to verify subsequent launches stay in the tray.
test('Returning users start in the tray', async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'spear-returning-'),
  );
  await fs.mkdir(path.join(temporary, 'data'));
  await fs.writeFile(
    path.join(temporary, 'data', 'config.json'),
    JSON.stringify({
      options: { firstRunComplete: true, appVisible: false, tray: true },
    }),
  );
  const app = await electron.launch({
    cwd: root,
    args: [root, '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORTABLE_EXECUTABLE_DIR: temporary,
    },
  });
  try {
    await expect
      .poll(
        () =>
          app
            .evaluate(
              ({ Menu }) =>
                Menu.getApplicationMenu()?.items[0]?.label === 'Settings',
            )
            .catch(() => false),
        { timeout: 30000 },
      )
      .toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    ).toBe(false);
  } finally {
    await app.close();
  }
});

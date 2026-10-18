import { createHash } from 'node:crypto';
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
    const trayPreload = path.join(temporary, 'tray-preview.cjs');
    await fs.writeFile(
      trayPreload,
      "const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('classic',{request:async()=>({title:'A long track title that must stay on one line',artist:'Preview artist',paused:false,elapsed:74,duration:240,artwork:''})});",
    );
    const trayOpened = app.waitForEvent('window');
    await app.evaluate(
      ({ BrowserWindow }, { preload, page }) => {
        const win = new BrowserWindow({
          width: 360,
          height: 188,
          frame: false,
          webPreferences: { preload, contextIsolation: true, sandbox: true },
        });
        void win.loadFile(page);
      },
      {
        preload: trayPreload,
        page: path.join(root, 'src', 'classic', 'tray.html'),
      },
    );
    const tray = await trayOpened;
    await expect(
      tray.getByRole('button', { name: 'Exit app', exact: true }),
    ).toBeVisible();
    await expect(
      tray.getByRole('button', { name: 'Open player', exact: true }),
    ).toBeVisible();
    await expect(
      tray.getByRole('button', { name: 'Settings', exact: true }),
    ).toBeVisible();
    await expect(
      tray.getByRole('button', { name: 'Pause', exact: true }),
    ).toBeVisible();
    expect(
      await tray.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await tray.screenshot({
      path: path.join(root, 'test-results', 'spear-tray.png'),
    });
    await tray.close();
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
        BrowserWindow.getAllWindows()
          .find((win) =>
            win.webContents.getURL().startsWith('https://consent.youtube.com/'),
          )
          ?.getBackgroundColor()
          .toLowerCase(),
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

test('Portable update shows progress, cancels and verifies before offering restart', async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'spear-update-test-'),
  );
  const executable = path.join(temporary, 'YouTube-Music-Spear.exe');
  await fs.writeFile(executable, 'unchanged test executable');
  const app = await electron.launch({
    cwd: root,
    args: [root, '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORTABLE_EXECUTABLE_DIR: temporary,
      PORTABLE_EXECUTABLE_FILE: executable,
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
    await app.evaluate(
      async ({ net }, hash) => {
        const bytes = Buffer.alloc(65536, 42);
        const original = net.fetch.bind(net);
        net.fetch = async (url, options) => {
          const base =
            'https://github.com/Magisterion/spear-desktop/releases/download/v9.9.9/';
          if (String(url).endsWith('/releases/latest'))
            return new Response(
              JSON.stringify({
                tag_name: 'v9.9.9',
                draft: false,
                prerelease: false,
                assets: [
                  {
                    name: 'YouTube-Music-Spear.exe',
                    size: bytes.length,
                    browser_download_url: base + 'YouTube-Music-Spear.exe',
                  },
                  {
                    name: 'YouTube-Music-Spear.exe.sha256',
                    size: 64,
                    browser_download_url:
                      base + 'YouTube-Music-Spear.exe.sha256',
                  },
                ],
              }),
            );
          if (String(url) === base + 'YouTube-Music-Spear.exe.sha256')
            return new Response(hash);
          if (String(url) === base + 'YouTube-Music-Spear.exe') {
            let offset = 0;
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  await new Promise((resolve) => setTimeout(resolve, 150));
                  if (options?.signal?.aborted) {
                    controller.error(new Error('Aborted'));
                    return;
                  }
                  if (offset === bytes.length) {
                    controller.close();
                    return;
                  }
                  controller.enqueue(bytes.subarray(offset, offset + 4096));
                  offset += 4096;
                },
              }),
            );
          }
          return original(url, options);
        };
      },
      createHash('sha256').update(Buffer.alloc(65536, 42)).digest('hex'),
    );
    const settingsOpened = app.waitForEvent('window');
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click(),
    );
    const settings = await settingsOpened;
    const updateOpened = app.waitForEvent('window');
    await settings
      .getByRole('button', { name: 'Check for updates', exact: true })
      .click();
    const update = await updateOpened;
    await expect(update.getByRole('heading')).toHaveText(
      'An update is available',
    );
    await update
      .getByRole('button', { name: 'Download update', exact: true })
      .click();
    await expect(
      update.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();
    await expect(update.locator('#stats')).toContainText('%');
    // The separate preferences window remains usable during download.
    await settings.getByRole('button', { name: 'About', exact: true }).click();
    await expect(
      settings.getByRole('heading', {
        name: 'YouTube Music Spear',
        exact: true,
      }),
    ).toBeVisible();
    await update.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(update.getByRole('heading')).toHaveText('Download cancelled');
    expect(await fs.readFile(executable, 'utf8')).toBe(
      'unchanged test executable',
    );
    await update
      .getByRole('button', { name: 'Download update', exact: true })
      .click();
    await expect(
      update.getByRole('button', { name: 'Restart and install', exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(
      (
        await fs.stat(
          path.join(
            temporary,
            'data',
            'updates',
            'YouTube-Music-Spear.exe.new',
          ),
        )
      ).size,
    ).toBe(65536);
    expect(await fs.readFile(executable, 'utf8')).toBe(
      'unchanged test executable',
    );
    await update.screenshot({
      path: path.join(root, 'test-results', 'spear-update.png'),
    });
    // Do not execute the fake update. Installation requires an explicit user action.
  } finally {
    await app.close();
  }
});

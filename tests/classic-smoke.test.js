import { stripTypeScriptTypes } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { test, expect, _electron as electron } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
async function localWindow(app, filename) {
  await expect
    .poll(() => app.windows().some((w) => w.url().includes(filename)), {
      timeout: 20000,
    })
    .toBe(true);
  return app.windows().find((w) => w.url().includes(filename));
}
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
          app
            .evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0]?.isVisible(),
            )
            .catch(() => false),
        { timeout: 20000 },
      )
      .toBe(true);
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click(),
    );
    const settings = await localWindow(app, 'settings');
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
      .getByRole('button', { name: 'Privacy & network', exact: true })
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
    await settings.getByRole('button', { name: 'Themes', exact: true }).click();
    await settings
      .getByRole('button', { name: 'Amber display', exact: true })
      .click();
    await expect(
      settings.getByRole('button', { name: 'Amber display', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await settings
      .getByRole('button', { name: 'Pixel night', exact: true })
      .click();
    await expect(
      settings.getByRole('button', { name: 'Pixel night', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await settings.screenshot({
      path: path.join(root, 'test-results', 'spear-themes.png'),
    });
    const player = app
      .windows()
      .find((w) => w.url().startsWith('https://music.youtube.com'));
    // Native navigation must route within the existing page, retaining its media state.
    await player.evaluate(() => {
      const app = document.querySelector('ytmusic-app');
      window.originalNavigate = app.navigate;
      app.navigate = (page) => {
        window.lastBrowse = page;
      };
      window.navigationSentinel = 'same-document';
    });
    for (const [action, expected] of [
      ['home', 'FEmusic_home'],
      ['library', 'FEmusic_library_landing'],
    ]) {
      await player.evaluate(
        (action) => window.ipcRenderer.invoke('classic:navigate', action),
        action,
      );
      await expect
        .poll(() => player.evaluate(() => window.lastBrowse))
        .toBe(expected);
      expect(await player.evaluate(() => window.navigationSentinel)).toBe(
        'same-document',
      );
    }
    await player.evaluate(() => {
      document.querySelector('ytmusic-app').navigate = window.originalNavigate;
    });
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'game'),
    );
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) =>
              w.webContents.getURL().startsWith('https://music.youtube.com'),
            )
            ?.isFullScreen(),
        ),
      )
      .toBe(true);
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'game-exit'),
    );
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'equalizer'),
    );
    await expect(
      settings.getByRole('button', { name: 'Equalizer', exact: true }),
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      settings.getByLabel('Enable Equalizer', { exact: true }),
    ).toBeChecked();
    const preset = settings.getByLabel('Preset', { exact: true });
    await expect(preset.locator('option')).toHaveCount(9);
    await preset.selectOption({ label: 'Rock' });
    await expect(settings.locator('#notice')).not.toBeVisible();
    await preset.selectOption({ label: 'Flat (default)' });
    const bassBand = settings.getByRole('slider', {
      name: '31 Hz gain',
      exact: true,
    });
    await bassBand.focus();
    await bassBand.press('ArrowUp');
    await expect(preset.locator('option:checked')).toHaveText('Custom');
    await expect(bassBand).not.toHaveValue('0');
    await settings
      .getByRole('button', { name: 'Reset to Flat', exact: true })
      .click();
    await expect(bassBand).toHaveValue('0');
    await settings.screenshot({
      path: path.join(root, 'test-results/spear-equalizer.png'),
    });
    await settings.getByRole('searchbox').fill('Visualizer');
    const milkdrop = settings.getByLabel('MilkDrop preset', { exact: true });
    await expect(milkdrop.locator('option')).toHaveCount(107);
    const visualizerType = settings.locator('select').last();
    await expect(visualizerType.locator('option:checked')).toHaveText(
      'spectrum',
    );
    await expect(visualizerType.locator('option')).toHaveCount(13);
    await visualizerType.selectOption({ label: 'oscilloscope' });
    await expect(visualizerType.locator('option:checked')).toHaveText(
      'oscilloscope',
    );
    await expect(settings.locator('#notice')).not.toBeVisible();
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
    const fixturePath = path.join(temporary, 'compact-fixture.html');
    const css =
      (await fs.readFile(path.join(root, 'src/classic/compact.css'), 'utf8')) +
      (await fs.readFile(
        path.join(root, 'src/plugins/visualizer/empty-player.css'),
        'utf8',
      ));
    await fs.writeFile(
      fixturePath,
      `<!doctype html><style>
      * { box-sizing: border-box; } body { margin:0; background:#151821; color:white; --menu-bar-height:40px; }
      ytmusic-app, ytmusic-app-layout, ytmusic-player-page { display:block; }
      tp-yt-app-drawer { position:fixed; top:0; height:100vh; width:72px; background:#303540; }
      #guide-wrapper { position:relative; } #guide-wrapper button { height:40px; }
      ytmusic-player-page { margin-left:72px; width:calc(100% - 72px); padding:90px 88px; }
      #columns { display:flex; } #main-panel, #side-panel { width:900px; min-width:900px; }
      #player-container, #player { height:600px; } #player { position:relative; background:#070a12; }
      #visualizer { width:100%; height:100%; } #side-panel { transform:translateY(500px); }
      ${css}</style><ytmusic-app><tp-yt-app-drawer><div id="guide-wrapper"><button>Menu</button></div></tp-yt-app-drawer>
      <ytmusic-app-layout id="layout"><ytmusic-player-page slot="player-page"><div id="columns">
      <div id="main-panel"><div id="player-container"><div id="player"></div></div>
      <section id="spear-visualizer-stage"><canvas id="visualizer"></canvas><div id="spear-visualizer-tools"><button>Visualizer</button><button>Equalizer</button><button>Fullscreen</button></div></section></div>
      <div id="side-panel">Queue</div></div></ytmusic-player-page></ytmusic-app-layout></ytmusic-app>`,
    );
    await app.evaluate(({ BrowserWindow }, file) => {
      const win = new BrowserWindow({ width: 720, height: 900 });
      void win.loadFile(file);
    }, fixturePath);
    const layout = await localWindow(app, 'compact-fixture');
    await layout.waitForLoadState('domcontentloaded');
    await layout.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(
          path.join(root, 'src/plugins/visualizer/stage.ts'),
          'utf8',
        ),
      ).replaceAll('export ', ''),
    });
    await layout.evaluate(() => {
      window.stage = createVisualizerStage();
    });
    const boxes = await layout.evaluate(() =>
      Object.fromEntries(
        [
          '#visualizer',
          '#side-panel',
          '#spear-visualizer-tools',
          '#guide-wrapper button',
        ].map((selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return [
            selector,
            {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              height: r.height,
            },
          ];
        }),
      ),
    );
    expect(boxes['#visualizer'].height).toBe(180);
    expect(boxes['#visualizer'].right).toBeLessThanOrEqual(720);
    expect(boxes['#side-panel'].right).toBeLessThanOrEqual(720);
    expect(boxes['#side-panel'].top).toBeLessThan(300);
    expect(boxes['#spear-visualizer-tools'].top).toBeGreaterThanOrEqual(
      boxes['#visualizer'].top,
    );
    expect(boxes['#spear-visualizer-tools'].bottom).toBeLessThan(
      boxes['#visualizer'].bottom,
    );
    expect(boxes['#guide-wrapper button'].top).toBeGreaterThanOrEqual(40);
    await layout.evaluate(() => window.stage.toggleMedia());
    await expect(layout.locator('#visualizer')).not.toBeVisible();
    await expect(layout.locator('#player-container')).toBeVisible();
    await layout.evaluate(() => window.stage.toggleMedia());
    await expect(layout.locator('#visualizer')).toBeVisible();
    await expect(layout.locator('#player-container')).not.toBeVisible();
    await layout.screenshot({
      path: path.join(root, 'test-results/spear-visualizer-layout.png'),
    });
    await layout.evaluate(() => {
      const player = document.createElement('ytmusic-player');
      player.setAttribute('player-ui-state', 'MINIPLAYER');
      document.body.append(player);
    });
    await expect(layout.locator('#spear-visualizer-stage')).toHaveClass('mini');
    await expect(layout.locator('#visualizer')).toHaveCSS('height', '180px');
    await layout.evaluate(() => {
      document.querySelector('#spear-visualizer-tools button').onclick = () =>
        document.querySelector('#spear-visualizer-stage').requestFullscreen();
    });
    await layout.locator('#spear-visualizer-tools button').first().click();
    await expect
      .poll(() => layout.evaluate(() => document.fullscreenElement?.id))
      .toBe('spear-visualizer-stage');
    expect(
      await layout
        .locator('#visualizer')
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThan(500);
    await layout.evaluate(() => document.exitFullscreen());
    await layout.close();
    const trayPreload = path.join(temporary, 'tray-preview.cjs');
    await fs.writeFile(
      trayPreload,
      "const {contextBridge}=require('electron');let last;contextBridge.exposeInMainWorld('classic',{lastRequest:()=>last,request:async(action,value)=>{if(action!=='song')last={action,value};return ({title:'A long track title that must stay on one line',artist:'Preview artist',paused:false,elapsed:74,duration:240,artwork:'',palette:{top:'#39346a',bottom:'#1d1b36',accent:'#ffcc66',pixel:true}})}});",
    );
    const trayOpened = app.waitForEvent('window');
    await app.evaluate(
      ({ BrowserWindow }, { preload, page }) => {
        const win = new BrowserWindow({
          width: 480,
          height: 320,
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
    const seekBox = await tray
      .getByRole('slider', { name: 'Seek track' })
      .boundingBox();
    expect(seekBox.y + seekBox.height).toBeLessThan(300);
    await tray.getByRole('slider', { name: 'Seek track' }).focus();
    await tray.getByRole('slider', { name: 'Seek track' }).press('End');
    expect(await tray.evaluate(() => window.classic.lastRequest())).toEqual({
      action: 'seek',
      value: 240,
    });
    await tray.screenshot({
      path: path.join(root, 'test-results', 'spear-tray.png'),
    });
    await tray.close();
    const gameOpened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const preview = new BrowserWindow({
        width: 720,
        height: 650,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      preview.webContents.setAudioMuted(true);
      await preview.loadURL(
        'data:text/html,<html><body><video></video></body></html>',
      );
    });
    const game = await gameOpened;
    await game.evaluate(() => {
      window.gameListeners = {};
      window.audioLevel = -1;
      window.ipcRenderer = {
        on: (channel, callback) => {
          window.gameListeners[channel] = callback;
        },
        send: (channel, value) => {
          if (channel === 'classic:audio-level') window.audioLevel = value;
        },
        invoke: async () => {},
      };
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/audio.ts'), 'utf8'),
      ).replaceAll('export ', ''),
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/night-run.ts'), 'utf8'),
      ).replace(/import[^;]+;/, ''),
    });
    await game.evaluate(() => window.gameListeners['classic:game']());
    await expect(
      game.getByText('Play music to bring the track to life'),
    ).toBeVisible();
    await game
      .getByRole('button', { name: 'Autopilot: off', exact: true })
      .click();
    await expect(
      game.getByRole('button', { name: 'Autopilot: on', exact: true }),
    ).toBeVisible();
    await game.evaluate(async () => {
      const video = document.querySelector('video');
      Object.defineProperty(video, 'paused', {
        value: false,
        configurable: true,
      });
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 110;
      const source = context.createGain();
      source.gain.value = 0.4;
      oscillator.connect(source);
      const output = initializeAudio(context, source, video);
      const outputMeter = context.createAnalyser();
      outputMeter.fftSize = 2048;
      output.connect(outputMeter);
      window.outputMeter = outputMeter;
      oscillator.start();
      window.testTone = source;
    });
    await expect
      .poll(() => game.evaluate(() => window.audioLevel))
      .toBeGreaterThan(0.4);
    await expect
      .poll(() =>
        game
          .getByRole('progressbar', { name: 'Music pulse' })
          .evaluate((el) => el.value),
      )
      .toBeGreaterThan(0.4);
    // A 0.4 sine has RMS 0.283. A parallel dry path would double this.
    const rms = await game.evaluate(() => {
      const data = new Float32Array(2048);
      window.outputMeter.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    });
    expect(rms).toBeGreaterThan(0.24);
    expect(rms).toBeLessThan(0.32);
    await game.keyboard.press('Space');
    await expect(game.locator('#score')).toContainText('charging');
    await expect(game.locator('#score')).toContainText(/2 s/);
    await game.screenshot({
      path: path.join(root, 'test-results/spear-pulsefield.png'),
    });
    await game.evaluate(() =>
      Object.defineProperty(document.querySelector('video'), 'paused', {
        value: true,
        configurable: true,
      }),
    );
    await expect.poll(() => game.evaluate(() => window.audioLevel)).toBe(0);
    await game.keyboard.press('Escape');
    await expect(game.locator('#spear-pulsefield')).toHaveCount(0);
    await game.evaluate(() => window.gameListeners['classic:game']());
    await expect(game.locator('#spear-pulsefield')).toHaveCount(1);
    await game.close();
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

// A manual launch always opens the player; only autostart may hide it.
for (const automatic of [false, true])
  test(`Returning user launch: automatic=${automatic}`, async () => {
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
      args: [
        root,
        '--no-sandbox',
        '--disable-gpu',
        ...(automatic ? ['--spear-autostart'] : []),
      ],
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
      const main = await app.firstWindow();
      await main.waitForLoadState('domcontentloaded');
      await expect
        .poll(
          () =>
            app
              .evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]?.isVisible(),
              )
              .catch(() => undefined),
          { timeout: 20000 },
        )
        .toBe(!automatic);
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
  let app = await electron.launch({
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
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click(),
    );
    const settings = await localWindow(app, 'settings');
    await settings
      .getByRole('button', { name: 'Check for updates', exact: true })
      .click();
    const update = await localWindow(app, 'updater');
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
      update.getByRole('button', { name: 'Restart and update', exact: true }),
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
    await update.getByRole('button', { name: 'Later', exact: true }).click();
    await app.close();
    app = await electron.launch({
      cwd: root,
      args: [root, '--no-sandbox', '--disable-gpu'],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORTABLE_EXECUTABLE_DIR: temporary,
        PORTABLE_EXECUTABLE_FILE: executable,
      },
    });
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
    // No mocked network on the second launch: a saved verified update must work offline.
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().items[0].submenu.items[0].click(),
    );
    const reopenedSettings = await localWindow(app, 'settings');
    await reopenedSettings
      .getByRole('button', { name: 'Check for updates', exact: true })
      .click();
    const restored = await localWindow(app, 'updater');
    await expect(
      restored.getByRole('button', { name: 'Restart and update', exact: true }),
    ).toBeVisible();
    await expect(restored.locator('#message')).toContainText(
      'No download is needed',
    );
    // Do not execute the fake update. Installation requires an explicit user action.
  } finally {
    await app.close();
  }
});

test('Windows portable helper verifies, replaces and relaunches without changing data permissions', async () => {
  test.skip(process.platform !== 'win32', 'Windows portable updater');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'spear-helper-'));
  const target = path.join(temporary, 'portable.cmd');
  const source = target + '.new';
  const marker = path.join(temporary, 'restarted.txt');
  const ready = path.join(temporary, 'ready.txt');
  const result = path.join(temporary, 'result.json');
  const bytes = Buffer.from(
    '@echo off\r\necho restarted>"%~dp0restarted.txt"\r\n',
  );
  await fs.writeFile(target, '@echo off\r\n');
  await fs.writeFile(source, bytes);
  // An isolated dummy process represents the running player. No real app is killed.
  const waiting = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
  const payload = Buffer.from(
    JSON.stringify({
      pid: waiting.pid,
      source,
      target,
      ready,
      result,
      hash: createHash('sha256').update(bytes).digest('hex'),
    }),
  ).toString('base64');
  const code = await fs.readFile(
    path.join(root, 'src/classic/updater.ts'),
    'utf8',
  );
  const script = code
    .match(/const script = `([\s\S]*?)`;/)[1]
    .replace('${payload}', payload);
  let error = '';
  const helper = spawn(
    path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      cwd: temporary,
      windowsHide: true,
      env: {
        ...process.env,
        PSModulePath: path.join(
          process.env.SystemRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'Modules',
        ),
      },
    },
  );
  helper.stderr.on('data', (chunk) => {
    error += chunk;
  });
  try {
    const exitCode = await new Promise((resolve, reject) => {
      helper.once('exit', resolve);
      helper.once('error', reject);
    });
    const helperStatus = await fs
      .readFile(ready, 'utf8')
      .catch(() => 'No startup acknowledgement');
    expect(error).toBe('');
    expect(exitCode, helperStatus).toBe(0);
    expect(await fs.readFile(ready, 'utf8')).toBe('ready');
    expect(JSON.parse(await fs.readFile(result, 'utf8')).success).toBe(true);
    expect(await fs.readFile(target)).toEqual(bytes);
    await expect
      .poll(() => fs.readFile(marker, 'utf8').catch(() => ''), {
        timeout: 10000,
      })
      .toContain('restarted');
    // The update directory remains writable after the helper has exited.
    await fs.writeFile(path.join(temporary, 'data-check'), 'writable');
    await fs.rm(path.join(temporary, 'data-check'));
  } finally {
    helper.kill();
    waiting.kill();
  }
});

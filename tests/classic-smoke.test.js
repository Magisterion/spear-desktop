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
      ytmusic-player { display:block; } #visualizer { width:100%; height:100%; } #side-panel { transform:translateY(500px); }
      ${css}</style><ytmusic-app><tp-yt-app-drawer><div id="guide-wrapper"><button>Menu</button></div></tp-yt-app-drawer>
      <ytmusic-app-layout id="layout"><ytmusic-player-page slot="player-page"><div id="columns">
      <div id="main-panel"><div id="player-container"><ytmusic-player id="player" player-ui-state="PLAYER_PAGE"><div id="song-image" style="padding-top:100%"><div id="thumbnail">Album cover</div></div></ytmusic-player></div>
      <section id="spear-visualizer-stage"><canvas id="visualizer"></canvas><div id="spear-visualizer-tools"><button>Visualizer</button><button>Equalizer</button><button>Fullscreen</button><button class="player-action">Player</button><button class="mini-action">Close mini</button></div></section></div>
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
    await expect(
      layout.getByRole('button', { name: 'Minimize player', exact: true }),
    ).toBeVisible();
    // Widen the real Electron fixture window and compare the two media rectangles.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('compact-fixture'))
        .setSize(1200, 900),
    );
    await layout.evaluate(() => window.stage.toggleMedia());
    await expect
      .poll(() =>
        layout.evaluate(() => {
          const a = document
            .querySelector('#spear-visualizer-stage')
            .getBoundingClientRect();
          const b = document
            .querySelector('#song-image')
            .getBoundingClientRect();
          return (
            Math.abs(a.x - b.x) +
            Math.abs(a.y - b.y) +
            Math.abs(a.width - b.width) +
            Math.abs(a.height - b.height)
          );
        }),
      )
      .toBeLessThan(2);
    await expect(
      layout.getByRole('button', { name: 'Minimize player', exact: true }),
    ).toBeVisible();
    await layout.evaluate(() => window.stage.toggleMedia());
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('compact-fixture'))
        .setSize(720, 900),
    );
    await layout.screenshot({
      path: path.join(root, 'test-results/spear-visualizer-layout.png'),
    });
    await layout.evaluate(() =>
      document
        .querySelector('ytmusic-player')
        .setAttribute('player-ui-state', 'MINIPLAYER'),
    );
    await expect(layout.locator('#spear-visualizer-stage')).toHaveClass('mini');
    await expect(layout.locator('#visualizer')).toHaveCSS('height', '180px');
    await expect(
      layout.getByRole('button', { name: 'Open player', exact: true }),
    ).toBeVisible();
    await expect(
      layout.getByRole('button', { name: 'Close mini', exact: true }),
    ).toBeVisible();
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
    expect(
      await layout.locator('#spear-visualizer-stage').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }),
    ).toEqual({ x: 0, y: 0 });
    await layout.evaluate(() => document.exitFullscreen());
    await layout.evaluate(() => {
      const app = document.querySelector('ytmusic-app');
      const area = document.createElement('div');
      area.id = 'contrast-fixture';
      area.innerHTML =
        '<button class="ytSpecButtonShapeNextHost ytSpecButtonShapeNextMono ytSpecButtonShapeNextFilled"><span><yt-formatted-string>Save</yt-formatted-string></span></button><ytmusic-chip-cloud-chip-renderer is-selected chip-style="STYLE_UNKNOWN"><a class="ytmusic-chip-cloud-chip-renderer"><yt-formatted-string>All</yt-formatted-string></a></ytmusic-chip-cloud-chip-renderer>';
      app.append(area);
    });
    for (const palette of [
      {
        name: 'Default',
        accent: '#ffffff',
        text: '#ffffff',
        inverse: '#030303',
      },
      {
        name: 'Steel blue',
        accent: '#c1d6ee',
        text: '#edf1f7',
        inverse: '#101820',
      },
      {
        name: 'Classic midnight',
        accent: '#b5c9eb',
        text: '#edf1f7',
        inverse: '#101820',
      },
      {
        name: 'Graphite',
        accent: '#d1d5db',
        text: '#edf1f7',
        inverse: '#101820',
      },
    ]) {
      await layout.evaluate((p) => {
        const style = document.documentElement.style;
        style.setProperty('--player-accent', p.accent);
        style.setProperty('--player-text', p.text);
        style.setProperty('--player-accent-text', p.inverse);
      }, palette);
      const colors = await layout
        .locator('#contrast-fixture yt-formatted-string')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
      expect(colors).toEqual([
        palette.inverse === '#030303' ? 'rgb(3, 3, 3)' : 'rgb(16, 24, 32)',
        palette.inverse === '#030303' ? 'rgb(3, 3, 3)' : 'rgb(16, 24, 32)',
      ]);
    }
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
        await fs.readFile(path.join(root, 'src/classic/drive.ts'), 'utf8'),
      ).replaceAll('export ', ''),
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/night-run.ts'), 'utf8'),
      ).replace(/import[^;]+;/g, ''),
    });
    await game.evaluate(() => window.gameListeners['classic:game']());
    await expect(
      game.getByText('Play music to bring the track to life'),
    ).toBeVisible();
    await expect(game.getByRole('button')).toHaveCount(0);
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
    const rms = () =>
      game.evaluate(() => {
        const data = new Float32Array(2048);
        window.outputMeter.getFloatTimeDomainData(data);
        return Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
      });
    await expect.poll(rms).toBeGreaterThan(0.24);
    expect(await rms()).toBeLessThan(0.32);
    // The actual audible output must respond to equalizer changes.
    await game.evaluate(() =>
      setEqualizer([0, -12, -12, 0, 0, 0, 0, 0, 0, 0], true),
    );
    await expect.poll(rms).toBeLessThan(0.15);
    await game.evaluate(() => setEqualizer(Array(10).fill(0), true));
    await expect.poll(rms).toBeGreaterThan(0.24);
    await game.keyboard.press('r');
    await expect(game.locator('#score')).toContainText('0 pts');
    await game.evaluate(() => {
      audioMotion.band = 0;
      audioMotion.beat++;
    });
    // Physical collection in the center lane, without any timed key press.
    await expect(game.locator('#score')).toContainText(/[1-9][0-9]* pts/, {
      timeout: 6000,
    });
    await game.evaluate(() => {
      audioMotion.band = 2;
      audioMotion.beat++;
    });

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
    await game.evaluate(() => window.gameListeners['classic:game-close']());
    await expect(game.locator('#spear-pulsefield')).toHaveCount(0);
    await game.close();
    const consent = player;
    const nativePlayer = await app.browserWindow(player);
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'game'),
    );
    await expect
      .poll(() => nativePlayer.evaluate((w) => w.isFullScreen()))
      .toBe(true);
    await nativePlayer.evaluate((w) => w.close());
    await expect
      .poll(() =>
        nativePlayer.evaluate((w) => w.isVisible() && !w.isFullScreen()),
      )
      .toBe(true);
    await expect(player.locator('#spear-pulsefield')).toHaveCount(0);
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'game'),
    );
    await nativePlayer.evaluate((w) =>
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }),
    );
    await expect
      .poll(() => nativePlayer.evaluate((w) => !w.isFullScreen()))
      .toBe(true);
    await expect(player.locator('#spear-pulsefield')).toHaveCount(0);
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'game'),
    );
    await nativePlayer.evaluate((w) => w.hide());
    await player.evaluate(() =>
      window.ipcRenderer.invoke('classic:navigate', 'show'),
    );
    await expect
      .poll(() =>
        nativePlayer.evaluate((w) => w.isVisible() && !w.isFullScreen()),
      )
      .toBe(true);
    await expect(player.locator('#spear-pulsefield')).toHaveCount(0);
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
            const start = Number(
              /bytes=(\d+)-/.exec(options?.headers?.Range ?? '')?.[1] ?? 0,
            );
            globalThis.spearResumeStart = start;
            let offset = start;
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
              start
                ? {
                    status: 206,
                    headers: {
                      'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
                    },
                  }
                : {},
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
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('settings-'))
          ?.isVisible(),
      ),
    ).toBe(false);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('updater-'))
          ?.isAlwaysOnTop(),
      ),
    ).toBe(false);
    await expect
      .poll(() => update.locator('#stats').innerText())
      .toMatch(/ [1-9][0-9]*%|^[1-9][0-9]*%/);
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
      await app.evaluate(() => globalThis.spearResumeStart),
    ).toBeGreaterThan(0);
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

// Deterministic physical collisions and progression, independent of the canvas.
test('Pulseflight collects by position, damages on collision, and keeps running', async () => {
  const source = stripTypeScriptTypes(
    await fs.readFile(path.join(root, 'src/classic/drive.ts'), 'utf8'),
  );
  const { createDrive } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  );
  const drive = createDrive(),
    run = drive.run;
  drive.beat(0);
  for (let i = 0; i < 100; i++) drive.step(0.05, true, 120);
  expect(run.score).toBe(100);
  for (let i = 0; i < 20; i++) {
    run.objects.push({ x: 0, z: 0.879, hazard: false, color: 0 });
    drive.step(0.05, true, 120);
  }
  expect(run.score).toBeGreaterThan(1000);
  const distance = run.distance;
  drive.step(0.05, true, 120);
  expect(run.distance).toBeGreaterThan(distance);
  run.objects.push({ x: 0, z: 0.879, hazard: true, color: 0 });
  drive.step(0.05, true, 120);
  expect(run.shield).toBe(65);
  expect(run.combo).toBe(0);
  for (let hit = 0; hit < 2; hit++) {
    run.invulnerable = 0;
    run.objects.push({ x: 0, z: 0.879, hazard: true, color: 0 });
    drive.step(0.05, true, 120);
  }
  expect(run.shield).toBe(0);
  const stopped = run.distance;
  drive.step(0.05, true, 120);
  expect(run.distance).toBe(stopped);
  drive.reset();
  run.target = 0.66;
  for (let i = 0; i < 20; i++) drive.step(0.05, false, 120);
  expect(run.x).toBeGreaterThan(0.6);
  expect(run.distance).toBe(0);
  run.objects.push({ x: 0, z: 0.879, hazard: true, color: 0 });
  drive.step(0.05, true, 120);
  expect(run.shield).toBe(100);
});

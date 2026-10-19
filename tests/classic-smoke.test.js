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
    await expect(settings.locator('#content article').last()).toContainText(
      'Album Color Theme',
    );
    await expect(
      settings
        .locator('#nav')
        .getByRole('button', { name: 'Album colors', exact: true }),
    ).toHaveCount(0);
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
    await settings
      .getByRole('button', { name: 'General', exact: true })
      .click();
    await expect(settings.locator('#content details')).toHaveCount(0);
    await expect(settings.getByText('Hide menu', { exact: true })).toHaveCount(
      0,
    );
    await expect(
      settings.getByText('Version 3.12.20', { exact: true }),
    ).toBeVisible();
    const pin = settings.getByLabel('Always on top', { exact: true });
    const pinButton = player.locator(
      '#ytmd-title-bar-main-panel button[aria-label="Always on top"]',
    );
    await expect(pin).not.toBeChecked();
    await pin.check();
    await expect(pinButton).toHaveAttribute('aria-pressed', 'true');
    await pinButton.evaluate((button) => button.click());
    await expect(pin).not.toBeChecked();
    await expect(pinButton).toHaveAttribute('aria-pressed', 'false');
    const labels = await settings
      .locator('#content article')
      .first()
      .locator('label')
      .allTextContents();
    expect(labels[0]).toContain('Language');
    expect(labels[1]).toContain('Starting page');
    await expect(
      settings.getByLabel(
        'Single click opens the window; double click plays/pauses',
        { exact: true },
      ),
    ).toBeChecked();
    await expect(
      settings.getByRole('heading', {
        name: 'Compatibility & maintenance',
        exact: true,
      }),
    ).toHaveCount(0);
    await settings
      .getByRole('button', { name: 'Compatibility & maintenance', exact: true })
      .click();
    await expect(settings.locator('#content details')).toHaveCount(0);
    await expect(
      settings.getByRole('heading', {
        name: 'Compatibility & maintenance',
        exact: true,
      }),
    ).toBeVisible();
    await settings
      .getByRole('button', { name: 'Appearance', exact: true })
      .click();
    const likes = settings.locator('#content article').filter({
      has: settings.getByRole('heading', { name: 'Like buttons', exact: true }),
    });
    await expect(likes).toBeVisible();
    await expect(likes.locator('details')).toHaveCount(0);
    await expect(likes.locator('input[type="radio"]')).toHaveCount(3);
    await expect(
      settings
        .locator('#nav')
        .getByRole('button', { name: 'Like buttons', exact: true }),
    ).toHaveCount(0);
    await settings.screenshot({
      path: path.join(root, 'test-results/spear-like-buttons.png'),
    });
    await settings
      .getByRole('button', { name: 'Appearance', exact: true })
      .click();
    await settings.getByLabel('Remove upgrade button', { exact: true }).check();
    // Exercise the missing-icon fallback without YouTube custom-element upgrades replacing the fixture.
    await player.evaluate(() => {
      document.querySelector('iron-iconset-svg[name="yt-sys-icons"]')?.remove();
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) =>
          w.webContents.getURL().startsWith('https://music.youtube.com'),
        )
        .webContents.send('classic:appearance');
    });
    await expect
      .poll(() =>
        player.evaluate(
          () => document.getElementById('spear-upgrade-style')?.textContent,
        ),
      )
      .toContain('/music_premium');
    const styles = await player.evaluate(
      () => document.getElementById('spear-upgrade-style').textContent,
    );
    const fixtureOpened = app.waitForEvent('window');
    const fixture = await app.evaluate(({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false });
      win.loadURL('about:blank');
      return win.id;
    });
    const fixturePage = await fixtureOpened;
    await fixturePage.waitForLoadState();
    await fixturePage.setContent(
      '<style>' +
        styles +
        '</style><ytmusic-guide-section-renderer><div id="items"><ytmusic-guide-entry-renderer><a href="/music_premium">Premium</a></ytmusic-guide-entry-renderer><ytmusic-guide-entry-renderer id="spear-library-test"><a href="/library">Library</a></ytmusic-guide-entry-renderer></div></ytmusic-guide-section-renderer>',
    );
    await expect(fixturePage.locator('#spear-library-test')).toBeVisible();
    await expect(
      fixturePage.locator('a[href="/music_premium"]'),
    ).not.toBeVisible();
    await app.evaluate(
      ({ BrowserWindow }, id) => BrowserWindow.fromId(id).destroy(),
      fixture,
    );
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
      (await fs.readFile(
        path.join(root, 'src/plugins/in-app-menu/titlebar.css'),
        'utf8',
      )) +
      (await fs.readFile(path.join(root, 'src/classic/compact.css'), 'utf8')) +
      (await fs.readFile(
        path.join(root, 'src/plugins/visualizer/empty-player.css'),
        'utf8',
      ));
    await fs.writeFile(
      fixturePath,
      `<!doctype html><style>
      * { box-sizing:border-box; } body { margin:0;background:#1b2c42;color:white;--ytmusic-nav-bar-height:64px;--ytmusic-player-bar-height:72px;--ytmusic-guide-width:72px; }
      ytmusic-app,ytmusic-app-layout,ytmusic-player-page { display:block; }
      #mini-guide.ytmusic-app { position:fixed;left:0;top:0;width:72px;height:100%;background:#25374e;z-index:4; }
      #mini-guide-spacer.ytmusic-app { margin-top:64px; }
      #mini-guide button { display:block;width:72px;height:72px; }
      [slot='nav-bar'] { position:fixed;top:0;left:0;height:64px;width:100%;z-index:5;background:#152332; }
      ytmusic-app-layout > [slot='player-bar'] {position:fixed;bottom:0;left:0;height:72px;width:calc(100vw - 15px);}
      ytmusic-player-page { position:fixed;top:64px;left:var(--ytmusic-guide-width);width:calc(100% - var(--ytmusic-guide-width));padding:24px; }
      #columns { display:flex;gap:32px;height:100%; }
      #main-panel { flex:1;min-width:0;display:flex;align-items:center;justify-content:center; }
      #player-container { width:100%;max-width:800px; }
      #side-panel { flex:0 0 30%;min-width:0; }
      ytmusic-player { display:block;position:relative;width:100%;background:#080b16; }
      #song-image { padding-top:100%; } #thumbnail { position:absolute;inset:0;width:100%;height:100%; }
      #thumbnail img { width:100%;height:100%;object-fit:contain; }
      ytmusic-player[player-ui-state='MINIPLAYER'] { position:fixed;right:20px;bottom:88px;width:220px;height:220px;z-index:8; }
      ${css}</style><ytmusic-app>
      <div id="mini-guide" class="ytmusic-app"><div id="mini-guide-spacer" class="ytmusic-app"></div><button>Home</button><button>Explore</button><button>Library</button></div>
      <ytmusic-app-layout id="layout"><div slot="nav-bar">YouTube Music</div><ytmusic-player-page slot="player-page"><div id="columns">
      <div id="main-panel"><div id="player-container"><ytmusic-player id="player" player-ui-state="PLAYER_PAGE"><div id="song-image"><div id="thumbnail"><img alt="Album artwork" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Crect width='320' height='320' fill='%234579a2'/%3E%3Ccircle cx='160' cy='160' r='100' fill='%23efc579'/%3E%3C/svg%3E"></div></div></ytmusic-player></div>
      <section id="spear-visualizer-stage"><canvas id="visualizer"></canvas><div id="spear-visualizer-tools"><button aria-label="Visualizer">V</button><button aria-label="Equalizer">E</button><button aria-label="Fullscreen">F</button><button class="player-action">↕</button><button class="mini-action" aria-label="Close mini">×</button></div></section></div>
      <div id="side-panel">Queue</div></div></ytmusic-player-page><ytmusic-player-bar slot="player-bar"></ytmusic-player-bar></ytmusic-app-layout></ytmusic-app>`,
    );
    await app.evaluate(({ BrowserWindow }, file) => {
      const win = new BrowserWindow({ width: 720, height: 900 });
      void win.loadFile(file);
    }, fixturePath);
    const layout = await localWindow(app, 'compact-fixture');
    await layout.waitForLoadState('domcontentloaded');
    await layout.evaluate(() => {
      window.ipcRenderer = {
        on: () => {},
        invoke: async () => ({ visible: true, speakers: false }),
      };
    });
    await layout.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/activity.ts'), 'utf8'),
      ).replaceAll('export ', ''),
    });
    await layout.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(
          path.join(root, 'src/plugins/visualizer/stage.ts'),
          'utf8',
        ),
      )
        .replace(/import[^;]+;/g, '')
        .replaceAll('export ', ''),
    });
    await layout.evaluate(() => {
      window.stage = createVisualizerStage();
    });
    const bounds = (selector) =>
      layout.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const overlayMatchesPlayer = async () => {
      const a = await bounds('#player'),
        b = await bounds('#spear-visualizer-stage');
      for (const key of ['x', 'y', 'width', 'height'])
        expect(Math.abs(a[key] - b[key])).toBeLessThan(1);
    };
    await overlayMatchesPlayer();
    expect((await bounds('#player')).height).toBe(180);
    const barBounds = await bounds('ytmusic-player-bar');
    expect(
      Math.abs(
        barBounds.x +
          barBounds.width -
          (await layout.evaluate(() => innerWidth)),
      ),
    ).toBeLessThan(1);
    await expect(layout.locator('#mini-guide')).not.toBeVisible();
    // Stage events must never trigger the native player play/pause handler.
    await layout.evaluate(() => {
      window.nativeClicks = 0;
      document
        .querySelector('#player')
        .addEventListener('click', () => window.nativeClicks++);
    });
    await layout.locator('#visualizer').click();
    expect(await layout.evaluate(() => window.nativeClicks)).toBe(0);
    await layout.screenshot({
      path: path.join(root, 'test-results/spear-compact-layout.png'),
    });
    // Native media geometry must survive both toggles and viewport changes.
    const nativeWindow = await app.browserWindow(layout);
    for (const width of [1200, 1900]) {
      await nativeWindow.evaluate((w, width) => w.setSize(width, 1000), width);
      const contentWidth = await nativeWindow.evaluate(
        (w) => w.getContentSize()[0],
      );
      await expect
        .poll(() => layout.evaluate(() => innerWidth))
        .toBe(contentWidth);
      const before = await bounds('#player');
      await layout.evaluate(() => window.stage.toggleMedia());
      await expect(layout.locator('#visualizer')).not.toBeVisible();
      await expect(layout.locator('#song-image')).toHaveCSS('opacity', '1');
      await overlayMatchesPlayer();
      expect(await bounds('#player')).toEqual(before);
      await layout.evaluate(() => window.stage.toggleMedia());
      expect(await bounds('#player')).toEqual(before);
    }
    await layout.screenshot({
      path: path.join(root, 'test-results/spear-visualizer-layout.png'),
    });
    // The mini player remains in its native page ancestry, with real painted artwork.
    await layout.evaluate(() =>
      document
        .querySelector('#player')
        .setAttribute('player-ui-state', 'MINIPLAYER'),
    );
    await expect(layout.locator('#spear-visualizer-stage')).toHaveClass('mini');
    await overlayMatchesPlayer();
    await layout.evaluate(() => window.stage.toggleMedia());
    await expect(layout.locator('#song-image')).toHaveCSS('opacity', '1');
    expect(
      await layout
        .locator('#thumbnail img')
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    ).toBe(true);
    expect(
      await layout.locator('#thumbnail img').evaluate((img) => {
        const r = img.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
          img
        );
      }),
    ).toBe(true);
    await layout.locator('#player').screenshot({
      path: path.join(root, 'test-results/spear-mini-cover.png'),
    });
    await expect(
      layout.getByRole('button', { name: 'Open player', exact: true }),
    ).toBeVisible();
    await expect(
      layout.getByRole('button', { name: 'Close mini', exact: true }),
    ).toBeVisible();
    await layout.evaluate(() => window.stage.dismissMini());
    await expect(layout.locator('#player')).not.toBeVisible();
    await layout.evaluate(() => window.stage.showVisualizer());
    await expect(layout.locator('#player')).toBeVisible();
    await layout.evaluate(() => {
      window.stage.showVisualizer();
      document.querySelector('#spear-visualizer-tools button').onclick = () =>
        document.querySelector('#spear-visualizer-stage').requestFullscreen();
    });
    await layout.locator('#spear-visualizer-tools button').first().click();
    await expect
      .poll(() => layout.evaluate(() => document.fullscreenElement?.id))
      .toBe('spear-visualizer-stage');
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
          if (channel === 'classic:audio-level') {
            window.audioLevel = value;
            window.audioMessages = (window.audioMessages || 0) + 1;
          }
        },
        invoke: async (_channel, action) => {
          if (action === 'game-exit')
            window.gameExitRequests = (window.gameExitRequests || 0) + 1;
          return { visible: true, speakers: true };
        },
      };
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/activity.ts'), 'utf8'),
      ).replaceAll('export ', ''),
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/audio.ts'), 'utf8'),
      )
        .replace(/import[^;]+;/g, '')
        .replaceAll('export ', ''),
    });
    await game.addScriptTag({
      content: stripTypeScriptTypes(
        await fs.readFile(path.join(root, 'src/classic/collector.ts'), 'utf8'),
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
    // Verify the rendered background, not just a metadata attribute: changing
    // the current artwork must change pixels without reopening the game.
    const setArtwork = (color) =>
      game.evaluate((color) => {
        let bar = document.querySelector('ytmusic-player-bar');
        if (!bar) {
          bar = document.createElement('ytmusic-player-bar');
          bar.innerHTML = '<img class="image">';
          document.body.append(bar);
        }
        bar.querySelector('img').src =
          'data:image/svg+xml,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`,
          );
      }, color);
    const backgroundPixel = () =>
      game.evaluate(() => {
        const canvas = document
          .querySelector('#spear-pulsefield')
          .shadowRoot.querySelector('canvas');
        return [...canvas.getContext('2d').getImageData(10, 150, 1, 1).data];
      });
    await setArtwork('#ff0000');
    await expect
      .poll(async () => {
        const p = await backgroundPixel();
        return p[0] - p[2];
      })
      .toBeGreaterThan(20);
    await setArtwork('#0000ff');
    await expect
      .poll(async () => {
        const p = await backgroundPixel();
        return p[2] - p[0];
      })
      .toBeGreaterThan(20);

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
      video.dispatchEvent(new Event('play', { bubbles: true }));
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
    // Rendering and FFT telemetry stop without stopping background music.
    await game.evaluate(() => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      window.renderFrames = 0;
      window.stopRenderProbe = animateVisualizer(
        canvas,
        () => window.renderFrames++,
      );
    });
    await expect
      .poll(() => game.evaluate(() => window.renderFrames))
      .toBeGreaterThan(2);
    await game.evaluate(() =>
      window.gameListeners['classic:activity'](null, {
        visible: false,
        speakers: false,
      }),
    );
    const idle = await game.evaluate(() => [
      window.renderFrames,
      window.audioMessages,
    ]);
    await game.waitForTimeout(200);
    expect(
      await game.evaluate(() => [window.renderFrames, window.audioMessages]),
    ).toEqual(idle);
    await expect.poll(rms).toBeGreaterThan(0.24);
    // A visible tray can sample audio while the main visualizer stays asleep.
    await game.evaluate(() =>
      window.gameListeners['classic:activity'](null, {
        visible: false,
        speakers: true,
      }),
    );
    await expect
      .poll(() => game.evaluate(() => window.audioLevel))
      .toBeGreaterThan(0.4);
    expect(await game.evaluate(() => window.renderFrames)).toBe(idle[0]);
    await game.evaluate(() =>
      window.gameListeners['classic:activity'](null, {
        visible: true,
        speakers: true,
      }),
    );
    await expect
      .poll(() => game.evaluate(() => window.renderFrames))
      .toBeGreaterThan(idle[0]);
    await game.keyboard.press('r');
    await expect(game.locator('#score')).toContainText('0 pts');
    await game.evaluate(() => {
      // Sustained oscillator: no injected onset. Tempo fallback must keep gameplay alive.
      audioMotion.band = 0;
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
    await game.evaluate(() => {
      const video = document.querySelector('video');
      Object.defineProperty(video, 'paused', {
        value: true,
        configurable: true,
      });
      video.dispatchEvent(new Event('pause'));
    });
    await expect.poll(() => game.evaluate(() => window.audioLevel)).toBe(0);
    await expect
      .poll(() => game.evaluate(() => window.outputMeter.context.state))
      .toBe('suspended');
    const paused = await game.evaluate(() => [
      window.renderFrames,
      window.audioMessages,
    ]);
    await game.waitForTimeout(200);
    expect(
      await game.evaluate(() => [window.renderFrames, window.audioMessages]),
    ).toEqual(paused);
    await game.evaluate(() => window.stopRenderProbe());

    await game.keyboard.press('Escape');
    await expect(game.locator('#spear-pulsefield')).toHaveCount(0);
    await game.evaluate(() => window.gameListeners['classic:game']());
    await expect(game.locator('#spear-pulsefield')).toHaveCount(1);
    const exits = await game.evaluate(() => window.gameExitRequests);
    await game.evaluate(() => window.gameListeners['classic:game-close']());
    expect(await game.evaluate(() => window.gameExitRequests)).toBe(exits);
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
    await expect(player.locator('#spear-pulsefield')).toHaveCount(1);
    await expect
      .poll(() => nativePlayer.evaluate((w) => w.isFullScreen()))
      .toBe(true);
    await nativePlayer.evaluate((w) => w.focus());
    await expect
      .poll(() => nativePlayer.evaluate((w) => w.isFocused()))
      .toBe(true);
    await expect
      .poll(() => player.evaluate(() => document.hasFocus()))
      .toBe(true);
    await nativePlayer.evaluate((w) => {
      w.testEscapeInputs = [];
      w.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown') w.testEscapeInputs.push(input.key);
      });
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    });
    try {
      await expect
        .poll(() => nativePlayer.evaluate((w) => !w.isFullScreen()))
        .toBe(true);
    } catch (error) {
      console.log(
        'Escape diagnostic',
        await nativePlayer.evaluate((w) => ({
          inputs: w.testEscapeInputs,
          fullscreen: w.isFullScreen(),
          focused: w.isFocused(),
        })),
        await player.evaluate(() => ({
          game: !!document.getElementById('spear-pulsefield'),
          fullscreen: document.fullscreenElement?.tagName,
          pointer: document.pointerLockElement?.tagName,
          focus: document.hasFocus(),
        })),
      );
      throw error;
    }
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
            'https://github.com/weirdthoughts/spear-desktop/releases/download/v9.9.9/';
          if (
            String(url) ===
            'https://api.github.com/repos/weirdthoughts/spear-desktop/releases/latest'
          )
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
test('Stardrift collects with its trail, clears mines, penalizes misses and reforms', async () => {
  const source = stripTypeScriptTypes(
    await fs.readFile(path.join(root, 'src/classic/collector.ts'), 'utf8'),
  );
  const { createCollector } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  );
  const game = createCollector(),
    r = game.run;
  const shape = (x, y, hazard = false) => ({
    x,
    y,
    hazard,
    radius: 10,
    hue: 170,
    sides: 4,
    angle: 0,
  });
  r.objects.push(shape(0.5, 0.7));
  game.step(0.001, true, 120, 0.1, false);
  expect(r.score).toBe(30);
  r.tail = [
    { x: 0.2, y: 0.4, age: 0 },
    { x: 0.2, y: 0.5, age: 0 },
  ];
  r.objects.push(shape(0.2, 0.45));
  game.step(0.001, true, 120, 0.1, false);
  expect(r.score).toBe(60);
  const strengthBeforeMiss = r.mass;
  r.objects.push(shape(0.1, 1.2));
  game.step(0.001, true, 120, 0.1, false);
  expect(r.score).toBe(45);
  expect(r.mass).toBe(strengthBeforeMiss);
  for (let i = 0; i < 40; i++) {
    r.objects.push(shape(0.1, 1.2));
    game.step(0.001, true, 120, 0.1, false);
  }
  expect(r.mass).toBe(strengthBeforeMiss);
  expect(r.respawn).toBe(0);
  expect(r.score).toBe(45 - 40 * 15);
  r.charge = 1;
  r.held = true;
  r.objects.push(shape(0.6, 0.7, true));
  game.step(0.01, true, 120, 0.1, false);
  for (let i = 0; i < 40; i++) game.step(0.016, true, 120, 0.1, false);
  expect(r.objects).toHaveLength(0);
  expect(r.mass).toBeGreaterThan(3);
  r.waves = [];
  r.invulnerable = 0;
  r.mass = 2;
  r.objects.push(shape(r.x, r.y, true));
  game.step(0.01, true, 120, 0.1, false);
  expect(r.respawn).toBeGreaterThan(0);
  for (let i = 0; i < 140; i++) game.step(0.016, true, 120, 0.1, false);
  expect(r.mass).toBe(3);
  expect(r.score).toBe(0);
  const distance = r.distance;
  game.step(0.5, false, 120, 0.1, false);
  expect(r.distance).toBe(distance);
});

test('locked configuration survives startup, merges changes, and flushes recovery', async () => {
  const syncFs = (await import('node:fs')).default;
  const { default: Conf } = await import('conf');
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'spear-config-lock-'),
  );
  const file = path.join(temporary, 'config.json');
  await fs.writeFile(file, JSON.stringify({ theme: 'steel-blue', volume: 42 }));
  let source = stripTypeScriptTypes(
    await fs.readFile(path.join(root, 'src/config/resilient-store.ts'), 'utf8'),
  );
  source = source
    .replace(/^import .*;$/gm, '')
    .replace(/const Store = [\s\S]*?\.default;/, '')
    .replace('export class', 'class');
  let locked = true;
  class LockingConf extends Conf {
    get store() {
      return super.store;
    }
    set store(value) {
      if (locked)
        throw Object.assign(new Error('Simulated Windows sharing violation'), {
          code: 'EPERM',
        });
      super.store = value;
    }
  }
  const ResilientStore = new Function(
    'fs',
    'Store',
    'app',
    'dialog',
    source + '\nreturn ResilientStore;',
  )(
    syncFs,
    LockingConf,
    { whenReady: async () => {} },
    { showMessageBox: async () => {} },
  );
  try {
    const store = new ResilientStore({
      cwd: temporary,
      projectVersion: '3.12.14',
      defaults: { firstRun: false },
    });
    store.set('volume', 65);
    store.set('theme', 'graphite');
    expect(store.get('volume')).toBe(65);
    expect(store.get('theme')).toBe('graphite');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).volume).toBe(42);
    expect(
      JSON.parse(await fs.readFile(file + '.pending', 'utf8')).volume,
    ).toBe(65);
    // Simulate a restart while the canonical file is still locked.
    const restarted = new ResilientStore({
      cwd: temporary,
      projectVersion: '3.12.14',
    });
    expect(restarted.get('volume')).toBe(65);
    expect(restarted.get('theme')).toBe('graphite');
    locked = false;
    await expect
      .poll(async () => JSON.parse(await fs.readFile(file, 'utf8')).volume, {
        timeout: 12000,
      })
      .toBe(65);
    await expect
      .poll(
        () =>
          fs.access(file + '.pending').then(
            () => true,
            () => false,
          ),
        { timeout: 12000 },
      )
      .toBe(false);
  } finally {
    locked = false;
  }
});

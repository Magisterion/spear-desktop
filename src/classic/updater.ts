import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  copyFile,
  open,
  readFile,
  rm,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { gt, valid } from 'semver';
import updatePage from './updater.html?asset';
import updatePreload from './updater-preload.cjs?asset';

const repository = 'Magisterion/spear-desktop';
const assetName = 'YouTube-Music-Spear.exe';
type Phase =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'current'
  | 'cancelled'
  | 'error'
  | 'unsupported';
type Asset = { name: string; browser_download_url: string; size: number };
type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Asset[];
};
let state = {
  phase: 'current' as Phase,
  version: '',
  received: 0,
  total: 0,
  speed: 0,
  message: '',
};
let window: BrowserWindow | null = null;
let registered = false;
let checking = false;
let downloadController: AbortController | undefined;
let releaseFiles: { asset: Asset; checksum: Asset } | undefined;
let verified: { staged: string; hash: string } | undefined;
const updateFolder = () => path.join(app.getPath('userData'), 'updates');

async function restoreDownload() {
  const manifest = path.join(updateFolder(), 'verified.json');
  try {
    const saved = JSON.parse(await readFile(manifest, 'utf8')) as {
      version: string;
      hash: string;
      size: number;
    };
    if (!valid(saved.version) || !gt(saved.version, app.getVersion())) {
      await rm(manifest, { force: true });
      return false;
    }
    if (
      !/^[a-f0-9]{64}$/.test(saved.hash) ||
      !Number.isSafeInteger(saved.size) ||
      saved.size <= 0
    )
      return false;
    const staged = path.join(updateFolder(), assetName + '.new');
    if ((await stat(staged)).size !== saved.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(staged))
      hash.update(chunk as Buffer);
    if (hash.digest('hex') !== saved.hash) return false;
    verified = { staged, hash: saved.hash };
    setState({
      phase: 'ready',
      version: saved.version,
      received: saved.size,
      total: saved.size,
      message:
        'Your downloaded portable update is ready. No download is needed. Restart when convenient.',
    });
    return true;
  } catch {
    return false;
  }
}

function setState(change: Partial<typeof state>) {
  state = { ...state, ...change };
  window?.setProgressBar(
    state.phase === 'downloading'
      ? state.total
        ? state.received / state.total
        : 2
      : state.phase === 'verifying'
        ? 2
        : -1,
  );
}
function trustedAsset(url: string) {
  const parsed = new URL(url);
  if (
    parsed.origin !== 'https://github.com' ||
    !parsed.pathname.startsWith(`/${repository}/releases/download/`)
  )
    throw new Error('Unexpected release download address.');
  return url;
}
function showUpdates() {
  if (!registered) {
    ipcMain.handle('spear:updates', (event, action: string) => {
      if (!window || event.sender !== window.webContents)
        throw new Error('Untrusted update window');
      if (action === 'download') void downloadUpdate();
      if (action === 'cancel') downloadController?.abort();
      if (action === 'install') void installUpdate();
      if (action === 'check') void checkPortableUpdate(true);
      if (action === 'releases')
        void shell.openExternal(`https://github.com/${repository}/releases`);
      if (action === 'close' && state.phase !== 'installing') window.close();
      return {
        ...state,
        canDownload: !!releaseFiles,
        currentVersion: app.getVersion(),
      };
    });
    registered = true;
  }
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 480,
    height: 335,
    resizable: false,
    maximizable: false,
    alwaysOnTop: false,
    show: false,
    backgroundColor: '#17191d',
    title: 'YouTube Music Spear · Updates',
    autoHideMenuBar: true,
    webPreferences: {
      preload: updatePreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('close', (event) => {
    if (state.phase === 'installing') event.preventDefault();
    else downloadController?.abort();
  });
  window.on('closed', () => {
    window = null;
  });
  void window.loadFile(updatePage);
}

export async function checkPortableUpdate(
  manual: boolean,
  onAvailable?: () => void,
) {
  if (
    checking ||
    ['downloading', 'verifying', 'ready', 'installing'].includes(state.phase)
  ) {
    if (manual) showUpdates();
    if (state.phase !== 'checking') onAvailable?.();
    return;
  }
  checking = true;
  setState({
    phase: 'checking',
    message: '',
    version: '',
    received: 0,
    total: 0,
    speed: 0,
  });
  if (manual) showUpdates();
  try {
    if (!process.env.PORTABLE_EXECUTABLE_FILE || process.platform !== 'win32') {
      setState({
        phase: 'unsupported',
        message:
          'Automatic updating is available in the Windows portable build.',
      });
      return;
    }
    let previousFailure = '';
    const resultFile = path.join(updateFolder(), 'install-result.json');
    const previous = await readFile(resultFile, 'utf8').catch(() => '');
    if (previous) {
      const result = JSON.parse(previous) as {
        success: boolean;
        stage?: string;
        error?: string;
      };
      if (!result.success) {
        previousFailure = `The previous update stopped at ${result.stage ?? 'replacement'}: ${result.error ?? 'Unknown error'}. The verified download and your data were preserved.`;
        setState({ phase: 'error', message: previousFailure });
      }
    }
    if (await restoreDownload()) {
      if (previousFailure)
        setState({
          message:
            previousFailure + ' You can retry without downloading again.',
        });
      onAvailable?.();
      showUpdates();
      return;
    }
    const response = await net.fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (response.status === 404) {
      setState({
        phase: 'current',
        message: 'No published update is available yet.',
      });
      return;
    }
    if (!response.ok)
      throw new Error(`Could not check for updates (HTTP ${response.status}).`);
    const release = (await response.json()) as Release;
    const version = valid(release.tag_name);
    if (
      !version ||
      release.draft ||
      release.prerelease ||
      !gt(version, app.getVersion())
    ) {
      setState({ phase: 'current', message: 'You have the latest version.' });
      return;
    }
    const asset = release.assets.find((item) => item.name === assetName);
    const checksum = release.assets.find(
      (item) => item.name === `${assetName}.sha256`,
    );
    if (
      !asset ||
      !checksum ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0
    )
      throw new Error(
        'This release does not include a verified Windows portable build.',
      );
    releaseFiles = { asset, checksum };
    setState({ phase: 'available', version, total: asset.size, message: '' });
    onAvailable?.();
    showUpdates();
  } catch (error) {
    setState({
      phase: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not check for updates. Please try again.',
    });
    if (manual) showUpdates();
  } finally {
    checking = false;
  }
}

async function downloadUpdate() {
  if (
    !releaseFiles ||
    !['available', 'cancelled', 'error'].includes(state.phase) ||
    downloadController
  )
    return;
  const controller = new AbortController();
  downloadController = controller;
  verified = undefined;
  const staged = path.join(updateFolder(), assetName + '.new');
  const { asset, checksum } = releaseFiles;
  setState({
    phase: 'downloading',
    received: 0,
    total: asset.size,
    speed: 0,
    message: '',
  });
  try {
    await mkdir(updateFolder(), { recursive: true });
    const checksumResponse = await net.fetch(
      trustedAsset(checksum.browser_download_url),
      {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(30000),
        ]),
      },
    );
    if (!checksumResponse.ok)
      throw new Error(
        'Could not download the release checksum. Please try again.',
      );
    const expected = (await checksumResponse.text())
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw new Error(
        'The release checksum is invalid. Nothing was installed.',
      );
    const partial = path.join(updateFolder(), 'partial.json');
    const identity = JSON.stringify({
      version: state.version,
      expected,
      size: asset.size,
      url: asset.browser_download_url,
    });
    const saved = await readFile(partial, 'utf8').catch(() => '');
    let offset =
      saved === identity
        ? await stat(staged)
            .then((s) => s.size)
            .catch(() => 0)
        : 0;
    if (offset > asset.size) offset = 0;
    if (!offset) await writeFile(staged, '');
    await writeFile(partial, identity, 'utf8');
    setState({ received: offset });
    if (offset < asset.size) {
      const response = await net.fetch(
        trustedAsset(asset.browser_download_url),
        {
          headers: offset ? { Range: `bytes=${offset}-` } : {},
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(600000),
          ]),
        },
      );
      if (!response.ok || !response.body)
        throw new Error(
          `Could not download the update (HTTP ${response.status}). Saved progress is kept.`,
        );
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          response.headers.get('content-range') ?? '',
        );
        if (
          !range ||
          Number(range[1]) !== offset ||
          Number(range[3]) !== asset.size ||
          Number(range[2]) !== asset.size - 1
        ) {
          await response.body.cancel();
          throw new Error(
            'The server returned an unexpected download range. Saved progress is kept.',
          );
        }
      } else if (response.status === 200) {
        offset = 0; // The server ignored Range: safely replace, never append a full response.
        setState({ received: 0 });
      } else {
        await response.body.cancel();
        throw new Error('Unexpected download response.');
      }
      const file = await open(staged, offset ? 'a' : 'w');
      const reader = response.body.getReader();
      const start = Date.now();
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (state.received + value.byteLength > asset.size)
            throw new Error(
              'The download is larger than the release metadata.',
            );
          await file.writeFile(value);
          const received = state.received + value.byteLength;
          setState({
            received,
            speed:
              (received - offset) / Math.max(0.1, (Date.now() - start) / 1000),
          });
        }
      } finally {
        await reader.cancel().catch(() => {});
        await file.close();
      }
    }
    controller.signal.throwIfAborted();
    if (state.received !== asset.size)
      throw new Error(
        'Download interrupted. Saved progress is kept; retry to resume.',
      );
    setState({ phase: 'verifying' });
    const diskHash = createHash('sha256');
    for await (const chunk of createReadStream(staged)) {
      controller.signal.throwIfAborted();
      diskHash.update(chunk as Buffer);
    }
    if (diskHash.digest('hex') !== expected) {
      await rm(staged, { force: true });
      await rm(partial, { force: true });
      throw new Error(
        'The saved file failed verification. Nothing was installed.',
      );
    }
    await rm(partial, { force: true });
    const manifest = path.join(updateFolder(), 'verified.json');
    await writeFile(
      manifest + '.tmp',
      JSON.stringify({
        version: state.version,
        hash: expected,
        size: asset.size,
      }),
      'utf8',
    );
    await rename(manifest + '.tmp', manifest);
    verified = { staged, hash: expected };
    setState({
      phase: 'ready',
      message:
        'Portable update verified and saved. Later keeps the download for your next restart.',
    });
  } catch (error) {
    setState({
      phase: controller.signal.aborted ? 'cancelled' : 'error',
      message: controller.signal.aborted
        ? 'Download cancelled. Saved progress is kept for the next attempt.'
        : error instanceof Error
          ? error.message
          : 'Download failed. Please try again.',
    });
  } finally {
    downloadController = undefined;
  }
}

async function installUpdate() {
  if (state.phase !== 'ready' || !verified) return;
  setState({
    phase: 'installing',
    message: 'Preparing the portable update. Spear will restart shortly.',
  });
  try {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!executable)
      throw new Error('The portable executable could not be located.');
    const handshake = path.join(updateFolder(), 'updater-ready');
    await rm(handshake, { force: true });
    const payload = Buffer.from(
      JSON.stringify({
        pid: process.pid,
        source: verified.staged,
        target: executable,
        hash: verified.hash,
        ready: handshake,
        version: state.version,
        launch: path.join(updateFolder(), 'last-launch.json'),
        result: path.join(updateFolder(), 'install-result.json'),
      }),
    ).toString('base64');
    // Keep the running helper outside the portable profile so it cannot lock data.
    const helperFolder = await mkdtemp(
      path.join(app.getPath('temp'), 'Spear-Updater-'),
    );
    const helper = path.join(helperFolder, 'Spear-Update.exe');
    const bundledHelper = app.isPackaged
      ? path.join(process.resourcesPath, 'updater', 'Spear-Update.exe')
      : path.join(app.getAppPath(), 'build', 'updater', 'Spear-Update.exe');
    await copyFile(bundledHelper, helper);
    const child = spawn(helper, [payload], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: helperFolder,
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    let ready = false;
    let detail = '';
    for (let i = 0; i < 1200; i++) {
      const status = (await readFile(handshake, 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null)) as {
        state?: string;
        stage?: string;
        error?: string;
      } | null;
      if (status?.state === 'error') {
        detail = `${status.stage}: ${status.error}`;
        break;
      }
      if (status?.state === 'ready') {
        ready = true;
        break;
      }
      if (child.exitCode !== null) {
        detail = `Updater exited with code ${child.exitCode}.`;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      child.kill();
      const message =
        detail ||
        'The native updater did not acknowledge startup within two minutes.';
      await writeFile(
        path.join(updateFolder(), 'install-result.json'),
        JSON.stringify({
          success: false,
          stage: 'helper-start',
          error: message,
        }),
      );
      throw new Error(
        `${message} Spear is still running and the verified download is preserved. Details: data/updates/install-result.json.`,
      );
    }
    // Allow the update window to close during the normal application shutdown.
    window?.removeAllListeners('close');
    setTimeout(() => app.exit(0), 8000).unref();
    app.quit();
  } catch (error) {
    setState({
      phase: 'ready',
      message:
        error instanceof Error
          ? error.message
          : 'The portable update could not start. Your current version is unchanged.',
    });
  }
}

/** Receipt lets the independent helper verify the actual new Electron process started. */
export async function recordPortableLaunch() {
  if (process.platform !== 'win32' || !process.env.PORTABLE_EXECUTABLE_FILE)
    return;
  await mkdir(updateFolder(), { recursive: true });
  await writeFile(
    path.join(updateFolder(), 'last-launch.json'),
    JSON.stringify({ pid: process.pid, version: app.getVersion() }),
  );
}

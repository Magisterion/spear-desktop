import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
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
      return { ...state, currentVersion: app.getVersion() };
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
    alwaysOnTop: BrowserWindow.getAllWindows().some((win) =>
      win.isAlwaysOnTop(),
    ),
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

export async function checkPortableUpdate(manual: boolean) {
  if (
    checking ||
    ['downloading', 'verifying', 'ready', 'installing'].includes(state.phase)
  ) {
    if (manual) showUpdates();
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
    const resultFile = path.join(updateFolder(), 'install-result.json');
    const previous = await readFile(resultFile, 'utf8').catch(() => '');
    if (previous) {
      await rm(resultFile, { force: true });
      const result = JSON.parse(previous) as { success: boolean };
      if (!result.success) {
        setState({
          phase: 'error',
          message:
            'Windows could not replace the executable. Close other copies of Spear and try again, or download the release manually. Your data folder was preserved.',
        });
      }
    }
    if (await restoreDownload()) {
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
    const response = await net.fetch(trustedAsset(asset.browser_download_url), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Could not download the update (HTTP ${response.status}).`,
      );
    const file = await open(staged, 'w');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    const start = Date.now();
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (state.received + value.byteLength > asset.size)
          throw new Error(
            'The download is larger than the release metadata. Nothing was installed.',
          );
        await file.writeFile(value);
        hash.update(value);
        const received = state.received + value.byteLength;
        setState({
          received,
          speed: received / Math.max(0.1, (Date.now() - start) / 1000),
        });
      }
    } finally {
      await reader.cancel().catch(() => {});
      await file.close();
    }
    controller.signal.throwIfAborted();
    setState({ phase: 'verifying' });
    if (state.received !== asset.size || hash.digest('hex') !== expected)
      throw new Error(
        'The downloaded file failed verification. Nothing was installed. Please try again.',
      );
    const diskHash = createHash('sha256');
    for await (const chunk of createReadStream(staged)) {
      controller.signal.throwIfAborted();
      diskHash.update(chunk as Buffer);
    }
    if (diskHash.digest('hex') !== expected)
      throw new Error(
        'The saved file failed verification. Nothing was installed.',
      );
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
    await rm(staged, { force: true }).catch(() => {});
    setState({
      phase: controller.signal.aborted ? 'cancelled' : 'error',
      message: controller.signal.aborted
        ? 'Download cancelled. Your current version is unchanged.'
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
        result: path.join(updateFolder(), 'install-result.json'),
      }),
    ).toString('base64');
    // Only base64 JSON is interpolated; paths never become PowerShell source.
    const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
try {
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($p.source)
try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha.Dispose() }
if ($actualHash -ne $p.hash) { throw 'Downloaded file verification failed.' }
[IO.File]::WriteAllText($p.ready, 'ready')
$running = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
if ($running) { $running.WaitForExit() }
$backup = $p.target + '.previous'
$installed = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    Move-Item -LiteralPath $p.target -Destination $backup -Force
    try { Move-Item -LiteralPath $p.source -Destination $p.target -Force }
    catch { Move-Item -LiteralPath $backup -Destination $p.target -Force; throw }
    $installed = $true
    break
  } catch { Start-Sleep -Seconds 1 }
}
[IO.File]::WriteAllText($p.result, (@{success=$installed} | ConvertTo-Json))
try {
  if (!(Test-Path -LiteralPath $p.target)) { throw 'The portable executable is missing.' }
  Start-Process -FilePath $p.target -WorkingDirectory (Split-Path -Parent $p.target) -ErrorAction Stop
} catch {
  [IO.File]::WriteAllText($p.result, (@{success=$false} | ConvertTo-Json))
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('Spear could not restart automatically. Start YouTube-Music-Spear.exe manually. Your data folder has been preserved.', 'YouTube Music Spear update') | Out-Null
}
} catch {
  [IO.File]::WriteAllText($p.ready, ('error: ' + $_.Exception.Message))
  exit 1
}
`;
    const child = spawn(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        cwd: path.dirname(executable),
        env: {
          ...process.env,
          PSModulePath: path.join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'Modules',
          ),
        },
      },
    );
    let startupError = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      startupError = (startupError + chunk.toString()).slice(-1500);
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    let ready = false;
    for (let i = 0; i < 600; i++) {
      const handshakeState = await readFile(handshake, 'utf8').catch(() => '');
      if (handshakeState.startsWith('error:')) {
        startupError = handshakeState;
        break;
      }
      if (handshakeState === 'ready') {
        ready = true;
        break;
      }
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      child.kill();
      throw new Error(
        'The portable updater could not start. Spear is still running. ' +
          (startupError.trim() ||
            'Windows may have blocked PowerShell, or file verification took too long. Try again or use the release download.'),
      );
    }
    child.stderr?.destroy();
    child.unref();
    // Allow the update window to close during the normal application shutdown.
    window?.removeAllListeners('close');
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

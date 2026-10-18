import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { app, dialog, net } from 'electron';
import { gt, valid } from 'semver';

const repository = 'Magisterion/spear-desktop';
const assetName = 'YouTube-Music-Spear.exe';
let busy = false;
type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
};

function trustedAsset(url: string) {
  const parsed = new URL(url);
  if (
    parsed.origin !== 'https://github.com' ||
    !parsed.pathname.startsWith(`/${repository}/releases/download/`)
  )
    throw new Error('Unexpected release asset location');
  return url;
}

export async function checkPortableUpdate(manual: boolean) {
  if (busy) return;
  busy = true;
  let installing = false;
  try {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE;
    if (!executable || process.platform !== 'win32') {
      if (manual)
        await dialog.showMessageBox({
          message: 'Updates are available in the Windows portable build.',
          title: 'Spear updates',
        });
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
      if (manual)
        await dialog.showMessageBox({
          message: 'No published release is available yet.',
          title: 'Spear updates',
        });
      return;
    }
    if (!response.ok)
      throw new Error(`Release check failed (${response.status})`);
    const release = (await response.json()) as Release;
    const version = valid(release.tag_name);
    if (
      !version ||
      release.draft ||
      release.prerelease ||
      !gt(version, app.getVersion())
    ) {
      if (manual)
        await dialog.showMessageBox({
          message: 'Spear is up to date.',
          title: 'Spear updates',
        });
      return;
    }
    const asset = release.assets.find((item) => item.name === assetName);
    const checksum = release.assets.find(
      (item) => item.name === `${assetName}.sha256`,
    );
    if (!asset || !checksum)
      throw new Error(
        'This release has no verified Windows x64 portable build.',
      );
    const answer = await dialog.showMessageBox({
      title: 'Spear update',
      message: `Spear ${version} is available.`,
      detail:
        'Download and restart to update this portable copy. Your data folder will be preserved.',
      buttons: ['Update and restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response !== 0) return;
    installing = true;
    const folder = path.join(app.getPath('userData'), 'updates');
    await mkdir(folder, { recursive: true });
    const staged = path.join(folder, assetName + '.new');
    const checksumResponse = await net.fetch(
      trustedAsset(checksum.browser_download_url),
      { signal: AbortSignal.timeout(30000) },
    );
    if (!checksumResponse.ok)
      throw new Error('Could not download release checksum.');
    const expected = (await checksumResponse.text())
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw new Error('Invalid release checksum.');
    const download = await net.fetch(trustedAsset(asset.browser_download_url), {
      signal: AbortSignal.timeout(600000),
    });
    if (!download.ok) throw new Error(`Download failed (${download.status})`);
    const bytes = Buffer.from(await download.arrayBuffer());
    if (
      bytes.length !== asset.size ||
      createHash('sha256').update(bytes).digest('hex') !== expected
    )
      throw new Error('Update integrity check failed. Nothing was replaced.');
    await writeFile(staged, bytes);
    if (
      createHash('sha256')
        .update(await readFile(staged))
        .digest('hex') !== expected
    ) {
      await rm(staged);
      throw new Error('Staged update verification failed.');
    }
    // Paths are transported as base64 JSON, never interpolated into executable code.
    const payload = Buffer.from(
      JSON.stringify({
        pid: process.pid,
        source: staged,
        target: executable,
        hash: expected,
      }),
    ).toString('base64');
    const script = `$ErrorActionPreference = 'Stop'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
Wait-Process -Id $p.pid -ErrorAction SilentlyContinue
if ((Get-FileHash -LiteralPath $p.source -Algorithm SHA256).Hash.ToLower() -ne $p.hash) { exit 1 }
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
if ($installed) { Start-Process -FilePath $p.target }
`;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    app.quit();
  } catch (error) {
    if (manual || installing)
      await dialog.showMessageBox({
        type: 'error',
        title: 'Spear update',
        message:
          error instanceof Error
            ? error.message
            : 'Update failed. Please try again later.',
      });
    else
      console.warn(
        'Spear update check failed; the installed version is unchanged.',
      );
  } finally {
    busy = false;
  }
}

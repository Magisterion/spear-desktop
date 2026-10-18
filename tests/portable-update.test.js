import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (file) =>
  fs
    .readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
test('real portable EXE updates and relaunches while preserving data', async () => {
  test.skip(process.platform !== 'win32');
  test.setTimeout(240000);
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'Spear portable Юникод '),
  );
  const updates = path.join(temporary, 'data', 'updates');
  await fs.mkdir(updates, { recursive: true });
  const target = path.join(temporary, 'YouTube-Music-Spear.exe');
  const source = path.join(updates, 'YouTube-Music-Spear.exe.new');
  const version = JSON.parse(
    await fs.readFile(path.join(root, 'package.json')),
  ).version;
  const parts = version.split('.').map(Number);
  parts[2]++;
  const nextVersion = parts.join('.');
  await fs.copyFile(path.join(root, 'pack', 'YouTube-Music-Spear.exe'), target);
  await fs.copyFile(
    path.join(root, 'pack-next', 'YouTube-Music-Spear.exe'),
    source,
  );
  const bytes = await fs.readFile(source);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(
    path.join(updates, 'verified.json'),
    JSON.stringify({ version: nextVersion, hash, size: bytes.length }),
  );
  const sentinel = path.join(temporary, 'data', 'user-settings-sentinel.txt');
  await fs.writeFile(sentinel, 'Keep my profile unchanged.');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const launcher = spawn(
    target,
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { cwd: temporary, stdio: 'ignore' },
  );
  let browser;
  try {
    await expect
      .poll(
        async () => {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/json/version`);
            return r.ok;
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      )
      .toBe(true);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await expect
      .poll(
        () =>
          browser
            .contexts()[0]
            .pages()
            .some((p) => p.url().includes('updater-')),
        { timeout: 45000 },
      )
      .toBe(true);
    const update = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('updater-'));
    await expect
      .poll(() => update.evaluate(() => window.updates.request('status')))
      .toMatchObject({
        phase: 'ready',
        currentVersion: version,
        version: nextVersion,
      });
    const before = await readJson(path.join(updates, 'last-launch.json'));
    expect(before.version).toBe(version);
    await update
      .getByRole('button', { name: 'Restart and update', exact: true })
      .click();
    // This uses the production IPC action and bundled native helper, not an extracted script.
    await expect
      .poll(() => readJson(path.join(updates, 'install-result.json')), {
        timeout: 150000,
        intervals: [500],
      })
      .toMatchObject({ success: true, version: nextVersion });
    const after = await readJson(path.join(updates, 'last-launch.json'));
    expect(after.version).toBe(nextVersion);
    expect(after.pid).not.toBe(before.pid);
    expect(
      createHash('sha256')
        .update(await fs.readFile(target))
        .digest('hex'),
    ).toBe(hash);
    expect(await fs.readFile(sentinel, 'utf8')).toBe(
      'Keep my profile unchanged.',
    );
    await fs.writeFile(
      path.join(temporary, 'data', 'writable.txt'),
      'still writable',
    );
    expect(await fs.stat(target + '.previous')).toBeTruthy();
    // A failed install can retry without downloading again.
    expect(
      createHash('sha256')
        .update(await fs.readFile(source))
        .digest('hex'),
    ).toBe(hash);
  } finally {
    await browser?.close().catch(() => {});
    const receipt = await readJson(path.join(updates, 'last-launch.json'));
    if (receipt?.pid) {
      try {
        process.kill(receipt.pid);
      } catch {}
    }
    launcher.kill();
  }
});

test('native updater rejects a corrupt file before closing the player', async () => {
  test.skip(process.platform !== 'win32');
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'spear-update-reject-'),
  );
  const source = path.join(temporary, 'download.new'),
    target = path.join(temporary, 'player.exe');
  await fs.writeFile(source, 'corrupt');
  await fs.writeFile(target, 'original');
  const ready = path.join(temporary, 'ready.json'),
    result = path.join(temporary, 'result.json');
  const payload = Buffer.from(
    JSON.stringify({
      pid: process.pid,
      source,
      target,
      ready,
      result,
      hash: '0'.repeat(64),
    }),
  ).toString('base64');
  const child = spawn(path.join(root, 'build/updater/Spear-Update.exe'), [
    payload,
  ]);
  expect(
    await new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    }),
  ).toBe(1);
  expect(await readJson(ready)).toMatchObject({
    state: 'error',
    stage: 'verification',
  });
  expect(await fs.readFile(target, 'utf8')).toBe('original');
});

test('failed relaunch exits the helper and releases the update folder', async () => {
  test.skip(process.platform !== 'win32');
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), 'spear-relaunch-fail-'),
  );
  const source = path.join(temporary, 'download.new');
  const target = path.join(temporary, 'player.exe');
  const ready = path.join(temporary, 'ready.json');
  const result = path.join(temporary, 'result.json');
  const bytes = Buffer.from('Not a Windows executable');
  await fs.writeFile(source, bytes);
  await fs.writeFile(target, 'previous executable');
  const payload = Buffer.from(
    JSON.stringify({
      pid: 2147483647,
      source,
      target,
      ready,
      result,
      launch: path.join(temporary, 'launch.json'),
      version: '0.0.1',
      hash: createHash('sha256').update(bytes).digest('hex'),
    }),
  ).toString('base64');
  const child = spawn(path.join(root, 'build/updater/Spear-Update.exe'), [
    payload,
  ]);
  const exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  try {
    expect(await exited).toBe(1);
    expect(await readJson(ready)).toMatchObject({ state: 'ready' });
    expect(await readJson(result)).toMatchObject({
      success: false,
      stage: 'relaunch',
    });
    await fs.rm(temporary, { recursive: true });
    await expect(fs.stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    child.kill();
  }
});

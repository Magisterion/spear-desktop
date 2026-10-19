import fs from 'node:fs';
import { app, dialog } from 'electron';

// electron-store's constructor can save migrations before main-process error
// handlers exist. Protect that path as well as later preference changes.
// oxlint-disable-next-line typescript/no-require-imports
const Store = (
  require('electron-store') as {
    default: typeof import('electron-store').default;
  }
).default;
type Snapshot = Record<string, unknown>;
const pending = new WeakMap<object, Snapshot>();
const loaded = new WeakSet<object>();
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
let warned = false;
const isLocked = (error: unknown) =>
  ['EPERM', 'EACCES', 'EBUSY'].includes(
    (error as NodeJS.ErrnoException)?.code ?? '',
  );

export class ResilientStore extends Store {
  override get store(): Snapshot {
    if (this.path && !loaded.has(this)) {
      loaded.add(this);
      try {
        const journalTime = fs.statSync(this.path + '.pending').mtimeMs;
        let canonicalTime = 0;
        try {
          canonicalTime = fs.statSync(this.path).mtimeMs;
        } catch {
          /* First save. */
        }
        if (journalTime < canonicalTime) return super.store;
        const recovery: unknown = JSON.parse(
          fs.readFileSync(this.path + '.pending', 'utf8'),
        );
        if (
          recovery &&
          typeof recovery === 'object' &&
          !Array.isArray(recovery)
        ) {
          pending.set(this, recovery as Snapshot);
          this.retryLater();
        }
      } catch {
        /* Missing journal: the canonical config remains authoritative. */
      }
    }
    const value = pending.get(this);
    return value ? structuredClone(value) : super.store;
  }

  override set store(value: Snapshot) {
    const previous = pending.get(this);
    // During an outstanding lock, keep changes in the same pending snapshot.
    // Do not repeatedly enter atomically's synchronous Windows retry loop.
    if (previous && timers.has(this)) {
      this.defer(value, previous);
      return;
    }
    try {
      super.store = value;
      pending.delete(this);
      try {
        fs.unlinkSync(this.path + '.pending');
      } catch {
        /* No journal. */
      }
    } catch (error) {
      if (!isLocked(error)) throw error;
      this.defer(value, previous);
    }
  }

  private defer(value: Snapshot, previous?: Snapshot) {
    const snapshot = JSON.parse(JSON.stringify(value)) as Snapshot;
    pending.set(this, snapshot);
    // Preserve the original config. A separate atomic journal survives a restart
    // if only config.json is locked by a sync client or scanner.
    const journal = this.path + '.pending';
    const temporary = journal + '.tmp';
    let durable = false;
    try {
      fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), {
        mode: 0o600,
      });
      fs.renameSync(temporary, journal);
      durable = true;
    } catch {
      /* Keep the last good journal and the in-memory snapshot. */
    }
    this.retryLater();
    if (JSON.stringify(previous) !== JSON.stringify(snapshot))
      this.events.dispatchEvent(new Event('change'));
    if (!warned) {
      warned = true;
      void app.whenReady().then(() =>
        dialog.showMessageBox({
          type: 'warning',
          title: 'Spear settings are temporarily locked',
          message: 'Windows is preventing Spear from saving its settings file.',
          detail:
            'Dropbox, another sync app, antivirus software, or folder permissions may be blocking access. Pause synchronization or move the portable folder outside the synced location.\n\n' +
            (durable
              ? 'Your changes are saved in a recovery file. Spear will retry saving automatically.'
              : 'Your changes are currently kept in memory only. Keep Spear open until write access is restored. Spear will retry saving automatically.') +
            `\n\nSettings file: ${this.path}`,
          buttons: ['Continue'],
        }),
      );
    }
  }

  private retryLater() {
    if (timers.has(this)) return;
    const timer = setTimeout(() => {
      timers.delete(this);
      const value = pending.get(this);
      if (value) this.store = value;
    }, 5000);
    timer.unref();
    timers.set(this, timer);
  }
}

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

// Run before electron-store and the default Chromium session are initialized.
if (process.type === 'browser' && process.env.PORTABLE_EXECUTABLE_DIR) {
  const data = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
  mkdirSync(data, { recursive: true });
  app.setPath('userData', data);
  app.setPath('sessionData', path.join(data, 'session'));
  app.setAppLogsPath(path.join(data, 'logs'));
}

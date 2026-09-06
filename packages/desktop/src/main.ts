import path from 'node:path';
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import {
  APP_VERSION,
  createAppContext,
  createLogger,
  resolveAppPaths,
  type AppContext,
  type Logger,
} from '@school-library/core';
import { buildApp } from '@school-library/server';
import type { FastifyInstance } from 'fastify';

/**
 * The library application as it runs on the library computer.
 *
 * ARCHITECTURE.md AD-3: the service runs inside this process rather than as a
 * separate program. There is nothing to install alongside, nothing to start in
 * the right order, and nothing left running if the window is closed.
 *
 * AD-2 is unchanged by the move to a desktop shell: the window is a browser
 * pointed at the local service, and it reaches the database over HTTP like any
 * other client. The renderer gets no Node, no preload bridge and no direct
 * database handle, so a rule enforced in the service is enforced here too.
 */

/** Held for the lifetime of the process so shutdown can close them in order. */
let context: AppContext | null = null;
let service: FastifyInstance | null = null;
let mainWindow: BrowserWindow | null = null;
let serviceUrl: string | null = null;

/**
 * Where the built interface sits next to this file.
 *
 * The application is packaged unpacked (see `electron-builder.yml`), so this is
 * an ordinary directory on disk and `@fastify/static` reads it the same way it
 * does in development.
 */
const UI_DIR = path.join(__dirname, 'ui');

/**
 * The compiled SQLite module shipped beside the application.
 *
 * Pointed at explicitly rather than searched for: the packaged layout is not
 * the layout npm produces, and a native module that cannot be found is a blank
 * window with nothing in the log to explain it.
 */
const SQLITE_BINDING = path.join(
  __dirname,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);

/**
 * Starts the local service on a port the operating system chooses.
 *
 * Port 3000 is a busy address on a shared computer, and a library machine that
 * also runs something else on it would fail to start with nothing to say. The
 * window is told the port, so nothing needs a fixed one (§20 still requires
 * loopback, which is where it binds).
 */
async function startService(logger: Logger): Promise<string> {
  process.env.LIBRARY_SQLITE_BINDING = SQLITE_BINDING;
  context = createAppContext({ logger });
  service = buildApp(context, { uiDir: UI_DIR });

  await service.listen({ host: '127.0.0.1', port: 0 });

  const address = service.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The local service did not report a port.');
  }

  logger.info(
    { port: address.port, dataRoot: context.paths.root, schemaVersion: context.schemaVersion },
    'Local service started inside the desktop application',
  );

  return `http://127.0.0.1:${address.port}/`;
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    // Shown once the interface has painted, so the librarian never sees an
    // empty white frame while the database opens and migrations run.
    show: false,
    backgroundColor: '#f6f7f9',
    title: 'ספריית בית הספר',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadURL(url);

  // A link to somewhere else belongs in the browser, not in a window that is
  // signed in to the library. Neither a new window nor navigation away from the
  // local service is allowed.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

/**
 * A short menu in Hebrew.
 *
 * Electron's default menu is in English and offers a developer a great deal
 * that a librarian does not need. What is left is what someone actually
 * reaches for: reload when a screen looks stale, zoom for a shared monitor, and
 * the data folder for when they are asked where the backups are.
 */
function buildMenu(): void {
  const paths = resolveAppPaths();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'קובץ',
        submenu: [{ label: 'יציאה', role: 'quit' }],
      },
      {
        label: 'תצוגה',
        submenu: [
          { label: 'רענן', role: 'reload' },
          { type: 'separator' },
          { label: 'הגדל', role: 'zoomIn' },
          { label: 'הקטן', role: 'zoomOut' },
          { label: 'גודל רגיל', role: 'resetZoom' },
          { type: 'separator' },
          { label: 'מסך מלא', role: 'togglefullscreen' },
        ],
      },
      {
        label: 'עזרה',
        submenu: [
          {
            label: 'פתח את תיקיית הנתונים',
            click: () => void shell.openPath(paths.root),
          },
          {
            label: 'פתח את תיקיית הגיבויים',
            click: () => void shell.openPath(paths.backups),
          },
          {
            label: 'פתח את תיקיית היומנים',
            click: () => void shell.openPath(paths.logs),
          },
          { type: 'separator' },
          {
            label: 'אודות',
            click: () => {
              void dialog.showMessageBox({
                type: 'info',
                title: 'אודות',
                message: 'ספריית בית הספר',
                detail: [
                  `גרסה ${APP_VERSION}`,
                  `גרסת מסד נתונים ${context?.schemaVersion ?? '—'}`,
                  `כתובת מקומית ${serviceUrl ?? '—'}`,
                  `תיקיית נתונים ${paths.root}`,
                ].join('\n'),
                buttons: ['סגור'],
              });
            },
          },
          {
            label: 'כלי פיתוח',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => mainWindow?.webContents.toggleDevTools(),
            visible: false,
          },
        ],
      },
    ]),
  );
}

/**
 * Closes the service and the database before the process ends.
 *
 * SQLite in WAL mode leaves a `-wal` file behind if the connection is not
 * closed, and the next start has to recover it. Closing here is what keeps a
 * normal exit a clean one.
 */
async function shutdown(): Promise<void> {
  if (service !== null) {
    await service.close();
    service = null;
  }
  if (context !== null) {
    context.close();
    context = null;
  }
}

/**
 * Reports a failure to start in the only place a librarian will see it.
 *
 * There is no console on the library computer. A dialog is the whole error
 * channel, so it names the log file rather than only saying that something
 * went wrong.
 */
function reportStartupFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const logFile = path.join(resolveAppPaths().logs, 'app.log');

  dialog.showErrorBox(
    'התוכנה לא הצליחה להיפתח',
    `${detail}\n\nפרטים נוספים נמצאים בקובץ היומן:\n${logFile}`,
  );
}

// Two copies of the application would be two sets of migrations running against
// one database file. The second launch hands its request to the first and
// stops, which is also what a librarian double-clicking the icon twice expects.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(
    async () => {
      const paths = resolveAppPaths();
      // No console stream: a packaged Windows application has no window to
      // write to, and the file is where anyone looking will look.
      const logger = createLogger({ logDirectory: paths.logs, console: false });

      try {
        serviceUrl = await startService(logger);
        buildMenu();
        mainWindow = createWindow(serviceUrl);
      } catch (error) {
        logger.error({ err: error }, 'Failed to start');
        reportStartupFailure(error);
        await shutdown();
        app.exit(1);
      }
    },
    (error: unknown) => {
      reportStartupFailure(error);
      app.exit(1);
    },
  );

  // On Windows, closing the window means closing the application — there is no
  // dock to leave it running in.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (service === null && context === null) return;
    // Stop the default quit, close the database, then quit for real.
    event.preventDefault();
    void shutdown().finally(() => app.quit());
  });
}

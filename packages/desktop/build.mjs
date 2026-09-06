import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

/**
 * Builds the desktop application into `app/`, ready for electron-builder.
 *
 * The output is a plain, self-contained Electron application directory: one
 * bundled main process, the built interface beside it, one native module, and
 * a `package.json` describing them. Nothing in it refers to the workspace it
 * was built from.
 *
 * That independence is the point. Packaging a monorepo is where desktop builds
 * usually break — the packager has to work out which of a hoisted, symlinked
 * `node_modules` tree belongs to the application. Here it never has to: it is
 * handed a finished directory.
 *
 *   node build.mjs [--platform=win32] [--arch=x64]
 *
 * The platform and architecture select the native module only; everything else
 * is the same bytes on every target.
 */

const DESKTOP_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..', '..');
const APP_DIR = path.join(DESKTOP_DIR, 'app');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key ?? '', value ?? ''];
  }),
);

const targetPlatform = args.get('platform') ?? process.platform;
const targetArch = args.get('arch') ?? process.arch;

function log(message) {
  process.stdout.write(`  ${message}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Runs a package's own entry script with this Node.
 *
 * Not `npx`: on Windows the installed binaries are `.cmd` shims, which cannot
 * be spawned without a shell, and this build has to produce the Windows
 * installer on a Windows runner. Calling the JavaScript directly works
 * identically everywhere.
 */
function runNodeBin(relativeEntry, argv, cwd) {
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'node_modules', ...relativeEntry), ...argv], {
    cwd,
    stdio: 'inherit',
  });
}

const rootPackage = readJson(path.join(REPO_ROOT, 'package.json'));
const desktopPackage = readJson(path.join(DESKTOP_DIR, 'package.json'));

/**
 * The Electron version the native module must match.
 *
 * Read from the dependency rather than written down twice: a compiled addon
 * built against the wrong Electron will load and then crash the process, which
 * is a bad way to discover that two numbers drifted apart.
 */
const electronVersion = desktopPackage.devDependencies.electron.replace(/^[^\d]*/, '');

fs.rmSync(APP_DIR, { recursive: true, force: true });
fs.mkdirSync(APP_DIR, { recursive: true });

// --- The main process, with the service bundled into it -------------------

log('bundling the main process and the local service');

await esbuild.build({
  entryPoints: [path.join(DESKTOP_DIR, 'src', 'main.ts')],
  outfile: path.join(APP_DIR, 'main.cjs'),
  bundle: true,
  platform: 'node',
  // CommonJS, not ESM. `exceljs` is CommonJS with dynamic requires that an ESM
  // bundle cannot express, and the whole tree survives being inlined here.
  format: 'cjs',
  target: 'node20',
  // Electron is provided by the runtime; `better-sqlite3` is a compiled binary
  // and cannot be inlined into JavaScript.
  external: ['electron', 'better-sqlite3'],
  alias: {
    '@school-library/core': path.join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts'),
    '@school-library/server': path.join(REPO_ROOT, 'packages', 'server', 'src', 'index.ts'),
  },
  define: { 'import.meta.url': 'IMPORT_META_URL' },
  // The workspace source is written as ES modules and reads `import.meta.url`
  // to find its own location. In a CommonJS bundle that expression does not
  // exist, so it is defined above and given its value here.
  banner: {
    js: "const IMPORT_META_URL = require('url').pathToFileURL(__filename).href;",
  },
  logLevel: 'warning',
  minify: false,
  sourcemap: false,
});

// --- The interface --------------------------------------------------------

log('building the interface');

runNodeBin(['vite', 'bin', 'vite.js'], ['build', path.join(REPO_ROOT, 'packages', 'ui')], REPO_ROOT);

fs.cpSync(path.join(REPO_ROOT, 'packages', 'ui', 'dist'), path.join(APP_DIR, 'ui'), {
  recursive: true,
});

// --- The native module ----------------------------------------------------

/**
 * `better-sqlite3`, compiled for Electron rather than for Node.
 *
 * Electron embeds its own build of V8, and `better-sqlite3` uses the V8 API
 * directly, so the copy npm installed for this Node will not load inside
 * Electron. The project publishes binaries for both, and this fetches the
 * Electron one for the target platform — which is also why a Windows build
 * does not need a compiler.
 */
log(`fetching better-sqlite3 for electron ${electronVersion} (${targetPlatform}-${targetArch})`);

const nativeDir = path.join(APP_DIR, 'node_modules', 'better-sqlite3');
const sourceDir = path.join(REPO_ROOT, 'node_modules', 'better-sqlite3');

fs.mkdirSync(nativeDir, { recursive: true });
// Only what runs: the JavaScript and the package manifest. The C++ sources,
// the bundled SQLite amalgamation and the build tooling are all install-time
// concerns and would triple the size of the installer.
fs.cpSync(path.join(sourceDir, 'lib'), path.join(nativeDir, 'lib'), { recursive: true });
fs.cpSync(path.join(sourceDir, 'package.json'), path.join(nativeDir, 'package.json'));

runNodeBin(
  ['prebuild-install', 'bin.js'],
  [
    '--runtime=electron',
    `--target=${electronVersion}`,
    `--platform=${targetPlatform}`,
    `--arch=${targetArch}`,
    '--tag-prefix=v',
  ],
  nativeDir,
);

const binding = path.join(nativeDir, 'build', 'Release', 'better_sqlite3.node');
if (!fs.existsSync(binding)) {
  throw new Error(`The native module was not produced at ${binding}`);
}

// --- The application manifest ---------------------------------------------

/**
 * Named `school-library` deliberately.
 *
 * `APP_VERSION` is found by walking up from the running file to the workspace
 * root manifest by name. Giving the packaged application the same name and the
 * same version means the support screen and `/api/v1/health` report the real
 * version here too, rather than the "unknown" they would report from a
 * directory that has no manifest they recognise.
 */
fs.writeFileSync(
  path.join(APP_DIR, 'package.json'),
  `${JSON.stringify(
    {
      name: rootPackage.name,
      productName: desktopPackage.productName,
      version: rootPackage.version,
      description: desktopPackage.description,
      main: 'main.cjs',
      author: 'School Library',
      license: 'UNLICENSED',
      // Declared so the packager keeps `node_modules/better-sqlite3`. Left
      // out, it prunes the directory as an unused development dependency and
      // the application ships without the database engine.
      dependencies: { 'better-sqlite3': desktopPackage.dependencies['better-sqlite3'] },
    },
    null,
    2,
  )}\n`,
);

log(`built ${path.relative(REPO_ROOT, APP_DIR)} for ${targetPlatform}-${targetArch}`);

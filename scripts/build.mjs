import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generateAllIcons } from './generate-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const require = createRequire(import.meta.url);

function loadEsbuild() {
  for (const searchPath of [ROOT, path.resolve(ROOT, '..')]) {
    try {
      return require(require.resolve('esbuild', { paths: [searchPath] }));
    } catch {
      // try next path
    }
  }
  throw new Error('esbuild could not be resolved in local or workspace node_modules');
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

export async function buildExtension({ minify = false } = {}) {
  const start = performance.now();
  const esbuild = loadEsbuild();

  // Ensure crisp icons exist
  const iconsDir = path.join(ROOT, 'assets', 'icons');
  if (!fs.existsSync(path.join(iconsDir, 'icon128.png'))) {
    generateAllIcons();
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // Copy manifest & static assets
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));

  fs.mkdirSync(path.join(DIST, 'styles'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'src', 'styles', 'inject.css'),
    path.join(DIST, 'styles', 'inject.css')
  );

  for (const page of ['popup', 'options']) {
    const srcPage = path.join(ROOT, 'src', 'ui', page);
    const distPage = path.join(DIST, 'ui', page);
    fs.mkdirSync(distPage, { recursive: true });
    fs.copyFileSync(path.join(srcPage, `${page}.html`), path.join(distPage, `${page}.html`));
    fs.copyFileSync(path.join(srcPage, `${page}.css`), path.join(distPage, `${page}.css`));
  }

  const bundles = [
    { entry: 'src/entries/content-bridge.js', out: 'content-bridge.js', format: 'iife' },
    { entry: 'src/entries/inject-entry.js', out: 'inject.js', format: 'iife' },
    { entry: 'src/site-handlers/scripts/netflix.js', out: 'netflix-seek.js', format: 'iife' },
    { entry: 'src/background.js', out: 'background.js', format: 'iife' },
    { entry: 'src/ui/popup/popup.js', out: 'ui/popup/popup.js', format: 'iife' },
    { entry: 'src/ui/options/options.js', out: 'ui/options/options.js', format: 'iife' },
  ];

  const results = await Promise.all(
    bundles.map((b) =>
      esbuild.build({
        entryPoints: [path.join(ROOT, b.entry)],
        bundle: true,
        format: b.format,
        platform: 'browser',
        target: 'chrome111',
        minify,
        legalComments: 'none',
        outfile: path.join(DIST, b.out),
      })
    )
  );

  const summary = bundles.map((b, i) => ({
    file: b.out,
    bytes: fs.statSync(path.join(DIST, b.out)).size,
    warnings: results[i].warnings.length,
  }));

  const elapsedMs = (performance.now() - start).toFixed(1);
  return { summary, elapsedMs, minify, dist: DIST };
}

if (process.argv[1]?.endsWith('build.mjs')) {
  const minify = process.argv.includes('--minify');
  const res = await buildExtension({ minify });
  console.log(`Built extension (${minify ? 'minified' : 'standard'}) in ${res.elapsedMs}ms -> ${res.dist}`);
  for (const row of res.summary) {
    console.log(`  ${row.file.padEnd(24)} ${String(row.bytes).padStart(7)} bytes`);
  }
}


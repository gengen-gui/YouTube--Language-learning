import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

// Public backend URL baked into the build. When publishing a release you set:
//   YT_LINGO_API_BASE=https://your-app.fly.dev npm run build
// so end users don't have to type the server address themselves.
// Falls back to localhost for local development.
const API_BASE = (process.env.YT_LINGO_API_BASE || 'http://localhost:8787').replace(/\/$/, '');
console.log(`[yt-lingo] building with default API base: ${API_BASE}`);

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Copy static assets into dist
cpSync('public', outdir, { recursive: true });

// Rewrite manifest host_permissions so the extension is allowed to call the
// configured backend (Chrome blocks cross-origin fetch to hosts not listed here).
const manifestPath = path.join(outdir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const hosts = new Set(manifest.host_permissions || []);
hosts.add('https://www.youtube.com/*');
hosts.add('http://localhost:8787/*'); // keep localhost for dev/self-host
try {
  const u = new URL(API_BASE);
  hosts.add(`${u.protocol}//${u.host}/*`);
} catch {
  /* ignore invalid URL */
}
manifest.host_permissions = [...hosts];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const buildOptions = {
  entryPoints: {
    content: 'src/content.ts',
    inject: 'src/inject.ts',
    popup: 'src/popup.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  outdir,
  logLevel: 'info',
  define: {
    // Injected into api.ts as the default apiBase.
    __API_BASE__: JSON.stringify(API_BASE),
  },
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[yt-lingo] watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('[yt-lingo] build complete -> dist/');
}

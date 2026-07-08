import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Copy static assets into dist
cpSync('public', outdir, { recursive: true });

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
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[yt-lingo] watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('[yt-lingo] build complete -> dist/');
}

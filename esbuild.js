#!/usr/bin/env node
/**
 * esbuild bundler for the VS Code extension.
 *
 * Two builds:
 *   1. Extension host (Node, CJS) → out/extension/extension.js
 *   2. Service Map webview (Browser, IIFE, React + React Flow bundled) → out/webview/serviceMap.{js,css}
 *
 * The webview bundle replaces the previous CDN-loaded React Flow so the
 * Service Map renders fully offline.
 */

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const extensionOptions = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode', 'fsevents'],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'out/extension/extension.js',
};

const webviewOptions = {
    bundle: true,
    platform: 'browser',
    target: ['es2020', 'chrome100'],
    format: 'iife',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    jsx: 'automatic',
    loader: { '.css': 'css' },
    entryPoints: ['src/webview-src/serviceMap/index.tsx'],
    outfile: 'out/webview/serviceMap.js',
    define: {
        'process.env.NODE_ENV': production ? '"production"' : '"development"',
    },
};

async function build() {
    if (watch) {
        const extCtx = await esbuild.context(extensionOptions);
        const wvCtx = await esbuild.context(webviewOptions);
        await Promise.all([extCtx.watch(), wvCtx.watch()]);
        console.log('[esbuild] Watching extension + webview for changes...');
    } else {
        await esbuild.build(extensionOptions);
        await esbuild.build(webviewOptions);
        console.log('[esbuild] Build complete (extension + webview).');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});

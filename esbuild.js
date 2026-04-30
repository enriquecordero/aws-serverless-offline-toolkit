#!/usr/bin/env node
/**
 * esbuild bundler for the VS Code extension.
 * Bundles all source + dependencies into the output files so the VSIX
 * does not require node_modules to be included.
 */

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const baseOptions = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode', 'fsevents'],  // vscode = provided by VS Code; fsevents = optional native macOS module
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
};

async function build() {
    // ── Extension entry point ────────────────────────────────────────────────
    const extensionCtx = await esbuild.context({
        ...baseOptions,
        entryPoints: ['src/extension/extension.ts'],
        outfile: 'out/extension/extension.js',
    });

    if (watch) {
        await extensionCtx.watch();
        console.log('[esbuild] Watching for changes...');
    } else {
        await extensionCtx.rebuild();
        await extensionCtx.dispose();
        console.log('[esbuild] Build complete.');
    }
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});

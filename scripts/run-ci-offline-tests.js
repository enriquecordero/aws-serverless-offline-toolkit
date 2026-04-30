#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DEFAULT_LUMA_SCHEMA = '/Users/enriquecordero/Documents/evertec/luma/bcpr-dev-luma-poc/lib/schemas';

function runStep(name, command, args, env = process.env) {
    console.log(`\n[ci-offline] ${name}`);
    const res = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        env,
        shell: process.platform === 'win32',
    });

    if (res.status !== 0) {
        throw new Error(`${name} failed with exit code ${res.status}`);
    }
}

function main() {
    const lumaSchema = process.env.LUMA_SCHEMA || DEFAULT_LUMA_SCHEMA;
    const resolvedLumaSchema = path.isAbsolute(lumaSchema)
        ? lumaSchema
        : path.resolve(ROOT, lumaSchema);

    if (!fs.existsSync(resolvedLumaSchema)) {
        throw new Error(
            `LUMA schema path not found: ${resolvedLumaSchema}. Set LUMA_SCHEMA env var and retry.`
        );
    }

    runStep('Compile extension', 'npm', ['run', 'compile']);
    runStep('Run example offline suite', 'npm', ['run', 'test:offline:example']);
    runStep('Run LUMA offline suite', 'npm', [
        'run',
        'test:offline',
        '--',
        '--schema',
        resolvedLumaSchema,
        '--suite',
        'scripts/test-suites/luma-suite.json',
    ]);

    console.log('\n[ci-offline] All suites passed');
}

try {
    main();
} catch (err) {
    console.error(`\n[ci-offline] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}

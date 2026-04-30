#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ALLOWED_BUMPS = new Set(['patch', 'minor']);

function run(command, env) {
    execSync(command, {
        stdio: 'inherit',
        env: env || process.env,
    });
}

function readPackageVersion(packageJsonPath) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return pkg.version;
}

function loadEnvFromDotEnv(repoRoot) {
    const envFilePath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envFilePath)) {
        return;
    }

    const lines = fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function printUsage() {
    console.log('Usage: node scripts/release.js <patch|minor>');
    console.log('');
    console.log('Examples:');
    console.log('  npm run release:patch');
    console.log('  npm run release:minor');
}

function main() {
    const bump = process.argv[2];
    if (!bump || bump === '--help' || bump === '-h') {
        printUsage();
        process.exit(0);
    }

    if (!ALLOWED_BUMPS.has(bump)) {
        console.error(`Invalid bump type: ${bump}`);
        printUsage();
        process.exit(1);
    }

    const repoRoot = process.cwd();
    const packageJsonPath = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.error('package.json not found in current directory.');
        process.exit(1);
    }

    loadEnvFromDotEnv(repoRoot);
    if (!process.env.VSCE_PAT) {
        console.error('VSCE_PAT is missing. Set it in environment or in .env before running release.');
        process.exit(1);
    }

    const previousVersion = readPackageVersion(packageJsonPath);
    let nextVersion = previousVersion;

    try {
        console.log('Running prepublish checks...');
        run('npm run prepublish:check');

        console.log(`Bumping version (${bump})...`);
        run(`npm version ${bump} --no-git-tag-version`);
        nextVersion = readPackageVersion(packageJsonPath);

        console.log(`Publishing version ${nextVersion}...`);
        run('npm run publish:vsce');

        console.log(`Release completed: ${previousVersion} -> ${nextVersion}`);
    } catch (error) {
        console.error('Release failed.');

        if (nextVersion !== previousVersion) {
            try {
                console.log(`Reverting version to ${previousVersion}...`);
                run(`npm version ${previousVersion} --no-git-tag-version`);
            } catch (_) {
                console.error(`Could not automatically revert version. Please set package.json version back to ${previousVersion}.`);
            }
        }

        process.exit(1);
    }
}

main();

#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const token = argv[i];
        if (token.startsWith('--')) {
            const key = token.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith('--')) {
                args[key] = true;
            } else {
                args[key] = next;
                i++;
            }
        }
    }
    return args;
}

function getByPath(obj, dotPath) {
    if (!dotPath) return obj;
    const parts = dotPath.split('.');
    let curr = obj;
    for (const part of parts) {
        if (curr == null) return undefined;
        curr = curr[part];
    }
    return curr;
}

function toAbs(p) {
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

async function run() {
    const args = parseArgs(process.argv);
    const { AppSyncOfflineServer } = require('../out/core/appsync/server');

    const suitePath = toAbs(args.suite || 'scripts/test-suites/example-suite.json');
    if (!fs.existsSync(suitePath)) {
        throw new Error(`Suite file not found: ${suitePath}`);
    }

    const suite = JSON.parse(fs.readFileSync(suitePath, 'utf-8'));
    const schemaPath = toAbs(args.schema || 'example/schema.graphql');
    const mockPath = args.mock ? toAbs(args.mock) : undefined;
    const port = Number(args.port || 4020);

    const dataSources = mockPath
        ? [{ name: 'MockDB', type: 'JSON_FILE', filePath: mockPath }]
        : [{ name: 'MockDB', type: 'IN_MEMORY', data: {} }];

    const server = new AppSyncOfflineServer({
        port,
        schemaPath,
        resolversDir: undefined,
        dataSources,
        identity: { type: args.identity || 'apiKey' },
    });

    await server.start();
    console.log(`\n[offline-tests] Running suite: ${suite.name || path.basename(suitePath)} on http://localhost:${port}/graphql`);

    let passed = 0;
    let failed = 0;

    for (const test of suite.tests || []) {
        const body = {
            query: test.query,
            variables: test.variables || undefined,
            operationName: test.operationName || undefined,
        };

        try {
            const res = await fetch(`http://localhost:${port}/graphql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const payload = await res.json();

            if (test.expectNoErrors !== false && payload.errors && payload.errors.length > 0) {
                throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
            }

            if (test.expect && Array.isArray(test.expect)) {
                for (const rule of test.expect) {
                    const actual = getByPath(payload, rule.path);
                    if (Object.prototype.hasOwnProperty.call(rule, 'equals') && actual !== rule.equals) {
                        throw new Error(`Assertion failed at ${rule.path}. Expected ${JSON.stringify(rule.equals)}, got ${JSON.stringify(actual)}`);
                    }
                    if (rule.notNull === true && (actual === null || actual === undefined)) {
                        throw new Error(`Assertion failed at ${rule.path}. Expected not null.`);
                    }
                }
            }

            passed++;
            console.log(`  PASS  ${test.name}`);
        } catch (err) {
            failed++;
            console.error(`  FAIL  ${test.name}`);
            console.error(`        ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    server.stop();

    console.log(`\n[offline-tests] Summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

run().catch(err => {
    console.error('[offline-tests] Fatal:', err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
});

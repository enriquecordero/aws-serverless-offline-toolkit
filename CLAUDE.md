# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check only (no emit)
npm run compile

# Dev build (with source maps)
npm run bundle

# Watch mode
npm run watch

# Production build (minified, no source maps)
npm run bundle:prod

# Run integration tests against example project
npm run test:offline:example

# Package as .vsix
npm run package
```

There is no unit test framework. Tests are offline integration tests that boot the local AppSync server and fire GraphQL queries against it via `scripts/run-offline-tests.js`. The test suite is defined in `scripts/test-suites/example-suite.json` and runs against `example/schema.graphql` + `example/mock-data.json`.

## Architecture

### Build system

TypeScript is compiled exclusively via **esbuild** (not `tsc`). Running `tsc` only performs type checking (`--noEmit`). The single entry point is `src/extension/extension.ts`, bundled into `out/extension/extension.js`. `vscode` and `fsevents` are externalized.

### Layer separation

```
src/core/       ← pure logic, zero vscode imports
src/extension/  ← VS Code API layer (commands, webviews, activation)
src/shared/     ← types.ts (all shared interfaces) and logger/config
```

All business logic lives in `src/core/`. Commands in `src/extension/commands/` are thin wrappers that call core functions and present results via `vscode.window` APIs or webviews. Never import `vscode` from `src/core/`.

### Three subsystems

**1. AppSync Offline Studio** (`src/core/appsync/`)

- `AppSyncOfflineServer` — Express server on port 4000, exposes `/graphql` and `/logs` (polling endpoint for the webview).
- `SchemaLoader` — merges `.graphql` files from a directory or a single file; watches for changes and emits reload events.
- `resolverEngine.ts` — runs APPSYNC_JS resolvers in a Node.js `vm` sandbox with a 3-second timeout. Exposes `request(ctx)` / `response(ctx)` function shapes. DynamoDB-style operations (`GetItem`, `PutItem`, `Scan`, etc.) are dispatched to `inMemoryStore`.
- `inMemoryDataSource.ts` — single global in-memory store; table names resolved by fuzzy match (strips `Table` suffix, case-insensitive).
- `contextSimulator.ts` — builds `AppSyncContext` and provides the `$util` mock.
- `AppSyncPanel` — singleton webview (`AppSyncPanel.currentPanel`); all communication via `postMessage`/`onDidReceiveMessage` to satisfy VS Code CSP.

**2. CDK Diff Explainer** (`src/core/cdkDiff/`)

- `cdkDiffRunner.ts` — shells out to `cdk diff` and captures stdout.
- `cdkDiffParser.ts` — parses the raw diff text line-by-line into `DiffChange[]`.
- `riskAnalyzer.ts` — applies ~62 deterministic rules (most-specific-first) to assign a `RiskLevel` and `explanation` to each change.
- `markdownReport.ts` — formats findings into Markdown.
- `CdkDiffPanel` — webview that renders the report and supports Markdown export.

**3. Stack Intent Validator** (`src/core/cdkIntent/stackIntentValidator.ts`)

Parses `cdk.out/*.template.json` files statically — **no AWS calls, no CDK runtime**. Checks:
- AppSync resolvers reference existing data sources (by `Ref` or `Fn::GetAtt`).
- `AWS_LAMBDA` data sources point to Lambda functions in the same template.
- `AMAZON_DYNAMODB` data sources point to DynamoDB tables in the same template.
- Lambda functions have an IAM role that exists in the template.
- IAM roles/policies don't use wildcard actions or resources.
- AppSync data source `ServiceRoleArn` resolves to a real role.

Findings are deduplicated and sorted by severity (high → medium → low). Results are presented as a Markdown document opened in a new editor tab.

### AppSync discovery

All schema/resolver/mock-data discovery is centralized in `src/extension/commands/appsyncDiscovery.ts`. Command files consume its output — they do not duplicate file scanning. Lookup order: explicit settings (`awsToolkit.appsync.schemaPath`, etc.) → fallback scan → quick-pick when multiple candidates are found.

### Adding a new command

1. Implement core logic in `src/core/` (no vscode dependency).
2. Create a command handler in `src/extension/commands/`.
3. Register it in `src/extension/extension.ts` under `activate()`.
4. Add the command to `contributes.commands` and `activationEvents` in `package.json`.
5. Never change existing command IDs — doing so breaks installed extension bindings.

### Webview pattern

All webviews are CSP-safe: no inline event handlers (`onclick`, `oninput`, etc.) in HTML, all scripts served from `media/` via `webview.asWebviewUri`, all extension↔webview communication through `postMessage`/`onDidReceiveMessage`. The AppSync panel uses a `webviewReady` flag — messages queued before the webview signals ready are flushed on the `ready` message. Panel state is persisted per workspace key using `context.workspaceState`.

## Release

Requires `VSCE_PAT` set in the environment or in a `.env` file at the repo root (never commit `.env`).

```bash
# Patch release (0.1.x → 0.1.x+1)
npm run release:patch

# Minor release (0.x.0 → 0.x+1.0)
npm run release:minor
```

The release script (`scripts/release.js`) does in order:

1. Loads `VSCE_PAT` from `.env` if not already in environment.
2. Runs `npm run prepublish:check` (= `compile` + `test:offline:example`) — must pass.
3. Bumps version with `npm version <bump> --no-git-tag-version`.
4. Runs `vsce publish` via `npm run publish:vsce`.
5. On any failure after the version bump, **automatically reverts `package.json`** to the previous version.

After a successful publish, verify propagation:

```bash
npx vsce show ec-dev-studio.aws-serverless-offline-toolkit
```

Marketplace propagation can take 10–60 minutes. If publish succeeded but the extension is not discoverable, check Publisher Hub — do not re-publish.

Never run plain `vsce publish` without a version bump. Always go through `release:patch` or `release:minor`.

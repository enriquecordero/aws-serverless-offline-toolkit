# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Trace ID per GraphQL request** — every request processed by the AppSync Offline Studio now gets a unique `traceId`. All resolver log entries (request, response, error) carry this ID so the log panel can group them into collapsible trace trees.
- **Per-request identity override** — send an `x-appsync-identity` HTTP header to change the mock identity for a single query without restarting the server or changing extension settings. The AppSync Studio passes this header automatically from its identity dropdown.
- **Identity dropdown in the query editor** — select `apiKey`, `cognitoUser`, `iam`, `admin`, or `guest` per query run. The chosen identity is included in every log entry for easy correlation.
- **⚡ All Identities runner** — new "All Identities" button executes the current query against all five mock identities in parallel and displays a combined JSON response keyed by identity name.
- **↺ Reload Data button** — reloads `mock-data.json` into the in-memory store without restarting the AppSync server. A confirmation banner appears in the panel on success.
- **Resolver Runner tab** — new tab in the AppSync Studio with a `Type.Field` picker, identity selector, and argument editor. Runs the selected resolver and displays the full trace log (phases, duration, I/O) alongside the response.
- **Trace-grouped log view** — the Logs panel now groups entries by `traceId`, showing collapsible trace trees with identity badge and per-step phase/duration/I/O detail.
- **Mock Data Seeder (Phase 12)** — new `mockDataSeeder.ts` module with three capabilities:
  - `seedFromJsonFile` — clears and re-seeds the in-memory store from a JSON file.
  - `generateSkeletonsFromCdk` — parses `cdk.out` CloudFormation templates and generates skeleton `mock-data.json` fixtures from DynamoDB table key schemas.
  - `watchMockDataFile` — watches `mock-data.json` for changes and hot-reloads data with a 300 ms debounce.
- **New command: `AWS: Reload Mock Data`** — resolves `mock-data.json` (from `awsToolkit.appsync.mockDataPath` or workspace root), seeds the store, and notifies the panel.
- **New command: `AWS: Generate Mock Data from CDK`** — generates skeleton fixtures from `cdk.out` DynamoDB table definitions, writes `mock-data.json`, opens it in the editor, and seeds immediately.
- **`awsToolkit.appsync.mockDataPath` setting** — optional path (absolute or relative to workspace root) to a custom mock data file.
- **Resolver Runner — direct execution (Phase 1)** — Resolver Runner tab now calls a dedicated `/direct-resolve` endpoint, passing arguments as plain JSON. No GraphQL query string needs to be constructed, so all argument types (ID, string, number, nested object) work correctly.
- **Resolver trace display** — each run shows request/response/error phases with duration and I/O preview. Actionable diagnostics appear for common failures: null data-source result, undefined variable, syntax error, VTL error.
- **Resolver run history (Phase 1)** — the last 20 resolver runs are persisted in workspace state and shown in a collapsible "Recent Runs" section. Click any entry to replay (restores Type.Field, identity, and arguments).
- **VTL Resolver Debugging (Phase 4)** — resolver templates written in Velocity Template Language (`.vtl` files) are now evaluated locally:
  - Variable interpolation: `$ctx.args`, `$ctx.identity`, `${...}` braced form, user-defined `#set` vars.
  - DynamoDB helpers: `$util.dynamodb.toDynamoDBJson`, `toMapValuesJson`, `toStringJson`, `toListJson`, `toStringSet`.
  - Utilities: `$util.toJson`, `$util.autoId`, `$util.defaultIfNull`, `$util.error` (raises `VtlError`).
  - Control flow: `#set`, `#if`/`#elseif`/`#else`/`#end` (nested), `#foreach` with `$foreach.hasNext`.
  - `schemaLoader` auto-detects `.vtl` files and marks resolvers with `resolverType: 'VTL'`.
  - `VtlError` type is surfaced in the resolver trace with its AppSync error type annotation.
- **Lambda Debugging Integration (Phase 2)** — invoke and debug Lambda data source handlers directly from the Resolver Runner tab:
  - New **🐛 Debug Lambda** button next to "Run Resolver": spawns the handler with `--inspect-brk` and attaches VS Code's Node.js debugger automatically via `vscode.debug.startDebugging`.
  - `lambdaRunner.ts` — new module that writes a runner script to a temp file, spawns `node [--inspect-brk=port] runner.js eventFile handlerPath exportName`, and resolves the result from stdout. TypeScript handlers are supported via `ts-node` auto-registration.
  - AppSync event shape (`arguments`, `identity`, `source`, `request`, `info`, `stash`, `prev`) is constructed from the context simulator and passed as the Lambda event.
  - Lambda data sources are now resolved end-to-end in `resolverEngine` when a handler spec is registered: request template → Lambda invocation → response template.
  - New settings: `awsToolkit.appsync.lambdaHandlers` (map of data source name → `"path/to/handler.ts#exportName"`) and `awsToolkit.appsync.lambdaDebugPort` (default `9229`).
  - Debug session banner appears in the panel while the debugger is attached; result or error banner appears on completion.
- **Pipeline Resolver support** — resolvers declared as `TypeName.fieldName.pipeline.json` are now executed as AppSync pipeline resolvers:
  - `before` template (optional `.before.js/.vtl`) runs first and can populate `ctx.stash`.
  - Each function in the `functions` array runs in order: request template → data source → response template.
  - `ctx.stash` is shared across all steps; `ctx.prev.result` carries each function's output to the next.
  - Any step failure short-circuits the pipeline and returns immediately with the error and step label.
  - JS and VTL functions are supported independently per function.
  - Lambda data sources work per function using the same `lambdaHandlers` config.
  - `after` template (optional `.after.js/.vtl`) runs last with `ctx.prev.result` from the final function.
  - Resolver trace shows per-step labels: `[before]`, `FunctionName`, `FunctionName:lambda`, `[after]`.
  - Log panel shows an amber step badge for each pipeline log entry.
  - Function files live in `resolvers/functions/<FunctionName>.request.js` (or `.vtl`).
- **Timeout Mismatch Detector (Phase 15)** — integrated into the CDK Preflight Report. Detects API Gateway integration timeout shorter than Lambda timeout (504 risk), AppSync Lambda data source exceeding the 30s resolver limit, SQS visibility timeout shorter than Lambda timeout (duplicate processing risk), and Lambda functions configured at the 900s maximum.

## [0.1.8] - 2026-04-30

### Added

- **CDK Stack Preflight webview** — `AWS: Validate Stack Intent (cdk.out)` now opens a dedicated panel instead of a plain Markdown tab, with findings grouped by severity and an Export Markdown button.
- **Confidence score** — preflight report displays a 0–100 readiness score with label (*Ready to Deploy*, *Minor Issues*, *Review Needed*, *Significant Issues*, *Not Ready*) derived from finding severity counts.
- **Env Var Preflight** — new command `AWS: Validate Environment Variables` scans every Lambda function in `cdk.out` and classifies each environment variable as: static (resolved), SSM/Secrets Manager/cross-stack ref (needs cloud), CDK intrinsic token, or empty string.
- `.env.local` support — env var preflight reads workspace-root `.env.local` to resolve cloud-backed variables offline, and surfaces a ready-to-paste snippet for any unresolved SSM or Secrets Manager references.
- **CLAUDE.md** — added codebase guidance file for Claude Code.

### Changed

- Stack Intent validation result is now shown in a webview panel (`StackIntentPanel`) with color-coded severity sections, replacing the previous plain Markdown document.
- Preflight log output now includes the confidence score and label alongside finding counts.

## [0.1.7] - 2026-04-27

### Added

- New command: `AWS: Validate Stack Intent (cdk.out)` for pre-deploy wiring checks from synthesized templates.
- New command: `AWS: Synth and Validate Stack Intent` to run `cdk synth` and open the validation report in one step.
- Intent checks for AppSync resolver/data source references, Lambda role presence, DynamoDB table detection, AppSync Lambda/Dynamo target wiring, AppSync data source service-role wiring, and IAM wildcard policy patterns (role inline policies and IAM::Policy resources).
- Validation warning when no synthesized templates are found in `cdk.out` (suggests running `cdk synth`).

### Changed

- AppSync Offline Studio logs panel now supports phase filtering (`all`, `request`, `response`, `error`) and resolver search.
- `Validate Stack Intent (cdk.out)` now offers guided actions when templates are missing, including launching `cdk synth` from VS Code.

## [0.1.0] - 2026-04-27

### Added

- AppSync Offline Studio with segmented schema support.
- Fallback resolver loading from resolver-definitions.ts.
- Hot reload notifications to the webview schema panel.
- Query editor UX improvements (history, variables tab, shortcuts, schema search).
- Offline test runner and LUMA smoke suite.
- CDK Diff Explainer integration.

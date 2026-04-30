# AWS Serverless Offline Toolkit Roadmap

## Vision

Build a fast pre-deploy validation toolkit for AWS CDK projects that validates intended behavior from synthesized artifacts (`cdk.out`) and local code, reducing dependence on long pipeline cycles.

## Product Direction

- Prioritize fast feedback before deployment by validating the synthesized stack and resolver/lambda logic.
- Keep discovery and execution generic for different repository layouts.
- Align all major workflows to CDK-based projects.
- Avoid full cloud emulation platforms as a core dependency.

## Non-Goals

- Do not build a full LocalStack replacement.
- Do not emulate every AWS service behavior 1:1.
- Do not require cloud deployment to validate core wiring and contracts.

## Validation Strategy (CDK-first)

- Use `cdk.out` CloudFormation templates as the source of truth for infrastructure intent.
- Correlate synthesized resources with local source code (resolvers, lambda handlers, config).
- Run preflight checks that answer: "Will this stack behave as intended?" before pipeline execution.

## Status Snapshot

- ✅ Completed: `AWS: Validate Stack Intent (cdk.out)` command is implemented and published.
- ✅ Completed: `AWS: Synth and Validate Stack Intent` command is implemented and published.
- ✅ Completed: Preflight checks for AppSync resolver/data source wiring and Lambda/Dynamo target references.
- ✅ Completed: Initial IAM checks for wildcard action/resource patterns.
- ✅ Completed: Guided flow when `cdk.out` is missing (prompt to run `cdk synth`).
- ✅ Completed: Logs panel filters (phase + resolver search) in AppSync Offline Studio.
- ✅ Completed: CDK Preflight webview with confidence score (0–100) and readiness label.
- ✅ Completed: Environment Variable Preflight — classifies Lambda env vars from `cdk.out`, supports `.env.local` overrides.
- ✅ Completed: Mock Data Seeder (Phase 12) — `AWS: Reload Mock Data` and `AWS: Generate Mock Data from CDK` commands, hot-reload via `fs.watch`, CDK skeleton generation.
- ✅ Completed: AppSync Studio identity dropdown, multi-identity runner, Resolver Runner tab, and trace-grouped log view.
- ✅ Completed: Phase 1 — `/direct-resolve` endpoint, resolver run history (workspace state), actionable error diagnostics.
- ✅ Completed: Phase 4 — VTL resolver evaluator (`$ctx`, `$util.dynamodb.*`, `#if`, `#foreach`, `VtlError`).
- ✅ Completed: Phase 2 — Lambda debugging integration: `lambdaRunner.ts` local invocation via `child_process`, `--inspect-brk` debug mode, VS Code attach session from "Debug Lambda" button, AppSync event shape construction, `awsToolkit.appsync.lambdaHandlers` / `lambdaDebugPort` settings.

## Phase 1 - Resolver Debugging Foundation

**Status:** ✅ Complete

### Goal

Deliver practical debugging for AppSync resolvers with clear execution traces.

### Scope

- APPSYNC_JS resolver debugging first.
- Pipeline execution tracing (functions, stash, prev/result transitions).
- Context inspection for key objects:
  - arguments
  - identity
  - source
  - stash
  - request and response payloads
- Breakpoint-like checkpoints per resolver step.

### Outputs

- Resolver trace timeline view.
- Command to execute resolver with selected mock identity and variables.
- Persisted run history in workspace state.

### Exit Criteria

- A developer can run and inspect a full APPSYNC_JS resolver flow locally.
- Common failures are shown with actionable diagnostics.

## Phase 2 - Lambda Debugging Integration

**Status:** ✅ Complete

### Goal

Enable end-to-end local debugging when resolvers invoke Lambda data sources.

### Scope

- Simulate AppSync event shape for Lambda invocations.
- Launch local Lambda runtime with Node inspector support.
- Support stepping from resolver execution into Lambda handler.

### Outputs

- ✅ "🐛 Debug Lambda" button in Resolver Runner tab — spawns handler with `--inspect-brk` and attaches VS Code debugger.
- ✅ `lambdaRunner.ts` — local Lambda invocation via `child_process.spawn`; runner script written to temp file; ts-node auto-registered for `.ts` handlers.
- ✅ Unified trace: request template → Lambda invocation → response template, all visible in the resolver trace panel.
- ✅ AppSync event shape (`arguments`, `identity`, `source`, `request`, `info`, `stash`, `prev`) constructed from context simulator.
- ✅ `awsToolkit.appsync.lambdaHandlers` setting: map of data source name → handler spec (`"path/to/handler.ts#exportName"`).
- ✅ `awsToolkit.appsync.lambdaDebugPort` setting (default `9229`).

### Exit Criteria

- ✅ A developer can set breakpoints in Lambda code and inspect handler execution from an AppSync request.

## Phase 3 - DynamoDB Intent Validation (CDK-oriented)

### Goal

Validate DynamoDB assumptions from synthesized templates and resolver/lambda usage without full service emulation.

### Scope

- Parse table/index definitions from `cdk.out`.
- Validate that resolver/lambda operations match table key schema and expected access patterns.
- Validate presence and wiring of required GSIs.
- Validate common expression assumptions (key usage, condition/update/query intent).
- Optional lightweight in-memory execution for happy-path data shape checks.

### Outputs

- Dynamo validation report with actionable findings.
- Access-pattern checker (PK/SK/GSI compatibility).
- Optional fixture-based quick checks for data contracts.

### Exit Criteria

- Developers can detect key schema/index mismatches before pipeline runs.
- Most Dynamo-related misconfigurations are caught from `cdk.out` + code analysis.

## Phase 4 - VTL Resolver Debugging

**Status:** ✅ Complete

### Goal

Add transparent debugging support for VTL request/response templates.

### Scope

- Render and inspect VTL request mapping results.
- Evaluate response mapping and error branches.
- Show step trace for pipeline and unit resolver templates.

### Outputs

- VTL trace report (input, template output, downstream result).
- Diff view between expected and actual mapping output.

### Exit Criteria

- A developer can diagnose VTL mapping issues without deploying to AWS.

## Phase 5 - CDK Preflight Report

**Status:** ✅ Complete

### Goal

Produce a full stack readiness report from synthesized `cdk.out` artifacts before any pipeline execution.

### Scope

- Parse all resource types from the CloudFormation template in `cdk.out`.
- Validate AppSync, DynamoDB, Lambda, IAM, and Cognito wiring in a single pass.
- Detect missing environment variables referenced in Lambda definitions.
- Detect resolver/data source mismatches between the schema and synthesized AppSync config.
- Surface actionable findings grouped by severity.

### Outputs

- ✅ `AWS: Validate Stack Intent (cdk.out)` command.
- ✅ `AWS: Synth and Validate Stack Intent` command.
- ✅ Markdown preflight report with findings grouped by severity.
- ✅ Dedicated preflight webview with per-resource findings.
- ✅ Confidence score and full stack readiness summary.

### Exit Criteria

- ✅ A developer can run one command and get a confidence score for the stack before pushing to CI.
- ✅ Critical wiring issues are covered locally (AppSync/Lambda/Dynamo/IAM wildcard checks).
- ✅ Missing env vars covered via Phase 13.

## Phase 6 - Lambda Local Runner

### Goal

Execute any Lambda handler locally with a mock event, without Docker or cloud deployment.

### Scope

- Auto-discover Lambda handlers from `cdk.out` (function definitions, code paths, environment variables).
- Provide a library of standard event templates: API Gateway, SQS, SNS, EventBridge, DynamoDB Streams, S3, Cognito triggers.
- Inject environment variables from the synthesized template or a local `.env` override.
- Execute handlers via `ts-node` or compiled JS with no external runtime dependency.
- Show output, logs, timing, and uncaught errors in a dedicated panel.
- Integrate with Phase 2 so AppSync resolver → Lambda flows use this runner as the execution backend.

### Outputs

- `AWS: Run Lambda Locally` command with handler picker and event template selector.
- Event template editor with schema hints per trigger type.
- Execution result panel with stdout, return value, duration, and error trace.

### Exit Criteria

- A developer can run any Lambda handler in the workspace with a realistic mock event in under 5 seconds.
- Environment variables are resolved from CDK definitions without manual configuration.

## Phase 7 - IAM Permission Preflight

### Goal

Detect IAM permission mismatches between what a Lambda or resolver does in code and what its role actually allows, using only synthesized templates and static analysis.

### Scope

- Parse IAM role/policy definitions from `cdk.out`.
- Correlate each Lambda handler with its attached role and its effective permissions.
- Scan handler source code for AWS SDK calls (`dynamodb.putItem`, `s3.getObject`, etc.) and map them to required IAM actions.
- Flag cases where a required action is absent from the role policy.
- Detect overly broad wildcards (`*` on resource or action) and surface them as warnings.

### Outputs

- `AWS: Validate IAM Permissions` command.
- Per-Lambda permission report: required actions vs. granted actions.
- Warning list for wildcard policies flagged in the CDK diff risk analyzer.

### Exit Criteria

- A developer can detect "Lambda missing permission" bugs before deployment.
- The most common serverless IAM mistake (forgot to grant an action when adding a new SDK call) is caught automatically.

## Phase 8 - EventBridge Rule Tester

### Goal

Validate locally whether a given event matches an EventBridge rule pattern, without deploying or sending real events.

### Scope

- Load rule patterns from CDK definitions or from a pasted JSON pattern.
- Accept a sample event JSON as input.
- Evaluate the pattern match locally using the EventBridge matching specification (prefix, suffix, anything-but, numeric ranges, exists).
- Show which fields matched, which did not, and why.
- Support batch testing: run a set of events against a rule and show a pass/fail table.

### Outputs

- `AWS: Test EventBridge Rule` command with pattern editor and event input.
- Match result view: MATCH / NO MATCH with per-field breakdown.
- Batch test mode from a JSON array of sample events.

### Exit Criteria

- A developer can verify an EventBridge rule pattern locally before deploying event-driven infrastructure.
- No AWS credentials or network access required.

## Phase 9 - CDK Cost Estimator

### Goal

Estimate the monthly infrastructure cost of a stack from its synthesized template before deployment.

### Scope

- Parse resource definitions from `cdk.out` CloudFormation templates.
- Apply static pricing tables for the most common serverless resources: Lambda (invocations, duration, memory), DynamoDB (on-demand vs. provisioned, storage), AppSync (query volume), Cognito (MAU), S3 (storage, requests), API Gateway.
- Allow configuration of estimated usage parameters (invocations/month, average payload size, etc.).
- Detect common misconfigurations that inflate cost (DynamoDB provisioned when on-demand was intended, Lambda memory set too high).

### Outputs

- `AWS: Estimate Stack Cost` command with region and usage parameter inputs.
- Cost breakdown panel by resource type and by stack.
- Inline warning when a resource configuration appears inconsistent with typical usage (e.g., 3 GB Lambda memory for a lightweight handler).

### Exit Criteria

- A developer can get a ballpark monthly cost estimate without leaving VS Code.
- Cost-inflating misconfigurations are surfaced before the stack is deployed.

## Phase 10 - Step Functions Local Debugger

### Goal

Execute AWS Step Functions state machines locally, step by step, with mocked Lambda outputs and no cloud dependency.

### Scope

- Load state machine definitions from `.asl.json` or `.asl.yaml` files in the workspace.
- Execute states sequentially: Task, Choice, Wait, Parallel, Map, Pass, Succeed, Fail.
- Invoke Lambda Task states using the Lambda Local Runner from Phase 6.
- Allow mock responses for Task states when no local handler is available.
- Pause at each state transition and show: current input, state output, effective path taken.
- Detect infinite loops, unreachable states, and missing Catch/Retry handlers.

### Outputs

- `AWS: Debug Step Function` command with state machine file picker.
- Step-by-step execution view with state graph highlight and I/O inspector.
- Report of unreachable states and missing error handlers.

### Exit Criteria

- A developer can validate a state machine's execution path locally for both happy path and error branches.
- Unreachable states and unhandled error conditions are detected without deploying.

## Phase 11 - CloudWatch Logs Live Tail

### Goal

Tail Lambda log groups directly from VS Code after deployment, using the CDK stack as the source of known log group names.

### Scope

- Auto-discover Lambda log groups (`/aws/lambda/<function-name>`) from the deployed stack or from `cdk.out` resource names.
- Open a live tail panel using the CloudWatch Logs API (FilterLogEvents / StartLiveTail).
- Support filtering by log level, timestamp range, and correlation ID / request ID.
- Highlight errors, warnings, and structured JSON log fields.
- Integrate with the correlation ID pattern already used in the AppSync Offline Studio.

### Outputs

- `AWS: Tail Lambda Logs` command with function picker populated from CDK stack output.
- Log panel with structured rendering, search, and filter.
- Link from a resolver trace (Phase 1) to the corresponding CloudWatch log entry when deployed.

### Exit Criteria

- A developer can go from local resolver debugging to deployed log inspection without opening the AWS console.
- Log discovery is automatic from the CDK stack — no manual log group configuration required.

## Phase 12 - Mock Data Seeder

**Status:** ✅ Complete

### Goal

Populate the AppSync Offline Studio's in-memory store from CDK-derived table definitions and project seed scripts, replacing manual `mock-data.json` maintenance.

### Scope

- Parse DynamoDB table definitions from `cdk.out` (key schema, attribute types, GSI definitions).
- Detect and execute project-level seed scripts (e.g., `scripts/seed-data.sh`, `scripts/seed-data.ts`) against the local in-memory store.
- Generate skeleton mock data automatically from table key schema when no seed script exists.
- Add a `Reload Mock Data` command that refreshes in-memory data from disk without restarting the server.
- Preserve current `mock-data.json` support as a fallback.

### Outputs

- `AWS: Reload Mock Data` command.
- `AWS: Seed from CDK Definitions` command that generates starter fixtures from table schemas.
- Hot reload of seed data when the mock data file changes on disk.

### Exit Criteria

- A developer can start the AppSync Offline Studio with realistic data without manually writing `mock-data.json`.
- Seed data refreshes without a server restart.

## Phase 13 - Environment Variable Preflight

**Status:** ✅ Complete

### Goal

Validate that every environment variable declared in Lambda definitions within `cdk.out` has a resolvable value before deployment, catching missing configuration before it causes a runtime failure.

### Scope

- Parse all Lambda function definitions from `cdk.out` and extract their declared environment variables.
- Classify each variable by source: static string, SSM Parameter Store reference (`resolve:ssm:/...`), Secrets Manager reference, or cross-stack reference.
- For SSM and Secrets Manager references, verify the parameter/secret exists in the target account and region using the configured AWS credentials.
- For cross-stack references, confirm the exporting stack has been deployed and the export value is available.
- Flag any variable whose value is `undefined`, empty, or points to a non-existent parameter.
- Support a local override file (e.g., `.env.local`) that maps variable names to values for offline validation without AWS credentials.

### Outputs

- ✅ `AWS: Validate Environment Variables` command.
- ✅ Report listing each Lambda, its declared variables, their resolution status (resolved / missing / unresolvable), and the source type.
- ✅ `.env.local` override support with per-Lambda snippet suggestions.

### Exit Criteria

- ✅ A developer can confirm all Lambda environment variables are resolvable before triggering a deployment.
- ✅ SSM, Secrets Manager, cross-stack, empty, and CDK intrinsic variables are surfaced with the exact variable name and Lambda function affected.

## Phase 14 - Lambda Bundle Size Analyzer

### Goal

Detect oversized Lambda deployment packages and heavy dependencies before the deploy fails or the function exceeds AWS limits.

### Scope

- Discover Lambda handler source files and their associated `bundling` configuration from `cdk.out` and CDK source.
- Build or inspect the output bundle (using the compiled asset in `cdk.out/.cache` when available, or triggering a local bundle via esbuild/webpack if configured).
- Measure the uncompressed and compressed bundle size per function.
- Break down size by dependency (top N largest packages contributing to the bundle).
- Warn when the bundle approaches or exceeds AWS Lambda limits: 50 MB zipped for direct upload, 250 MB unzipped, 512 MB for container images.
- Suggest optimizations: tree-shaking opportunities, externalize dependencies available in the runtime, split into Lambda Layers.
- Detect when the full AWS SDK v2 is bundled instead of the modular v3 clients.

### Outputs

- `AWS: Analyze Lambda Bundle Sizes` command.
- Bundle report panel: size per function, dependency breakdown treemap, limit warnings.
- Inline CodeLens annotation on CDK Lambda definitions showing current bundle size.

### Exit Criteria

- A developer can identify which Lambda is too large and which dependency is responsible before the deploy fails.
- Oversized bundles and full-SDK inclusions are flagged automatically on every `cdk synth`.

## Phase 15 - Timeout Mismatch Detector

### Goal

Detect configuration mismatches between service timeout values that cause silent failures or incorrect error responses, without requiring a deployed environment.

### Scope

- Parse timeout configurations from `cdk.out` for Lambda functions, API Gateway integrations, AppSync resolvers, and SQS visibility timeouts.
- Detect the following mismatch patterns:
  - API Gateway integration timeout shorter than its backing Lambda timeout (Lambda completes but API GW already returned 504).
  - AppSync resolver timeout shorter than its Lambda data source timeout.
  - SQS visibility timeout shorter than the Lambda function timeout (message becomes visible again before the handler finishes, causing duplicate processing).
  - Lambda timeout shorter than the average DynamoDB or external HTTP call duration reported in X-Ray traces, when available.
  - Step Functions task timeout shorter than the Lambda it invokes.
- Classify each mismatch by severity: silent data corruption risk (SQS/Lambda), user-visible error (API GW/Lambda), or potential duplicate execution.

### Outputs

- `AWS: Check Timeout Configuration` command, also run as part of the CDK Preflight Report (Phase 5).
- Timeout mismatch report with affected resource pairs, current values, and recommended alignment.
- Inline warning in the CDK diff report when a timeout change introduces a new mismatch.

### Exit Criteria

- A developer can detect all timeout mismatches between connected services from `cdk.out` alone.
- The SQS visibility timeout / Lambda timeout mismatch — the most common source of duplicate message processing — is always flagged.

## Phase 16 - AI Resolver Error Diagnosis

### Prerequisite

Phase 1 (Resolver Debugging Foundation).

### Goal

When a resolver fails in the AppSync Offline Studio, generate a human-readable root-cause explanation and a concrete fix suggestion using an LLM, eliminating the need to manually parse raw error traces.

### Scope

- Capture the full error context on resolver failure: error message, stack trace, resolver source code, request/response payloads, and the `ctx` snapshot.
- Send the captured context to a configurable LLM (Claude via Amazon Bedrock, or OpenAI-compatible endpoint).
- Display a structured diagnosis panel alongside the existing resolver log:
  - Root cause summary (one sentence).
  - Step-by-step explanation of what went wrong.
  - Inline diff suggestion showing the fix in the resolver code.
- Support opt-out: developers can disable AI diagnosis and use raw logs only.
- Respect the Content Security Policy of the VS Code webview — all LLM calls go through the extension host, never from the webview directly.

### Outputs

- AI diagnosis panel in the AppSync Offline Studio, triggered automatically on resolver failure.
- `AWS: Explain Last Resolver Error` command for on-demand re-analysis of the last failure.
- Configurable LLM provider and endpoint in extension settings.

### Exit Criteria

- A developer can read a plain-English explanation of why their resolver failed without reading raw stack traces.
- The suggested fix is accurate for the most common failure classes: key schema mismatches, missing `$util` calls, wrong DynamoDB operation type, and null-access in response mapping.

---

## Phase 17 - AI-Enhanced CDK Risk Analysis

### Prerequisite

Phase 5 (CDK Preflight Report).

### Goal

Replace the hardcoded 62-rule risk classifier in the CDK Diff Explainer with an LLM-powered contextual analyzer that understands deployment intent, not just change type.

### Scope

- After the existing rule-based pass, send the full diff summary and stack context to an LLM.
- Ask the LLM to:
  - Re-evaluate risk scores with contextual reasoning (e.g., "DynamoDB replacement is flagged CRITICAL, but resource names suggest a dev→prod migration, not accidental removal").
  - Generate a narrative summary of the diff: what is changing, why it is likely changing, and what could go wrong.
  - Suggest pre-deployment checkpoints specific to the detected changes.
- Present rule-based findings and AI findings side by side so developers can compare.
- Do not replace deterministic rules — AI layer is additive and clearly labeled as such.

### Outputs

- AI narrative section in the CDK Diff report webview.
- Per-change contextual commentary with LLM reasoning visible.
- `AWS: Re-analyze Diff with AI` command for on-demand re-evaluation after the developer edits the stack.

### Exit Criteria

- The AI layer correctly identifies at least one false positive from the rule-based classifier in a real project diff.
- Developers receive a pre-deployment checklist tailored to the specific changes in the diff, not a generic list.

---

## Phase 18 - AI IAM Policy Generator

### Prerequisite

Phase 7 (IAM Permission Preflight).

### Goal

When Phase 7 detects a missing IAM permission, automatically generate a least-privilege policy statement that grants exactly what the Lambda handler needs, ready to paste into the CDK stack.

### Scope

- Trigger after Phase 7 identifies a `LAMBDA_MISSING_ROLE` or missing-action finding.
- For each affected Lambda, send its handler source code to an LLM with the prompt: "Extract all AWS SDK calls and map them to the minimum required IAM actions and resource ARN patterns."
- Generate a CDK `PolicyStatement` snippet (TypeScript) that the developer can copy directly into their stack.
- Include resource-level scoping where possible (e.g., `arn:aws:dynamodb:*:*:table/MyTable` instead of `*`).
- Flag when the LLM cannot infer the resource ARN (dynamic names, cross-account) and suggest a placeholder with a comment.

### Outputs

- AI-generated policy snippets displayed per Lambda in the IAM preflight report.
- `AWS: Generate IAM Policy for Lambda` command with handler file picker.
- Copy-to-clipboard button for each generated `PolicyStatement`.

### Exit Criteria

- A developer can go from "missing permission detected" to a pasteable CDK policy fix in one command.
- Generated policies cover the most common SDK patterns: DynamoDB CRUD, S3 read/write, SSM parameter access, Cognito user pool operations.

---

## Phase 19 - AI Incident Root-Cause Analysis

### Prerequisite

Phase 11 (CloudWatch Logs Live Tail).

### Goal

When a deployed Lambda or resolver fails in production, correlate the CloudWatch log stream with the local resolver trace history and generate a plain-English incident narrative explaining what happened and why.

### Scope

- After Phase 11 surfaces a spike of errors in the CloudWatch log tail, offer an "Analyze with AI" action.
- Collect: error log lines within the incident window, the corresponding resolver trace (if available from Phase 1), recent CDK diff history, and any environment variable changes detected by Phase 13.
- Send the correlated context to an LLM to produce:
  - A one-paragraph incident summary (what failed, when, how many requests were affected).
  - A ranked list of probable root causes with confidence levels.
  - A recommended next step for each root cause.
- Support exporting the incident report as Markdown for postmortem documentation.

### Outputs

- `AWS: Analyze Incident` command triggered from the CloudWatch Logs panel.
- Incident narrative panel with summary, root causes, and recommendations.
- Markdown export for postmortem documentation.

### Exit Criteria

- A developer can generate an incident narrative from raw log output without manually correlating timestamps across services.
- The most common incident patterns are correctly identified: IAM permission removed after deployment, missing environment variable, DynamoDB throttling, cold-start timeout.

---

## Phase 20 - AI Test Case Generator

### Prerequisite

Phase 1 (Resolver Debugging Foundation) and Phase 12 (Mock Data Seeder).

### Goal

Parse the GraphQL schema and resolver source code to automatically generate a representative test suite covering happy paths, edge cases, and error branches — eliminating the need to write `mock-data.json` fixtures and test queries by hand.

### Scope

- For each resolver in the workspace, send its source code and the relevant GraphQL type definitions to an LLM.
- Ask the LLM to generate:
  - Happy-path queries with realistic variable values.
  - Edge cases: null optional fields, empty lists, maximum-length strings, boundary numeric values.
  - Error branches: missing required fields, invalid types, permission-denied identity contexts.
- Output test cases as a structured JSON file compatible with the AppSync Offline Studio's existing query runner.
- Integrate with Phase 12 so the seeder can auto-populate the in-memory store with the fixtures the generated tests require.
- Show branch coverage estimate: "This resolver has 4 conditional branches. Generated tests cover 3."

### Outputs

- `AWS: Generate Test Cases for Resolver` command with resolver picker.
- Generated test file (`.appsync-tests.json`) per resolver, importable into the AppSync Offline Studio.
- Branch coverage summary shown in the resolver trace panel.

### Exit Criteria

- A developer can generate a runnable test suite for a resolver they have never tested before in under 30 seconds.
- Generated tests cover at least the happy path and one error branch for every resolver in the example project.

---

## Cross-cutting Workstreams

### CDK Discovery and Mapping

- Auto-detect AppSync APIs, resolvers, data sources, and Lambda references from CDK outputs and conventions.
- Keep manual override settings for non-standard layouts.
- Validate IAM/resource wiring from synthesized templates and fail early on common permission gaps.

### Developer Experience

- Keep command names and workflows consistent.
- Use actionable error messages with next-step guidance.
- Preserve CSP-safe webview architecture (no inline handlers).

### Quality and Safety

- Maintain prepublish checks before release.
- Add smoke tests for critical commands.
- Exclude secrets from package artifacts and logs.

## Milestone Sequence

1. ✅ M1: APPSYNC_JS trace and checkpoint debugger.
2. ✅ M2: Resolver -> Lambda debug bridge.
3. M3: DynamoDB intent validation from `cdk.out` + code contracts.
4. ✅ M4: VTL trace and mapping diagnostics.
5. ✅ M5: CDK preflight report command for pipeline readiness.
6. M6: Lambda local runner with event templates and CDK-aware handler discovery.
7. M7: IAM permission preflight from synthesized policies and handler source analysis.
8. M8: EventBridge rule tester with local pattern evaluation and batch mode.
9. M9: CDK cost estimator from `cdk.out` with usage parameters and cost warnings.
10. M10: Step Functions local debugger with state-by-state execution and error path analysis.
11. M11: CloudWatch Logs live tail integrated with CDK stack resource names.
12. ✅ M12: Mock data seeder from CDK table definitions and project seed scripts.
13. ✅ M13: Environment variable preflight with SSM resolution and local override support.
14. M14: Lambda bundle size analyzer with dependency breakdown and limit warnings.
15. ✅ M15: Timeout mismatch detector across Lambda, API Gateway, AppSync, SQS, and Step Functions.
16. M16: AI resolver error diagnosis — plain-English root cause and inline fix suggestion on failure. (requires M1)
17. M17: AI-enhanced CDK risk analysis — contextual diff narrative and intent-aware risk scoring. (requires M5)
18. M18: AI IAM policy generator — least-privilege CDK PolicyStatement from handler source. (requires M7)
19. M19: AI incident root-cause analysis — correlated CloudWatch + trace narrative and postmortem export. (requires M11)
20. M20: AI test case generator — schema-aware happy path, edge case, and error branch test suite. (requires M1, M12)

## Near-term Backlog (Next Iterations)

- ⬜ Define resolver trace JSON schema.
- ⬜ Add command: run resolver with custom variables and identity profile.
- ✅ Add command: debug Lambda invocation from resolver context.
- ✅ Add command: validate stack intent from `cdk.out` (AppSync, DynamoDB, IAM, Lambda wiring).
- ✅ Add command: synth and validate stack intent in one flow.
- 🔄 Implement DynamoDB access-pattern validator (table keys, GSIs, operation compatibility).
- 🔄 Implement IAM preflight checks for resolver/lambda required actions.
- ✅ Add initial documentation with quickstart and troubleshooting.
- ✅ Add `Reload Mock Data` button to AppSync Offline Studio panel.
- ✅ Export CDK diff report as Markdown from the webview UI.
- ✅ Add multi-identity query runner: execute the same query across all mock identities in one command.

# AWS Serverless Offline Toolkit Roadmap

## Vision

Build a fast pre-deploy validation toolkit for AWS CDK projects that validates intended behavior from synthesized artifacts (`cdk.out`) and local code, reducing dependence on long pipeline cycles.

## Product Direction

- Prioritize fast feedback **before** deployment by validating the synthesized stack and resolver/lambda logic.
- Keep discovery and execution generic for different repository layouts.
- Align all major workflows to CDK-based projects.
- Avoid full cloud emulation platforms as a core dependency.

## Non-Goals

- Do not build a full LocalStack replacement.
- Do not emulate every AWS service behavior 1:1.
- Do not require cloud deployment to validate core wiring and contracts.
- Do not build features that require live AWS credentials as a hard dependency (cloud-aware features must degrade gracefully offline).

## Validation Strategy (CDK-first)

- Use `cdk.out` CloudFormation templates as the source of truth for infrastructure intent.
- Correlate synthesized resources with local source code (resolvers, lambda handlers, config).
- Run preflight checks that answer: "Will this stack behave as intended?" before pipeline execution.

---

## What's Shipped (v0.2.0)

| Capability | Surface |
| --- | --- |
| AppSync Offline Studio (GraphQL execution, resolver runner, multi-identity, trace-grouped logs, resolver run history) | Webview + `/graphql`, `/direct-resolve`, `/logs` endpoints |
| APPSYNC_JS resolver engine with sandbox + 3s timeout | `resolverEngine.ts` |
| VTL evaluator (`$ctx`, `$util.dynamodb.*`, `#if`, `#foreach`) | `vtlEvaluator.ts` |
| Pipeline resolvers (`.pipeline.json`, before/after templates, `ctx.stash` chaining) | Resolver engine |
| In-memory DynamoDB simulator (GetItem, PutItem, Query, Scan, UpdateExpression, GSI, FilterExpression, pagination) | `inMemoryDataSource.ts` + `expressionEvaluator.ts` |
| Lambda local debugging (`--inspect-brk`, VS Code attach, AppSync event shape) | `lambdaRunner.ts` |
| CDK Diff Explainer (62 deterministic risk rules, severity classification, Markdown export) | `cdkDiff/` |
| CDK Stack Intent Preflight (AppSync/Lambda/DynamoDB/IAM wiring, confidence score 0–100) | `stackIntentValidator.ts` |
| Environment Variable Preflight (SSM, Secrets Manager, cross-stack, `.env.local` overrides) | `envVarValidator.ts` |
| Timeout Mismatch Detector (Lambda ↔ API GW / AppSync / SQS / Step Functions) | `timeoutValidator.ts` |
| Mock Data Seeder (CDK skeleton generation, hot reload) | `mockDataSeeder.ts` |
| AWS Service Map (React Flow visualization from `cdk.out`) | `serviceMapParser.ts` + `serviceMapPanel.ts` |

**Implemented commands:** `startAppSyncOffline`, `detectAppSyncProject`, `detectAndStartAppSyncOffline`, `validateAppSyncSetup`, `runCdkDiffExplainer`, `validateStackIntent`, `synthAndValidateStackIntent`, `validateEnvVars`, `reloadMockData`, `seedFromCdk`, `generateServiceMap`.

---

## Roadmap Restructure (2026)

The roadmap below replaces the previous phase-numbered plan. It reflects the current state of the codebase (~6.3K LOC TS), removes items that conflict with the project's tesis ("no live cloud, pre-deploy only"), and prioritizes by **multiplier × ROI × alignment-with-vision**.

### Decisions vs. previous roadmap

| Previous Phase | Decision | Reason |
| --- | --- | --- |
| Phase 3 — DynamoDB Intent Validation | **Merged into P1 — Stack Intent v2** | ~70% already lives in `stackIntentValidator.ts` and `expressionEvaluator.ts`; standalone phase is redundant |
| Phase 9 — CDK Cost Estimator | **Cut** | Static pricing tables decay rapidly; AWS Pricing Calculator covers this; high maintenance / low ROI |
| Phase 11 — CloudWatch Live Tail | **Cut (out of scope)** | Requires live cloud credentials and is post-deploy — violates the "pre-deploy, offline-first" tesis. Belongs in a sibling extension |
| Phase 17 — AI-Enhanced CDK Risk Analysis | **Deferred (P3)** | Rule-based 62-rule analyzer is sufficient; AI layer is incremental polish, not a differentiator |
| Phase 19 — AI Incident RCA | **Cut** | Depended on the cut Phase 11 |
| Phase 20 — AI Test Case Generator | **Deferred (P3)** | High novelty cost; only valuable after IAM and Lambda Runner ship |
| Phase 16 — AI Resolver Diagnosis | **Kept (P2)** | Single highest-ROI AI feature, surfaces directly in existing AppSync Studio |
| Phase 18 — AI IAM Policy Generator | **Kept (P3, after P1 IAM)** | Only useful once IAM Preflight has produced findings to fix |

---

## P0 — Foundations (must ship before more features)

These are non-negotiable infrastructure investments. Without them, every new phase adds compound risk.

### P0.1 — Test infrastructure

**Why now:** 6.3K LOC of TypeScript with **zero unit tests**. The most fragile components — the 62-rule `riskAnalyzer.ts`, the recursive-descent `expressionEvaluator.ts`, the VTL/JS sandbox in `resolverEngine.ts` — silently regress on any refactor.

**Scope:**

- Add `vitest` (or `jest`) with `tsconfig` paths aligned to `src/`.
- Unit tests for: `expressionEvaluator.ts` (DynamoDB filter/key/update parsing), `riskAnalyzer.ts` (rule classification), `vtlEvaluator.ts` (`$util.dynamodb.toMapValues`, `#foreach`, error branches), `envVarValidator.ts` (SSM/Secrets/cross-stack classification), `timeoutValidator.ts` (mismatch matrix).
- Smoke test that runs the example project end-to-end through each command.
- CI check on PRs.

**Exit criteria:** ≥60% line coverage on `src/core/`, every command invokable in CI without manual setup.

### P0.2 — Extensible rule engine

**Why now:** The 62 hardcoded rules in `riskAnalyzer.ts` and the wiring rules in `stackIntentValidator.ts` cannot accommodate a new AWS service or custom team policy without code changes. This blocks community contributions and tailored team deployments.

**Scope:**

- Define a declarative rule schema (JSON or YAML) loadable from `.aws-toolkit/rules/*.json`.
- Rule fields: `id`, `severity`, `match` (CloudFormation resource type + JSONPath expression), `message`, `remediation`.
- Migrate the existing 62 rules to declarative form; keep a deterministic loader for built-in rules.
- Allow project-level rule overrides (silence built-in rule, add custom rule) without forking the extension.
- Version the rule schema (`schemaVersion: 1`) so future changes don't break existing rule files.

**Exit criteria:** Existing risk analyzer behavior is preserved with rules loaded from JSON; a developer can add a custom rule by writing a single JSON file.

### P0.3 — Schema versioning for project artifacts

**Why now:** `mock-data.json`, `.pipeline.json`, future `.appsync-tests.json` have no version field. The first breaking change will silently corrupt user projects.

**Scope:**

- Add `schemaVersion` to every project-level artifact the toolkit reads or writes.
- Implement a tolerant loader that warns (not errors) on unknown future versions.
- Document the schema for each artifact in `/docs/schemas/`.

**Exit criteria:** Every artifact the extension reads has a documented, versioned schema.

### P0.4 — Service Map offline mode

**Why now:** [serviceMapPanel.ts](src/extension/webviews/serviceMapPanel.ts) loads React Flow from a CDN. The toolkit advertises "offline" but this view fails without internet — a credibility-damaging contradiction.

**Scope:**

- Bundle React Flow locally via esbuild (already in `esbuild.js` pipeline).
- Verify Service Map renders with no network access.

**Exit criteria:** Disconnect network → run `AWS: Generate Service Map` → renders successfully.

---

## P1 — Highest-leverage feature work

### P1.1 — Lambda Local Runner *(was Phase 6)*

**Why P1:** Largest multiplier in the roadmap. ~80% of the runtime already exists in [lambdaRunner.ts](src/core/appsync/lambdaRunner.ts) (used today for AppSync Lambda data sources). Promoting it to a first-class command unblocks Step Functions debugging (P3.1), strengthens incident reproduction, and addresses a frequent user request.

**Scope:**

- Auto-discover Lambda handlers from `cdk.out` (function definitions, code paths, environment variables).
- Library of standard event templates: API Gateway (REST + HTTP), SQS, SNS, EventBridge, DynamoDB Streams, S3, Cognito triggers (pre-token-gen, post-confirmation, custom message).
- Inject env vars from synthesized template + `.env.local` override (reuse `envVarValidator` logic).
- Execute via `ts-node` or compiled JS, no Docker dependency.
- Output panel: stdout, return value, duration, error trace.
- Promote `lambdaRunner.ts` from `appsync/` to `lambda/` (it is no longer AppSync-specific).
- Refactor the existing AppSync resolver → Lambda flow to use this runner as its execution backend.

**New command:** `AWS: Run Lambda Locally`

**Exit criteria:** Any Lambda handler in the workspace runs locally with a realistic mock event in under 5 seconds; env vars resolved from CDK definitions without manual config.

### P1.2 — IAM Permission Preflight *(was Phase 7)*

**Why P1:** This is the **strongest competitive differentiator**. Catches the single most common serverless bug — "I added a new SDK call but forgot to grant the IAM action" — which today only surfaces at deploy time or at runtime in production. No other VS Code extension does this from `cdk.out` + static handler analysis.

**Scope:**

- Parse IAM role/policy definitions from `cdk.out`.
- Correlate each Lambda handler with its attached role and effective permissions.
- Static analysis of handler source for AWS SDK v3 calls (`new DynamoDBClient`, `send(new PutItemCommand(...))`, `GetObjectCommand`, etc.) → required IAM action set.
- Flag missing actions with the exact line in the handler that requires them.
- Detect overly broad wildcards (`*` on resource or action) and surface them as warnings.
- Reuse the extensible rule engine (P0.2) for action → SDK call mappings.

**New command:** `AWS: Validate IAM Permissions`

**Exit criteria:** A developer adding a new SDK call without granting the corresponding IAM action sees a finding before deploy. SDK v3 patterns (DynamoDB CRUD, S3, SSM, Cognito, SQS, SNS, EventBridge, Step Functions) all detected.

### P1.3 — Stack Intent v2 *(absorbs former Phase 3)*

**Why P1:** Closes the most-cited gap in the current preflight — DynamoDB key schema/index validation. Most of the building blocks exist already; this is consolidation, not greenfield.

**Scope:**

- Validate that resolver/lambda DynamoDB operations match the key schema declared in CDK (PK/SK presence, attribute types).
- Validate GSI usage: every `IndexName` in resolver/handler code must exist in CDK; flag GSIs declared but never used.
- Validate expression assumptions (key vs. attribute usage, condition vs. update intent).
- Extend `stackIntentValidator.ts` rather than creating a parallel module.
- Add findings to the existing CDK Preflight webview.

**Exit criteria:** Key schema and index mismatches are caught before pipeline runs; >90% of common DynamoDB misconfigurations surfaced from `cdk.out` + handler analysis alone.

---

## P2 — High-value, self-contained additions

### P2.1 — Lambda Bundle Size Analyzer *(was Phase 14)*

**Why P2:** Self-contained, no cross-phase dependency, addresses the painful "deploy fails because bundle is 51 MB" feedback loop. CodeLens annotations on CDK Lambda definitions make it discoverable.

**Scope:**

- Discover handler source files and `bundling` config from `cdk.out` and CDK source.
- Inspect the compiled asset in `cdk.out/.cache` when available; trigger a local esbuild bundle if missing.
- Measure uncompressed and zipped size per function.
- Top-N dependency breakdown (treemap optional).
- Warn when approaching limits: 50 MB zipped (direct), 250 MB unzipped, 512 MB container.
- Detect AWS SDK v2 full-bundle inclusion vs. modular v3.

**New command:** `AWS: Analyze Lambda Bundle Sizes`

**Exit criteria:** Oversized bundles and full-SDK inclusions flagged automatically after every `cdk synth`.

### P2.2 — EventBridge Rule Tester *(was Phase 8)*

**Why P2:** Self-contained, no AWS credentials needed, deterministic — fits the tesis perfectly. Common gap in event-driven CDK projects.

**Scope:**

- Load patterns from CDK definitions or pasted JSON.
- Local pattern evaluation per the EventBridge spec: prefix, suffix, anything-but, numeric ranges, exists, IP-address.
- MATCH / NO MATCH with per-field breakdown.
- Batch mode: array of events → pass/fail table.

**New command:** `AWS: Test EventBridge Rule`

**Exit criteria:** A developer can verify a rule pattern locally before deploying event-driven infrastructure.

### P2.3 — AI Resolver Error Diagnosis *(was Phase 16)*

**Why P2:** The single AI feature with clear ROI — surfaces directly inside the existing AppSync Studio on resolver failure, no separate panel to discover. Existing trace + ctx snapshot is the perfect prompt context.

**Prerequisite:** AppSync Offline Studio (shipped). LLM provider config (new).

**Scope:**

- On resolver failure, capture: error message, stack trace, resolver source, request/response payloads, `ctx` snapshot.
- Send through extension host (never from webview directly — CSP boundary).
- Configurable LLM: Bedrock (Claude) or OpenAI-compatible endpoint.
- Diagnosis panel: one-sentence root cause, step-by-step explanation, inline diff suggestion.
- Opt-out via setting; off by default until a provider is configured.
- Redact env-var values and identity claims before sending to the LLM.

**New command:** `AWS: Explain Last Resolver Error`

**Exit criteria:** Plain-English explanation accurate for the most common failure classes (key schema mismatch, missing `$util` call, wrong DynamoDB operation, null in response mapping).

---

## P3 — Targeted niche features

### P3.1 — Step Functions Local Debugger *(was Phase 10)*

**Prerequisite:** P1.1 (Lambda Local Runner).

**Scope:**

- Load `.asl.json` / `.asl.yaml` from workspace.
- Execute states sequentially: Task, Choice, Wait, Parallel, Map, Pass, Succeed, Fail.
- Lambda Task states use the runner from P1.1.
- Allow mocked Task responses when no local handler.
- Pause at each transition; show input, output, effective path.
- Detect infinite loops, unreachable states, missing Catch/Retry.

**Exit criteria:** State machine execution path validated locally for happy and error branches.

### P3.2 — AI IAM Policy Generator *(was Phase 18)*

**Prerequisite:** P1.2 (IAM Preflight) must have shipped to produce findings to fix.

**Scope:**

- Triggered after P1.2 reports a missing-action finding.
- Send handler source to LLM: "extract SDK calls → minimum IAM actions + ARN patterns."
- Generate `aws-cdk-lib` `PolicyStatement` snippet (TypeScript) with resource-level scoping where possible.
- Flag dynamic ARNs with placeholder + comment.

**Exit criteria:** "Missing permission detected" → "pasteable CDK snippet" in one command.

---

## P4 — Deferred / explicitly cut

| Item | Decision |
| --- | --- |
| ~~Phase 9 — CDK Cost Estimator~~ | **Cut.** Static pricing tables decay; AWS Pricing Calculator covers this. May reconsider as a "stretch" if user demand surfaces. |
| ~~Phase 11 — CloudWatch Logs Live Tail~~ | **Cut from this extension.** Out of scope: requires live cloud credentials and is post-deploy. Could ship as a sibling extension `aws-serverless-online-toolkit`. |
| ~~Phase 17 — AI-Enhanced CDK Risk Analysis~~ | **Deferred.** Deterministic rules are predictable; AI layer is incremental polish, not a differentiator. Reconsider if P0.2 rule engine grows complex enough to need AI summarization. |
| ~~Phase 19 — AI Incident RCA~~ | **Cut.** Depended on the cut CloudWatch Live Tail. |
| ~~Phase 20 — AI Test Case Generator~~ | **Deferred.** Compelling but high novelty cost; revisit after P1.1 + P1.2 ship and the AppSync Studio has a stable test-case import format. |

---

## Candidate ideas (not yet committed)

These are aligned with the tesis and worth evaluating before adding to a P-tier:

1. **GraphQL contract testing** — diff the schema in the deployed stack vs. local schema, flag breaking changes (removed fields, narrowed types) before deploy. Strong fit for the pre-deploy thesis.
2. **CDK construct linter** — declarative rules akin to `cdk-nag` but local and config-free (memory/timeout suspicious values, log retention missing, X-Ray off, KMS not configured). Reuses P0.2.
3. **`cdk.out` snapshot diff** — semantic (not textual) diff between two synths in the same workspace, complementing the CDK Diff Explainer with intra-branch changes.
4. **API Gateway REST/HTTP preflight** — extend Stack Intent to validate REST API integration wiring (currently AppSync-only).
5. **Cognito trigger debugger** — analogous to AppSync Lambda debugging but for Cognito triggers (pre-token-gen, post-confirmation, custom message). Reuses P1.1.

---

## Cross-cutting Workstreams

### CDK Discovery and Mapping

- Auto-detect AppSync APIs, resolvers, data sources, Lambda references from CDK outputs and conventions.
- Keep manual override settings for non-standard layouts.
- Validate IAM/resource wiring from synthesized templates and fail early on common permission gaps.

### Developer Experience

- Keep command names and workflows consistent.
- Use actionable error messages with next-step guidance.
- Preserve CSP-safe webview architecture (no inline handlers, postMessage only).
- Bundle all webview dependencies locally — never CDN (see P0.4).

### Quality and Safety

- Maintain test coverage on `src/core/` (P0.1).
- Maintain prepublish checks before release.
- Exclude secrets from package artifacts and logs.
- Redact identity claims and env values before any LLM call.

---

## Updated Milestone Sequence

| # | Milestone | Status |
| --- | --- | --- |
| M1 | APPSYNC_JS trace and checkpoint debugger | ✅ |
| M2 | Resolver → Lambda debug bridge | ✅ |
| M3 | VTL trace and mapping diagnostics | ✅ |
| M4 | CDK preflight report (AppSync/Lambda/DynamoDB/IAM wiring) | ✅ |
| M5 | Mock data seeder + env var preflight + timeout detector | ✅ |
| M6 | AWS Service Map | ✅ |
| **M7** | **P0 — Test infra + extensible rules + schema versioning + Service Map offline** | ⬜ |
| **M8** | **P1.1 — Lambda Local Runner** | ⬜ |
| **M9** | **P1.2 — IAM Permission Preflight** | ⬜ |
| **M10** | **P1.3 — Stack Intent v2 (DynamoDB key/index validation)** | ⬜ |
| M11 | P2.1 — Lambda Bundle Size Analyzer | ⬜ |
| M12 | P2.2 — EventBridge Rule Tester | ⬜ |
| M13 | P2.3 — AI Resolver Error Diagnosis | ⬜ |
| M14 | P3.1 — Step Functions Local Debugger | ⬜ |
| M15 | P3.2 — AI IAM Policy Generator | ⬜ |

## Near-term Backlog

- ⬜ P0.1 — Add `vitest` setup and unit tests for `expressionEvaluator`, `riskAnalyzer`, `vtlEvaluator`.
- ⬜ P0.2 — Migrate the 62-rule risk analyzer to declarative JSON.
- ⬜ P0.3 — Add `schemaVersion` to `mock-data.json`, `.pipeline.json`.
- ⬜ P0.4 — Bundle React Flow locally; remove CDN dependency.
- ⬜ Define resolver trace JSON schema (carried over from previous roadmap).
- ⬜ Add CI workflow for tests + prepublish checks.

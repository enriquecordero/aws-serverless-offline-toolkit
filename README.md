# AWS Serverless Offline Toolkit

A VS Code extension for fast pre-deploy validation of AWS serverless projects — without waiting on pipelines or cloud deployments.

## Why

When a pipeline takes 10–20 minutes, small mistakes become expensive. This toolkit is built for developers who want to catch resolver bugs, infrastructure wiring issues, missing environment variables, and risky CDK changes before pushing anything.

It is not a full cloud emulator. The goal is shorter feedback loops and earlier detection of common problems.

## Features

### AppSync Offline Studio

Run AppSync JavaScript and VTL resolvers locally with a realistic `ctx` simulation — no AWS account required.

- Local GraphQL server with AppSync-style context (`arguments`, `identity`, `source`, `stash`, `result`).
- Supports single schema files and multi-file schema folders with hot reload.
- Mock identity modes: `apiKey`, `cognitoUser`, `iam`, `admin`, `guest` — switchable per request.
- Query editor with variables, execution history, and schema explorer.
- **Resolver Runner tab** — run any resolver directly with a custom identity and argument JSON, see the full trace (phase, duration, I/O) without writing a full GraphQL query.
- **Lambda data source support** — configure a handler spec per data source and the resolver engine invokes the Lambda handler locally instead of the in-memory store.
- **🐛 Debug Lambda** — one click spawns the Lambda handler with `--inspect-brk` and attaches VS Code's Node.js debugger so you can set breakpoints and step through handler code.
- **VTL resolver evaluation** — `.vtl` request/response templates are rendered locally, with `$ctx`, `$util.dynamodb.*`, `#if`, `#foreach`, and `$util.error` support.
- In-memory DynamoDB with full expression support: `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `Scan`, composite keys, `FilterExpression`, `KeyConditionExpression`, `UpdateExpression` (`SET`/`REMOVE`/`ADD`), GSI simulation, and `limit`/`nextToken` pagination.
- Resolver run history — the last 20 runs persist in workspace state with one-click replay.
- Auto-detection of project layout or explicit path configuration.

### CDK Diff Explainer

Runs `cdk diff` and classifies every infrastructure change by risk level with actionable explanations.

- Critical, high, medium, and low risk classification across Lambda, DynamoDB, IAM, AppSync, S3, Cognito, SQS, and more.
- Highlights replacements, deletions, and wildcard IAM policies that need review.
- Exportable Markdown report for engineering reviews and approvals.

### CDK Stack Preflight Report

Validates synthesized `cdk.out` templates before any deployment — no AWS credentials required.

- Checks AppSync resolver → DataSource wiring, Lambda → IAM role references, DynamoDB table targets, and AppSync ServiceRole bindings.
- Flags wildcard IAM actions and resources.
- Displays a **confidence score** (0–100) with a readiness label: *Ready to Deploy*, *Minor Issues*, *Review Needed*, *Significant Issues*, or *Not Ready*.
- One command runs `cdk synth` and validation in a single flow.

### Env Var Preflight

Scans every Lambda function in `cdk.out` and classifies its environment variables before deployment.

- Detects static values, SSM Parameter Store references, Secrets Manager references, CDK intrinsic tokens, cross-stack refs, and empty strings.
- Supports `.env.local` overrides for offline validation of cloud-backed variables.
- Shows per-Lambda breakdown with status, source type, and a `.env.local` snippet for any variables that need cloud resolution.

## Commands

Open the Command Palette (`Cmd+Shift+P`) and run:

| Command | Description |
| --- | --- |
| `AWS: Start AppSync Offline Server` | Start local GraphQL server |
| `AWS: Stop AppSync Offline Server` | Stop local server |
| `AWS: Detect AppSync Project` | Auto-detect schema, resolvers, and mock data |
| `AWS: Detect and Start AppSync Offline` | Detect project and start server in one step |
| `AWS: Validate AppSync Setup` | Verify paths and configuration |
| `AWS: Reload Mock Data` | Re-seed in-memory store from `mock-data.json` without restart |
| `AWS: Generate Mock Data from CDK` | Generate skeleton fixtures from CDK DynamoDB table definitions |
| `AWS: Run CDK Diff Explainer` | Analyze `cdk diff` with risk classification |
| `AWS: Validate Stack Intent (cdk.out)` | Run preflight checks from synthesized templates |
| `AWS: Synth and Validate Stack Intent` | Run `cdk synth` then preflight in one flow |
| `AWS: Validate Environment Variables` | Scan Lambda env vars from `cdk.out` |

## Quick Start

### AppSync local validation

1. Open a workspace with a GraphQL schema and resolver files.
2. Run `AWS: Detect AppSync Project` to auto-configure paths.
3. Run `AWS: Detect and Start AppSync Offline`.
4. Execute queries, inspect resolver output, and iterate with hot reload.

### CDK infrastructure review

1. Make infrastructure changes in your CDK app.
2. Run `AWS: Run CDK Diff Explainer` to review risk before pushing.
3. Run `AWS: Synth and Validate Stack Intent` to catch wiring issues from synthesized templates.
4. Run `AWS: Validate Environment Variables` to confirm all Lambda env vars are resolvable.

## Project Layout

### AppSync

```text
my-appsync-project/
  schema.graphql
  mock-data.json
  resolvers/
    Query.getItem.request.js
    Query.getItem.response.js
```

Schema folders (`lib/schemas/*.graphql`) are also supported when auto-detected or configured.

### CDK preflight

The extension reads `cdk.out/*.template.json` — run `cdk synth` first if `cdk.out` does not exist. The `AWS: Synth and Validate Stack Intent` command handles this automatically.

For env var validation, add a `.env.local` file at the workspace root to provide values for SSM and Secrets Manager references without cloud access:

```bash
# .env.local  (excluded from VSIX and git)
MY_SSM_PARAM=local-override-value
ANOTHER_SECRET=dev-value
```

## DynamoDB Expression Support

The in-memory store evaluates real DynamoDB expression syntax, so resolver code written for AWS works locally without changes.

**Query with GSI** (filters by any attribute — no index schema needed):

```js
// resolver request
export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'userId = :userId',
      expressionValues: { ':userId': util.dynamodb.toDynamoDB(ctx.args.userId) },
    },
    filter: {
      expression: '#status = :status',
      expressionNames: { '#status': 'status' },
      expressionValues: { ':status': util.dynamodb.toDynamoDB('active') },
    },
    index: 'byUserId',
    limit: 20,
  };
}
```

**UpdateExpression**:

```js
export function request(ctx) {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    update: {
      expression: 'SET #name = :name REMOVE deletedAt',
      expressionNames: { '#name': 'name' },
      expressionValues: { ':name': util.dynamodb.toDynamoDB(ctx.args.name) },
    },
  };
}
```

## Lambda Data Source Setup

To connect a Lambda data source to the local resolver engine, add the handler spec to your workspace settings:

```json
// .vscode/settings.json
{
  "awsToolkit.appsync.lambdaHandlers": {
    "MyLambdaDataSource": "src/handlers/resolver.ts#handler"
  }
}
```

The key is the AppSync data source name (as defined in your CDK stack or AppSync config). The value is `"path/to/handler#exportedFunction"` — relative to the workspace root.

Once configured, the Resolver Runner's **▶ Run Resolver** button invokes the Lambda locally. Use **🐛 Debug Lambda** to attach the VS Code debugger and step through the handler with breakpoints.

## Resolver Example (APPSYNC_JS)

```js
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: { id: { S: ctx.arguments.id } },
  };
}

export function response(ctx) {
  return ctx.result;
}
```

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `awsToolkit.appsync.port` | `4000` | Local AppSync server port |
| `awsToolkit.appsync.mockIdentity` | `apiKey` | Default mock identity type |
| `awsToolkit.appsync.schemaPath` | — | Schema file or directory path |
| `awsToolkit.appsync.resolversPath` | — | Resolvers directory path |
| `awsToolkit.appsync.mockDataPath` | — | `mock-data.json` file path |
| `awsToolkit.appsync.lambdaHandlers` | `{}` | Map of data source name → handler spec, e.g. `{ "MyDS": "src/handler.ts#handler" }` |
| `awsToolkit.appsync.lambdaDebugPort` | `9229` | Node.js inspector port for Lambda debug sessions |
| `awsToolkit.cdkDiff.stackName` | — | Specific CDK stack to diff (empty = all) |

## Best Fit

Teams working with:

- AWS AppSync with JavaScript resolvers.
- CDK-based serverless stacks.
- Local-first development before CI/CD.
- Fast iteration on schema, resolver, and infrastructure changes.

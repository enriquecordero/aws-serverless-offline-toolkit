# AWS Serverless Offline Toolkit

A VS Code extension to validate AWS serverless behavior before deployment.

It provides two core capabilities:

- Run AppSync resolvers locally with a realistic `ctx` simulation.
- Analyze `cdk diff` output with a risk-oriented summary.

## Why This Extension

When pipeline feedback takes 10-20 minutes, small mistakes become expensive. This toolkit is designed for fast pre-deploy checks in local development.

It is especially useful when you need to answer questions like:

- Is this resolver behaving the way I expect before I deploy?
- Did my schema or resolver change break a query or mutation?
- Is this `cdk diff` showing a safe change or a risky one?
- Can I validate intent locally before waiting for a pipeline run?

## Features

### AppSync Offline Studio

- Local GraphQL server for AppSync-style resolver execution.
- Supports single schema files and multi-file schema folders.
- Resolver hot reload when schema/resolver files change.
- Mock identity modes: `apiKey`, `cognitoUser`, `iam`, `admin`, `guest`.
- Query editor with variables, history, and schema explorer.
- Setup detection and validation commands for faster onboarding.

### CDK Diff Explainer

- Runs `cdk diff` and classifies changes by risk.
- Highlights critical and high-risk infrastructure changes.
- Generates Markdown reports for reviews and approvals.

## Best Fit

This extension is a strong fit for teams working with:

- AWS AppSync with JavaScript resolvers.
- CDK-based serverless projects.
- Local-first validation before CI/CD.
- Fast iteration on schema, resolver, and infrastructure changes.

It is not trying to be a full cloud emulator. The goal is to shorten feedback loops and catch common issues earlier.

## Commands

Use the Command Palette and run:

- `AWS: Start AppSync Offline Server`
- `AWS: Stop AppSync Offline Server`
- `AWS: Detect AppSync Project`
- `AWS: Detect and Start AppSync Offline`
- `AWS: Validate AppSync Setup`
- `AWS: Run CDK Diff Explainer`
- `AWS: Validate Stack Intent (cdk.out)`
- `AWS: Synth and Validate Stack Intent`

## Install

Install the extension from the Visual Studio Code Marketplace and open a workspace that contains an AppSync or CDK project.

This extension is designed for developers who want fast local feedback before waiting on cloud deployment or CI/CD pipelines.

## Quick Start

### AppSync local validation

1. Open a workspace that contains a GraphQL schema and resolver files.
2. Run `AWS: Detect AppSync Project` if your project uses a non-trivial layout.
3. Run `AWS: Validate AppSync Setup` to confirm schema, resolvers, and mock-data paths.
4. Run `AWS: Detect and Start AppSync Offline` or `AWS: Start AppSync Offline Server`.
5. Use the panel to execute queries, pass variables, inspect schema, and review resolver output.

What you get:

- A local query runner inside VS Code.
- Resolver execution with AppSync-style context simulation.
- Quick schema iteration with hot reload.
- Faster debugging than deploy-and-test loops.

### CDK infrastructure review

1. Open a CDK project workspace.
2. Ensure `npx cdk diff` works in that project.
3. Run `AWS: Run CDK Diff Explainer`.
4. Run `AWS: Validate Stack Intent (cdk.out)` to catch wiring issues from synthesized templates.
5. Or run `AWS: Synth and Validate Stack Intent` to execute `cdk synth` and validation in one flow.
6. Review the risk summary before pushing changes into a pipeline.

Note: if no templates are found in `cdk.out`, run `cdk synth` first.
The command can also prompt you to run `cdk synth` directly from VS Code.

What you get:

- A more readable explanation of infrastructure changes.
- Risk-oriented findings for review.
- Exportable output for sharing in engineering workflows.
- A preflight intent report from `cdk.out` without deploy.
- Wiring checks for AppSync resolvers and DataSources, Lambda/Dynamo targets, AppSync ServiceRole references, and basic IAM wildcard policy risks.

## What You Need In Your Project

For AppSync workflows, the extension works best when your workspace includes:

- A GraphQL schema file or schema folder.
- Resolver files for your AppSync operations.
- Optional `mock-data.json` for local data-backed tests.

For CDK diff workflows, the workspace should contain a valid CDK app where `cdk diff` can run successfully.

## Example AppSync Project Layout

```text
my-appsync-project/
  schema.graphql
  mock-data.json
  resolvers/
    Query.getItem.request.js
    Query.getItem.response.js
```

Alternative schema organization also works (for example, `lib/schemas/*.graphql`) when discovered or configured.

## Resolver Example (APPSYNC_JS style)

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

## Typical AppSync Workflow

1. Detect the project layout or set explicit paths in VS Code settings.
2. Start the offline server.
3. Run a query from the AppSync panel.
4. Adjust schema or resolver code.
5. Re-run immediately with hot reload instead of waiting for deployment.

## Typical CDK Workflow

1. Make infrastructure changes in your CDK app.
2. Run `AWS: Run CDK Diff Explainer`.
3. Review risky replacements, deletions, or auth-related changes.
4. Export the report if you need to share the result with your team.
5. Push with more confidence once the diff looks correct.

## Offline Test Scripts

```bash
npm run test:offline:example
npm run test:offline -- --schema /path/to/schema.graphql --suite scripts/test-suites/example-suite.json
npm run test:offline:ci
```

## CDK Diff Usage

1. Open a CDK project workspace.
2. Run `AWS: Run CDK Diff Explainer`.
3. Review risk findings and export Markdown if needed.

## Why Teams Use It

- Catch resolver and schema issues before deployment.
- Review infrastructure intent from `cdk diff` before pipeline execution.
- Reduce slow feedback loops when CI/CD takes 10 to 20 minutes.
- Give developers a safer local validation step for serverless changes.

## Current Focus

Today, the extension focuses on:

- AppSync offline workflows.
- Resolver-oriented local validation.
- CDK diff analysis inside VS Code.

Planned roadmap items include deeper pre-deploy validation for Lambda flows, resolver debugging, and CDK-oriented validation from synthesized stack output.

## Configuration

Settings keys:

- `awsToolkit.appsync.port`
- `awsToolkit.appsync.mockIdentity`
- `awsToolkit.appsync.schemaPath`
- `awsToolkit.appsync.resolversPath`
- `awsToolkit.appsync.mockDataPath`
- `awsToolkit.cdkDiff.stackName`

## Security Notes

- Never include `.env` or secrets in a VSIX package.
- Use PAT credentials through environment variables.
- Rotate tokens immediately if exposed.

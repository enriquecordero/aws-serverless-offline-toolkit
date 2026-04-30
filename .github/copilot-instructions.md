# Copilot Instructions - AWS Serverless Offline Toolkit

## Project Goal
This repository provides a VS Code extension to run AppSync offline, validate setup, and explain CDK diffs.
The code should stay generic for different AppSync/CDK projects, not tied to a single client layout.

## Core Rules

- Keep AppSync discovery generic and reusable.
- Prefer shared helpers over duplicated logic in command files.
- Keep webview logic CSP-safe: no inline event handlers in HTML; wire events in external JS.
- Never package or commit secrets (`.env`, PATs, credentials).
- Keep Marketplace publishing flow stable (`vsce`, PAT via env, `.vscodeignore` protections).

## AppSync Discovery Conventions

- Centralize schema/resolver/mock-data discovery in `src/extension/commands/appsyncDiscovery.ts`.
- Use configurable settings first (`awsToolkit.appsync.schemaPath`, `resolversPath`, `mockDataPath`), then fallback scanning.
- In multi-project workspaces, prompt user to choose candidate project.

## Commands Conventions

- `startAppSyncOffline` should consume discovery helper output, not duplicate scanning logic.
- Detection and validation commands should offer practical actions (`apply settings`, `start now`).
- Preserve user-facing messages in clear, concise language.

## Webview Conventions

- Keep panel scripts in `media/` and load via `webview.asWebviewUri`.
- Use `addEventListener` for interactions.
- Persist panel state per workspace key (query, variables, history).

## Release and Publish

- Run `npm run prepublish:check` before release/publish.
- Keep `.vscodeignore` updated to exclude sensitive files.
- Use release scripts (`release:patch`, `release:minor`) to avoid manual mistakes.
- For update publishes, prefer `publish:patch` or `publish:minor` to ensure version bump before `vsce publish`.

## Security

- If any token appears in logs or files, treat it as compromised and rotate immediately.
- Never echo PAT values in code, docs, or terminal output intended for sharing.

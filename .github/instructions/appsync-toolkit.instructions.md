---
applyTo: "src/**"
description: "Use when: working on AppSync offline commands, discovery, panel integration, or release behavior in this toolkit."
---

# AppSync Toolkit File Instructions

## Architecture

- Keep discovery logic centralized in `src/extension/commands/appsyncDiscovery.ts`.
- Reuse discovery helpers from command files.
- Avoid embedding project-specific assumptions unless they are fallback patterns.

## Command Behavior

- Start/Detect/Validate flows should remain consistent in inputs and selected project handling.
- If multiple schema candidates are found, keep quick-pick selection available.
- Keep detection results actionable (apply settings, validate, start).

## Webview and UI

- Do not use inline HTML handlers (`onclick`, `oninput`, etc.) due CSP constraints.
- Wire UI behavior in external script files under `media/`.
- Keep state synchronization explicit between extension and webview.

## Reliability

- Prefer small, composable helper functions.
- Keep user messages clear and operational (what happened, what to do next).
- Avoid breaking existing command IDs and config keys.

## Security and Packaging

- Never include `.env` or credentials in VSIX.
- Ensure `.vscodeignore` excludes environment files.
- Treat PATs and secrets as sensitive and rotate if exposed.

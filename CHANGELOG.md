# Changelog

All notable changes to this project will be documented in this file.

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

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

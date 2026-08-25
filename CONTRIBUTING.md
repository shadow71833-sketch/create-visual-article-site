# Contributing

## Development requirements

- Node.js 22 or newer
- No API key is required for the deterministic test suite
- Do not add source articles, images, or fixtures that contain private or copyrighted material without permission

## Validation

Run `npm test` for code changes and `npm run validate` before opening a pull request. New behavior requires a focused `node:test` regression. Security controls may only be relaxed with a documented threat-model change and a failing test that demonstrates the need.

## Pull requests

Keep changes focused, explain the user-visible effect, list validation commands, and attach desktop/mobile evidence for layout changes. Do not commit secrets, generated backups, or unrelated output directories.

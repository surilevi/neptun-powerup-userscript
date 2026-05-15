# Agent Guidance

This repository contains a public Tampermonkey userscript for Neptun student portals.

## Working Rules

- Keep changes small and testable.
- Prefer existing module patterns in `src/core`, `src/modules`, and `src/utils`.
- Treat Neptun DOM selectors as fragile; add focused tests when changing selector logic.
- Never commit personal data, real tokens, cookies, private hostnames, or screenshots with student information.
- Rebuild `dist/npu.user.js` when runtime behavior changes.

## Checks

Run the full local gate before publishing changes:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Product Boundaries

NPU should reduce repetitive clicking after the user has made a choice. It should not collect credentials, bypass Neptun rules, or make hidden enrollment decisions.

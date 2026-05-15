# Contributing

Thanks for helping improve Neptun PowerUp! This project is intentionally small: changes should make repetitive Neptun workflows safer, clearer, or more reliable without collecting personal data or bypassing institutional rules.

## Local Setup

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Use Node.js 22 and pnpm 10, matching CI.

## Quality Checks

Before opening a pull request, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If a change touches course or exam automation, add or update focused Vitest coverage around the selector or workflow behavior.

## Privacy And Safety

- Do not commit screenshots, logs, fixtures, or snippets that contain names, Neptun codes, subject registrations tied to a person, tokens, cookies, or hostnames that should stay private.
- Do not add features that submit credentials, bypass server-side rules, or hide meaningful errors from the user.
- Keep automation explicit. The user should understand when NPU is about to click course or exam controls.

## Release Notes

The installable userscript lives at `dist/npu.user.js`. If behavior changes, run `pnpm build` and include the rebuilt file in the same pull request.

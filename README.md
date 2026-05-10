# Neptun PowerUp!

Tampermonkey userscript with quality-of-life helpers for Neptun student portals.

Hungarian documentation: [README.hu.md](README.hu.md)

Neptun PowerUp! focuses on reducing repetitive work inside authenticated Neptun pages: saving course selections, restoring them during registration periods, keeping the active session alive, and quickly rejoining saved exam dates.

> Important: This tool automates parts of the Neptun UI. Use it at your own risk and in line with your university's acceptable-use policy.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Build the userscript with `pnpm build`.
3. Open [`dist/npu.user.js`](dist/npu.user.js) and install it in Tampermonkey.
4. Open your university's Neptun portal. The NPU panel appears in the bottom-right corner.

If you want to install directly from GitHub, use:

- [dist/npu.user.js](https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js)

## Features

- Course Store: save selected courses, restore them later, and optionally auto-enroll them during registration periods.
- Session Keepalive: refreshes the active session before expiry and retries refresh attempts when the network is flaky.
- Exam Quick Signup: save a preferred exam date and auto-enroll it with one click.
- Pink Mode: optional visual theme customization.

## University Support

The userscript targets Neptun student portals by path family instead of a hand-maintained host list:

- `/hallgatoi/*`
- `/hallgato_ng/*`
- `/hallgatoing/*`
- `/ujhallgato/*`

Course and exam features no longer depend on `BME...` subject codes. Subject detection is heuristic-based and works from the visible Neptun UI, which makes the core flows more portable across universities.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

To enable verbose diagnostics for troubleshooting, set `localStorage.npu_debug = 'true'` in the browser console and reload the page. Set it back to `'false'` to return to the normal quiet release behavior.

## Limitations

- The script relies on Neptun's current Angular Material DOM structure. A UI refresh can break selectors without warning.
- Subject detection is heuristic. If a university uses unusually short or nonstandard subject identifiers, save/load may need follow-up tuning.
- Enrollment is intentionally sequential. Neptun typically rejects concurrent enrollment requests.
- Exam Quick Signup operates on the currently open exam page. It does not navigate between multiple subjects on its own.

## Privacy

The script stores its own preferences and saved selections in Tampermonkey storage. It does not include a login-retry feature and does not persist usernames or passwords.

## Legal

Neptun PowerUp! automates some browser interactions with Neptun and may still violate university rules or acceptable-use policies. The authors accept no liability for consequences of using this tool.

For more detail, see [LEGAL_NOTICE.md](LEGAL_NOTICE.md).

## License

MIT

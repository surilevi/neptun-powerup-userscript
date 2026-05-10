# Neptun PowerUp!

A Tampermonkey userscript for Neptun student portals.

Hungarian documentation: [README.hu.md](README.hu.md)

Neptun PowerUp! helps with the parts of Neptun that usually mean repeating the same clicks: saving course selections, restoring them during registration, keeping the current session alive, and rejoining saved exam dates.

> Important: this tool automates parts of the Neptun UI. Use it at your own risk and check your university's rules before relying on it.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. If you use Chrome or Edge, open the browser extensions page and enable Developer Mode so Tampermonkey can run userscripts.
3. Build the userscript with `pnpm build`.
4. Open [`dist/npu.user.js`](dist/npu.user.js) and install it in Tampermonkey.
5. Open your university's Neptun portal. The NPU panel appears in the bottom-right corner.

If you want to install directly from GitHub, use:

- [dist/npu.user.js](https://github.com/surilevi/neptun-powerup-userscript/raw/main/dist/npu.user.js)

## Features

- Course Store: saves selected courses and restores them later.
- Course Rush: loads saved courses and tries to enroll them one by one.
- Exam Quick Signup: saves a preferred exam date and tries to enroll it with one click.
- Exam Rush: scans the visible exam page for saved exam targets.
- Infinite Session: tries to keep the current Neptun session alive.
- Theme: optional accent colors for the Neptun UI.

## Portal Paths

The userscript watches common Neptun student portal paths instead of a fixed university host list:

- `/hallgatoi/*`
- `/hallgato_ng/*`
- `/hallgatoing/*`
- `/ujhallgato/*`

Course and exam features do not depend on `BME...` subject codes. Detection is based on the visible Neptun UI, so it can work across different university installs, but local Neptun changes may still need fixes.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

For verbose debug logs, run `localStorage.npu_debug = 'true'` in the browser console and reload. Set it back to `'false'` to keep the console quiet.

## Limitations

- The script relies on Neptun's current Angular Material DOM. A Neptun UI update can break selectors.
- Subject and exam detection is heuristic. Unusual local labels may need tuning.
- Enrollment runs sequentially on purpose. Neptun often handles parallel requests badly.
- Exam features work on the currently open exam page. They do not browse every subject page on their own.

## Privacy

The script stores its own settings and saved selections in Tampermonkey storage. It does not save usernames or passwords.

## Legal

Neptun PowerUp! automates browser interactions with Neptun and may violate university rules or acceptable-use policies. You are responsible for how you use it.

For more detail, see [LEGAL_NOTICE.md](LEGAL_NOTICE.md).

## License

MIT

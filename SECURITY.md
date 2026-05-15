# Security Policy

## Supported Versions

Security fixes target the latest version on the `main` branch and the current `dist/npu.user.js` build.

## Reporting A Vulnerability

Please do not open a public issue for vulnerabilities that expose private data, tokens, credentials, or a way to perform unintended actions in Neptun.

Report privately through GitHub's private vulnerability reporting if it is available for this repository. If it is not available, open a minimal issue that says you need a private security contact, without exploit details.

Useful details:

- A short description of the impact.
- A minimal reproduction that avoids real account data.
- Browser, userscript manager, and NPU version.
- Whether the issue affects stored settings, session tokens, course actions, exam actions, or page detection.

## Scope

In scope:

- Accidental leakage of stored NPU settings or Neptun session data.
- Unsafe DOM injection or cross-site scripting caused by NPU.
- Automation behavior that clicks the wrong visible control because of a selector bug.

Out of scope:

- Neptun server vulnerabilities.
- Institution-specific policy questions.
- Reports that require access to someone else's account.

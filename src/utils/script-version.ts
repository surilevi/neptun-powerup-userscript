/**
 * The running userscript's version, as Tampermonkey reports it.
 *
 * Shown in the panel header because the repo builds more than one
 * `dist/npu.user.js` (main checkout plus git worktrees), and the file name alone
 * gives no clue which one is installed. Having the version on screen makes
 * "am I testing the build I just made?" answerable at a glance.
 */
export function getScriptVersion(): string {
  try {
    if (typeof GM !== 'undefined' && GM.info?.script?.version) {
      return GM.info.script.version
    }
  } catch {
    // GM is unavailable outside Tampermonkey (tests, plain page context).
  }

  return 'dev'
}

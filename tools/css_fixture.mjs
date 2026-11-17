// SPDX-License-Identifier: GPL-3.0-or-later
// Only for legacy visual-contract tests: CSS formatting is not behavior.
// Preserve spaces within selectors and CSS function values.
export function compactCss(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{};:])\s*/g, '$1')
    .replace(/@media\s*\(/g, '@media(')
    .trim();
}

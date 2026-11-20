// SPDX-License-Identifier: GPL-3.0-or-later
// Test-only classic-script projection of the native browser ES modules.
// It keeps the existing mock-DOM and failure-injection tests dependency-free;
// test_frontend.mjs separately verifies the real ESM graph and exports.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const moduleNames = ['core', 'api', 'ui', 'discovery', 'sha256', 'transfer', 'signaling', 'session'];

export function browserTestSource(root) {
  const pieces = [...moduleNames.map((name) => `web/js/${name}.js`), 'web/app.js'];
  return pieces.map((file) => {
    const source = readFileSync(resolve(root, file), 'utf8');
    return source
      .replace(/^import \{[^\n]*\} from '[^']+';\n/gm, '')
      .replace(/^export (?=(?:async )?function |(?:const|let|class) )/gm, '');
  }).join('\n');
}

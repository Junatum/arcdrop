// SPDX-License-Identifier: GPL-3.0-or-later
// Host-side checks only. No ESLint code or dependencies ship with ArcDrop.
const globals = Object.fromEntries([
  'window', 'document', 'navigator', 'location', 'localStorage',
  'sessionStorage', 'fetch', 'Blob', 'File', 'URL', 'TextEncoder',
  'TextDecoder', 'RTCPeerConnection', 'RTCSessionDescription',
  'RTCIceCandidate', 'crypto', 'performance', 'console', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'AbortController',
  'FileReader', 'atob', 'btoa', 'requestAnimationFrame', 'cancelAnimationFrame',
  'process', 'Buffer', 'globalThis', 'structuredClone', 'setImmediate',
  'alert', 'prompt', 'confirm', 'URLSearchParams',
].map((name) => [name, 'readonly']));

export default [
  {
    files: ['web/**/*.js', 'tests/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-self-assign': 'error',
      'no-unsafe-finally': 'error',
    },
  },
];

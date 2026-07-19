/**
 * scripts/build-browser-tool.js
 *
 * Bundles browser-tool/app.js (which pulls in the frozen parser and the
 * Phase 2 renderer via require()) into a single browser-runnable script,
 * browser-tool/dist/app.bundle.js. This is a build-time step only -
 * nothing here runs at request time, and pdf.js itself is NOT part of
 * this bundle (it's loaded separately from browser-tool/vendor/ as a
 * plain <script> tag - see index.html).
 *
 * Usage: node scripts/build-browser-tool.js
 */

'use strict';

const esbuild = require('esbuild');
const path = require('path');

esbuild
  .build({
    entryPoints: [path.join(__dirname, '..', 'browser-tool', 'app.js')],
    bundle: true,
    format: 'iife',
    target: 'es2018',
    outfile: path.join(__dirname, '..', 'browser-tool', 'dist', 'app.bundle.js'),
    logLevel: 'info',
  })
  .catch(() => process.exit(1));

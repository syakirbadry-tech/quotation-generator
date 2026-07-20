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
 * Phase 4 adds a second, earlier bundle stage: browser-tool/application/
 * (the client-facing multi-step application form) is bundled on its own
 * into a standalone IIFE, because it has to end up inlined as a literal
 * `<script>` tag inside the client-facing quotation document, which is a
 * `file://` document with no server and no network access to fetch a
 * second script from (see composeClientDocument.js). Its bundled text is
 * baked into app.bundle.js as a compile-time string constant via
 * esbuild's `define`, so composeClientDocument.js can embed it without
 * ever performing a runtime fetch.
 *
 * Usage: node scripts/build-browser-tool.js
 */

'use strict';

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'browser-tool', 'dist');
fs.mkdirSync(distDir, { recursive: true });

const applicationRuntimeResult = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'browser-tool', 'application', 'clientRuntime.js')],
  bundle: true,
  format: 'iife',
  target: 'es2018',
  write: false,
  logLevel: 'info',
});
const applicationRuntimeSource = applicationRuntimeResult.outputFiles[0].text;

// Also written to disk for debugging/inspection - not read back by the
// app.js build below, which uses the in-memory string above instead.
fs.writeFileSync(path.join(distDir, 'application.bundle.js'), applicationRuntimeSource);

esbuild
  .build({
    entryPoints: [path.join(__dirname, '..', 'browser-tool', 'app.js')],
    bundle: true,
    format: 'iife',
    target: 'es2018',
    outfile: path.join(distDir, 'app.bundle.js'),
    define: {
      __APPLICATION_RUNTIME_SOURCE__: JSON.stringify(applicationRuntimeSource),
    },
    logLevel: 'info',
  })
  .catch(() => process.exit(1));

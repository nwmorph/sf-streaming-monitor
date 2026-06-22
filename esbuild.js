const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  // vscode and @salesforce/core (uses keytar native binary) must stay external
  external: [
    'vscode',
    '@salesforce/core',
    'keytar',
  ],
  // Silence esbuild's warning about dynamic require() in @grpc packages
  logLevel: 'warning',
}).catch(() => process.exit(1));

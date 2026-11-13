import esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';

const outDir = path.resolve('dist-server');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('[Build Server] Bundling server/index.ts with esbuild...');

try {
  await esbuild.build({
    entryPoints: ['server/index.ts'],
    outfile: 'dist-server/index.mjs',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    packages: 'external',
    sourcemap: true,
    banner: {
      js: `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`
    }
  });
  console.log('[Build Server] Successfully built dist-server/index.mjs!');
} catch (err) {
  console.error('[Build Server] Build failed:', err);
  process.exit(1);
}

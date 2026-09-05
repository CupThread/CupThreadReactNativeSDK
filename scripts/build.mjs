#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`Build step failed: ${cmd} ${args.join(' ')}`);
    process.exit(res.status || 1);
  }
}

const localTsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

function runTsc(configPath) {
  if (existsSync(localTsc)) {
    run(process.execPath, [localTsc, '-p', configPath]);
  } else {
    run('npx', ['tsc', '-p', configPath]);
  }
}

console.log('📦 Cleaning dist/...');
rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });

console.log('🔨 Compiling ESM and TypeScript declarations...');
runTsc('tsconfig.build.esm.json');

console.log('🔨 Compiling CommonJS modules...');
runTsc('tsconfig.build.cjs.json');

console.log('📝 Emitting package markers...');
writeFileSync(
  path.join(ROOT, 'dist', 'cjs', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);
writeFileSync(
  path.join(ROOT, 'dist', 'esm', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n'
);

// Normalize relative imports in ESM for Node strict resolution
function normalizeEsmImports(dir) {
  for (const file of readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      normalizeEsmImports(fullPath);
    } else if (file.endsWith('.js')) {
      let content = readFileSync(fullPath, 'utf8');
      content = content.replace(/(from\s+['\"])(\.[^'\"]+?)(['\"])/g, (match, p1, p2, p3) => {
        if (!p2.endsWith('.js')) return `${p1}${p2}.js${p3}`;
        return match;
      });
      content = content.replace(/(export\s+\*\s+from\s+['\"])(\.[^'\"]+?)(['\"])/g, (match, p1, p2, p3) => {
        if (!p2.endsWith('.js')) return `${p1}${p2}.js${p3}`;
        return match;
      });
      writeFileSync(fullPath, content);
    }
  }
}
normalizeEsmImports(path.join(ROOT, 'dist', 'esm'));

console.log('✨ Build completed successfully!\n');

// scripts/build-web.js — Copies web files to www/ for Capacitor
// Run with: node scripts/build-web.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'www');

// Files and directories to copy
const ITEMS = [
  'index.html',
  'login.html',
  'legal.html',
  'admin.html',
  'superadmin.html',
  'deployed_login.html',
  'manifest.json',
  'sw.js',
  'exercises.json',
  'assets',
  'data',
  'js',
  'images',
  'videos',
];

// Directories to skip
const SKIP = new Set(['node_modules', '.git', 'android', 'ios', 'www', '.agent', 'tools', 'tests', 'scripts', '.github', 'design-system', 'music']);

function mkdirSafe(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    mkdirSafe(dest);
    for (const child of fs.readdirSync(src)) {
      if (SKIP.has(child)) continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    // Skip very large files (>20MB) — e.g. leftover media
    if (stat.size > 20 * 1024 * 1024) {
      console.log(`  skip (too large): ${path.relative(ROOT, src)}`);
      return;
    }
    fs.copyFileSync(src, dest);
  }
}

// Clean and recreate www/
console.log('Cleaning www/ ...');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
mkdirSafe(OUT);

console.log('Copying web files to www/ ...');
for (const item of ITEMS) {
  const src = path.join(ROOT, item);
  const dest = path.join(OUT, item);
  if (!fs.existsSync(src)) {
    console.log(`  skip (not found): ${item}`);
    continue;
  }
  copyRecursive(src, dest);
  console.log(`  ✓ ${item}`);
}

console.log(`\nDone! ${ITEMS.length} items copied to www/`);

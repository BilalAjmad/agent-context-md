// Shared repo scanning + detection logic.
// Environment-agnostic ESM: imported by the CLI and by the hooks installed
// into target repos (via .context/lib/). No dependencies, no network.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', 'target', 'vendor', 'coverage', '__pycache__', '.venv', 'venv',
  '.cache', '.idea', '.turbo', 'obj', 'DerivedData', 'Pods',
]);

export function findRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'context.md')) || fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function walkRepo(root, { maxDepth = 2, cap = 400 } = {}) {
  const entries = [];
  const stack = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < cap) {
    const { dir, depth } = stack.pop();
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of items) {
      if (visited >= cap) break;
      if (item.name.startsWith('.') && item.name !== '.github') continue;
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue;
        if (entries.length >= cap + 500) continue; // stop pushing more dirs once file cap is near
        entries.push({ type: 'dir', name: item.name, rel: path.relative(root, path.join(dir, item.name)) || '.', depth });
        if (depth < maxDepth) stack.push({ dir: path.join(dir, item.name), depth: depth + 1 });
      } else {
        visited++;
        entries.push({ type: 'file', name: item.name, rel: path.relative(root, path.join(dir, item.name)), depth });
      }
    }
  }
  return entries;
}

const STACK_SIGNATURES = [
  ['package.json', 'Node.js'],
  ['tsconfig.json', 'TypeScript'],
  ['pyproject.toml', 'Python'],
  ['requirements.txt', 'Python'],
  ['setup.py', 'Python'],
  ['go.mod', 'Go'],
  ['Cargo.toml', 'Rust'],
  ['pom.xml', 'Java (Maven)'],
  ['build.gradle', 'Java/Kotlin (Gradle)'],
  ['composer.json', 'PHP'],
  ['Gemfile', 'Ruby'],
  ['Dockerfile', 'Docker'],
];

const DEP_HINTS = [
  ['next', 'Next.js'], ['react', 'React'], ['vue', 'Vue'], ['nuxt', 'Nuxt'],
  ['svelte', 'Svelte'], ['@angular/core', 'Angular'], ['express', 'Express'],
  ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'], ['tailwindcss', 'Tailwind'],
  ['prisma', 'Prisma'], ['django', 'Django'], ['fastapi', 'FastAPI'],
  ['flask', 'Flask'], ['@supabase/supabase-js', 'Supabase'],
];

export function detectStack(root) {
  const found = [];
  for (const [file] of STACK_SIGNATURES) {
    if (fs.existsSync(path.join(root, file))) found.push(file);
  }
  const parts = found.map((f) => STACK_SIGNATURES.find(([x]) => x === f)[1]);

  let packageManager = null;
  for (const [file, pm] of [
    ['package-lock.json', 'npm'], ['yarn.lock', 'yarn'], ['pnpm-lock.yaml', 'pnpm'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
  ]) {
    if (fs.existsSync(path.join(root, file))) { packageManager = pm; break; }
  }

  let framework = null;
  const pkgPath = path.join(root, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, '')); } catch { /* not node or unreadable */ }
  if (pkg) {
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const hit = DEP_HINTS.find(([name]) => deps.includes(name));
    if (hit) framework = hit[1];
  }

  let scripts = null;
  if (pkg?.scripts) {
    const interesting = ['dev', 'start', 'build', 'test', 'lint'].filter((s) => pkg.scripts[s]);
    if (interesting.length) scripts = interesting.map((s) => `${s}=\`${pkg.scripts[s]}\``).join(', ');
  }

  return {
    languages: [...new Set(parts)],
    framework,
    packageManager,
    scripts,
    depCount: pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length : null,
  };
}

function git(root, ...args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function gitInfo(root) {
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === null) return null; // not a git repo
  const head = git(root, 'rev-parse', '--short', 'HEAD') || '(no commits yet)';
  const porcelain = git(root, 'status', '--porcelain') || '';
  const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
  return { branch, head, dirty };
}

export function countFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length && count <= 10000) {
    const dir = stack.pop();
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      if (count > 10000) break;
      if (item.name.startsWith('.') && item.name !== '.github') continue;
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name)) stack.push(path.join(dir, item.name));
      } else {
        count++;
      }
    }
  }
  return count;
}

export function buildSnapshot(root) {
  const stack = detectStack(root);
  const gi = gitInfo(root);
  const files = countFiles(root);
  const lines = [
    `- Updated: ${new Date().toISOString()}`,
  ];
  lines.push(gi
    ? `- Git: ${gi.branch} @ ${gi.head}${gi.dirty ? ` · ${gi.dirty} uncommitted change(s)` : ' · clean'}`
    : '- Git: not a repository');
  lines.push(`- Stack: ${stack.languages.join(' + ') || 'unknown'}${stack.framework ? ` · ${stack.framework}` : ''}${stack.packageManager ? ` · ${stack.packageManager}` : ''}`);
  lines.push(`- Files (excl. deps/build): ${files}${stack.depCount !== null ? ` · dependencies: ${stack.depCount}` : ''}`);
  if (stack.scripts) lines.push(`- Scripts: ${stack.scripts}`);
  return lines.join('\n');
}

export function buildStructure(root) {
  const entries = walkRepo(root, { maxDepth: 2, cap: 300 });
  const dirs = entries.filter((e) => e.type === 'dir' && e.depth === 0);
  const files = entries.filter((e) => e.type === 'file' && e.depth === 0);
  const fileCount = (rel) => {
    const full = path.join(root, rel);
    let n = 0;
    const stack = [full];
    while (stack.length && n < 5000) {
      const d = stack.pop();
      let items;
      try { items = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const item of items) {
        if (item.isDirectory()) {
          if (!SKIP_DIRS.has(item.name) && !item.name.startsWith('.')) stack.push(path.join(d, item.name));
        } else n++;
      }
    }
    return n;
  };
  const lines = [];
  for (const d of dirs.slice(0, 20)) {
    lines.push(`${d.name}/  (${fileCount(d.rel)} files)`);
  }
  for (const f of files.slice(0, 25)) {
    lines.push(f.name);
  }
  return lines.join('\n') || '(empty repository)';
}

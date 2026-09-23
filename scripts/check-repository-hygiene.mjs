import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build']);
const ignoredFiles = new Set(['pnpm-lock.yaml']);
const textExtensions = new Set(['.cjs', '.css', '.gradle', '.html', '.java', '.json', '.md', '.mjs', '.properties', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml']);
const forbidden = [
  { name: 'private network address', pattern: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})\b/ },
  { name: 'personal filesystem path', pattern: /(?:\/Users\/|\/private\/var\/|\/var\/folders\/)/ },
  { name: 'private key material', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'literal credential assignment', pattern: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*["'][^"']+["']/i },
];

function collectFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...collectFiles(fullPath));
      continue;
    }
    if (ignoredFiles.has(entry.name)) continue;
    if (textExtensions.has(path.extname(entry.name)) || entry.name === '.env.example') result.push(fullPath);
  }
  return result;
}

const findings = [];
for (const file of collectFiles(root)) {
  const relative = path.relative(root, file);
  if (relative.startsWith('android/app/src/main/assets/')) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) findings.push(`${relative}:${index + 1} ${rule.name}`);
    }
  });
}

if (findings.length) {
  console.error('Repository hygiene check failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Repository hygiene check passed: no private IPs, personal paths, literal credentials, or private key material found.');
}

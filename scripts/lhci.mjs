#!/usr/bin/env node
/**
 * lhci 本地执行包装
 *
 * 背景：lhci autorun 通过 chrome-launcher 启动 Chrome 时，若不指定
 * `--user-data-dir`，chrome-launcher 会调用 makeTmpDir()。在 Windows / WSL
 * 环境下，当 USERPROFILE / TMPDIR 等环境变量未正确传递时，Chrome 会把
 * 整段 `\\wsl.localhost\...\undefined:\Users\undefined\AppData\Local\lighthouse.<PID>`
 * 当字面目录名在 cwd 下创建污染项目根。
 *
 * 解决：本地启动时 mkdtemp 一个临时目录，通过 `--userDataDir` 注入到一份
 * 派生的 .lighthouserc.json，再 spawn lhci autorun --config=<tmp>。
 * GitHub Action（ubuntu-latest）不经过本包装，使用原 .lighthouserc.json 即可。
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC_CONFIG = join(ROOT, '.lighthouserc.json');

const userDataDir = mkdtempSync(join(tmpdir(), 'lhci-'));
const tmpConfigDir = mkdtempSync(join(tmpdir(), 'lhci-conf-'));
const tmpConfigPath = join(tmpConfigDir, '.lighthouserc.json');

const src = JSON.parse(readFileSync(SRC_CONFIG, 'utf8'));
// 注入 chrome-launcher settings.userDataDir
src.ci ??= {};
src.ci.collect ??= {};
src.ci.collect.settings ??= {};
src.ci.collect.settings.userDataDir = userDataDir;

writeFileSync(tmpConfigPath, JSON.stringify(src, null, 2) + '\n', 'utf8');

console.log(`[lhci] user-data-dir: ${userDataDir}`);
console.log(`[lhci] tmp config:    ${tmpConfigPath}`);

const result = spawnSync('lhci', ['autorun', '--config=' + tmpConfigPath], {
  stdio: 'inherit',
  cwd: ROOT,
});

rmSync(userDataDir, { recursive: true, force: true });
rmSync(tmpConfigDir, { recursive: true, force: true });

process.exit(result.status ?? 1);
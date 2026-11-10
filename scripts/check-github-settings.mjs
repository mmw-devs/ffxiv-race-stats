#!/usr/bin/env node
/**
 * 校验 GitHub 侧“无法进仓库”的运维设置。
 *
 * 这些设置是 SSOT 的一部分，但只存在于 GitHub 控制台/API：
 * - main 分支保护与必需 check
 * - Actions 默认权限
 * - workflow 引用的 secrets 是否存在
 * - content/* 分支 ruleset 与 bot bypass
 *
 * 需要本机 `gh` 已登录，且账号有仓库 admin 读权限。
 * 默认人工运行；不要直接塞进 CI，除非另配一个有 admin:read 的 token。
 *
 * 用法：
 *   node scripts/check-github-settings.mjs
 *   node scripts/check-github-settings.mjs --json
 */

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 策略常量：改这里等于改“期望状态”，review 时可见。
const REQUIRED_CHECK = 'build-verify';
const REQUIRED_APPROVALS = 1;
const CONTENT_REF = 'refs/heads/content/**';

const results = [];

function pass(name, detail) {
  results.push({ level: 'PASS', name, detail });
}

function fail(name, detail) {
  results.push({ level: 'FAIL', name, detail });
}

function warn(name, detail) {
  results.push({ level: 'WARN', name, detail });
}

const TEMP_DIR = mkdtempSync(path.join(os.tmpdir(), 'gh-settings-'));
let tempSeq = 0;

/**
 * 用文件 fd 捕获 gh 输出，不用 pipe。
 * Windows 沙箱里 Node 的 pipe 会 EPERM；正常终端下两者都可。
 */
function gh(args) {
  const outFile = path.join(TEMP_DIR, `out-${tempSeq}.txt`);
  const errFile = path.join(TEMP_DIR, `err-${tempSeq}.txt`);
  tempSeq += 1;

  const outFd = openSync(outFile, 'w+');
  const errFd = openSync(errFile, 'w+');
  try {
    execFileSync('gh', args, {
      cwd: ROOT,
      stdio: ['ignore', outFd, errFd],
    });
    return readFileSync(outFile, 'utf8').trim();
  } catch (error) {
    const stderr = readFileSync(errFile, 'utf8').trim();
    const message = stderr || error.message;
    throw new Error(`gh ${args.join(' ')} 失败：${message}`);
  } finally {
    closeSync(outFd);
    closeSync(errFd);
    unlinkSync(outFile);
    unlinkSync(errFile);
  }
}

function ghJson(apiPath) {
  return JSON.parse(gh(['api', apiPath]));
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
}

function workflowFiles() {
  const dirs = ['.github/workflows', 'agent-src/.github/workflows'];
  const files = [];
  for (const dir of dirs) {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith('.yml') || name.endsWith('.yaml')) {
        files.push(path.join(ROOT, dir, name));
      }
    }
  }
  return files;
}

function referencedSecrets() {
  const names = new Set();
  for (const file of workflowFiles()) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*#/.test(line)) continue;
      for (const match of line.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        if (match[1] !== 'GITHUB_TOKEN') names.add(match[1]);
      }
    }
  }
  return names;
}

function checkBranchProtection(repo) {
  let protection;
  try {
    protection = ghJson(`repos/${repo}/branches/main/protection`);
  } catch (error) {
    fail('main 分支保护', String(error.message));
    return;
  }

  const checks = protection.required_status_checks;
  const contexts = checks?.contexts ?? [];
  if (contexts.includes(REQUIRED_CHECK)) {
    pass('main 必需 check', contexts.join(', '));
  } else {
    fail('main 必需 check', `缺少 ${REQUIRED_CHECK}，当前为 [${contexts.join(', ')}]`);
  }

  if (checks?.strict === true) {
    pass('main 要求分支最新', 'strict=true');
  } else {
    fail('main 要求分支最新', 'strict 未开启，PR 可能在过期 base 上合并');
  }

  if (protection.allow_force_pushes?.enabled === false) {
    pass('禁止 force push', 'main 不允许强推');
  } else {
    fail('禁止 force push', 'main 允许 force push');
  }

  if (protection.allow_deletions?.enabled === false) {
    pass('禁止删除分支', 'main 不允许删除');
  } else {
    fail('禁止删除分支', 'main 允许删除');
  }

  const reviews = protection.required_pull_request_reviews;
  if ((reviews?.required_approving_review_count ?? 0) >= REQUIRED_APPROVALS) {
    pass('PR 审批数', `${reviews.required_approving_review_count} 人`);
  } else {
    fail('PR 审批数', `当前为 ${reviews?.required_approving_review_count ?? 0}，期望 >= ${REQUIRED_APPROVALS}`);
  }

  if (reviews?.dismiss_stale_reviews === true) {
    pass('新提交废掉旧审批', 'dismiss_stale_reviews=true');
  } else {
    warn('新提交废掉旧审批', '未开启；新 push 不会自动废掉旧 approval');
  }

  if (protection.enforce_admins?.enabled === false) {
    warn('admin 绕过保护', 'enforce_admins=false：单人维护时有意保留的逃生口');
  } else {
    pass('admin 也受保护', 'enforce_admins=true');
  }
}

function checkActionsPermissions(repo) {
  let permissions;
  try {
    permissions = ghJson(`repos/${repo}/actions/permissions`);
  } catch (error) {
    fail('Actions 权限', String(error.message));
    return;
  }

  if (permissions.enabled === true) {
    pass('Actions 启用', 'enabled=true');
  } else {
    fail('Actions 启用', 'Actions 未启用');
  }

  let workflowPermissions;
  try {
    workflowPermissions = ghJson(`repos/${repo}/actions/permissions/workflow`);
  } catch (error) {
    fail('workflow 默认权限', String(error.message));
    return;
  }

  if (workflowPermissions.default_workflow_permissions === 'read') {
    pass('workflow 默认权限', 'read');
  } else {
    fail('workflow 默认权限', `当前为 ${workflowPermissions.default_workflow_permissions}，期望 read`);
  }

  if (workflowPermissions.can_approve_pull_request_reviews === false) {
    pass('workflow 不能自批 PR', 'can_approve_pull_request_reviews=false');
  } else {
    fail('workflow 不能自批 PR', 'workflow 可以 approve PR，存在自审风险');
  }
}

function checkSecrets(repo) {
  const referenced = referencedSecrets();
  let response;
  try {
    response = ghJson(`repos/${repo}/actions/secrets?per_page=100`);
  } catch (error) {
    fail('Actions secrets', String(error.message));
    return;
  }

  const existing = new Set((response.secrets ?? []).map((item) => item.name));
  const missing = [...referenced].filter((name) => !existing.has(name)).sort();
  const unused = [...existing].filter((name) => !referenced.has(name)).sort();

  if (missing.length === 0) {
    pass('workflow 引用的 secrets', `${referenced.size} 个全部存在`);
  } else {
    fail('workflow 引用的 secrets', `缺少 ${missing.join(', ')}`);
  }

  if (unused.length > 0) {
    warn('未被 workflow 引用的 secrets', unused.join(', '));
  }
}

function checkContentRuleset(repo) {
  let rulesets;
  try {
    rulesets = ghJson(`repos/${repo}/rulesets`);
  } catch (error) {
    fail('content/* ruleset', String(error.message));
    return;
  }

  const activeBranchRulesets = (rulesets ?? []).filter(
    (item) => item.target === 'branch' && item.enforcement === 'active',
  );

  let contentRuleset;
  for (const item of activeBranchRulesets) {
    let detail;
    try {
      detail = ghJson(`repos/${repo}/rulesets/${item.id}`);
    } catch {
      continue;
    }
    const includes = detail.conditions?.ref_name?.include ?? [];
    if (includes.includes(CONTENT_REF)) {
      contentRuleset = detail;
      break;
    }
  }

  if (!contentRuleset) {
    fail('content/* ruleset', `没有 active 的 branch ruleset 覆盖 ${CONTENT_REF}`);
    return;
  }

  const ruleTypes = new Set((contentRuleset.rules ?? []).map((rule) => rule.type));
  const requiredRules = ['creation', 'update', 'deletion'];
  const missingRules = requiredRules.filter((rule) => !ruleTypes.has(rule));
  if (missingRules.length === 0) {
    pass('content/* 限制规则', `覆盖 ${requiredRules.join('/')}`);
  } else {
    fail('content/* 限制规则', `缺少 ${missingRules.join(', ')}`);
  }

  const integrations = (contentRuleset.bypass_actors ?? []).filter(
    (actor) => actor.actor_type === 'Integration',
  );
  if (integrations.length > 0) {
    pass('content/* bot bypass', `Integration actor ${integrations.map((actor) => actor.actor_id).join(', ')}`);
  } else {
    fail('content/* bot bypass', '没有 Integration bypass，ops-submit 无法创建 content/* 分支');
  }
}

function main() {
  const repo = repoSlug();
  checkBranchProtection(repo);
  checkActionsPermissions(repo);
  checkSecrets(repo);
  checkContentRuleset(repo);

  const failed = results.filter((item) => item.level === 'FAIL').length;
  const warned = results.filter((item) => item.level === 'WARN').length;

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ repo, ok: failed === 0, results }, null, 2)}\n`);
  } else {
    console.log(`GitHub 设置检查：${repo}`);
    for (const item of results) {
      console.log(`  [${item.level}] ${item.name} — ${item.detail}`);
    }
    console.log(`\n${failed === 0 ? 'OK' : 'DRIFT'}：${results.length - failed - warned} pass，${warned} warn，${failed} fail`);
  }

  process.exitCode = failed === 0 ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`检查失败：${error.message}`);
  console.error('请确认 `gh auth status` 正常，且账号有仓库 admin 读权限。');
  process.exitCode = 2;
}

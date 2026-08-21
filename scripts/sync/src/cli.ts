/**
 * CLI 参数解析
 *
 * 用法:
 *   sync pr <number> [--dry-run] [--profile <name>]
 *   sync issue <number> [--dry-run] [--profile <name>]
 *   sync all [--dry-run] [--profile <name>]
 */

export type SyncCommand = 'pr' | 'issue' | 'all';

export interface SyncArgs {
  command: SyncCommand;
  number?: number;
  dryRun: boolean;
  profile: string;
  baseToken: string;
  prTableId: string;
  issueTableId: string;
}

export function parseArgs(argv: readonly string[]): SyncArgs {
  // 默认 command 是 'all'; 首个非 flag 参数会覆盖
  let command: SyncCommand = 'all';
  let number: number | undefined;
  let dryRun = false;
  let profile = process.env.LARK_PROFILE ?? 'ci-bot';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '') continue;
    switch (arg) {
      case 'pr':
      case 'issue':
      case 'all':
        command = arg;
        break;
      case '--number':
      case '-n':
        number = parsePositiveInt(argv[++i]);
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--profile':
      case '-p':
        profile = argv[++i] ?? profile;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        // 兼容 "pr 70" 形式
        if (/^\d+$/.test(arg)) {
          number = parsePositiveInt(arg);
        } else {
          throw new Error(`unknown argument: ${arg}`);
        }
    }
  }

  // command 是 pr/issue 时必须有 number
  if ((command === 'pr' || command === 'issue') && number === undefined) {
    throw new Error(`${command} 命令需要指定 number`);
  }

  return {
    command,
    number,
    dryRun,
    profile,
    baseToken: req('LARK_BASE_TOKEN'),
    prTableId: req('LARK_PR_TABLE_ID'),
    issueTableId: req('LARK_ISSUE_TABLE_ID'),
  };
}

function parsePositiveInt(s: string | undefined): number {
  if (!s) throw new Error('expected number after flag');
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid number: ${s}`);
  return n;
}

function req(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`未设置环境变量 ${name}`);
  }
  return v;
}

function printHelp(): void {
  console.log(`Usage:
  sync pr <number> [--dry-run] [--profile <name>]
  sync issue <number> [--dry-run] [--profile <name>]
  sync all [--dry-run] [--profile <name>]

Environment:
  LARK_PROFILE         lark-cli profile 名 (default: ci-bot)
  LARK_BASE_TOKEN      飞书多维表格 base token
  LARK_PR_TABLE_ID     PR 表 ID
  LARK_ISSUE_TABLE_ID  Issue 表 ID
`);
}

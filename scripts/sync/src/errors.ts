/**
 * 自定义错误类型
 *
 * 阶段 1: 定义
 * 阶段 2 起: 适配器在 catch 时抛出对应类型
 *
 * 错误类型层级:
 *   SyncError
 *   ├── NetworkError       lark-cli / gh CLI 网络/HTTP 失败
 *   ├── ScopeError         飞书 OAuth scope 不足
 *   ├── ConflictError      飞书侧并发冲突
 *   ├── AuthError          lark-cli profile 失效
 *   └── ValidationError    zod schema 校验失败
 */

export class SyncError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SyncError';
  }

  /** 红化输出 (排除凭据) */
  override toString(): string {
    const ctx = this.context ? ` ${JSON.stringify(this.context)}` : '';
    return `${this.name}: ${this.message}${ctx}`;
  }
}

export class NetworkError extends SyncError {
  constructor(message: string, cause?: unknown) {
    super(message, cause, { kind: 'network' });
    this.name = 'NetworkError';
  }
}

export class ScopeError extends SyncError {
  constructor(scope: string, cause?: unknown) {
    super(`missing scope: ${scope}`, cause, { kind: 'scope', scope });
    this.name = 'ScopeError';
  }
}

export class ConflictError extends SyncError {
  constructor(
    message: string,
    public readonly recordId: string,
    cause?: unknown,
  ) {
    super(message, cause, { kind: 'conflict', recordId });
    this.name = 'ConflictError';
  }
}

export class AuthError extends SyncError {
  constructor(profile: string, cause?: unknown) {
    super(`lark-cli profile "${profile}" auth failed`, cause, { kind: 'auth', profile });
    this.name = 'AuthError';
  }
}

export class ValidationError extends SyncError {
  constructor(
    public readonly schemaName: string,
    public readonly zodError: z.ZodError,
  ) {
    super(`schema "${schemaName}" validation failed`, zodError, {
      kind: 'validation',
      issues: zodError.issues,
    });
    this.name = 'ValidationError';
  }
}

// zod 是 type-only + 副作用接口, 不在这里 import 完整 zod
import type { z } from 'zod';

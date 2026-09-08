import type { CodexTransport } from './transport';
import type { CommandExecutionRequestApprovalResponse } from '../../../../runtime/generated/codex/v2/CommandExecutionRequestApprovalResponse';
import type { FileChangeRequestApprovalResponse } from '../../../../runtime/generated/codex/v2/FileChangeRequestApprovalResponse';

export interface ApprovalRequest {
  requestId: string | number;
  kind: 'command' | 'writeStdin' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  command: string | null;
  cwd: string | null;
  reason: string | null;
  environmentId: string | null;
  network: { host: string; protocol: string } | null;
  grantRoot: string | null;
}

export function parseApprovalRequest(message: Record<string, unknown>): ApprovalRequest {
  const command = message.method === 'item/commandExecution/requestApproval';
  if (!command && message.method !== 'item/fileChange/requestApproval') throw new Error('当前请求类型尚未支持，未自动批准');
  if ((typeof message.id !== 'string' && typeof message.id !== 'number') ||
      !message.params || typeof message.params !== 'object' || Array.isArray(message.params)) throw new Error('审批请求结构无效');
  const params = message.params as Record<string, unknown>;
  const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
  if (!identifier(params.threadId) || !identifier(params.turnId) || !identifier(params.itemId) ||
      !Number.isSafeInteger(params.startedAtMs) || Number(params.startedAtMs) < 0 ||
      (command && params.kind !== 'command' && params.kind !== 'writeStdin')) throw new Error('审批请求关联或类型无效');
  const optionalText = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error('审批说明格式无效');
    return value;
  };
  let network: ApprovalRequest['network'] = null;
  if (command && params.networkApprovalContext !== undefined && params.networkApprovalContext !== null) {
    const value = params.networkApprovalContext as Record<string, unknown>;
    if (typeof value !== 'object' || Array.isArray(value) || typeof value.host !== 'string' || typeof value.protocol !== 'string') throw new Error('审批网络说明格式无效');
    network = { host: value.host, protocol: value.protocol };
  }
  return { requestId: message.id, kind: command ? params.kind as 'command' | 'writeStdin' : 'fileChange',
    threadId: params.threadId, turnId: params.turnId, itemId: params.itemId, startedAtMs: Number(params.startedAtMs),
    command: command ? optionalText(params.command) : null, cwd: command ? optionalText(params.cwd) : null, reason: optionalText(params.reason),
    environmentId: command ? optionalText(params.environmentId) : null, network,
    // 仅保留上游请求的路径说明，不据此建立会话级授权或依赖该不稳定字段实现权限。
    grantRoot: command ? null : optionalText(params.grantRoot) };
}

export async function answerApproval(transport: CodexTransport, request: ApprovalRequest, decision: 'accept' | 'decline'): Promise<void> {
  if (decision !== 'accept' && decision !== 'decline') throw new Error('首版仅支持本次允许或拒绝');
  const response: CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse = { decision };
  await transport.respond(request.requestId, response);
}

import type { MessageItem, CommandItem, FileChangeItem, ExecutionPlan } from '../../../shared/contracts/execution';

export function parsePlanEvent(message: unknown): ExecutionPlan | null {
  if (!message || typeof message !== 'object' || !('method' in message) || message.method !== 'turn/plan/updated') return null;
  const value = ('params' in message ? message.params : null) as Partial<ExecutionPlan> | null;
  const id = (text: unknown): text is string => typeof text === 'string' && text.length > 0 && text.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(text);
  if (!value || Array.isArray(value) || !id(value.threadId) || !id(value.turnId) ||
    (value.explanation !== null && typeof value.explanation !== 'string') || !Array.isArray(value.plan)) throw new Error('计划事件结构或关联无效，需核对状态');
  const plan = value.plan.map(step => {
    if (!step || typeof step !== 'object' || typeof step.step !== 'string' || typeof step.status !== 'string' ||
      !['pending', 'inProgress', 'completed'].includes(step.status)) throw new Error('计划步骤无效，需核对状态');
    return { step: step.step, status: step.status };
  });
  return { threadId: value.threadId, turnId: value.turnId, explanation: value.explanation, plan };
}

interface MessageEvent {
  action: 'started' | 'delta' | 'completed';
  threadId: string;
  turnId: string;
  itemId: string;
  text: string;
  phase: MessageItem['phase'];
}

type CommandEvent = { action: 'delta'; threadId: string; turnId: string; itemId: string; output: string }
  | { action: 'snapshot'; threadId: string; turnId: string; itemId: string; item: CommandItem };

export function parseFileChangeEvent(message: unknown): FileChangeItem | null {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !('method' in message) ||
      (message.method !== 'item/started' && message.method !== 'item/completed' && message.method !== 'item/fileChange/patchUpdated')) return null;
  const params = 'params' in message ? message.params : null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('文件事件结构无效，需核对状态');
  const value = params as Record<string, unknown>;
  // 补丁修订只更新引擎报告的内容，不提供完成事实；终态仍来自对应执行项。
  const item = message.method === 'item/fileChange/patchUpdated'
    ? { type: 'fileChange', id: value.itemId, status: 'inProgress', changes: value.changes }
    : value.item && typeof value.item === 'object' && !Array.isArray(value.item) ? value.item as Record<string, unknown> : null;
  if (item?.type !== 'fileChange') return null;
  const validId = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(input);
  const { status, changes } = item;
  if (!validId(value.threadId) || !validId(value.turnId) || !validId(item.id) || !Array.isArray(changes) ||
      typeof status !== 'string' || !['inProgress', 'completed', 'failed', 'declined'].includes(status) ||
      (message.method === 'item/completed' && status === 'inProgress')) throw new Error('文件执行结果无效，需核对状态');
  const parsed = changes.map((change): FileChangeItem['changes'][number] => {
    if (!change || typeof change !== 'object' || Array.isArray(change) || typeof change.path !== 'string' ||
        typeof change.diff !== 'string' || !change.kind || typeof change.kind !== 'object' ||
        !['add', 'delete', 'update'].includes(change.kind.type) ||
        (change.kind.type === 'update' && change.kind.move_path !== null && typeof change.kind.move_path !== 'string')) throw new Error('文件变化内容无效，需核对状态');
    return { path: change.path, diff: change.diff, operation: change.kind.type, movePath: change.kind.type === 'update' ? change.kind.move_path : null };
  });
  return { kind: 'fileChange', threadId: value.threadId, turnId: value.turnId, itemId: item.id, changes: parsed,
    status: status === 'inProgress' ? 'running' : status as FileChangeItem['status'] };
}

export function parseCommandEvent(message: unknown): CommandEvent | null {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !('method' in message)) return null;
  const method = message.method;
  if (method !== 'item/started' && method !== 'item/completed' && method !== 'item/commandExecution/outputDelta') return null;
  const params = 'params' in message ? message.params : null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('命令事件结构无效，需核对状态');
  const value = params as Record<string, unknown>;
  const item = value.item && typeof value.item === 'object' && !Array.isArray(value.item) ? value.item as Record<string, unknown> : null;
  if (method !== 'item/commandExecution/outputDelta' && item?.type !== 'commandExecution') return null;
  const validId = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(input);
  const itemId = method === 'item/commandExecution/outputDelta' ? value.itemId : item!.id;
  if (!validId(value.threadId) || !validId(value.turnId) || !validId(itemId)) throw new Error('命令事件关联无效，需核对状态');
  const binding = { threadId: value.threadId, turnId: value.turnId, itemId };
  if (method === 'item/commandExecution/outputDelta') {
    if (typeof value.delta !== 'string') throw new Error('命令输出片段无效，需核对状态');
    return { ...binding, action: 'delta', output: value.delta };
  }
  const { command, cwd, aggregatedOutput, status, exitCode, durationMs } = item!;
  if (typeof command !== 'string' || typeof cwd !== 'string' ||
      (aggregatedOutput !== null && typeof aggregatedOutput !== 'string') ||
      (exitCode !== null && !Number.isSafeInteger(exitCode)) ||
      (durationMs !== null && (!Number.isSafeInteger(durationMs) || Number(durationMs) < 0)) ||
      typeof status !== 'string' || !['inProgress', 'completed', 'failed', 'declined'].includes(status) ||
      (method === 'item/completed' && status === 'inProgress')) throw new Error('命令执行结果无效，需核对状态');
  return { ...binding, action: 'snapshot', item: { ...binding, kind: 'command', command, directory: cwd,
    output: aggregatedOutput as string | null, exitCode: exitCode as number | null, durationMs: durationMs as number | null,
    status: status === 'inProgress' ? 'running' : status as CommandItem['status'] } };
}

// 仅提取固定协议中已采用的正文事件；其他通知由各自的状态/审批处理器处理。
export function parseMessageEvent(message: unknown): MessageEvent | null {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !('method' in message)) return null;
  const method = message.method;
  if (method !== 'item/started' && method !== 'item/completed' && method !== 'item/agentMessage/delta') return null;
  const params = 'params' in message ? message.params : null;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('正文事件结构无效，需核对状态');
  const value = params as Record<string, unknown>;
  const item = value.item && typeof value.item === 'object' && !Array.isArray(value.item) ? value.item as Record<string, unknown> : null;
  if (method !== 'item/agentMessage/delta') {
    if (!item || typeof item.type !== 'string') throw new Error('执行项结构无效，需核对状态');
    if (item.type !== 'agentMessage') return null;
  }
  const id = method === 'item/agentMessage/delta' ? value.itemId : item!.id;
  const text = method === 'item/agentMessage/delta' ? value.delta : item!.text;
  const phase = method === 'item/agentMessage/delta' ? null : item!.phase ?? null;
  const validId = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(input);
  if (!validId(value.threadId) || !validId(value.turnId) || !validId(id) || typeof text !== 'string' ||
      (phase !== null && phase !== 'commentary' && phase !== 'final_answer')) throw new Error('正文事件关联或内容无效，需核对状态');
  return { threadId: value.threadId, turnId: value.turnId, itemId: id, text, phase,
    action: method === 'item/agentMessage/delta' ? 'delta' : method === 'item/started' ? 'started' : 'completed' };
}

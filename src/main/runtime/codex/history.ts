import path from 'node:path';
import type { ThreadReadParams } from '../../../../runtime/generated/codex/v2/ThreadReadParams';
import type { HistoryItem, HistoryTurn } from '../../../shared/contracts/history';
import type { CodexTransport } from './transport';
import { parseCommandEvent, parseFileChangeEvent, parseMessageEvent } from './events';


function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史结构不兼容，无法读取');
  return value as Record<string, unknown>;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

export async function readThreadHistory(transport: CodexTransport, threadId: string, directory: string) {
  if (!identifier(threadId) || !path.isAbsolute(directory)) throw new Error('历史关联或项目目录无效');
  const params: ThreadReadParams = { threadId, includeTurns: true };
  const thread = record(record(await transport.call('thread/read', params)).thread);
  if (thread.id !== threadId || typeof thread.cwd !== 'string' || !path.isAbsolute(thread.cwd) ||
      path.normalize(thread.cwd) !== path.normalize(directory) || !Array.isArray(thread.turns)) {
    throw new Error('历史关联或项目目录不匹配，无法读取');
  }
  const turnIds = new Set<string>();
  const turns = thread.turns.map(rawTurn => {
    const turn = record(rawTurn);
    if (!identifier(turn.id) || turnIds.has(turn.id) || !Array.isArray(turn.items) || turn.itemsView !== 'full' ||
        typeof turn.status !== 'string' || !['completed', 'interrupted', 'failed', 'inProgress'].includes(turn.status)) {
      throw new Error('历史轮次不完整或状态不兼容，无法读取');
    }
    turnIds.add(turn.id);
    const items: HistoryItem[] = [];
    const unrepresentedItemTypes: string[] = [];
    const itemIds = new Set<string>();
    for (const rawItem of turn.items) {
      const item = record(rawItem);
      if (!identifier(item.id) || itemIds.has(item.id) || !identifier(item.type)) throw new Error('历史执行项关联无效，无法读取');
      itemIds.add(item.id);
      if (item.type === 'userMessage') {
        if (!Array.isArray(item.content)) throw new Error('历史用户消息结构无效，无法读取');
        const text: string[] = [];
        for (const rawContent of item.content) {
          const content = record(rawContent);
          if (!identifier(content.type)) throw new Error('历史用户消息内容无效，无法读取');
          if (content.type === 'text') {
            if (typeof content.text !== 'string') throw new Error('历史用户文本无效，无法读取');
            text.push(content.text);
          } else unrepresentedItemTypes.push(`userMessage/${content.type}`);
        }
        items.push({ kind: 'userMessage', threadId, turnId: turn.id, itemId: item.id, text: text.join('\n') });
        continue;
      }
      // 历史快照不是实时完成通知；保留命令尚无退出码的事实。
      const message = { method: 'item/started', params: { threadId, turnId: turn.id, item } };
      const agent = parseMessageEvent(message);
      const command = parseCommandEvent(message);
      const file = parseFileChangeEvent(message);
      if (agent) items.push({ kind: 'message', threadId, turnId: turn.id, itemId: agent.itemId,
        text: agent.text, phase: agent.phase, status: turn.status === 'inProgress' ? 'running' : 'completed' });
      else if (command?.action === 'snapshot') items.push(command.item);
      else if (file) items.push(file);
      else unrepresentedItemTypes.push(item.type);
    }
    return { turnId: turn.id, status: turn.status as HistoryTurn['status'], items, unrepresentedItemTypes };
  });
  return { threadId, turns };
}

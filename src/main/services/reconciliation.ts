import type { ReconciliationSnapshot } from '../../shared/contracts/reconciliation';
import { readWorkspace } from '../storage/projects';
import { readRuntimeLeases } from '../storage/runtime-leases';
import { readTaskSubmissionIntents } from '../storage/tasks';
import { readProcessIdentity, sameProcessIdentity } from '../lifecycle/process-identity';
import { prepareCodexHistoryConfiguration } from '../runtime/codex/configuration';
import { openCodex } from '../runtime/codex/process';
import { readThreadHistory } from '../runtime/codex/history';
import type { CodexTransport } from '../runtime/codex/transport';

// 仅核对产品关联、实际进程和公开历史；不重建执行、回答审批或释放资源占用。
export async function readReconciliation(root: string, resourcesDirectory: string, input: unknown,
  existingTransport?: CodexTransport): Promise<ReconciliationSnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
      !('taskId' in input) || typeof input.taskId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.taskId)) {
    throw new Error('状态核对请求无效，只接受产品任务标识');
  }
  const taskId = input.taskId;
  const metadata = () => ({ task: readWorkspace(root).tasks.find(task => task.taskId === taskId) ?? null,
    leases: readRuntimeLeases(root).filter(lease => lease.taskId === taskId), intents: readTaskSubmissionIntents(root, taskId) });
  const before = metadata();
  if (!before.task && !before.leases.length) throw new Error('任务或引擎归属记录不存在，无法核对');
  const result: ReconciliationSnapshot = { taskId, title: before.task?.title ?? '尚未完成派发的准备记录',
    observedAt: new Date().toISOString(), stale: false, intents: before.intents, processes: [], history: null,
    historyError: null, matchedTurnStatus: null, bindingIssue: null };
  for (const lease of before.leases) {
    const process: ReconciliationSnapshot['processes'][number] = { leaseId: lease.leaseId, operationId: lease.operationId,
      state: 'unavailable', background: lease.releasedAt ? 'released' : 'unverified', rootClosedAt: lease.rootClosedAt, error: null };
    if (lease.releasedAt) process.state = 'released';
    else {
      try {
        const current = await readProcessIdentity(lease.identity.pid);
        process.state = current === null ? 'notFound' : sameProcessIdentity(lease.identity, current) ? 'sameProcess' : 'pidReused';
      } catch (error) { process.error = error instanceof Error ? error.message : '进程身份查询失败，不能视为没有残留'; }
    }
    result.processes.push(process);
  }
  const task = before.task;
  if (!task?.threadId) result.historyError = '没有已确认的会话关联，不能猜测历史归属或重新发送原要求。';
  else {
    let runtime: Awaited<ReturnType<typeof openCodex>> | null = null;
    try {
      let transport = existingTransport;
      if (!transport) {
        const configuration = await prepareCodexHistoryConfiguration(root);
        runtime = await openCodex({ resourcesDirectory, workingDirectory: root, ...configuration }, {
          notification() {}, request() { throw new Error('只读核对意外请求执行权限'); }, disconnected() {},
        });
        transport = runtime.transport;
      }
      result.history = { taskId, ...await readThreadHistory(transport, task.threadId, task.directory) };
      if (!task.turnId || !before.intents.some(intent => intent.turnId === task.turnId)) {
        result.bindingIssue = '缺少精确轮次与发送意图的绑定；下方只是已读历史，不能据最后一轮认领本次执行。';
      } else {
        result.matchedTurnStatus = result.history.turns.find(turn => turn.turnId === task.turnId)?.status ?? null;
        if (!result.matchedTurnStatus) result.bindingIssue = '公开历史中没有产品记录绑定的轮次，不能当作本轮未执行。';
      }
    } catch (error) { result.historyError = error instanceof Error ? error.message : '公开历史读取失败，不能当作空历史'; }
    finally {
      try { await runtime?.close(); }
      catch (error) { result.historyError = [result.historyError, error instanceof Error ? error.message : '只读连接关闭未确认'].filter(Boolean).join('；'); }
    }
  }
  result.stale = JSON.stringify(metadata()) !== JSON.stringify(before);
  return result;
}

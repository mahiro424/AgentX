import type { TaskSummary } from '../../shared/contracts/projects';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { readWorkspace } from '../storage/projects';
import { captureWorkspace, captureGitState } from './workspace-results';
import { saveWorkspaceBaseline } from '../storage/results';
import { acquireRuntimeLease, markRuntimeWorkStarted, recordRuntimeClosed, readRuntimeLeases } from '../storage/runtime-leases';
import { beginTaskSubmission, beginTaskContinuation, markSubmissionDispatched, markSubmissionUncertain, bindSubmissionThread, acknowledgeSubmission, settleTaskTurn, beginTaskStop, updateApprovalWait, readSubmissionIntent } from '../storage/tasks';
import { parseApprovalRequest, answerApproval, type ApprovalRequest } from '../runtime/codex/approvals';
import { startThread, resumeThread, startTurn, interruptTurn, steerTurn, terminateBackgroundTerminals } from '../runtime/codex/execution';
import type { CodexTransport } from '../runtime/codex/transport';
import type { ModelService } from './models';
import { prepareCodexConfiguration, prepareCodexHistoryConfiguration } from '../runtime/codex/configuration';
import { openExecutionCodex, openCodex } from '../runtime/codex/process';
import { readThreadHistory } from '../runtime/codex/history';
import { readReconciliation } from './reconciliation';
import type { TaskHistory } from '../../shared/contracts/history';
import { FLASH_MODEL_ID } from '../../shared/contracts/models';
import type { ExecutionItem, ExecutionSnapshot, ExecutionControl, ExecutionPlan } from '../../shared/contracts/execution';
import { parseMessageEvent, parseCommandEvent, parseFileChangeEvent, parsePlanEvent } from '../runtime/codex/events';

// Main 单一拥有者；准备阶段也占用执行槽，不把异步解密/启动间隙当成可发送。
export class ExecutionService {
  private preparing = false;
  private error: string | null = null;
  private closing = false;
  private shutdownPending: Promise<void> | null = null;
  private stopPending: Promise<void> | null = null;
  private exitError: string | null = null;
  private preparationDone = Promise.resolve();
  private finishPreparation: (() => void) | null = null;
  private controlOperations = new Set<string>();
  private runtime: Awaited<ReturnType<typeof openExecutionCodex>> | null = null;
  private readonly instanceId = randomUUID();
  private runtimeLeaseId: string | null = null;
  private current: { taskId: string; operationId: string; session: FirstTurnSession } | null = null;
  private historyReads = new Set<Promise<unknown>>();

  constructor(private readonly root: string, private readonly resourcesDirectory: string,
    private readonly models: Pick<ModelService, 'captureExecution'>, private readonly onChange: () => void = () => {}) {}

  read(): ExecutionSnapshot {
    const plan = this.current?.session.readPlan();
    const intent = this.current ? readSubmissionIntent(this.root, this.current.operationId) : null;
    const reconciliationTaskIds = [...new Set(readRuntimeLeases(this.root).filter(lease => lease.releasedAt === null &&
      (lease.leaseId !== this.runtimeLeaseId || (!this.preparing && this.error !== null))).map(lease => lease.taskId))];
    if (intent && intent.taskId !== this.current?.taskId) throw new Error('发送意图归属不一致，请核对任务记录');
    return { preparing: this.preparing,
      task: this.current ? readWorkspace(this.root).tasks.find(task => task.taskId === this.current!.taskId) ?? null : null,
      operationId: this.current?.operationId ?? null, items: this.current?.session.readItems() ?? [],
      approvals: this.current?.session.readApprovals() ?? [], error: this.error, ...(plan ? { plan } : {}), ...(intent ? { inputText: intent.text } : {}),
      ...(reconciliationTaskIds.length ? { reconciliationTaskIds } : {}) };
  }

  async readHistory(input: unknown): Promise<TaskHistory> {
    return this.loadHistory(input, false);
  }

  // 搜索只读本实例仍绑定的活动轮；不放宽恢复/结果检查的已结束门禁。
  async readSearchHistory(input: unknown): Promise<TaskHistory> {
    return this.loadHistory(input, true);
  }

  private async loadHistory(input: unknown, allowCurrent: boolean): Promise<TaskHistory> {
    if (this.closing) throw new Error('应用正在退出，不能读取历史');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 ||
        !('taskId' in input) || typeof input.taskId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.taskId)) throw new Error('历史读取请求无效');
    const task = readWorkspace(this.root).tasks.find(value => value.taskId === input.taskId);
    if (!task) throw new Error('任务不存在，无法读取历史');
    const ended = ['completed', 'failed', 'interrupted'].includes(task.executionState);
    const current = allowCurrent && !this.preparing && !this.error && !!this.runtime &&
      this.current?.taskId === task.taskId && ['running', 'waitingApproval', 'waitingInput', 'stopping'].includes(task.executionState);
    if (!task.threadId || !task.turnId || (!ended && !current)) throw new Error('本阶段仅能读取已结束轮次或本实例绑定的活动轮；未决任务须先核对状态');
    const ownedRuntime = this.runtime;
    const ownedSession = this.current?.session;
    const load = async (): Promise<TaskHistory> => {
      const read = async (transport: CodexTransport) => {
        const history = await readThreadHistory(transport, task.threadId!, task.directory);
        const latest = history.turns.find(turn => turn.turnId === task.turnId);
        if (!latest) throw new Error('历史缺少产品记录的轮次，不能显示为空会话');
        if (ended ? latest.status !== task.executionState || history.turns.some(turn => turn.status === 'inProgress')
          : latest.status !== 'inProgress' || history.turns.some(turn => turn.status === 'inProgress' && turn.turnId !== task.turnId)) {
          throw new Error('历史与产品记录的轮次状态不一致，需核对；不会自动重发任务');
        }
        if (current) {
          const now = readWorkspace(this.root).tasks.find(value => value.taskId === task.taskId);
          if (this.runtime !== ownedRuntime || this.current?.session !== ownedSession || this.current?.taskId !== task.taskId || this.error || !now ||
              now.threadId !== task.threadId || now.turnId !== task.turnId || !['running', 'waitingApproval', 'waitingInput', 'stopping'].includes(now.executionState)) {
            throw new Error('读取期间活动轮绑定已变化，请重新核对');
          }
          // 公开历史可能滞后于输出事件；只为当前搜索投影补入同一 owner 的已验证可见项。
          // 用户项 ID 仍取自公开历史，不用发送意图伪造；结束历史不走此合并路径。
          const items = new Map(latest.items.map(item => [item.itemId, item]));
          for (const item of ownedSession!.readItems()) {
            if (item.threadId !== task.threadId || item.turnId !== task.turnId ||
                (items.has(item.itemId) && items.get(item.itemId)!.kind !== item.kind)) {
              throw new Error('活动搜索项来源不一致，请核对状态');
            }
            items.set(item.itemId, item);
          }
          latest.items = [...items.values()];
        }
        return { taskId: task.taskId, ...history };
      };
      if (this.runtime) return read(this.runtime.transport);
      const configuration = await prepareCodexHistoryConfiguration(this.root);
      const runtime = await openCodex({ resourcesDirectory: this.resourcesDirectory, workingDirectory: this.root, ...configuration }, {
        notification() {}, request() { throw new Error('只读历史意外请求执行权限'); }, disconnected() {},
      });
      try { return await read(runtime.transport); }
      finally { await runtime.close(); }
    };
    const pending = load();
    this.historyReads.add(pending);
    try { return await pending; }
    finally { this.historyReads.delete(pending); }
  }

  async readReconciliation(input: unknown) {
    if (this.closing || this.preparing) throw new Error('正在准备执行或退出，请等待当前操作结束后核对');
    const pending = readReconciliation(this.root, this.resourcesDirectory, input, this.runtime?.transport);
    this.historyReads.add(pending);
    try { return await pending; }
    finally { this.historyReads.delete(pending); }
  }

  private changed(): void {
    // 窗口通知失败不应中断引擎；错误仍在 Main 日志中可定位。
    try { this.onChange(); } catch { console.error('执行状态通知未送达，请重新读取当前快照'); }
  }

  private control(input: unknown): FirstTurnSession {
    const value = input as Partial<ExecutionControl> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
        typeof value.operationId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.operationId) ||
        typeof value.taskId !== 'string' || typeof value.threadId !== 'string' || typeof value.turnId !== 'string') throw new Error('执行控制请求无效');
    const snapshot = this.read();
    if (this.preparing || !this.current || !snapshot.task || snapshot.task.taskId !== value.taskId ||
        snapshot.task.threadId !== value.threadId || snapshot.task.turnId !== value.turnId ||
        !['running', 'waitingApproval', 'waitingInput'].includes(snapshot.task.executionState)) throw new Error('当前没有可控制的有效轮次');
    if (this.controlOperations.has(value.operationId) || readSubmissionIntent(this.root, value.operationId)) throw new Error('控制操作已使用，不会重复发送');
    this.controlOperations.add(value.operationId);
    return this.current.session;
  }

  async stop(input: unknown): Promise<void> {
    const session = this.control(input);
    return this.stopSession(session);
  }

  private async stopSession(session: FirstTurnSession): Promise<void> {
    const pending = session.stop();
    this.stopPending = pending;
    this.changed();
    try { await pending; }
    finally { if (this.stopPending === pending) this.stopPending = null; this.changed(); }
  }

  async steer(input: unknown): Promise<void> {
    if (this.closing) throw new Error('应用正在退出，不能补充要求；请保留输入');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 5 ||
        !('text' in input) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 200000 || input.text.includes('\0')) throw new Error('补充内容无效，请保留输入');
    const { text, ...control } = input;
    const session = this.control(control);
    try { const pending = session.steer(text); this.changed(); await pending; }
    finally { this.changed(); }
  }

  async answer(input: unknown): Promise<void> {
    if (this.closing) throw new Error('应用正在退出，不能提交审批');
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 6 ||
        !('approvalToken' in input) || typeof input.approvalToken !== 'string' || !input.approvalToken ||
        !('decision' in input) || (input.decision !== 'accept' && input.decision !== 'decline')) throw new Error('审批请求无效；仅支持本次允许或拒绝');
    const { approvalToken, decision, ...control } = input;
    const session = this.control(control);
    try { const pending = session.answer(approvalToken, decision); this.changed(); await pending; }
    finally { this.changed(); }
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(this.historyReads);
    await this.preparationDone;
    await this.closeOwnedRuntime(false);
  }

  private async closeOwnedRuntime(backgroundVerified: boolean): Promise<void> {
    if (!this.runtime) return;
    await this.runtime.close();
    if (this.runtimeLeaseId) {
      // 没有发送意图表示准备/只读恢复失败在任务派发之前，不为此永久占用执行槽。
      const noIntent = !!this.current && readSubmissionIntent(this.root, this.current.operationId) === null;
      recordRuntimeClosed(this.root, this.runtimeLeaseId, this.instanceId, backgroundVerified || noIntent);
      this.runtimeLeaseId = null;
    }
    this.runtime = null;
  }

  needsExitConfirmation(): boolean {
    return this.preparing || !!this.runtime || !!this.exitError || readRuntimeLeases(this.root).some(lease => lease.releasedAt === null) || readWorkspace(this.root).tasks.some(task =>
      !['idle', 'completed', 'failed', 'interrupted'].includes(task.executionState));
  }

  private assertNoUnownedRuntime(): void {
    if (readRuntimeLeases(this.root).some(lease => lease.releasedAt === null &&
        (lease.leaseId !== this.runtimeLeaseId || lease.instanceId !== this.instanceId))) {
      throw new Error('仍有先前引擎及后台回收待核对；不自动重发、清锁或结束未知进程');
    }
  }

  async prepareTaskArchive(taskId: string): Promise<void> {
    if (this.current?.taskId !== taskId || !this.runtime) return;
    if (this.closing || this.preparing || this.stopPending) throw new Error('会话正在准备、停止或退出，请完成核对后再归档');
    const task = this.read().task;
    if (!task?.threadId || !['completed', 'failed', 'interrupted', 'unconfirmed'].includes(task.executionState)) throw new Error('会话尚有活动执行，不能归档');
    this.preparing = true;
    this.preparationDone = new Promise(resolve => { this.finishPreparation = resolve; });
    this.changed();
    try {
      await Promise.allSettled(this.historyReads);
      // 空集合只核对列表，不发终止请求；归档不是用户授权的停止操作。
      const remaining = await terminateBackgroundTerminals(this.runtime.transport, task.threadId, new Set());
      if (remaining) throw new Error('会话仍有后台终端，请先停止或核对；归档不会自动终止命令');
      await this.closeOwnedRuntime(true);
    } finally {
      this.preparing = false; this.finishPreparation?.(); this.finishPreparation = null; this.changed();
    }
  }

  private async releaseCompletedRuntime(): Promise<void> {
    if (!this.runtime) return;
    if (this.current && readSubmissionIntent(this.root, this.current.operationId) === null) {
      await this.closeOwnedRuntime(false);
      return;
    }
    const task = this.read().task;
    if (!task?.threadId || !['completed', 'failed', 'interrupted'].includes(task.executionState)) {
      throw new Error('本实例轮次或引擎归属尚待核对，不能回收后派发新任务');
    }
    const remaining = await terminateBackgroundTerminals(this.runtime.transport, task.threadId,
      new Set(this.current!.session.readItems().filter(item => item.kind === 'command').map(item => item.itemId)));
    if (remaining) throw new Error('仍有后台终端归属未核实，未终止陌生命令，也未确认可退出');
    await this.closeOwnedRuntime(true);
  }

  // 仅在用户确认真正退出后调用。终态、后台回收、引擎退出三者均须完成。
  shutdown(): Promise<void> {
    if (this.shutdownPending) return this.shutdownPending;
    this.closing = true;
    const drain = async () => {
      await this.preparationDone;
      if (this.stopPending) await this.stopPending;
      this.assertNoUnownedRuntime();
      const task = this.read().task;
      if (task && ['running', 'waitingApproval', 'waitingInput'].includes(task.executionState)) {
        await this.stopSession(this.current!.session);
      }
      if (readWorkspace(this.root).tasks.some(value => !['idle', 'completed', 'failed', 'interrupted'].includes(value.executionState))) {
        throw new Error('仍有未决任务，尚未确认轮次与后台进程结束；保留记录，不自动重发或强制退出');
      }
      await Promise.allSettled(this.historyReads);
      await this.releaseCompletedRuntime();
      this.exitError = null;
    };
    const pending = drain().catch(error => {
      this.exitError = error instanceof Error ? error.message : '退出结果未确认，请核对任务与进程';
      this.error = this.exitError;
      this.closing = false;
      this.changed();
      throw error;
    }).finally(() => { this.shutdownPending = null; });
    this.shutdownPending = pending;
    return pending;
  }

  async start(input: unknown) { return this.submit(input, false); }

  async continue(input: unknown) { return this.submit(input, true); }

  private async submit(input: unknown, continuing: boolean) {
    if (this.closing) throw new Error('应用正在退出，不能发送任务');
    if (this.exitError) throw new Error(`退出核对尚未完成，不能发送新任务：${this.exitError}`);
    this.assertNoUnownedRuntime();
    const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== (continuing ? 8 : 6) ||
        !('taskId' in input) || !uuid(input.taskId) || !('operationId' in input) || !uuid(input.operationId) ||
        !('projectId' in input) || !uuid(input.projectId) || !('modelId' in input) || input.modelId !== FLASH_MODEL_ID ||
        !('configRevision' in input) || !Number.isSafeInteger(input.configRevision) || Number(input.configRevision) < 0 ||
        !('text' in input) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 200000 || input.text.includes('\0')) {
      throw new Error('发送请求无效；本阶段仅支持 Flash、已关联项目和纯文本');
    }
    const request = { taskId: input.taskId, operationId: input.operationId, projectId: input.projectId,
      text: input.text, configRevision: Number(input.configRevision) };
    const workspace = readWorkspace(this.root);
    const previous = continuing ? workspace.tasks.find(task => task.taskId === request.taskId) : undefined;
    if (previous?.archivedAt) throw new Error('会话已归档，请先显式恢复，不能自动执行');
    if (continuing && (!('threadId' in input) || !('expectedTurnId' in input) || !previous?.threadId || !previous.turnId ||
        previous.threadId !== input.threadId || previous.turnId !== input.expectedTurnId || previous.projectId !== request.projectId ||
        !['completed', 'failed', 'interrupted'].includes(previous.executionState))) throw new Error('原会话轮次已变化或尚未确认结束，请重读状态；不会自动重发');
    if (this.preparing || workspace.tasks.some(task => !['idle', 'completed', 'failed', 'interrupted', 'unconfirmed'].includes(task.executionState))) {
      throw new Error('存在准备中、活动或未决任务；不会排队或自动重发');
    }
    if ((!continuing && workspace.tasks.some(task => task.taskId === request.taskId)) || readSubmissionIntent(this.root, request.operationId)) throw new Error('任务或发送操作已使用，请读取原记录，不能重复发送');
    const project = workspace.projects.find(value => value.projectId === request.projectId);
    if (!project) throw new Error('项目未关联，未开始执行');
    this.preparing = true;
    this.preparationDone = new Promise(resolve => { this.finishPreparation = resolve; });
    this.error = null;
    this.changed();
    let openedForRequest = false;
    try {
      const snapshot = await this.models.captureExecution(request.configRevision);
      if (this.closing) throw new Error('应用正在退出，未开始执行');
      // 保存的路径必须仍指向用户原先关联的普通目录，不接受 Renderer 指定任意 cwd。
      if (await fs.realpath(project.directory) !== project.directory || !(await fs.stat(project.directory)).isDirectory()) throw new Error('项目目录已变化，未开始执行');
      const directory = await fs.opendir(project.directory); await directory.close();
      await Promise.allSettled(this.historyReads);
      await this.releaseCompletedRuntime();
      const configuration = await prepareCodexConfiguration(this.root, snapshot);
      const now = new Date().toISOString();
      const task: TaskSummary = previous ?? { taskId: request.taskId, projectId: project.projectId, directory: project.directory,
        title: request.text.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 120),
        lastActivityAt: now, observedAt: now, executionState: 'submitting', threadId: null, turnId: null };
      const intent = { operationId: request.operationId, text: request.text, modelId: snapshot.modelId,
        configRevision: snapshot.configRevision, credentialRef: snapshot.credentialRef };
      const session = new FirstTurnSession(this.root, task, intent);
      this.current = { taskId: task.taskId, operationId: intent.operationId, session };
      this.runtime = await openExecutionCodex({ resourcesDirectory: this.resourcesDirectory,
        workingDirectory: project.directory, ...configuration }, {
        notification: message => { session.notification(message); this.changed(); },
        request: message => { session.request(message); this.changed(); },
        disconnected: error => {
          session.disconnected();
          if (this.current?.session === session && this.read().task?.executionState === 'reconciling') this.error = error.message;
          this.changed();
        },
      });
      openedForRequest = true;
      const leaseId = randomUUID();
      acquireRuntimeLease(this.root, { leaseId, instanceId: this.instanceId, taskId: task.taskId,
        operationId: intent.operationId, projectId: task.projectId, identity: this.runtime.identity, createdAt: new Date().toISOString() });
      this.runtimeLeaseId = leaseId;
      if (this.closing) throw new Error('应用正在退出，未发送任务');
      const baseline = await captureWorkspace(project.directory);
      const git = await captureGitState(project.directory);
      await saveWorkspaceBaseline(this.root, { taskId: task.taskId, operationId: intent.operationId }, baseline, git);
      if (this.closing) throw new Error('应用正在退出，未发送任务');
      markRuntimeWorkStarted(this.root, leaseId, this.instanceId);
      await session.submit(this.runtime.transport);
      const saved = readWorkspace(this.root).tasks.find(value => value.taskId === task.taskId);
      if (!saved) throw new Error('提交后任务记录缺失，需核对状态');
      return saved;
    } catch (error) {
      this.error = error instanceof Error ? error.message : '执行失败，请核对状态';
      if (this.runtime && openedForRequest) {
        try { await this.closeOwnedRuntime(false); }
        catch (closeError) { throw new AggregateError([error, closeError], '执行准备或发送失败，且引擎回收未确认；禁止重发'); }
      }
      throw error;
    } finally { this.preparing = false; this.finishPreparation?.(); this.finishPreparation = null; this.changed(); }
  }
}

// Main 内部协调接缝。调用者负责准备冻结配置及专属已握手连接，并接收该连接的事件。
export async function submitFirstTurn(root: string, task: TaskSummary,
  intent: Parameters<typeof beginTaskSubmission>[2], transport: CodexTransport) {
  // 检查与落盘之间没有 await；Main 单一写入者不允许第二次提交穿过此占用检查。
  if (readWorkspace(root).tasks.some(value => !['idle', 'completed', 'failed', 'interrupted', 'unconfirmed'].includes(value.executionState))) {
    throw new Error('存在活动或未决任务，请先完成或核对；不会自动排队');
  }
  beginTaskSubmission(root, task, intent);
  markSubmissionDispatched(root, task.taskId, intent.operationId);
  try {
    const thread = await startThread(transport, task.directory);
    bindSubmissionThread(root, task.taskId, intent.operationId, thread.threadId);
    const turn = await startTurn(transport, thread.threadId, intent.text);
    acknowledgeSubmission(root, task.taskId, intent.operationId, thread.threadId, turn.turnId);
    return { ...thread, ...turn };
  } catch (cause) {
    try {
      const observedAt = new Date(Math.max(Date.now(), Date.parse(task.observedAt))).toISOString();
      markSubmissionUncertain(root, task.taskId, intent.operationId, observedAt);
    } catch (storageError) {
      throw new AggregateError([cause, storageError], '发送结果未知，且产品状态落盘失败；保留原记录，禁止重发');
    }
    throw cause;
  }
}

export async function submitNextTurn(root: string, previous: TaskSummary,
  intent: Parameters<typeof beginTaskSubmission>[2], transport: CodexTransport, onHistory: (turnIds: string[]) => void = () => {}) {
  if (!previous.threadId || !previous.turnId || !['completed', 'failed', 'interrupted'].includes(previous.executionState)) throw new Error('原轮次尚未结束');
  const history = await readThreadHistory(transport, previous.threadId, previous.directory);
  const latest = history.turns.at(-1);
  if (latest?.turnId !== previous.turnId || latest.status !== previous.executionState || history.turns.some(turn => turn.status === 'inProgress')) {
    throw new Error('原会话历史与产品轮次不一致，未开始新轮，请核对状态');
  }
  onHistory(history.turns.map(turn => turn.turnId));
  const thread = await resumeThread(transport, previous.threadId, previous.directory);
  if (readWorkspace(root).tasks.some(value => !['idle', 'completed', 'failed', 'interrupted', 'unconfirmed'].includes(value.executionState))) throw new Error('存在活动或未决任务，不会排队或自动重发');
  beginTaskContinuation(root, previous, intent);
  markSubmissionDispatched(root, previous.taskId, intent.operationId);
  try {
    const turn = await startTurn(transport, thread.threadId, intent.text);
    if (turn.turnId === previous.turnId) throw new Error('新轮应答复用了旧轮次，发送结果需要核对');
    acknowledgeSubmission(root, previous.taskId, intent.operationId, thread.threadId, turn.turnId);
    return { ...thread, ...turn };
  } catch (cause) {
    try { markSubmissionUncertain(root, previous.taskId, intent.operationId, new Date(Math.max(Date.now(), Date.parse(previous.observedAt))).toISOString()); }
    catch (storageError) { throw new AggregateError([cause, storageError], '续轮发送结果未知，且状态落盘失败；禁止重发'); }
    throw cause;
  }
}

// 由当前连接的通知回调调用；普通 RPC 应答不经过此入口。
export function observeTurnCompletion(root: string, taskId: string, operationId: string, message: unknown): boolean {
  const completion = parseCompletion(message);
  return completion ? settleTaskTurn(root, taskId, operationId, completion.threadId, completion.turnId, completion.state) : false;
}

function parseCompletion(message: unknown): { threadId: string; turnId: string; state: 'completed' | 'failed' | 'interrupted' } | null {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !('method' in message) || message.method !== 'turn/completed') return null;
  if (!('params' in message) || !message.params || typeof message.params !== 'object' || Array.isArray(message.params)) throw new Error('轮次终态通知结构无效，需核对状态');
  const params = message.params as Record<string, unknown>;
  if (typeof params.threadId !== 'string' || !params.threadId || !params.turn || typeof params.turn !== 'object' || Array.isArray(params.turn)) throw new Error('轮次终态关联无效，需核对状态');
  const turn = params.turn as Record<string, unknown>;
  if (typeof turn.id !== 'string' || !turn.id || (turn.status !== 'completed' && turn.status !== 'failed' && turn.status !== 'interrupted')) throw new Error('轮次终态值无效，需核对状态');
  return { threadId: params.threadId, turnId: turn.id, state: turn.status };
}

// 一个实例只属于一次提交和一个连接；重连不能复用其回调或缓冲。
export class FirstTurnSession {
  private previousTurnIds = new Set<string>();
  private stopCompletion: ((completion: ReturnType<typeof parseCompletion>) => void) | null = null;
  private plans = new Map<string, ExecutionPlan>();
  private items = new Map<string, ExecutionItem>();
  private ended = false;
  private approvals = new Map<string, { request: ApprovalRequest; status: 'pending' | 'responding' | 'resolved' | 'stale' }>();
  private started = false;
  private bound = false;
  private invalidated = false;
  private steering = false;
  private connection: CodexTransport | null = null;
  private binding: { threadId: string; turnId: string } | null = null;
  private pending: NonNullable<ReturnType<typeof parseCompletion>>[] = [];
  private readonly task: TaskSummary;
  private readonly intent: Parameters<typeof beginTaskSubmission>[2];

  constructor(private readonly root: string, task: TaskSummary, intent: Parameters<typeof beginTaskSubmission>[2]) {
    this.task = { ...task }; this.intent = { ...intent };
  }

  async submit(transport: CodexTransport) {
    if (this.started || this.invalidated) throw new Error('本次提交或连接已使用/失效，不可重复发送');
    this.started = true;
    this.connection = transport;
    try {
      const result = this.task.threadId
        ? await submitNextTurn(this.root, this.task, this.intent, transport, turnIds => { this.previousTurnIds = new Set(turnIds); })
        : await submitFirstTurn(this.root, this.task, this.intent, transport);
      this.bound = true;
      this.binding = { threadId: result.threadId, turnId: result.turnId };
      if (this.invalidated) {
        this.markUnknown();
        throw new Error('引擎连接已失效，任务需核对；不会自动重发');
      }
      for (const completion of this.pending) this.apply(completion);
      this.pending = [];
      this.syncApprovalWait();
      return result;
    } catch (error) {
      const needsReconciliation = this.bound && !this.invalidated;
      this.invalidated = true;
      this.pending = [];
      if (needsReconciliation) {
        try { this.markUnknown(); }
        catch (storageError) { throw new AggregateError([error, storageError], '轮次事件保存失败，且核对状态未能落盘；禁止重发'); }
      }
      throw error;
    }
  }

  notification(message: unknown): void {
    if (this.invalidated || !this.started) return;
    // 恢复时可能先收到历史项通知；新轮应答前也不能把旧 delta 当作新执行上下文。
    if (this.previousTurnIds.size && message && typeof message === 'object' && 'params' in message) {
      const params = message.params as { threadId?: unknown; turnId?: unknown; turn?: { id?: unknown } } | null;
      const turnId = params?.turnId ?? params?.turn?.id;
      if (params?.threadId === this.task.threadId && typeof turnId === 'string' && this.previousTurnIds.has(turnId)) return;
    }
    const planEvent = this.ended ? null : parsePlanEvent(message);
    if (planEvent && (!this.binding || (planEvent.threadId === this.binding.threadId && planEvent.turnId === this.binding.turnId))) {
      this.plans.set(JSON.stringify([planEvent.threadId, planEvent.turnId]), planEvent);
    }
    const textEvent = this.ended ? null : parseMessageEvent(message);
    if (textEvent && (!this.binding || (textEvent.threadId === this.binding.threadId && textEvent.turnId === this.binding.turnId))) {
      const key = JSON.stringify([textEvent.threadId, textEvent.turnId, textEvent.itemId]);
      const previous = this.items.get(key);
      if (previous && previous.kind !== 'message') throw new Error('同一执行项类型发生冲突，需核对状态');
      if (!previous || previous.status !== 'completed') {
        this.items.set(key, { kind: 'message', threadId: textEvent.threadId, turnId: textEvent.turnId, itemId: textEvent.itemId,
          text: textEvent.action === 'delta' ? (previous?.text ?? '') + textEvent.text : textEvent.text,
          phase: textEvent.action === 'delta' ? previous?.phase ?? null : textEvent.phase,
          status: textEvent.action === 'completed' ? 'completed' : 'running' });
      }
    }
    const commandEvent = this.ended ? null : parseCommandEvent(message);
    if (commandEvent && (!this.binding || (commandEvent.threadId === this.binding.threadId && commandEvent.turnId === this.binding.turnId))) {
      const key = JSON.stringify([commandEvent.threadId, commandEvent.turnId, commandEvent.itemId]);
      const previous = this.items.get(key);
      if (previous && previous.kind !== 'command') throw new Error('同一执行项类型发生冲突，需核对状态');
      if (!previous || previous.status === 'running') {
        if (commandEvent.action === 'snapshot') this.items.set(key, { ...commandEvent.item, output: commandEvent.item.output ?? previous?.output ?? null });
        else {
          if (!previous) throw new Error('命令输出缺少执行项上下文，需核对状态');
          this.items.set(key, { ...previous, output: (previous.output ?? '') + commandEvent.output });
        }
      }
    }
    const fileEvent = this.ended ? null : parseFileChangeEvent(message);
    if (fileEvent && (!this.binding || (fileEvent.threadId === this.binding.threadId && fileEvent.turnId === this.binding.turnId))) {
      const key = JSON.stringify([fileEvent.threadId, fileEvent.turnId, fileEvent.itemId]);
      const previous = this.items.get(key);
      if (previous && previous.kind !== 'fileChange') throw new Error('同一执行项类型发生冲突，需核对状态');
      if (!previous || previous.status === 'running') this.items.set(key, fileEvent);
    }
    if (message && typeof message === 'object' && 'method' in message && message.method === 'serverRequest/resolved') {
      const params = (message as { params?: { threadId?: unknown; requestId?: unknown } }).params;
      for (const entry of this.approvals.values()) {
        if (entry.request.threadId === params?.threadId && entry.request.requestId === params?.requestId && entry.status !== 'stale') entry.status = 'resolved';
      }
      this.syncApprovalWait();
      return;
    }
    const completion = parseCompletion(message);
    if (!completion) return;
    if (this.bound) this.apply(completion);
    else this.pending.push(completion);
  }

  request(message: Record<string, unknown>): void {
    if (this.invalidated || !this.started) return;
    const request = parseApprovalRequest(message);
    if ([...this.approvals.values()].some(entry => entry.request.requestId === request.requestId)) throw new Error('重复审批请求标识，需核对状态');
    const current = this.bound ? readWorkspace(this.root).tasks.find(value => value.taskId === this.task.taskId) : null;
    const stale = this.bound && (!this.matchesApproval(request) || !current || !['running', 'waitingApproval'].includes(current.executionState));
    this.approvals.set(randomUUID(), { request, status: stale ? 'stale' : 'pending' });
    this.syncApprovalWait();
  }

  readApprovals() {
    if (!this.binding) return [];
    return [...this.approvals].filter(([, entry]) => this.matchesApproval(entry.request)).map(([approvalToken, entry]) => {
      const { requestId: _requestId, ...details } = entry.request;
      return { ...details, network: details.network ? { ...details.network } : null, approvalToken,
        status: this.invalidated && (entry.status === 'pending' || entry.status === 'responding') ? 'stale' as const : entry.status };
    });
  }

  readItems(): ExecutionItem[] {
    if (!this.binding) return [];
    return [...this.items.values()].filter(item => item.threadId === this.binding!.threadId && item.turnId === this.binding!.turnId)
      .map(item => structuredClone(item));
  }

  readPlan(): ExecutionPlan | undefined {
    const plan = this.binding ? this.plans.get(JSON.stringify([this.binding.threadId, this.binding.turnId])) : undefined;
    return plan ? structuredClone(plan) : undefined;
  }

  async answer(approvalToken: string, decision: 'accept' | 'decline'): Promise<void> {
    const entry = this.approvals.get(approvalToken);
    if (this.invalidated || !this.connection || !this.bound || !entry || entry.status !== 'pending' || !this.matchesApproval(entry.request)) throw new Error('审批已失效或不属于当前轮次');
    if (decision !== 'accept' && decision !== 'decline') throw new Error('首版仅支持本次允许或拒绝');
    const task = readWorkspace(this.root).tasks.find(value => value.taskId === this.task.taskId);
    if (task?.executionState !== 'waitingApproval' || task.threadId !== entry.request.threadId || task.turnId !== entry.request.turnId) throw new Error('当前任务审批已失效，不能继续提交');
    entry.status = 'responding';
    try { await answerApproval(this.connection, entry.request, decision); }
    catch (error) {
      try { this.disconnected(); }
      catch (storageError) { throw new AggregateError([error, storageError], '审批应答结果未知，核对状态未能保存'); }
      throw error;
    }
  }

  private matchesApproval(request: ApprovalRequest): boolean {
    return request.threadId === this.binding?.threadId && request.turnId === this.binding?.turnId;
  }

  private syncApprovalWait(): void {
    if (!this.binding || this.invalidated) return;
    const waiting = [...this.approvals.values()].some(entry => this.matchesApproval(entry.request) && (entry.status === 'pending' || entry.status === 'responding'));
    updateApprovalWait(this.root, this.task.taskId, this.intent.operationId, this.binding.threadId, this.binding.turnId, waiting);
  }

  async stop(): Promise<void> {
    if (this.invalidated || !this.bound || !this.binding || !this.connection) throw new Error('尚无有效轮次或连接已失效，不能发送停止');
    const { threadId, turnId } = this.binding;
    beginTaskStop(this.root, this.task.taskId, this.intent.operationId, threadId, turnId);
    for (const entry of this.approvals.values()) if (entry.status === 'pending' || entry.status === 'responding') entry.status = 'stale';
    let resolveCompletion!: (completion: ReturnType<typeof parseCompletion>) => void;
    const completed = new Promise<ReturnType<typeof parseCompletion>>(resolve => { resolveCompletion = resolve; });
    this.stopCompletion = resolveCompletion;
    const timer = setTimeout(() => resolveCompletion(null), 30000);
    try {
      await interruptTurn(this.connection, threadId, turnId);
      const completion = await completed;
      if (!completion || this.invalidated) throw new Error('轮次停止尚未确认，需核对状态');
      await terminateBackgroundTerminals(this.connection, threadId, new Set(this.readItems().filter(item => item.kind === 'command').map(item => item.itemId)));
      if (this.invalidated) throw new Error('后台清理期间连接失效，需核对状态');
      this.stopCompletion = null;
      this.apply(completion);
    } catch (error) {
      try { this.disconnected(); }
      catch (storageError) { throw new AggregateError([error, storageError], '停止结果未知，且核对状态未能落盘；禁止重发'); }
      throw error;
    } finally { clearTimeout(timer); this.stopCompletion = null; }
  }

  async steer(text: string) {
    if (this.invalidated || !this.bound || !this.binding || !this.connection || this.steering) throw new Error('当前连接或补充请求尚不可用，请保留输入');
    const task = readWorkspace(this.root).tasks.find(value => value.taskId === this.task.taskId);
    if (!task || task.threadId !== this.binding.threadId || task.turnId !== this.binding.turnId ||
        !['running', 'waitingApproval', 'waitingInput'].includes(task.executionState)) throw new Error('当前轮次不接受补充，请保留输入；不会新建轮次');
    this.steering = true;
    try {
      const result = await steerTurn(this.connection, this.binding.threadId, this.binding.turnId, text);
      if (this.invalidated) throw new Error('连接已失效，补充接收结果需核对；请保留输入');
      return result;
    } finally { this.steering = false; }
  }

  disconnected(): void {
    if (this.invalidated) return;
    this.invalidated = true;
    this.stopCompletion?.(null);
    this.pending = [];
    // 未决 RPC 的失败由 submitFirstTurn 落盘；已确认轮次则在此失效。
    if (this.bound) this.markUnknown();
  }

  private apply(completion: NonNullable<ReturnType<typeof parseCompletion>>): void {
    if (this.stopCompletion && this.binding?.threadId === completion.threadId && this.binding.turnId === completion.turnId) {
      this.stopCompletion(completion);
      return;
    }
    if (settleTaskTurn(this.root, this.task.taskId, this.intent.operationId, completion.threadId, completion.turnId, completion.state)) {
      this.ended = true;
      for (const entry of this.approvals.values()) if (entry.status === 'pending' || entry.status === 'responding') entry.status = 'stale';
    }
  }

  private markUnknown(): void {
    const task = readWorkspace(this.root).tasks.find(value => value.taskId === this.task.taskId);
    if (!task) throw new Error('执行任务记录缺失，无法保存核对状态');
    if (['completed', 'failed', 'interrupted'].includes(task.executionState)) return;
    markSubmissionUncertain(this.root, task.taskId, this.intent.operationId,
      new Date(Math.max(Date.now(), Date.parse(task.observedAt))).toISOString());
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import type { TaskResults } from '../../shared/contracts/results';
import type { TaskSummary } from '../../shared/contracts/projects';
import { readWorkspace } from '../storage/projects';
import { readTurnOperation, readSubmissionIntent } from '../storage/tasks';
import { listArtifacts, readArtifact, saveArtifact, type ArtifactRecord } from '../storage/artifacts';
import { readWorkspaceBaseline } from '../storage/results';
import { captureWorkspace, compareWorkspaceSnapshots } from './workspace-results';

export async function readTaskResults(root: string, input: unknown): Promise<TaskResults> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 ||
      !('taskId' in input) || typeof input.taskId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.taskId) ||
      !('turnId' in input) || typeof input.turnId !== 'string' || !input.turnId || input.turnId.length > 512 || /[\u0000-\u001f\u007f]/u.test(input.turnId)) throw new Error('结果读取请求无效');
  const task = readWorkspace(root).tasks.find(value => value.taskId === input.taskId);
  if (!task) throw new Error('任务不存在，无法检查结果');
  if (!task.threadId || task.turnId !== input.turnId || !['completed', 'failed', 'interrupted'].includes(task.executionState)) throw new Error('仅能检查已结束的匹配轮次；未决任务须先核对');
  const operationId = readTurnOperation(root, task.taskId, input.turnId);
  if (!operationId) throw new Error('本轮没有已确认的基线关联，不能用当前文件补造原始内容');
  let baseline;
  try { baseline = await readWorkspaceBaseline(root, { taskId: task.taskId, operationId }); }
  catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('本轮基线缺失，不能将结果显示为没有变化');
    throw cause;
  }
  if (baseline.snapshot.directory !== task.directory) throw new Error('基线与会话目录不一致，未进行比较');
  if (await fs.realpath(task.directory) !== task.directory) throw new Error('项目目录已变化，未读取替代位置');
  const after = await captureWorkspace(task.directory);
  const current = readWorkspace(root).tasks.find(value => value.taskId === task.taskId);
  if (current?.turnId !== task.turnId || current.executionState !== task.executionState) throw new Error('检查期间轮次状态已变化，请重新核对');
  const compared = compareWorkspaceSnapshots(baseline.snapshot, after);
  for (const change of compared.changes) {
    const file = change.after;
    if (!file || file.text === null || !['.txt', '.md', '.markdown'].includes(path.extname(file.path).toLowerCase())) continue;
    await saveArtifact(root, { taskId: task.taskId, threadId: task.threadId, turnId: input.turnId, operationId,
      directory: task.directory, path: file.path, sha256: file.sha256, size: file.size, observedAt: after.capturedAt });
  }
  const artifacts = await listArtifacts(root, task.taskId);
  for (const artifact of artifacts) requireArtifactBinding(root, task, artifact);
  const latest = readWorkspace(root).tasks.find(value => value.taskId === task.taskId);
  if (latest?.turnId !== task.turnId || latest.executionState !== task.executionState) throw new Error('检查期间轮次状态已变化，请重新核对');
  return { taskId: task.taskId, threadId: task.threadId, turnId: input.turnId, operationId, directory: task.directory,
    executionState: task.executionState as TaskResults['executionState'], baselineAt: baseline.snapshot.capturedAt, observedAt: after.capturedAt,
    ...compared, artifacts: artifacts.map(({ version: _version, directory: _directory, ...reference }) => reference), excludedNames: after.excludedNames, baselineGit: baseline.git };
}

function requireArtifactBinding(root: string, task: TaskSummary, value: ArtifactRecord) {
  const intent = readSubmissionIntent(root, value.operationId);
  if (task.taskId !== value.taskId || task.threadId !== value.threadId || task.directory !== value.directory ||
    readTurnOperation(root, task.taskId, value.turnId) !== value.operationId || intent?.taskId !== task.taskId || intent.phase !== 'settled') {
    throw new Error('产物引用与已确认轮次不匹配，未读取文件');
  }
}

export async function readTaskArtifact(root: string, taskId: string, resultId: string) {
  const task = readWorkspace(root).tasks.find(value => value.taskId === taskId);
  if (!task) throw new Error('产物所属任务不存在');
  let value: ArtifactRecord;
  try { value = await readArtifact(root, taskId, resultId); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('结果引用缺失，无法核对产物来源'); throw cause; }
  requireArtifactBinding(root, task, value);
  if (await fs.realpath(task.directory) !== task.directory) throw new Error('产物工作目录已变化，未读取替代位置');
  return value;
}

import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { TaskHistory, HistoryItem } from '../../shared/contracts/history';
import type { TaskSummary } from '../../shared/contracts/projects';
import type { TaskSearchRequest, TaskSearchSnapshot, TaskSearchResult, SearchSnippet, TaskSearchTarget, TaskSearchLocation, SearchIndexState } from '../../shared/contracts/search';
import { readWorkspace } from '../storage/projects';
import { tasksWithMaterialInputs } from '../storage/materials';
import { readSearchText, readSearchCoverage, replaceSearchTask, markSearchUnavailable, hasSearchSource, validateSearchCache, preserveDamagedSearchCache, type SearchTextRecord } from '../storage/search';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const taskRevision = (task: TaskSummary) => hash(JSON.stringify([task.threadId, task.turnId, task.executionState, task.observedAt]));
// 与 SQLite 内置 lower 一致；中文与标点保留，范围坐标使用 JS 的 UTF-16 单位。
const fold = (text: string) => text.replace(/[A-Z]/g, value => value.toLowerCase());
function matchCount(text: string, query: string): number {
  if (!query) return 0;
  const value = fold(text), needle = fold(query);
  let count = 0, offset = 0;
  while ((offset = value.indexOf(needle, offset)) !== -1) { count++; offset += needle.length; }
  return count;
}

// 搜索投影额外排除可识别的凭据；不读取/解密设置，也不更改引擎保存的原始历史。
function redactSearchText(text: string): string {
  return text.replace(/\b(?:ctx7sk|sk)-[A-Za-z0-9_-]{12,}\b/g, '[凭据已隐藏]')
    .replace(/\b(?:proxy-authorization|authorization|set-cookie|cookie)\s*:\s*[^\r\n]+/gi, '[认证信息已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, '[凭据已隐藏]')
    .replace(/("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[凭据已隐藏]');
}

function parseRequest(input: unknown): TaskSearchRequest {
  const value = input as Partial<TaskSearchRequest> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
    typeof value.query !== 'string' || value.query.length > 500 || /[\u0000-\u001f\u007f]/u.test(value.query) ||
    !['all', 'title', 'body'].includes(value.scope ?? '') || typeof value.includeArchived !== 'boolean' ||
    (value.projectId !== null && (typeof value.projectId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.projectId)))) {
    throw new Error('会话搜索请求无效，请检查查询与筛选条件');
  }
  return { ...value, query: value.query.trim() } as TaskSearchRequest;
}

function snippet(text: string, query: string): SearchSnippet {
  const position = fold(text).indexOf(fold(query));
  let start = Math.max(0, position - 64), end = Math.min(text.length, Math.max(start + 240, position + query.length));
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start])) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end])) end++;
  const prefix = start > 0 ? '…' : '';
  const visible = prefix + text.slice(start, end) + (end < text.length ? '…' : '');
  const folded = fold(visible), needle = fold(query), ranges: [number, number][] = [];
  for (let offset = prefix.length; offset < visible.length;) {
    const match = folded.indexOf(needle, offset);
    if (match < 0 || match + query.length > prefix.length + end - start) break;
    ranges.push([match, match + query.length]); offset = match + query.length;
  }
  return { text: visible, ranges };
}

function visibleText(item: HistoryItem): string {
  switch (item.kind) {
    case 'userMessage': case 'message': return item.text;
    case 'command': return [item.command, item.directory, item.output ?? ''].join('\n');
    case 'fileChange': return item.changes.map(change => [change.path, change.operation, change.movePath ?? '', change.diff].join('\n')).join('\n');
  }
}

export class TaskSearchService {
  private pending: Promise<void> | null = null;
  private paused = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshQueue = new Set<string>();
  private attempted = new Map<string, string>();
  private indexState: SearchIndexState = { running: false, processed: 0, total: 0, error: null };
  constructor(private readonly root: string, private readonly readHistory: (request: { taskId: string }) => Promise<TaskHistory>, private readonly onChange: () => void = () => {}) {}

  getIndexState(): SearchIndexState { return { ...this.indexState }; }
  ensureIndex(): void {
    if (this.paused) return;
    try {
      const coverage = new Map(readSearchCoverage(this.root).map(value => [value.taskId, value]));
      for (const task of readWorkspace(this.root).tasks) {
        const prior = coverage.get(task.taskId), revision = taskRevision(task);
        if ((!prior?.indexedAt || prior.taskRevision !== revision) && this.attempted.get(task.taskId) !== revision) {
          this.attempted.set(task.taskId, revision); this.refreshTask(task.taskId);
        }
      }
    } catch (cause) { this.reportIndexError(cause); }
  }
  refreshTask(taskId: string): void {
    if (this.paused) return;
    this.refreshQueue.add(taskId); this.scheduleRefresh();
  }
  private reportIndexError(cause: unknown): void {
    const message = redactSearchText(cause instanceof Error ? cause.message : '索引更新失败').slice(0, 1000);
    if (this.indexState.error !== message) { this.indexState.error = message; this.onChange(); }
  }
  private scheduleRefresh(): void {
    if (this.paused || this.pending || this.refreshTimer || !this.refreshQueue.size) return;
    // 合并流式通知；只读索引工作串行执行，不按 token 启动历史进程或模型轮次。
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      const taskIds = new Set(this.refreshQueue); this.refreshQueue.clear();
      void this.startRebuild(taskIds).catch(cause => this.reportIndexError(cause));
    }, 1000);
  }
  async pause(): Promise<void> {
    this.paused = true;
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    this.refreshQueue.clear();
    try { await this.pending; }
    catch (cause) {
      // 索引错误不伪装成功，也不阻止执行引擎退出；错误保留在独立状态供退出失败后查看。
      this.indexState.error = redactSearchText(cause instanceof Error ? cause.message : '索引失败，未完成重建').slice(0, 1000);
    }
  }
  resume(): void { this.paused = false; }
  rebuild(): Promise<void> {
    if (!this.pending) {
      if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
      this.refreshQueue.clear();
    }
    return this.startRebuild();
  }
  private startRebuild(taskIds?: Set<string>): Promise<void> {
    if (this.paused) return Promise.reject(new Error('应用正在退出，索引已暂停'));
    if (this.pending) return this.pending;
    this.indexState = { running: true, processed: 0, total: 0, error: null };
    const pending = this.runRebuild(taskIds).catch(cause => {
      this.indexState.error = redactSearchText(cause instanceof Error ? cause.message : '重建索引失败').slice(0, 1000);
      throw new Error(this.indexState.error);
    }).finally(() => {
      this.pending = null; this.indexState.running = false; this.onChange(); this.scheduleRefresh();
    });
    this.pending = pending; return pending;
  }

  async locate(input: unknown): Promise<TaskSearchLocation> {
    const value = input as Partial<TaskSearchTarget> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5 ||
      typeof value.taskId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.taskId) ||
      typeof value.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceRevision) ||
      [value.threadId, value.turnId, value.itemId].some(id => typeof id !== 'string' || !id.trim() || id.length > 512 || /[\u0000-\u001f\u007f]/u.test(id))) {
      throw new Error('搜索命中定位请求无效');
    }
    const target = value as TaskSearchTarget;
    const task = readWorkspace(this.root).tasks.find(task => task.taskId === target.taskId);
    if (!task || task.threadId !== target.threadId || !hasSearchSource(this.root, target)) throw new Error('搜索命中来源已失效或任务不匹配，请重新查询');
    try {
      const history = await this.readHistory({ taskId: task.taskId });
      const turn = history.turns.find(turn => turn.turnId === target.turnId);
      const item = turn?.items.find(item => item.itemId === target.itemId && item.threadId === target.threadId && item.turnId === target.turnId);
      if (history.taskId !== task.taskId || history.threadId !== target.threadId || !item) throw new Error('原历史缺少命中项，不能定位；请重试核对来源');
      if (tasksWithMaterialInputs(this.root).has(task.taskId) && item.kind !== 'userMessage') throw new Error('材料相关回复与工具正文不自动索引，请在原会话中阅读');
      if (hash(JSON.stringify([item.kind, redactSearchText(visibleText(item))])) !== target.sourceRevision) throw new Error('原历史命中内容已变化，请重建索引后重新查询');
      const current = readWorkspace(this.root).tasks.find(value => value.taskId === task.taskId);
      if (!current || taskRevision(current) !== taskRevision(task)) throw new Error('定位期间会话已变化，请重新核对来源');
      return { taskId: task.taskId, history, source: { threadId: target.threadId, turnId: target.turnId,
        itemId: target.itemId, sourceRevision: target.sourceRevision } };
    } catch (cause) {
      const error = redactSearchText(cause instanceof Error ? cause.message : '原历史读取失败，不能定位命中项').slice(0, 1000);
      markSearchUnavailable(this.root, task.taskId, taskRevision(task), error);
      throw new Error(error);
    }
  }

  async query(input: unknown): Promise<TaskSearchSnapshot> {
    const request = parseRequest(input), workspace = readWorkspace(this.root);
    const tasks = workspace.tasks.filter(task => (request.includeArchived || task.archivedAt === null) &&
      (request.projectId === null || task.projectId === request.projectId));
    const coverage = new Map(readSearchCoverage(this.root).map(value => [value.taskId, value]));
    const bodies = new Map<string, SearchTextRecord & { ordinal: number }>();
    const relevance = new Map<string, number>();
    if (request.query && request.scope !== 'title') {
      const taskIds = new Set(tasks.map(task => task.taskId));
      const materialTasks = tasksWithMaterialInputs(this.root);
      for await (const batch of readSearchText(this.root)) for (const item of batch) {
        if (!taskIds.has(item.taskId)) continue;
        if (materialTasks.has(item.taskId) && item.kind !== 'userMessage') continue;
        const count = matchCount(item.visibleText, request.query);
        if (!count) continue;
        if (!bodies.has(item.taskId) || bodies.get(item.taskId)!.ordinal > item.ordinal) bodies.set(item.taskId, item);
        relevance.set(item.taskId, (relevance.get(item.taskId) ?? 0) + count);
      }
    }
    const results: TaskSearchResult[] = [];
    for (const task of tasks) {
      const title = redactSearchText(task.title);
      const titleMatch = request.query && request.scope !== 'body' && fold(title).includes(fold(request.query));
      if (titleMatch) relevance.set(task.taskId, (relevance.get(task.taskId) ?? 0) + matchCount(title, request.query));
      const body = bodies.get(task.taskId);
      if (request.query && !titleMatch && !body) continue;
      results.push({ taskId: task.taskId, title, projectId: task.projectId,
        projectName: workspace.projects.find(project => project.projectId === task.projectId)?.displayName ?? '未关联项目',
        lastActivityAt: task.lastActivityAt, archived: task.archivedAt !== null,
        match: !request.query ? 'recent' : titleMatch ? 'title' : 'body',
        snippet: request.query ? snippet(titleMatch ? title : body!.visibleText, request.query) : null,
        source: body && !titleMatch ? { threadId: body.threadId, turnId: body.turnId, itemId: body.itemId, sourceRevision: body.sourceRevision } : null,
        sourceError: body && !titleMatch ? coverage.get(task.taskId)?.error ?? null : null });
    }
    // 字面命中次数是首版可复现的相关度，不引入模型或语义搜索。
    results.sort((a, b) => Number(b.match === 'title') - Number(a.match === 'title') || (relevance.get(b.taskId) ?? 0) - (relevance.get(a.taskId) ?? 0) ||
      b.lastActivityAt.localeCompare(a.lastActivityAt) || a.taskId.localeCompare(b.taskId));
    const issues = tasks.filter(task => !coverage.get(task.taskId)?.indexedAt || coverage.get(task.taskId)?.error ||
      coverage.get(task.taskId)?.partialReason || coverage.get(task.taskId)?.taskRevision !== taskRevision(task))
      .map(task => ({ taskId: task.taskId, title: redactSearchText(task.title), reason: coverage.get(task.taskId)?.error ??
        coverage.get(task.taskId)?.partialReason ?? '部分历史尚未可搜索，请重试建立索引' }));
    return { results, coverage: { totalTasks: tasks.length, coveredTasks: tasks.length - issues.length, issues } };
  }

  private async runRebuild(taskIds?: Set<string>): Promise<void> {
    validateSearchCache(this.root);
    if (!taskIds && preserveDamagedSearchCache(this.root)) this.indexState.notice = '损坏索引已保留在缓存目录；重建覆盖情况见下方，不改变会话与原文件。';
    const tasks = readWorkspace(this.root).tasks.filter(task => !taskIds || taskIds.has(task.taskId));
    this.indexState.total = tasks.length; this.onChange();
    for (const task of tasks) {
      if (this.paused) { this.indexState.error = '索引已暂停，剩余历史未完成重建'; break; }
      this.attempted.set(task.taskId, taskRevision(task));
      const items: SearchTextRecord[] = [];
      let partialReason: string | null = null;
      try {
        if (!task.threadId && task.executionState !== 'idle') throw new Error('会话尚无可核验的历史绑定，不能标记为已覆盖');
        if (task.threadId) {
          const history = await this.readHistory({ taskId: task.taskId });
          const materialBound = tasksWithMaterialInputs(this.root).has(task.taskId);
          if (history.taskId !== task.taskId || history.threadId !== task.threadId) throw new Error('索引历史归属不一致，保留原索引');
          const unsupported = [...new Set(history.turns.flatMap(turn => turn.unrepresentedItemTypes).filter(type => type !== 'reasoning'))];
          if (unsupported.length) partialReason = `部分可见历史类型尚不支持搜索：${redactSearchText(unsupported.join('、')).slice(0, 500)}`;
          if (materialBound) partialReason = '含材料会话仅索引标题与用户要求；材料相关回复和工具正文不自动进入索引';
          for (const turn of history.turns) for (const item of turn.items) {
            if (item.threadId !== history.threadId || item.turnId !== turn.turnId) throw new Error('索引历史项归属不一致，保留原索引');
            if (materialBound && item.kind !== 'userMessage') continue;
            const text = redactSearchText(visibleText(item));
            items.push({ taskId: task.taskId, threadId: item.threadId, turnId: item.turnId, itemId: item.itemId,
              kind: item.kind, visibleText: text, sourceRevision: hash(JSON.stringify([item.kind, text])) });
          }
        }
        const current = readWorkspace(this.root).tasks.find(value => value.taskId === task.taskId);
        if (!current || taskRevision(current) !== taskRevision(task)) throw new Error('索引期间会话已变化，请重新核对；保留原索引');
      } catch (cause) {
        markSearchUnavailable(this.root, task.taskId, taskRevision(task), redactSearchText(cause instanceof Error ? cause.message : '原历史读取失败，不能核验命中来源').slice(0, 1000));
        this.indexState.processed++; this.onChange();
        await setImmediate(); continue;
      }
      replaceSearchTask(this.root, { taskId: task.taskId, taskRevision: taskRevision(task), indexedAt: new Date().toISOString(), error: null, partialReason }, items);
      this.indexState.processed++; this.onChange();
      await setImmediate();
    }
  }
}

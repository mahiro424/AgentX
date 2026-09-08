// 手动触发的真实产品验收，不属于 npm test；不替换执行、模型或存储接口。
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { launch } = require('../tests/desktop/helpers.cjs');
let stage = '检查显式 --live 参数和进程环境密钥';

async function main() {
  if (!process.argv.includes('--live')) throw new Error('必须显式传入 --live 才会调用真实模型');
  let apiKey = process.env.AGENTX_LIVE_DEEPSEEK_KEY;
  delete process.env.AGENTX_LIVE_DEEPSEEK_KEY;
  if (process.argv.includes('--prompt-key')) {
    // Windows PowerShell 5 的 -File 默认编码不能可靠读取 UTF-8 无 BOM 的中文脚本。
    const dialogPath = path.join(__dirname, 'm1-live-key-dialog.ps1').replace(/'/g, "''");
    const command = `& ([scriptblock]::Create([IO.File]::ReadAllText('${dialogPath}', [Text.Encoding]::UTF8)))`;
    const response = await promisify(execFile)('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 600000, maxBuffer: 16384 });
    const entry = JSON.parse(response.stdout);
    if (entry.cancelled) { console.log('已取消本次验收，未调用模型。'); return; }
    apiKey = entry.apiKey;
  }
  if (!apiKey?.trim()) throw new Error('请通过当前进程环境变量 AGENTX_LIVE_DEEPSEEK_KEY 提供密钥，不要写进脚本');
  const model = 'deepseek-v4-flash';
  const stopScenario = process.argv.includes('--stop');
  const denyScenario = process.argv.includes('--deny');
  const allowScenario = process.argv.includes('--allow');
  const steerScenario = process.argv.includes('--steer');
  // 固定版本实测审批展示的是带 shell 的完整命令；只匹配这一个脚本，不做子串放行。
  const observedShell = path.join(require('node:os').homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', 'pwsh.exe');
  const approvalCommands = ['node approval.cjs', 'node .\\approval.cjs', 'node ./approval.cjs', `${JSON.stringify(observedShell)} -Command 'node approval.cjs'`];
  if ([stopScenario, denyScenario, allowScenario, steerScenario].filter(Boolean).length > 1) throw new Error('一次只执行一个验收场景');
  const root = path.resolve(__dirname, '..');
  const run = path.join(root, '.local-validation', 'm1-live', randomUUID());
  const project = path.join(run, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'math.cjs'), 'exports.add = (a, b) => a - b;\n', 'utf8');
  await fs.writeFile(path.join(project, 'text.cjs'), "exports.greet = name => 'Hello ' + name;\n", 'utf8');
  const preserved = '人工原有修改：保留此文件逐字不变。\n';
  await fs.writeFile(path.join(project, 'human-notes.txt'), preserved, 'utf8');
  const testSource = [
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('加法', () => assert.equal(require('./math.cjs').add(2, 3), 5));",
    "test('问候', () => assert.equal(require('./text.cjs').greet('世界'), 'Hello, 世界!'));", '',
  ].join('\n');
  await fs.writeFile(path.join(project, 'acceptance.test.cjs'), testSource, 'utf8');
  const delayedSource = "const fs = require('node:fs');\nfs.writeFileSync('started.txt', 'started');\nsetTimeout(() => fs.writeFileSync('finished.txt', 'finished'), 60000);\n";
  if (stopScenario || steerScenario) await fs.writeFile(path.join(project, 'delayed.cjs'), delayedSource, 'utf8');
  const approvalSource = "require('node:fs').appendFileSync(require('node:path').join(__dirname, '..', 'allowed.txt'), 'ALLOW_ONCE\\n');\n";
  if (allowScenario) await fs.writeFile(path.join(project, 'approval.cjs'), approvalSource, 'utf8');
  const exists = async name => { try { await fs.access(path.join(project, name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  const verify = () => promisify(execFile)(process.execPath, ['--test', 'acceptance.test.cjs'], { cwd: project, windowsHide: true, timeout: 30000 });
  await assert.rejects(verify());
  stage = '启动隔离产品窗口';
  const { app, page } = await launch(path.join(run, 'data'));
  let latest = null;
  let passed = false;
  let submissionAttempts = 0;
  let approvalsObserved = false;
  let stopSentAt = null;
  const observedStates = new Set();
  const deniedTokens = new Set();
  const acceptedApprovals = [];
  const approvalGuards = [];
  let steerBinding = null;
  try {
    stage = '保存系统加密密钥和拉取真实模型列表';
    let settings = await page.evaluate(() => window.agentx.getModelSettings());
    settings = await page.evaluate(value => window.agentx.saveModelKey(value), {
      operationId: randomUUID(), expectedRevision: settings.configRevision, apiKey: apiKey.trim(),
    });
    apiKey = undefined;
    settings = await page.evaluate(value => window.agentx.fetchModelCatalog(value), {
      operationId: randomUUID(), expectedRevision: settings.configRevision,
    });
    assert.ok(settings.catalog.modelIds.includes(model), '真实模型列表未返回指定 Flash，停止，不换其他模型');
    settings = await page.evaluate(value => window.agentx.setSelectedModels(value), {
      operationId: randomUUID(), expectedRevision: settings.configRevision, selectedModelIds: [model],
    });
    await page.evaluate(value => window.agentx.setActiveModel(value), {
      operationId: randomUUID(), expectedRevision: settings.configRevision, activeModelId: model,
    });
    // 仅替代操作系统目录对话框的人工选择，项目关联仍经过完整产品 API。
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, project);
    await page.evaluate(value => window.agentx.chooseProject(value), { operationId: randomUUID() });
    const workspace = await page.evaluate(() => window.agentx.getWorkspace());
    assert.equal(workspace.projects.length, 1);
    await page.getByRole('combobox', { name: '工作目录' }).selectOption(workspace.projects[0].projectId);
    await page.getByRole('textbox', { name: '任务要求' }).fill(allowScenario
      ? '这是一次原生审批允许验收。只执行一次命令 node approval.cjs；该预置脚本只向本次合成项目上级目录的 allowed.txt 追加一行。请为该命令申请所需的项目外写入审批，等待本次批准后执行。不修改脚本或任何已有文件，不安装依赖，不换工具或命令绕过审批；成功后直接结束。'
      : denyScenario
      ? `这是一次拒绝审批验收。请申请项目外文件写入权限，使用命令向 ${path.join(run, 'denied.txt')} 写入 test。目标仍在本次合成验收目录内。不修改项目文件；不要用其他路径或工具绕过审批。若用户拒绝，只说明被拒绝并结束，不重试。`
      : stopScenario || steerScenario
      ? '执行 node delayed.cjs 并等待命令自然结束。不要修改任何源码或文件，不要手工创建 started.txt 或 finished.txt，它们只由脚本生成。不安装依赖。'
      : '修复 math.cjs 和 text.cjs，使现有 acceptance.test.cjs 全部通过。不得修改测试、human-notes.txt 或其他文件，不安装依赖。运行 node --test acceptance.test.cjs 并报告结果。');
    await page.waitForFunction(() => !document.querySelector('[aria-label="发送"]').disabled);
    stage = '从工作台发送一次任务';
    submissionAttempts++;
    await page.getByRole('button', { name: '发送', exact: true }).click();
    console.log('已从真实产品发送一次 Flash 任务；如出现审批，请在此验收窗口检查并允许或拒绝。不会自动批准或重发。');
    stage = '等待真实执行终态及人工审批';
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      latest = await page.evaluate(() => window.agentx.getExecution());
      approvalsObserved ||= latest.approvals.length > 0;
      if (latest.task) observedStates.add(latest.task.executionState);
      if (allowScenario) for (const approval of latest.approvals) {
        if (approval.status !== 'pending' || acceptedApprovals.some(value => value.approvalToken === approval.approvalToken)) continue;
        stage = '核对本次允许审批的类型、关联、目录与精确命令';
        approvalGuards.push({ kindMatches: approval.kind === 'command', threadMatches: approval.threadId === latest.task.threadId,
          turnMatches: approval.turnId === latest.task.turnId, cwdMatches: typeof approval.cwd === 'string' && path.resolve(approval.cwd).toLowerCase() === project.toLowerCase(),
          commandMatches: approvalCommands.includes(approval.command?.trim()),
          command: approval.command?.replace(/(?:ctx7sk-|\bsk-)[a-z0-9_-]{16,}/gi, '[REDACTED]') ?? null });
        assert.equal(acceptedApprovals.length, 0, '本场景只允许一次审批，不扩大授权');
        assert.equal(approval.kind, 'command');
        assert.equal(approval.threadId, latest.task.threadId);
        assert.equal(approval.turnId, latest.task.turnId);
        assert.equal(path.resolve(approval.cwd).toLowerCase(), project.toLowerCase());
        assert.ok(approvalCommands.includes(approval.command?.trim()), '审批命令不在本场景明确允许范围内');
        assert.equal(await fs.readFile(path.join(project, 'approval.cjs'), 'utf8'), approvalSource);
        assert.equal(await exists('../allowed.txt'), false, '批准前已产生写入，不能视为审批验收通过');
        const binding = { taskId: latest.task.taskId, threadId: approval.threadId, turnId: approval.turnId,
          itemId: approval.itemId, approvalToken: approval.approvalToken, decision: 'accept' };
        await page.getByRole('group', { name: `审批请求：${approval.itemId}`, exact: true }).getByRole('button', { name: '允许本次', exact: true }).click();
        acceptedApprovals.push(binding);
        console.log('已核对预置脚本和审批归属，通过真实工作台允许本次执行。');
      }
      if (steerScenario && !steerBinding && latest.task?.executionState === 'running' && await exists('started.txt')) {
        steerBinding = { taskId: latest.task.taskId, threadId: latest.task.threadId, turnId: latest.task.turnId };
        await page.getByRole('textbox', { name: '任务要求' }).fill('补充要求：命令结束后，在当前项目创建 supplement.txt，内容准确为 STEER_ACCEPTED。只允许这一个新增文件，其余原文件不要改。');
        await page.getByRole('button', { name: '补充要求', exact: true }).click();
        await page.getByText('补充要求已接收', { exact: true }).waitFor();
        console.log('真实补充已被产品接收，继续等待同一轮次完成。');
      }
      if (denyScenario) for (const approval of latest.approvals) {
        if (approval.status !== 'pending' || deniedTokens.has(approval.approvalToken)) continue;
        await page.getByRole('group', { name: `审批请求：${approval.itemId}`, exact: true }).getByRole('button', { name: '拒绝', exact: true }).click();
        deniedTokens.add(approval.approvalToken);
        console.log('已通过实际工作台拒绝本次原生审批。');
      }
      if (stopScenario && !stopSentAt && latest.task?.executionState === 'running' && await exists('started.txt')) {
        assert.equal(await exists('finished.txt'), false, '命令已结束，不能冒称运行中停止');
        stopSentAt = Date.now();
        await page.getByRole('button', { name: '停止', exact: true }).click();
        console.log('已确认命令实际启动，并通过工作台点击停止；等待引擎终态及延迟副作用核对。');
      }
      if (latest.error || ['completed', 'failed', 'interrupted', 'reconciling', 'unconfirmed'].includes(latest.task?.executionState)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(latest?.task?.executionState, stopScenario ? 'interrupted' : 'completed', '真实任务未确认预期终态，不自动追加轮次');
    stage = '独立复跑并核对人工文件和测试未被修改';
    assert.equal(await fs.readFile(path.join(project, 'acceptance.test.cjs'), 'utf8'), testSource);
    if (stopScenario) {
      assert.ok(stopSentAt, '没有观察到运行后点击停止');
      assert.equal(await fs.readFile(path.join(project, 'delayed.cjs'), 'utf8'), delayedSource);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, stopSentAt + 65000 - Date.now())));
      assert.equal(await exists('finished.txt'), false, '停止后命令仍产生延迟写入');
    } else if (steerScenario) {
      assert.ok(steerBinding, '未在运行期间提交补充');
      assert.deepEqual({ taskId: latest.task.taskId, threadId: latest.task.threadId, turnId: latest.task.turnId }, steerBinding);
      assert.equal((await fs.readFile(path.join(project, 'supplement.txt'), 'utf8')).trim(), 'STEER_ACCEPTED');
      assert.equal(await fs.readFile(path.join(project, 'delayed.cjs'), 'utf8'), delayedSource);
    } else if (allowScenario) {
      assert.equal(acceptedApprovals.length, 1, '未记录唯一一次明确允许');
      assert.equal(await fs.readFile(path.join(run, 'allowed.txt'), 'utf8'), 'ALLOW_ONCE\n');
      assert.equal(await fs.readFile(path.join(project, 'approval.cjs'), 'utf8'), approvalSource);
      assert.ok(latest.approvals.some(value => value.approvalToken === acceptedApprovals[0].approvalToken && value.status === 'resolved'), '允许审批未收到解决事件');
      assert.equal(await fs.readFile(path.join(project, 'math.cjs'), 'utf8'), 'exports.add = (a, b) => a - b;\n');
      assert.equal(await fs.readFile(path.join(project, 'text.cjs'), 'utf8'), "exports.greet = name => 'Hello ' + name;\n");
    } else if (denyScenario) {
      assert.ok(deniedTokens.size > 0, '未出现可拒绝的原生审批，不能视为通过');
      assert.equal(await exists('../denied.txt'), false, '拒绝后仍发生目标写入');
      assert.ok(latest.approvals.some(approval => deniedTokens.has(approval.approvalToken) && approval.status === 'resolved'), '审批未收到解决事件');
    } else await verify();
    assert.equal(await fs.readFile(path.join(project, 'human-notes.txt'), 'utf8'), preserved);
    if (!stopScenario && !denyScenario) assert.ok(latest.items.some(item => item.kind === 'command' && item.exitCode === 0), '产品没有报告成功命令结果');
    passed = true;
    await page.screenshot({ path: path.join(run, 'workbench.png') });
  } finally {
    apiKey = undefined;
    try { await fs.writeFile(path.join(run, 'summary.json'), JSON.stringify({ model, scenario: allowScenario ? 'allow' : steerScenario ? 'steer' : denyScenario ? 'deny' : stopScenario ? 'stop' : 'first-turn', submissionAttempts, passed, approvalsObserved, stage,
      steerBinding,
      acceptedApprovals,
      approvalGuards,
      deniedApprovals: deniedTokens.size,
      stopSent: stopSentAt !== null, observedStates: [...observedStates],
      taskState: latest?.task?.executionState ?? null, itemKinds: [...new Set(latest?.items?.map(item => item.kind) ?? [])],
      scope: allowScenario ? '真实原生审批允许、关联及唯一写入；不代替历史和退出验收' : steerScenario ? '真实运行中补充和同轮次产出；不代替允许、历史和退出验收' : denyScenario ? '真实原生审批拒绝和目标未写入；不代替允许、补充、历史和退出验收' : stopScenario ? '真实运行中停止和延迟副作用；不代替补充、拒绝、历史和退出验收' : '首次真实执行；不代替审批允许/拒绝、补充、停止、历史和退出完整验收' }, null, 2), 'utf8');
    } finally { await app.close(); }
    console.log(`脱敏验收记录：${path.join(run, 'summary.json')}`);
  }
}

main().catch(() => { console.error(`真实验收未通过，所在阶段：${stage}。不自动重试，不输出可能包含凭据的原始异常。`); process.exitCode = 1; });

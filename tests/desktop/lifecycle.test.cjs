const {test}=require('node:test');
const assert=require('node:assert/strict');
const {launch,crashTestApp}=require('./helpers.cjs');
const {randomUUID}=require('node:crypto');
require('ts-node').register({transpileOnly:true});

test('tray：关闭主窗口只隐藏，恢复同一个窗口和草稿，不退出 Main', {timeout:45000}, async t=>{
 const {app,page}=await launch();t.after(()=>app.close());
 await page.getByRole('textbox',{name:'任务要求'}).fill('关闭到托盘后保留这份草稿');
 const original=await app.evaluate(({BrowserWindow})=>({id:BrowserWindow.getAllWindows()[0].id,pid:process.pid}));
 await app.evaluate(({BrowserWindow})=>new Promise(resolve=>{BrowserWindow.getAllWindows()[0].close();setTimeout(resolve,200);}));
 const hidden=await app.evaluate(({BrowserWindow})=>({count:BrowserWindow.getAllWindows().length,visible:BrowserWindow.getAllWindows()[0]?.isVisible()}));
 assert.deepEqual(hidden,{count:1,visible:false});
 await app.evaluate(({app})=>app.emit('second-instance',{},[],''));
 await page.waitForFunction(()=>document.visibilityState==='visible');
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>({id:BrowserWindow.getAllWindows()[0].id,pid:process.pid})),original);
 assert.equal(await page.getByRole('textbox',{name:'任务要求'}).inputValue(),'关闭到托盘后保留这份草稿');
});

test('exitConfirm：未知任务真正退出先确认，取消不改变记录或草稿', {timeout:45000}, async t=>{
 const {app,page,data}=await launch();t.after(()=>crashTestApp(app));
 const {associateProject}=require('../../src/main/storage/projects.ts');
 const {createTaskRecord}=require('../../src/main/storage/tasks.ts');
 const project=associateProject(data,data).project,now=new Date().toISOString();
 createTaskRecord(data,{taskId:randomUUID(),projectId:project.projectId,directory:project.directory,title:'需核对的合成任务',
  executionState:'running',threadId:'exit-ui-thread',turnId:'exit-ui-turn',lastActivityAt:now,observedAt:now});
 await page.getByRole('textbox',{name:'任务要求'}).fill('取消退出后保留的草稿');
 const before=await page.evaluate(()=>window.agentx.getWorkspace());
 await app.evaluate(({app})=>{setImmediate(()=>app.quit());});
 const prompt=page.getByRole('dialog',{name:'还有执行未确认结束'});
 await prompt.waitFor();
 const confirmation=await page.evaluate(()=>window.agentx.getExitState());
 await assert.rejects(page.evaluate(value=>window.agentx.answerExit(value),{requestId:randomUUID(),decision:'stop'}),/失效|无效/);
 await assert.rejects(page.evaluate(value=>window.agentx.answerExit(value),{requestId:confirmation.requestId,decision:['cancel']}),/失效|无效/);
 await prompt.getByRole('button',{name:'取消',exact:true}).click();
 await prompt.waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>window.agentx.getWorkspace()),before);
 assert.equal(await page.getByRole('textbox',{name:'任务要求'}).inputValue(),'取消退出后保留的草稿');
 await assert.rejects(page.evaluate(value=>window.agentx.answerExit(value),{requestId:confirmation.requestId,decision:'stop'}),/失效|无效/);
 await app.evaluate(({app})=>{setImmediate(()=>app.quit());});
 await prompt.waitFor();
 await prompt.getByRole('button',{name:'停止后退出'}).click();
 await prompt.getByRole('alert').filter({hasText:'仍有未决任务'}).waitFor();
 assert.equal((await page.evaluate(()=>window.agentx.getExitState())).state,'error');
 assert.deepEqual(await page.evaluate(()=>window.agentx.getWorkspace()),before);
 await prompt.getByRole('button',{name:'保留到托盘'}).click();
 // 隐藏窗口会暂停 rAF；在 Main 验证原生可见性，不能靠默认 rAF 轮询等待隐藏页面。
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
 await app.evaluate(({app})=>app.emit('second-instance',{},[],''));
 await page.waitForFunction(()=>document.visibilityState==='visible');
 assert.equal(await page.getByRole('textbox',{name:'任务要求'}).inputValue(),'取消退出后保留的草稿');
});

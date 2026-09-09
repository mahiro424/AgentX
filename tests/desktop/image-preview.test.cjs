const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {launch}=require('./helpers.cjs');
test('pdfImage：真实图片解码、缩放、错误及旧版本；本地查看不开放 Flash 含图发送',{timeout:45000},async t=>{
 const data=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agentx-image-desktop-')));
 const {app,page}=await launch(data);t.after(()=>app.close());
 // 由 Chromium 生成可见且无外部来源的合成材料，不使用产品代码伪造解码成功。
 const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=200;const g=c.getContext('2d');g.fillStyle='#dce9f5';g.fillRect(0,0,320,200);g.fillStyle='#1c5378';g.fillRect(30,30,260,140);return c.toDataURL('image/png').split(',')[1];});
 const filename=path.join(data,'设计材料.png');await fs.writeFile(filename,Buffer.from(encoded,'base64'));
 await app.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},filename);
 await page.getByRole('button',{name:'添加材料',exact:true}).click();await page.getByRole('menuitem',{name:'添加文件',exact:true}).click();
 await page.getByRole('status').filter({hasText:'草稿已保存'}).waitFor();await page.getByRole('button',{name:'预览材料：设计材料.png'}).click();
 const preview=page.getByRole('region',{name:'只读文件预览'}),image=preview.getByRole('img',{name:'本地图片：设计材料.png'});
 await image.waitFor();await image.evaluate(img=>img.decode());assert.equal(await image.evaluate(img=>img.naturalWidth),320);
 const before=await image.evaluate(img=>img.getBoundingClientRect().width);await preview.getByRole('button',{name:'放大文字',exact:true}).click();assert.ok(await image.evaluate(img=>img.getBoundingClientRect().width)>before);
 assert.equal(await preview.locator('iframe,webview,[contenteditable=true]').count(),0);assert.equal(await page.getByRole('button',{name:'发送',exact:true}).isEnabled(),false);
 assert.equal((await page.evaluate(()=>window.agentx.getDraft({projectId:null,taskId:null}))).materials[0].status,'blockedImage');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));await page.waitForFunction(()=>innerWidth===960);
 await fs.writeFile(filename,'损坏的图片');await preview.getByRole('alert').filter({hasText:/变化|格式/}).waitFor({timeout:10000});
 assert.ok(await preview.getByRole('note').filter({hasText:'保留上次成功读取的图片'}).isVisible());assert.equal(await image.evaluate(img=>img.naturalWidth),320);
 assert.equal(await preview.getByRole('button',{name:'本机打开',exact:true}).isEnabled(),false);
});

test('图片解码失败：头部尺寸正常但内容损坏时展示原因，保留草稿且不显示可打开成功',{timeout:30000},async t=>{
 const data=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agentx-image-decode-'))),filename=path.join(data,'损坏.png');
 const header=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC','base64');await fs.writeFile(filename,header);
 const {app,page}=await launch(data);t.after(()=>app.close());await app.evaluate(({dialog},filename)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},filename);
 await page.getByRole('button',{name:'添加材料',exact:true}).click();await page.getByRole('menuitem',{name:'添加文件',exact:true}).click();await page.getByRole('status').filter({hasText:'草稿已保存'}).waitFor();
 await page.getByRole('textbox',{name:'任务要求'}).fill('保留当前草稿');await page.getByRole('button',{name:'预览材料：损坏.png'}).click();
 const preview=page.getByRole('region',{name:'只读文件预览'});await preview.getByRole('alert').filter({hasText:'图片解码失败'}).waitFor();assert.equal(await preview.getByRole('button',{name:'本机打开',exact:true}).isEnabled(),false);assert.equal(await page.getByRole('textbox',{name:'任务要求'}).inputValue(),'保留当前草稿');
});

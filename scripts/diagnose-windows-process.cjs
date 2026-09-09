// 临时只读差分探针：无模型请求，不改变产品权限、超时或失败状态。
const {execFile}=require('node:child_process'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
async function query(pid,mode){
 const common="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';[Console]::Error.WriteLine('phase:started');";
 const prefix=mode==='explicit-module'?"Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1') -ErrorAction Stop;[Console]::Error.WriteLine('phase:module-ready');":'';
 const expression=mode==='dotnet'?`$p=Get-Process -Id ${pid};[Console]::Error.WriteLine('phase:queried');@{found=($null-ne$p);created=($null-ne$p.StartTime);image=($null-ne$p.Path)}|ConvertTo-Json -Compress`:
 `$p=Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${pid}' ${mode==='selected-properties'?'-Property ProcessId,ParentProcessId,CreationDate,ExecutablePath':''};[Console]::Error.WriteLine('phase:queried');$time=$p.CreationDate.ToUniversalTime().ToString('o');[Console]::Error.WriteLine('phase:date');$image=$p.ExecutablePath;[Console]::Error.WriteLine('phase:image');@{found=($null-ne$p);created=($null-ne$time);image=($null-ne$image)}|ConvertTo-Json -Compress`;
 const env={...process.env};if(mode==='clean-module-path')for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
 const start=Date.now();await new Promise(resolve=>execFile(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(common+prefix+expression,'utf16le').toString('base64')],{windowsHide:true,env,timeout:10000,maxBuffer:65536},(error,stdout,stderr)=>{console.log(JSON.stringify({target:pid===process.pid?'node':'codex',mode,elapsed:Date.now()-start,code:error?.code??null,killed:error?.killed??false,signal:error?.signal??null,phases:stderr.match(/phase:[a-z-]+/g),output:stdout.trim().slice(0,200)}));resolve();}));
}
(async()=>{
 if(!process.argv.includes('--codex')){for(const mode of['inherited','explicit-module','clean-module-path'])await query(process.pid,mode);return;}
 require('ts-node').register({transpileOnly:true});await require('./prepare-codex.cjs').prepareCodex();
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agentx-cim-diagnostic-')));
 const {prepareCodexConfiguration,verifyExecutionConfiguration}=require('../src/main/runtime/codex/configuration.ts');
 const prepared=await prepareCodexConfiguration(root,{modelId:'deepseek-v4-flash',apiKey:'synthetic-diagnostic-key'});
 const http=require('node:http');const trap=http.createServer((request,response)=>{request.resume();response.writeHead(503);response.end();});trap.on('connect',(_request,socket)=>socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'));await new Promise(resolve=>trap.listen(0,'127.0.0.1',resolve));
 const proxy='http://127.0.0.1:'+trap.address().port;Object.assign(prepared.environment,{HTTP_PROXY:proxy,HTTPS_PROXY:proxy,ALL_PROXY:proxy,NO_PROXY:''});
 let runtime;try{
  runtime=await require('../src/main/runtime/codex/process.ts').openCodex({...prepared,resourcesDirectory:path.resolve('.cache'),workingDirectory:root},{notification(){},request(){throw new Error('探针禁止审批');},disconnected(){}});
  await verifyExecutionConfiguration(runtime.transport,root);
  for(const mode of['inherited','selected-properties','dotnet','explicit-module','clean-module-path'])await query(runtime.pid,mode);
  await query(process.pid,'inherited');
 }finally{if(runtime)await runtime.close();await new Promise(resolve=>trap.close(resolve));}
})().catch(error=>{console.error('探针失败：'+error.message);process.exitCode=1;});

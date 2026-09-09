const {execFile}=require('node:child_process'),path=require('node:path');
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const common="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';[Console]::Error.WriteLine('phase:started');";
(async()=>{for(const mode of['inherited','explicit-module','clean-module-path']){
 const prefix=mode==='explicit-module'?"Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1') -ErrorAction Stop;[Console]::Error.WriteLine('phase:module-ready');":'';
 const script=common+prefix+`$p=Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${process.pid}';[Console]::Error.WriteLine('phase:queried');@{found=($null-ne$p);created=($null-ne$p.CreationDate);image=($null-ne$p.ExecutablePath)}|ConvertTo-Json -Compress`;
 const env={...process.env};if(mode==='clean-module-path')for(const key of Object.keys(env))if(key.toLowerCase()==='psmodulepath')delete env[key];
 const start=Date.now();await new Promise(resolve=>execFile(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env,timeout:10000,maxBuffer:65536},(error,stdout,stderr)=>{console.log(JSON.stringify({mode,elapsed:Date.now()-start,code:error?.code??null,killed:error?.killed??false,signal:error?.signal??null,phases:stderr.match(/phase:[a-z-]+/g),output:stdout.trim().slice(0,200)}));resolve();}));
}})();

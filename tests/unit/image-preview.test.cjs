const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
require('ts-node').register({transpileOnly:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEAAAAABJRU5ErkJggg==','base64');
test('pdfImage：图片可本地预览和打开，但材料仍阻断模型发送；身份变化不返回替代字节',async()=>{
 const {MaterialService}=require('../../src/main/services/materials.ts');
 const {saveDraft,readDraft}=require('../../src/main/storage/drafts.ts');
 const {readFilePreview,openFilePreview}=require('../../src/main/services/file-preview.ts');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agentx-image-'))),filename=path.join(root,'材料.png');await fs.writeFile(filename,png);
 const service=new MaterialService(root),[material]=await service.register([filename]);
 const scope={projectId:null,taskId:null},source={kind:'material',scope,materialId:material.materialId};
 await assert.rejects(readFilePreview(root,source),/未关联/);
 saveDraft(root,{...scope,expectedRevision:readDraft(root,scope).revision,text:'检查图片',materialIds:[material.materialId]});
 const preview=await readFilePreview(root,source);assert.equal(preview.status,'ready',preview.message);
 assert.equal(preview.image.mime,'image/png');assert.equal(preview.image.width,1);assert.equal(preview.image.height,1);assert.deepEqual(Buffer.from(preview.image.data,'base64'),png);
 assert.equal(readDraft(root,scope).materials[0].status,'blockedImage');await assert.rejects(service.requireReady([material.materialId]),/图像/);
 const opened=[],host={openPath:async file=>{opened.push(file);return '';},showItemInFolder(){}};
 await openFilePreview(root,{source,action:'open'},host);assert.deepEqual(opened,[filename]);
 await fs.writeFile(filename,Buffer.from('外部变化'));const changed=await readFilePreview(root,source);assert.notEqual(changed.status,'ready');assert.equal(changed.image,null);
 await assert.rejects(openFilePreview(root,{source,action:'open'},host),/未打开/);
});

test('图片预览边界：超尺寸、伪格式及可执行内容不进入解码；仍保留材料',async()=>{
 const {MaterialService}=require('../../src/main/services/materials.ts'),{imagePreview}=require('../../src/main/services/image-preview.ts');
 const {readFilePreview}=require('../../src/main/services/file-preview.ts'),{saveDraft,readDraft}=require('../../src/main/storage/drafts.ts');
 const huge=Buffer.from(png);huge.writeUInt32BE(20000,16);assert.throws(()=>imagePreview(huge),/尺寸超限/);
 assert.throws(()=>imagePreview(Buffer.alloc(8*1024*1024+1)),/8 MiB/);
 for(const data of[Buffer.from('<svg onload="alert(1)"></svg>'),Buffer.from('BMfake'),Buffer.from('bad')])assert.throws(()=>imagePreview(data),/无效|未开放/);
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'agentx-image-broken-'))),filename=path.join(root,'伪图片.png');await fs.writeFile(filename,'<svg onload="alert(1)"></svg>');
 const [material]=await new MaterialService(root).register([filename]),scope={projectId:null,taskId:null};
 saveDraft(root,{...scope,expectedRevision:readDraft(root,scope).revision,text:'保留',materialIds:[material.materialId]});
 const preview=await readFilePreview(root,{kind:'material',scope,materialId:material.materialId});assert.equal(preview.status,'unreadable');assert.equal(preview.image,null);assert.equal(readDraft(root,scope).text,'保留');
});

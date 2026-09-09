import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createSceneTestCdpClient } from './scene-test-cdp-client.mjs';

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'brain-video-export-'));
const evidence = resolve(process.env.NEWBRAIN_VIDEO_EVIDENCE || 'evidence/video-export', String(Date.now()));
await mkdir(evidence, { recursive: true });
await mkdir(join(root, 'media'), { recursive: true });
const files = [];
const sourceRoot = process.env.NEWBRAIN_VIDEO_SOURCE_ROOT;
const sourceState = sourceRoot ? JSON.parse(await readFile(join(sourceRoot, '.brain-video/pipeline-editor.json'), 'utf8')) : null;
if (sourceState) {
  const paths = [...new Set([...sourceState.shots.flatMap(s => [s.clip, s.audio]), ...(sourceState.clipInstances || []).map(c => c.relativePath)].filter(Boolean))];
  for (const storageKey of paths) {
    await mkdir(dirname(join(root, storageKey)), {recursive:true});
    await copyFile(join(sourceRoot, storageKey), join(root, storageKey));
    const bytes = await readFile(join(root, storageKey));
    files.push({storageKey,logicalName:storageKey.split('/').pop(),mimeType:storageKey.endsWith('.mp4')?'video/mp4':'audio/wav',sizeBytes:bytes.length,contentHash:`sha256:${createHash('sha256').update(bytes).digest('hex')}`});
  }
}
for (const [index, color] of (sourceState ? [] : ['red', 'green', 'blue']).entries()) {
  const storageKey = `media/shot-${index + 1}.mp4`;
  await exec('ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', `color=${color}:s=320x180:r=20`, '-t', '2.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, storageKey)], { windowsHide: true });
  const bytes = await readFile(join(root, storageKey));
  files.push({ storageKey, logicalName: `shot-${index + 1}.mp4`, mimeType: 'video/mp4', sizeBytes: bytes.length, contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
}
process.env.NEWBRAIN_E2E_FORCE_FRESH = '1';
const client = await createSceneTestCdpClient(9373);
const actions = [];
async function click(text) {
  const point = await client.evaluate(`(() => {
    const list = [...document.querySelectorAll('button')].filter(e => e.textContent.trim() === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 0);
    if (list.length !== 1) throw new Error('Expected one button: ' + ${JSON.stringify(text)} + ', found ' + list.length);
    const e = list[0]; if(e.disabled) throw new Error('Disabled: ' + e.textContent);
    e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await client.command('Input.dispatchMouseEvent', { type, ...point, button:'left', clickCount:1 });
  actions.push({ text, point, method: 'Input.dispatchMouseEvent' });
}
async function screenshot(name) {
  const shot = await client.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
}
try {
  await client.waitForAppReady();
  const projectId = await client.evaluate(`(async () => {
    const catalog = await window.newbrain.addWorkspace({name:'Video export regression',path:${JSON.stringify(root)}});
    const local = catalog.find(w => w.path === ${JSON.stringify(root)});
    const project = await window.newbrain.createBrainProject({name:'Video export regression',primaryWorkspaceKey:'video',localWorkspaceId:local.id});
    for (const file of ${JSON.stringify(files)}) await window.newbrain.registerBrainFile({projectId:project.id,...file});
    const loaded = await window.newbrain.getBrainVideoPipeline({projectId:project.id});
    const state = ${JSON.stringify(sourceState)} || {...loaded.state,script:'Three color sequence',canvas:{aspect:'16:9',width:320,height:180,fps:20},
      shots:${JSON.stringify(files)}.map((f,i)=>({title:'Shot '+(i+1),line:'',prompt:'',clip:f.storageKey,audio:'',ready:true,transition:'cut'})),
      clipInstances:${JSON.stringify(files)}.map((f,i)=>({id:'clip-'+i,shotId:'shot-'+(i+1),kind:'video',trackId:'v1',relativePath:f.storageKey,startSec:i*1.5,durationSec:1.5,inSec:0,outSec:1.5})),
      textClips:[],trackEdits:{},lanes:[{id:'v1',kind:'video',name:'V1',output:true}]};
    await window.newbrain.saveBrainVideoPipeline({projectId:project.id,state});
    await window.newbrain.saveVideoTimeline({projectId:project.id,title:'Export regression',width:320,height:180,fps:20});
    localStorage.setItem('brain.workspaceSelection.v2',JSON.stringify({version:2,selectedWorkspaceKey:'video',catalogs:{video:{projectId:project.id,conversationId:''}}}));
    return project.id;
  })()`);
  await client.command('Page.reload');
  await client.waitFor("document.body?.innerText.includes('Video export regression')");
  console.log(await client.evaluate("[...document.querySelectorAll('button')].map(e=>e.textContent.trim()).filter(t=>/轨|导出|渲染/.test(t))"));
  await click('本镜音视频轨');
  await client.waitFor("document.querySelector('.workspace-artifact-video__primary')?.readyState >= 2");
  await click('全片序列');
  await client.waitFor("document.body.innerText.includes('全片序列播放完毕')", 60000);
  const stopped = await client.evaluate("(()=>{const v=document.querySelector('.workspace-artifact-video__primary');return {paused:v.paused,time:v.currentTime,src:v.currentSrc}})()");
  await new Promise(r => setTimeout(r, 3000));
  const later = await client.evaluate("(()=>{const v=document.querySelector('.workspace-artifact-video__primary');return {paused:v.paused,time:v.currentTime,src:v.currentSrc}})()");
  assert.equal(later.paused, true);
  assert.ok(Math.abs(later.time-stopped.time)<0.1, JSON.stringify({stopped,later}));
  await screenshot('sequence-stopped');
  const outputs = [];
  for (const label of ['渲染', '导出']) {
    await click(label);
    await client.waitFor(`document.body.innerText.includes('${label}完成 · exports/')`, 90000);
    const registered = await client.evaluate(`window.newbrain.listBrainFiles({projectId:${JSON.stringify(projectId)}})`);
    const file = registered.find(f => f.storageKey.startsWith('exports/') && !outputs.some(o => o.path === f.storageKey));
    assert.ok(file, 'Export file registered');
    const {stdout} = await exec('ffprobe.exe',['-v','error','-show_entries','format=duration','-of','json',join(root,file.storageKey)],{windowsHide:true});
    const duration = Number(JSON.parse(stdout).format.duration);
    const expected = sourceState ? Math.max(...sourceState.clipInstances.map(c=>c.startSec+c.durationSec)) : 4.5;
    assert.ok(Math.abs(duration-expected)<0.15, `Full sequence duration: ${duration}, expected ${expected}`);
    outputs.push({path:file.storageKey,duration});
  }
  const artifacts = await client.evaluate(`window.newbrain.listBrainArtifacts({projectId:${JSON.stringify(projectId)}})`);
  assert.equal(artifacts.filter(a=>a.artifactType==='video_render').length,2);
  const artifactPoint = await client.evaluate("(()=>{const e=[...document.querySelectorAll('button')].find(e=>/^产物/.test(e.textContent.trim()));e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  for (const type of ['mousePressed','mouseReleased']) await client.command('Input.dispatchMouseEvent',{type,...artifactPoint,button:'left',clickCount:1});
  actions.push({text:'产物',point:artifactPoint,method:'Input.dispatchMouseEvent'});
  await client.waitFor("document.querySelector('.brain-resource-row')?.parentElement.innerText.includes('video_render')");
  await screenshot('export-artifacts');
  await writeFile(join(evidence,'result.json'),JSON.stringify({status:'PASS',fixture:{root,projectId},actions,stopped,later,outputs,artifacts},null,2));
  console.log(JSON.stringify({status:'PASS',evidence,outputs}));
} catch(error) {
  await screenshot('failure').catch(()=>{});
  const text = await client.evaluate('document.body.innerText').catch(()=> '');
  await writeFile(join(evidence,'failure.json'),JSON.stringify({error:String(error),actions,text},null,2));
  throw error;
} finally { await client.close({preserveWorkspace:true}); }

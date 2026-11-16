import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from './deck.mjs';
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const tmp=root+'/tmp/task5-revised';
const out=root+'/deliverables/Qadam-Task5-Revised';
const req=createRequire('C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/runtime.cjs');
process.env.RUNTIME_NODE_MODULES='C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {Presentation,PresentationFile}=await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const p=Presentation.create({slideSize:{width:1280,height:720}});
await build(p);
await(await PresentationFile.exportPptx(p)).save(tmp+'/candidate.pptx');
for(let i=0;i<p.slides.items.length;i++){
 const im=await p.export({slide:p.slides.items[i],format:'png',scale:2});
 await fs.writeFile(tmp+'/slide-'+String(i+1).padStart(2,'0')+'.png',new Uint8Array(await im.arrayBuffer()));
}
try{const svg=await p.export({slide:p.slides.items[0],format:'svg'});await fs.writeFile(tmp+'/test.svg',new Uint8Array(await svg.arrayBuffer()));}catch(e){console.log('SVG export:',e.message);}
const skill='C:/Users/zhary/.codex/plugins/cache/openai-primary-runtime/presentations/26.1111.10930/skills/presentations';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const ref='C:/Users/zhary/Downloads/task_4_Qadam.pdf';
const result=await finalizePresentation({
 workspaceDir:root,candidatePath:tmp+'/candidate.pptx',finalPath:out+'/Qadam_Task5_Presentation_EN.pptx',
 pythonExecutable:'C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
 integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',
 layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...([3,5,7,8,9,11].flatMap(n=>['--require-native-table-slide',String(n)]))],
 explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[3,5,7,8,9,11],requiredNativeChartOwnerSlides:[],
 fontPolicy:{basis:'reference',families:['Arial'],referencePath:ref,referenceSha256:crypto.createHash('sha256').update(await fs.readFile(ref)).digest('hex')},
 verifyArtifactToolImport:true,receiptPath:tmp+'/validation.json'
});
console.log(JSON.stringify(result));

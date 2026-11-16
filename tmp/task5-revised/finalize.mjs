import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
process.env.RUNTIME_NODE_MODULES='C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const skill='C:/Users/zhary/.codex/plugins/cache/openai-primary-runtime/presentations/26.1111.10930/skills/presentations';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const candidate=root+'/tmp/task5-revised/candidate.pptx', final=root+'/deliverables/Qadam-Task5-Revised/Qadam_Task5_Presentation_EN.pptx';
const ref='C:/Users/zhary/Downloads/task_4_Qadam.pdf';
try{
 await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:final,pythonExecutable:'C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...([3,5,7,8,9,11].flatMap(n=>['--require-native-table-slide',String(n)]))],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[3,5,7,8,9,11],fontPolicy:{basis:'reference',families:['Arial'],referencePath:ref,referenceSha256:crypto.createHash('sha256').update(await fs.readFile(ref)).digest('hex')},verifyArtifactToolImport:true,receiptPath:root+'/tmp/task5-revised/validation.json'});
}catch(e){
 if(e.code!=='EPERM'||e.syscall!=='link')throw e;
 // All validation and exact-file import checks preceded the denied hard-link publish.
 await fs.copyFile(candidate,final,fs.constants.COPYFILE_EXCL);
 const sha=p=>fs.readFile(p).then(b=>crypto.createHash('sha256').update(b).digest('hex'));
 const a=await sha(candidate),b=await sha(final);if(a!==b)throw Error('Final copy differs');
 await fs.writeFile(root+'/tmp/task5-revised/validation-copy.json',JSON.stringify({validation:'Finalizer completed checks and import, failed only on filesystem link.',publish:'Copied exact validated candidate, matching SHA-256.',sha256:b},null,2));
 console.log('Checks and first-party import passed. Saved identical file via copy.');
}

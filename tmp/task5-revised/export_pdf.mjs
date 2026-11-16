import fs from 'node:fs/promises';
import {createRequire,registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
const req=createRequire('C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/runtime.cjs');
registerHooks({resolve(specifier,context,nextResolve){
 if(specifier.startsWith('#standard-fonts/')){
  const asset=specifier.slice('#standard-fonts/'.length);
  const file=req.resolve('@pdf-lib/standard-fonts/lib/'+asset+'.compressed.json');
  return {url:pathToFileURL(file).href,shortCircuit:true};
 }
 return nextResolve(specifier,context);
}});
const {PresentationFile,FileBlob}=await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const p=await PresentationFile.importPptx(await FileBlob.load(root+'/tmp/task5-revised/candidate.pptx'));
const pdf=await p.export({format:'pdf'});
await fs.writeFile(root+'/deliverables/Qadam-Task5-Revised/Qadam_Task5_Presentation_EN.pdf',new Uint8Array(await pdf.arrayBuffer()));
console.log('PDF exported');

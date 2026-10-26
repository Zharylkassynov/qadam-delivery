import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const runtime='C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime';
const skill=runtime+'/plugins/openai-primary-runtime/plugins/presentations/skills/presentations';
process.env.RUNTIME_NODE_MODULES=runtime+'/dependencies/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const result=await finalizePresentation({
 workspaceDir:root,candidatePath:path.join(root,'.codex-artifacts/qadam-midterm/build-en/candidate-en.pptx'),
 finalPath:path.join(root,'deliverables/Qadam-Midterm-English/Qadam_Delivery_Midterm_EN_Final.pptx'),
 pythonExecutable:runtime+'/dependencies/python/python.exe',
 integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',
 layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...[4,7,8,9,10].flatMap(n=>['--require-native-table-slide',String(n)])],
 explicitTotalSlideCount:10,requiredNativeTableOwnerSlides:[4,7,8,9,10],requiredNativeChartOwnerSlides:[5],
 materializeLiteralChartWorkbooks:true,fontPolicy:{basis:'design',families:['Arial']},
 verifyArtifactToolImport:true,receiptPath:path.join(root,'.codex-artifacts/qadam-midterm/build-en/validation-final.json')
});
console.log(JSON.stringify({file:result.finalPath,slides:result.packageIntegrity.slide_count,warnings:result.presentationLayout.warnings}));

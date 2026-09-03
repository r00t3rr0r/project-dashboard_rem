/* ========================================
   AI Conf - zentrale Ollama- und Workflow-Steuerung
   ======================================== */
(function(){'use strict';

var STORAGE_KEY='pd_ai_configuration';
var healthRequestSequence=0;
var healthCheckPending=false;
var lastHealthCheckAt=0;
var assistantDraft={projectId:'',mode:'',ownerId:'',items:[]};
var routineDraft={projectId:'',name:'',description:'',target:'server',runtime:'bash',inputs:'',script:'',questions:[],status:'draft'};
var githubDraft={questions:[],answers:{},data:null};
var ASSISTANTS={
  next:{icon:'next_plan',title:'Naechste Aufgaben',description:'Leitet die naechsten konkreten Arbeitspakete aus Projektstand und Projektwissen ab.',instruction:'Ermittle die unmittelbar naechsten, noch nicht vorhandenen Aufgaben. Beruecksichtige Blocker, Abhaengigkeiten, Prioritaeten und das Projektwissen.'},
  team:{icon:'groups',title:'Team orchestrieren',description:'Plant Aufgaben und verteilt sie passend zu Rolle, Kapazitaet und aktueller Auslastung.',instruction:'Orchestriere die offene Arbeit. Erzeuge fehlende Aufgaben und weise jede Aufgabe ueber assigneeId einem geeigneten Mitarbeiter zu. Nutze ausschliesslich Mitarbeiter-IDs aus dem Kontext.'},
  development:{icon:'code_blocks',title:'Entwicklung planen',description:'Zerlegt den naechsten Entwicklungsschritt in umsetzbare technische Arbeit.',instruction:'Plane die naechste Entwicklungsiteration mit Analyse, Implementierung, Tests, Review und Dokumentation. Vermeide Aufgaben, die bereits vorhanden oder abgeschlossen sind.'},
  progress:{icon:'monitoring',title:'Fortschritt steuern',description:'Erkennt Rueckstaende und erzeugt konkrete Massnahmen fuer Blocker und Projektfortschritt.',instruction:'Analysiere Soll und Ist des Projektfortschritts. Erzeuge nur konkrete Korrektur-, Entblockungs- oder Abschlussaufgaben, die den Fortschritt messbar verbessern.'},
  finish:{icon:'route',title:'Projekt fertigstellen',description:'Plant den kuerzesten realistischen Abschluss inklusive Hosting, Infrastruktur, Tests und Go-live.',instruction:'Erstelle einen vollstaendigen, sequenziellen Abschlussplan fuer dieses Projekt. Zerlege die Restarbeit in 6 bis 12 atomare Aufgaben mit jeweils 0.5 bis 7 Aufwandstunden. Beruecksichtige zwingend: offene Fachentscheidungen, technische Umsetzung, Datenmigration falls relevant, automatisierte Tests, Security- und Datenschutzpruefung, Hosting/Infrastruktur, DNS/TLS/Umgebungsvariablen, Monitoring/Backup, Deployment, Smoke-Test, Dokumentation und Uebergabe. Nutze genau eine Arbeitskraft mit 7 Stunden pro Werktag. Ordne jede Aufgabe ueber sequenceIndex und dependsOnPrevious. Erzeuge keine Sammelaufgaben und erfinde keine Infrastrukturdetails, sondern markiere ungeklaerte Punkte als konkrete Klaerungsaufgabe. Gib pro Aufgabe einen spezifischen deutschen KI-Prompt in aiPrompt zur Umsetzung aus.'},
  githubE2E:{icon:'account_tree',title:'GitHub E2E-Pipeline bauen',description:'Erstellt einen pruefbaren Playwright-Workflow, legt ihn nach Bestaetigung in GitHub an und startet ihn.',instruction:'Entwirf eine vollstaendige GitHub-Actions-E2E-Pipeline mit Playwright. Ermittle aus dem Projektkontext die wichtigsten Nutzerpfade. Nutze nur bekannte Startbefehle und frage fehlende Repository-, Installations-, URL- oder Secret-Informationen ab. Gib ein JSON mit workflowName, workflowPath, workflowYaml, testPlan und questions aus. Der YAML-Workflow muss npm ci, Browserinstallation, Tests, Artefakt-Upload und einen manuellen workflow_dispatch enthalten.'},
  routine:{icon:'rule',title:'Ablaufroutine entwickeln',description:'Erarbeitet aus belastbaren Angaben eine Routine, ein bearbeitbares Skript und sichere Ausfuehrungsschritte.',instruction:'Erstelle nur dann eine technische Ablaufroutine, wenn Ziel, Ausloeser, Eingaben, erwartetes Ergebnis, Zielumgebung, Runtime, Rechte, Pfade und Fehlerverhalten ausreichend bekannt sind. Wenn etwas fehlt, liefere ausschliesslich questions mit konkreten Rueckfragen und keine ausfuehrbare Routine. Sonst liefere JSON mit name, summary, runtime, target, requiredInputs, script, validationSteps, rollbackSteps und questions. Das Skript darf keine Secrets enthalten, muss Eingaben validieren, bei Fehlern abbrechen und einen Dry-Run ermoeglichen.'}
};
var DEFAULTS={
  routing:'auto',
  primaryModel:'',
  fallbackModel:'',
  temperature:0.3,
  maxTokens:3200,
  autoAssign:true,
  progressReview:true,
  templates:[
    {id:'task-draft',name:'Aufgabenentwurf',scope:'QuickTask',text:'Erstelle konkrete, umsetzbare Arbeitspakete mit Aufwand, Abhaengigkeiten und Akzeptanzkriterien.'},
    {id:'team-routing',name:'Teamzuweisung',scope:'Aufgabenfluss',text:'Ordne Aufgaben nach Kompetenz, aktueller Auslastung, Verfuegbarkeit und Prioritaet zu.'},
    {id:'progress-review',name:'Fortschrittspruefung',scope:'Projektsteuerung',text:'Pruefe Fortschritt, Blocker, Ueberfaelligkeiten und schlage die naechste konkrete Aktion vor.'}
  ]
};

function clone(value){return JSON.parse(JSON.stringify(value));}
function escapeHtml(value){var node=document.createElement('div');node.appendChild(document.createTextNode(String(value||'')));return node.innerHTML;}
function notify(message,isError){
  if(window.QuickTaskModule&&window.QuickTaskModule.showToast)window.QuickTaskModule.showToast(message,!!isError);
}
function readConfig(){
  var saved={};
  try{
    saved=window.DataLayer&&window.DataLayer.getStoredValue?window.DataLayer.getStoredValue(STORAGE_KEY,{}) : JSON.parse(window.localStorage.getItem(STORAGE_KEY)||'{}');
    if(typeof saved==='string')saved=JSON.parse(saved||'{}');
  }catch(_err){}
  var config=Object.assign({},clone(DEFAULTS),saved&&typeof saved==='object'?saved:{});
  config.templates=Array.isArray(saved&&saved.templates)&&saved.templates.length?saved.templates:clone(DEFAULTS.templates);
  return config;
}
function saveConfig(config){
  if(window.DataLayer&&window.DataLayer.setStoredValue){window.DataLayer.setStoredValue(STORAGE_KEY,config);}
  else {try{window.localStorage.setItem(STORAGE_KEY,JSON.stringify(config));}catch(_err){}}
  window.dispatchEvent(new CustomEvent('aiConfigurationChanged',{detail:config}));
}
function modelName(model){return String(model&& (model.name||model.model)||'').trim();}
function getModels(){
  if(!window.LocalOllama||!window.LocalOllama.health)return Promise.resolve([]);
  return window.LocalOllama.health().then(function(result){
    var body=result&&result.body?result.body:result||{};
    return Array.isArray(body.models)?body.models.map(modelName).filter(Boolean):[];
  });
}
function statusLabel(models,error,checking){
  if(checking)return '<span class="ai-conf-state is-checking" id="ai-conf-runtime-state">Verbindung wird geprueft</span>';
  if(error)return '<span class="ai-conf-state is-error" id="ai-conf-runtime-state">Ollama nicht erreichbar</span>';
  if(!models.length)return '<span class="ai-conf-state is-warning" id="ai-conf-runtime-state">Keine Modelle erkannt</span>';
  return '<span class="ai-conf-state is-ready" id="ai-conf-runtime-state">'+models.length+' Modell'+(models.length===1?'':'e')+' bereit</span>';
}
function render(){
  var root=document.getElementById('ai-conf-root');
  if(!root)return;
  var config=readConfig();
  var initialRender=!root.querySelector('.ai-conf-layout');
  if(initialRender)renderWorkspace(root,config,[],'',true);
  else refreshProjectSelect(root,config);
  if(initialRender||Date.now()-lastHealthCheckAt>30000)refreshModels(root,config,initialRender);
  syncActivityUI(window.LocalOllama&&window.LocalOllama.getStatus?window.LocalOllama.getStatus():null);
}
function refreshProjectSelect(root,config){
  var select=root.querySelector('#ai-assistant-project');
  if(!select)return;
  var selected=select.value||config.assistantProjectId||'';
  select.innerHTML=projectOptions(selected);
}
if(window.DataLayer&&typeof window.DataLayer.on==='function'){
  window.DataLayer.on('dataChanged',function(event){
    var entity=event&&event.entity;
    if(entity&&entity!=='projects'&&entity!=='all')return;
    var root=document.getElementById('ai-conf-root');
    if(root&&root.querySelector('.ai-conf-layout'))refreshProjectSelect(root,readConfig());
  });
}
function modelOptions(models,selected){
  return '<option value="">Automatisch zuweisen</option>'+models.map(function(model){return '<option value="'+escapeHtml(model)+'"'+(model===selected?' selected':'')+'>'+escapeHtml(model)+'</option>';}).join('');
}
function getProjects(){
  if(!window.DataLayer||typeof window.DataLayer.getProjects!=='function')return [];
  return (window.DataLayer.getProjects()||[]).slice().sort(function(a,b){return String(a.title||a.name||'').localeCompare(String(b.title||b.name||''),'de');});
}
function projectTitle(project){return String(project&&(project.title||project.name)||'Unbenanntes Projekt');}
function projectOptions(selectedId){
  var options=['<option value="">Projekt auswaehlen</option>'];
  getProjects().forEach(function(project){options.push('<option value="'+escapeHtml(project.id)+'"'+(project.id===selectedId?' selected':'')+'>'+escapeHtml(projectTitle(project))+'</option>');});
  return options.join('');
}
function assistantCards(){
  return Object.keys(ASSISTANTS).map(function(id){var assistant=ASSISTANTS[id];return '<button class="ai-assistant-card" type="button" data-assistant="'+id+'"><span class="material-symbols-rounded" aria-hidden="true">'+assistant.icon+'</span><span><strong>'+assistant.title+'</strong><small>'+assistant.description+'</small></span><span class="material-symbols-rounded ai-assistant-run" aria-hidden="true">play_arrow</span></button>';}).join('');
}
function defaultGithubWorkflow(){
  return "name: E2E Tests\n\non:\n  workflow_dispatch:\n  push:\n    branches: [ main ]\n  pull_request:\n\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Repository auschecken\n        uses: actions/checkout@v4\n      - name: Node.js einrichten\n        uses: actions/setup-node@v4\n        with:\n          node-version: 20\n          cache: npm\n      - name: Abhaengigkeiten installieren\n        run: npm ci\n      - name: Playwright Browser installieren\n        run: npx playwright install --with-deps chromium\n      - name: E2E Tests ausfuehren\n        run: npx playwright test\n      - name: Testergebnisse hochladen\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: playwright-report\n          path: |\n            playwright-report/\n            test-results/\n          if-no-files-found: ignore\n";
}
function normalizeGithubDraft(data){
  var source=data&&data.workflow&&typeof data.workflow==='object'?data.workflow:data||{};
  var yaml=source.workflowYaml||source.workflow_yaml||source.yaml||source.content||'';
  var questions=(Array.isArray(source.questions)?source.questions:[]).map(function(item,index){var rawId=item&&typeof item==='object'?item.id||'question-'+index:'question-'+index;var id=String(rawId).replace(/[^A-Za-z0-9_-]/g,'-');if(item&&typeof item==='object')return {id:id,label:String(item.question||item.prompt||item.label||item.text||'Bitte Angabe ergaenzen.'),answer:String(item.answer||'')};return {id:id,label:String(item||'Bitte Angabe ergaenzen.'),answer:''};});
  return {workflowPath:source.workflowPath||source.workflow_path||'.github/workflows/e2e.yml',workflowYaml:String(yaml||'').trim()||defaultGithubWorkflow(),questions:questions,testPlan:source.testPlan||source.test_plan||''};
}
function githubQuestionAnswers(root,questions){
  var answers={};(questions||[]).forEach(function(question){var field=root.querySelector('[data-github-question="'+question.id+'"]');if(field)answers[question.id]=field.value.trim();});return answers;
}
function runGithubWithAnswers(root,action){
  var answers=githubQuestionAnswers(root,githubDraft.questions);var missing=githubDraft.questions.filter(function(question){return !answers[question.id];});
  if(missing.length){notify('Bitte alle fehlenden Angaben beantworten.',true);return;}
  githubDraft.answers=answers;runSpecialAssistant(root,'githubE2E',action,answers);
}
function renderSpecialResult(root,type,data){
  var host=root.querySelector('#ai-special-result');if(!host)return;
  if(type==='githubE2E'){
    data=normalizeGithubDraft(data);githubDraft.data=data;githubDraft.questions=data.questions;var questions=Array.isArray(data.questions)?data.questions:[];
    host.hidden=false;host.innerHTML='<div class="ai-special-head"><strong>GitHub E2E-Workflow</strong><small>'+escapeHtml(questions.length?'Vor dem Anlegen fehlen noch Angaben.':'Workflow pruefen, Token eingeben und bewusst anlegen.')+'</small></div>'
      +(questions.length?'<div class="ai-conf-questions">'+questions.map(function(item){return '<label class="ai-conf-question"><span><span class="material-symbols-rounded" aria-hidden="true">help</span>'+escapeHtml(item.label)+'</span><textarea rows="2" data-github-question="'+escapeHtml(item.id)+'" placeholder="Antwort eingeben">'+escapeHtml(githubDraft.answers[item.id]||item.answer||'')+'</textarea></label>';}).join('')+'</div><div class="ai-routine-actions"><button class="btn btn-secondary" type="button" id="ai-github-regenerate"><span class="material-symbols-rounded" aria-hidden="true">refresh</span><span>Mit Angaben neu generieren</span></button><button class="btn btn-secondary" type="button" id="ai-github-prepare"><span class="material-symbols-rounded" aria-hidden="true">fact_check</span><span>Für GitHub vorbereiten</span></button></div>':'')
      +'<label class="form-group"><span>Workflow-Datei</span><input id="ai-github-workflow-path" value="'+escapeHtml(data.workflowPath||'.github/workflows/e2e.yml')+'"></label>'
      +'<label class="form-group"><span>YAML bearbeiten</span><textarea id="ai-github-workflow-yaml" rows="14">'+escapeHtml(data.workflowYaml||'')+'</textarea></label>'
      +'<label class="form-group"><span>GitHub Token fuer diesen Vorgang</span><input id="ai-github-token" type="password" autocomplete="off" placeholder="Wird nicht gespeichert"></label>'
      +'<button class="btn btn-primary" type="button" id="ai-github-create"'+(questions.length?' disabled':'')+'><span class="material-symbols-rounded" aria-hidden="true">publish</span><span>Workflow nach GitHub committen</span></button>';
    var create=host.querySelector('#ai-github-create');if(create)create.addEventListener('click',function(){createGitHubWorkflow(root,data);});
    var regenerate=host.querySelector('#ai-github-regenerate');if(regenerate)regenerate.addEventListener('click',function(){runGithubWithAnswers(root,'regenerate');});
    var prepare=host.querySelector('#ai-github-prepare');if(prepare)prepare.addEventListener('click',function(){runGithubWithAnswers(root,'prepare');});
    return;
  }
  var routine=data||{};var missing=Array.isArray(routine.questions)?routine.questions:[];
  routineDraft=Object.assign({},routineDraft,{name:routine.name||routineDraft.name,script:routine.script||'',target:routine.target||routineDraft.target,runtime:routine.runtime||routineDraft.runtime,questions:missing,status:missing.length?'needs-info':'ready'});
  host.hidden=false;host.innerHTML='<div class="ai-special-head"><strong>Ablaufroutine '+(missing.length?'braucht Angaben':'ist bereit')+'</strong><small>'+(missing.length?'Bitte Angaben ergaenzen und danach neu erzeugen.':'Skript bearbeiten, pruefen und erst dann ausfuehren.')+'</small></div>'
    +(missing.length?'<div class="ai-conf-questions">'+missing.map(function(item){return '<p><span class="material-symbols-rounded" aria-hidden="true">help</span>'+escapeHtml(item)+'</p>';}).join('')+'</div>':'')
    +'<label class="form-group"><span>Routine-Name</span><input id="ai-routine-name" value="'+escapeHtml(routine.name||'')+'"></label>'
    +'<label class="form-group"><span>Script bearbeiten</span><textarea id="ai-routine-script" rows="14"'+(missing.length?' disabled':'')+'>'+escapeHtml(routine.script||'')+'</textarea></label>'
    +'<div class="ai-routine-actions"><button class="btn btn-secondary" type="button" id="ai-routine-save"'+(missing.length?' disabled':'')+'><span class="material-symbols-rounded" aria-hidden="true">save</span><span>Routine speichern</span></button><button class="btn btn-secondary" type="button" id="ai-routine-download"'+(missing.length?' disabled':'')+'><span class="material-symbols-rounded" aria-hidden="true">download</span><span>Script herunterladen</span></button><button class="btn btn-secondary" type="button" id="ai-routine-run"'+(missing.length?' disabled':'')+'><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span><span>Dry-Run starten</span></button></div>';
  var save=host.querySelector('#ai-routine-save');if(save)save.addEventListener('click',function(){saveRoutine(root);});
  var download=host.querySelector('#ai-routine-download');if(download)download.addEventListener('click',function(){downloadRoutine(root);});
  var run=host.querySelector('#ai-routine-run');if(run)run.addEventListener('click',function(){saveRoutine(root);executeRoutine(root);});
}
function runSpecialAssistant(root,mode,action,answers){
  var projectId=String((root.querySelector('#ai-assistant-project')||{}).value||'');var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project){notify('Bitte zuerst ein Projekt auswaehlen.',true);return;}
  var description=mode==='routine'?String((root.querySelector('#ai-routine-description')||{}).value||'').trim():'';
  var target=mode==='routine'?String((root.querySelector('#ai-routine-target')||{}).value||'server'):'server';
  var runtime=mode==='routine'?String((root.querySelector('#ai-routine-runtime')||{}).value||'bash'):'bash';
  var inputs=mode==='routine'?String((root.querySelector('#ai-routine-inputs')||{}).value||'').trim():'';
  if(mode==='routine'&&!description){notify('Bitte zuerst den gewuenschten Routineablauf beschreiben.',true);return;}
  var host=root.querySelector('#ai-special-result');host.hidden=false;host.innerHTML='<div class="ai-assistant-pending"><span class="material-symbols-rounded">progress_activity</span><span>'+escapeHtml(ASSISTANTS[mode].title)+' wird vorbereitet ...</span></div>';
  fetchProjectKnowledge(project).then(function(knowledge){
    var context=projectContext(project);var answerText=answers?Object.keys(answers).map(function(id){return id+': '+answers[id];}).join('\n'):'Keine ergaenzenden Antworten';var finalInstruction=action==='prepare'?'Alle Rueckfragen sind beantwortet. Erzeuge jetzt den finalen Workflow ohne weitere questions und fuelle workflowYaml vollstaendig aus.':'Nutze die Antworten, um den Workflow neu zu generieren. Pruefe, ob danach noch wirklich notwendige questions offen sind.';var instruction=ASSISTANTS[mode].instruction+'\n\n'+finalInstruction+'\n\nBeantwortete Rueckfragen:\n'+answerText+'\n\nNutzerbeschreibung:\n'+description+'\nZielumgebung: '+target+'\nRuntime: '+runtime+'\nBekannte Eingaben/Parameter:\n'+(inputs||'Keine Angaben')+'\n\nProjektwissen:\n'+(knowledge||'Keine separate Wissensdatei vorhanden.')+'\n\nAntworte ausschliesslich als JSON-Objekt.';
    return window.LocalOllama.generate('/api/ai/meeting-task-draft',{projectId:project.id,projectTitle:projectTitle(project),draftInput:instruction,existingData:context,promptConfig:{temperature:0.1,maxTokens:5000}});
  }).then(function(body){
    var data=body&&body.draft&&typeof body.draft==='object'?body.draft:body||{};if(mode==='routine'){data.target=target;data.runtime=runtime;data.requiredInputs=inputs;}renderSpecialResult(root,mode,data);
  }).catch(function(error){host.innerHTML='<p class="ai-assistant-error">'+escapeHtml(error&&error.message||error)+'</p>';});
}
function saveRoutine(root){
  var projectId=String((root.querySelector('#ai-assistant-project')||{}).value||'');var name=String((root.querySelector('#ai-routine-name')||{}).value||'').trim();var script=String((root.querySelector('#ai-routine-script')||{}).value||'');
  if(!name||!script){notify('Routine-Name und Script sind erforderlich.',true);return;}
  var routines=readConfig().routines||[];routines.push({id:'routine-'+Date.now(),projectId:projectId,name:name,script:script,target:routineDraft.target,runtime:routineDraft.runtime,updatedAt:new Date().toISOString()});var config=readConfig();config.routines=routines;saveConfig(config);routineDraft.name=name;routineDraft.script=script;notify('Routine gespeichert. Ausfuehrung bleibt bestaetigungspflichtig.',false);
}
function downloadRoutine(root){
  var script=String((root.querySelector('#ai-routine-script')||{}).value||'');if(!script){notify('Kein Script zum Herunterladen vorhanden.',true);return;}
  var name=String((root.querySelector('#ai-routine-name')||{}).value||'routine').trim().replace(/[^A-Za-z0-9_-]+/g,'-')||'routine';var blob=new Blob([script],{type:'text/plain'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download=name+'.'+(routineDraft.runtime==='python'?'py':'sh');document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);notify('Script heruntergeladen. Bitte lokal nach eigener Pruefung ausfuehren.',false);
}
function executeRoutine(root){
  if(!window.confirm('Routine jetzt in der ausgewaehlten Zielumgebung ausfuehren?'))return;
  if(routineDraft.target!=='server'){downloadRoutine(root);return;}
  var script=String((root.querySelector('#ai-routine-script')||{}).value||'');
  fetch('/api/routines/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runtime:routineDraft.runtime,script:script})}).then(function(response){return response.json().then(function(body){if(!response.ok)throw new Error(body.error||'Routine konnte nicht ausgefuehrt werden.');return body;});}).then(function(body){notify('Routine beendet (Exit-Code '+body.exitCode+').',!body.ok);}).catch(function(error){notify(error.message,true);});
}
function createGitHubWorkflow(root,data){
  var project=getProjects().find(function(item){return item.id===String((root.querySelector('#ai-assistant-project')||{}).value||'');});var github=project&&project.github||{};var token=String((root.querySelector('#ai-github-token')||{}).value||'').trim();
  if(!token){notify('Bitte fuer den Commit einen GitHub Token eingeben.',true);return;}
  if(!github.owner||!github.repo){notify('Im Projekt fehlen GitHub owner und repo.',true);return;}
  var path=(root.querySelector('#ai-github-workflow-path')||{}).value||'.github/workflows/e2e.yml';var content=(root.querySelector('#ai-github-workflow-yaml')||{}).value||'';
  fetch('/api/github/e2e-workflow',{method:'POST',headers:{'Content-Type':'application/json','X-GitHub-Token':token},body:JSON.stringify({owner:github.owner,repo:github.repo,branch:github.branch||'main',path:path,content:content,dispatch:false,message:'chore: add automated E2E workflow'})}).then(function(response){return response.json().then(function(body){if(!response.ok)throw new Error(body.error||'GitHub Commit fehlgeschlagen.');return body;});}).then(function(result){
    var workflows=Array.isArray(project.githubE2EWorkflows)?project.githubE2EWorkflows:[];var existing=workflows.find(function(item){return item.path===path;});var workflow=Object.assign(existing||{id:'e2e-'+Date.now()}, {name:data.workflowName||path.split('/').pop(),path:path,yaml:content,branch:github.branch||'main',updatedAt:new Date().toISOString(),lastDispatchAt:result.dispatchStarted?new Date().toISOString():''});if(existing)workflows=workflows.map(function(item){return item.id===existing.id?workflow:item;});else workflows.push(workflow);project.githubE2EWorkflows=workflows;window.DataLayer.updateProject(project);notify('GitHub-Workflow angelegt und im Projekt gespeichert.',false);
  }).catch(function(error){notify(error.message,true);});
}
function projectContext(project){
  var tasks=window.DataLayer&&window.DataLayer.getTasks?window.DataLayer.getTasks():[];
  var employees=window.DataLayer&&window.DataLayer.getEmployees?window.DataLayer.getEmployees():[];
  var projectTasks=tasks.filter(function(task){return task&&task.projectId===project.id;});
  var workload={};
  tasks.forEach(function(task){
    if(!task||task.status==='done')return;
    var ids=Array.isArray(task.assigneeIds)?task.assigneeIds.slice():[];
    if(task.assigneeId&&ids.indexOf(task.assigneeId)===-1)ids.push(task.assigneeId);
    ids.forEach(function(id){workload[id]=(workload[id]||0)+1;});
  });
  return {
    project:{id:project.id,title:projectTitle(project),description:project.description||'',status:project.status||'',startDate:project.startDate||'',endDate:project.endDate||'',progress:project.progress,aiKnowledge:project.aiKnowledge||{}},
    tasks:projectTasks.map(function(task){return {id:task.id,title:task.title||'',description:task.description||'',status:task.status||'',priority:task.priority||'',progress:task.progress,assigneeId:task.assigneeId||'',dependencyTaskIds:task.dependencyTaskIds||[],effortHours:task.effortHours||0,dueDate:task.dueDate||task.deadline||''};}),
    employees:employees.map(function(employee){return {id:employee.id,name:employee.name||'',role:employee.role||'',availability:employee.availability||'',capacityPoints:employee.capacityPoints||0,focusArea:employee.focusArea||'',skills:employee.skills||employee.competencies||[],openTaskCount:workload[employee.id]||0};})
  };
}
function fetchProjectKnowledge(project){
  var filePath=String(project&&project.aiKnowledge&&project.aiKnowledge.filePath||'').trim();
  if(!filePath||typeof fetch!=='function')return Promise.resolve('');
  return fetch(filePath).then(function(response){return response.ok?response.text():'';}).then(function(text){return String(text||'').slice(0,9000);}).catch(function(){return '';});
}
function normalizeAssistantDraft(body){
  var draft=body&&body.draft&&typeof body.draft==='object'?body.draft:{};
  var source=[];
  if(draft.task&&typeof draft.task==='object')source.push(draft.task);
  if(Array.isArray(draft.taskSuggestions))source=source.concat(draft.taskSuggestions);
  if(Array.isArray(body&&body.tasks))source=source.concat(body.tasks);
  return source.map(function(item,index){
    var title=String(item.titleDe||item.title||item.titleEn||'').trim();
    var description=String(item.descriptionDe||item.description||item.descriptionEn||'').trim();
    return {title:title,description:description,priority:String(item.priority||'medium').toLowerCase(),effortHours:Number(item.effortHours||0)||0,assigneeId:String(item.assigneeId||'').trim(),sequenceIndex:Number(item.sequenceIndex||index+1)||index+1,dependsOnPrevious:!!item.dependsOnPrevious,subtasks:Array.isArray(item.subtasksDe)?item.subtasksDe:(Array.isArray(item.subtasks)?item.subtasks:[]),aiPrompt:String(item.aiPromptDe||item.aiPrompt||'').trim()};
  }).filter(function(item){return !!item.title;});
}
function dateOnly(date){return date.toISOString().slice(0,10);}
function nextWorkday(date){var result=new Date(date.getTime());while(result.getDay()===0||result.getDay()===6)result.setDate(result.getDate()+1);return result;}
function addWorkdays(date,count){var result=new Date(date.getTime());for(var index=0;index<count;index++){result.setDate(result.getDate()+1);result=nextWorkday(result);}return result;}
function buildAiPrompt(item,project){return item.aiPrompt||'Arbeite ausschliesslich an dieser Aufgabe: '+item.title+'.\nProjekt: '+projectTitle(project)+'\nZiel: '+(item.description||'Erzeuge das beschriebene Ergebnis.')+'\nRegeln: Nutze den vorhandenen Projektkontext. Veraendere nur notwendige Dateien und Daten. Nenne zuerst Annahmen und Blocker. Liefere danach konkrete Umsetzungsschritte, geaenderte Artefakte, Tests mit Ergebnissen und verbleibende Risiken. Keine erfundenen Werte, keine offenen Allgemeinplaetze.';}
function scheduleItems(items,project){
  var today=new Date();today.setHours(9,0,0,0);
  var projectStart=project.startDate&&/^\d{4}-\d{2}-\d{2}$/.test(project.startDate)?new Date(project.startDate+'T09:00:00'):today;
  var start=projectStart>today?projectStart:today;
  var dayCursor=nextWorkday(start),hour=9;
  return items.map(function(item){
    var remaining=Math.max(.5,Math.min(7,Number(item.effortHours)||1)),segments=[];
    while(remaining>0){
      dayCursor=nextWorkday(dayCursor);
      var available=16-hour;
      if(available<=0){dayCursor=addWorkdays(dayCursor,1);hour=9;continue;}
      var segment=Math.min(remaining,available),end=hour+segment;
      segments.push({date:dateOnly(dayCursor),startTime:String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0'),endTime:String(Math.floor(end)).padStart(2,'0')+':'+String(Math.round((end%1)*60)).padStart(2,'0')});
      hour=end;remaining-=segment;
      if(hour>=16){dayCursor=addWorkdays(dayCursor,1);hour=9;}
    }
    item.schedule=segments[0];item.scheduleEnd=segments[segments.length-1];item.aiPrompt=buildAiPrompt(item,project);return item;
  });
}
function employeeName(id){
  var employees=window.DataLayer&&window.DataLayer.getEmployees?window.DataLayer.getEmployees():[];
  var employee=employees.find(function(item){return item.id===id;});
  return employee?employee.name||employee.id:'Nicht zugewiesen';
}
function employeeOptions(selectedId){
  var employees=window.DataLayer&&window.DataLayer.getEmployees?window.DataLayer.getEmployees():[];
  return '<option value="">Verantwortlichen auswaehlen</option>'+employees.slice().sort(function(a,b){return String(a.name||a.id).localeCompare(String(b.name||b.id),'de');}).map(function(employee){return '<option value="'+escapeHtml(employee.id)+'"'+(employee.id===selectedId?' selected':'')+'>'+escapeHtml(employee.name||employee.id)+'</option>';}).join('');
}
function renderAssistantDraft(root){
  var host=root.querySelector('#ai-assistant-result');
  if(!host)return;
  if(!assistantDraft.items.length){host.innerHTML='';host.hidden=true;return;}
  host.hidden=false;
  var ownerField=assistantDraft.mode==='finish'?'<label class="form-group ai-assistant-owner"><span>Verantwortlich fuer die Fertigstellung</span><select id="ai-assistant-owner">'+employeeOptions(assistantDraft.ownerId)+'</select></label>':'';
  host.innerHTML='<div class="ai-assistant-result-head"><div><strong>'+assistantDraft.items.length+' Aufgabenvorschlaege</strong><small>'+(assistantDraft.mode==='finish'?'Verantwortlichen waehlen, Vorschlaege pruefen und gezielt uebernehmen.':'Vorschlaege pruefen und gezielt uebernehmen.')+'</small></div><button class="btn btn-primary" type="button" id="ai-assistant-import"><span class="material-symbols-rounded" aria-hidden="true">playlist_add_check</span><span>'+(assistantDraft.mode==='finish'?'Aufgaben + Kalender uebernehmen':'Ausgewaehlte uebernehmen')+'</span></button></div>'+ownerField+'<div class="ai-assistant-task-list">'+assistantDraft.items.map(function(item,index){return '<label class="ai-assistant-task"><input type="checkbox" data-assistant-task="'+index+'" checked><span><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.description||'Keine Beschreibung')+'</small><span class="ai-assistant-task-meta"><b>'+escapeHtml(item.priority)+'</b><b>'+escapeHtml(item.effortHours?item.effortHours+' Std.':'Aufwand offen')+'</b><b>'+escapeHtml(assistantDraft.ownerId&&assistantDraft.mode==='finish'?employeeName(assistantDraft.ownerId):employeeName(item.assigneeId))+'</b>'+(item.schedule?'<b>'+escapeHtml(item.schedule.date+' '+item.schedule.startTime+'-'+item.schedule.endTime)+'</b>':'')+'</span>'+(item.aiPrompt?'<details class="ai-assistant-prompt"><summary>KI-Prompt fuer diese Aufgabe</summary><textarea readonly rows="5">'+escapeHtml(item.aiPrompt)+'</textarea></details>':'')+'</span></label>';}).join('')+'</div>';
  if(assistantDraft.mode==='finish')host.querySelector('#ai-assistant-owner').addEventListener('change',function(){assistantDraft.ownerId=this.value;renderAssistantDraft(root);});
  host.querySelector('#ai-assistant-import').addEventListener('click',function(){importAssistantTasks(root);});
}
function runAssistant(root,mode){
  var projectId=String((root.querySelector('#ai-assistant-project')||{}).value||'');
  var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project){notify('Bitte zuerst ein Projekt auswaehlen.',true);return;}
  if(!window.LocalOllama||typeof window.LocalOllama.generate!=='function'){notify('Lokaler Ollama-Client ist nicht verfuegbar.',true);return;}
  var assistant=ASSISTANTS[mode];
  var result=root.querySelector('#ai-assistant-result');
  root.querySelectorAll('[data-assistant]').forEach(function(button){button.disabled=true;});
  result.hidden=false;
  result.innerHTML='<div class="ai-assistant-pending"><span class="material-symbols-rounded" aria-hidden="true">progress_activity</span><span>'+escapeHtml(assistant.title)+' analysiert '+escapeHtml(projectTitle(project))+' ...</span></div>';
  fetchProjectKnowledge(project).then(function(knowledge){
    var context=projectContext(project);
    var instruction=assistant.instruction+'\n\nProjektwissen:\n'+(knowledge||'Keine separate Wissensdatei vorhanden. Nutze den aktuellen Projektsnapshot.')+'\n\nAntworte ausschliesslich als JSON-Objekt mit dem Feld tasks. Jede Aufgabe benoetigt title, description, priority, effortHours, sequenceIndex, dependsOnPrevious, subtasks und bei Projekt fertigstellen zusaetzlich aiPrompt. Keine Markdown-Ausgabe.';
    return window.LocalOllama.generate('/api/ai/meeting-task-draft',{projectId:project.id,projectTitle:projectTitle(project),draftInput:instruction,options:{createSubtasks:true,splitIntoMultiple:true},existingData:context,promptConfig:{temperature:0.2,maxTokens:3200}});
  }).then(function(body){
      assistantDraft={projectId:project.id,mode:mode,ownerId:'',items:normalizeAssistantDraft(body)};
    if(mode==='finish')assistantDraft.items=scheduleItems(assistantDraft.items,project);
    renderAssistantDraft(root);
    if(!assistantDraft.items.length)notify('Die KI hat keine verwertbaren Aufgaben geliefert.',true);
  }).catch(function(error){
    var aborted=error&&(error.name==='AbortError'||/abort/i.test(String(error.message||'')));
    result.innerHTML='<p class="ai-assistant-error">'+escapeHtml(aborted?'KI-Arbeit wurde gestoppt.':String(error&&error.message||error))+'</p>';
    if(!aborted)notify('Operativer Assistent fehlgeschlagen.',true);
  }).finally(function(){root.querySelectorAll('[data-assistant]').forEach(function(button){button.disabled=false;});});
}
function importAssistantTasks(root){
  var project=getProjects().find(function(item){return item.id===assistantDraft.projectId;});
  if(!project||!window.DataLayer||typeof window.DataLayer.createTask!=='function'){notify('Projekt oder Aufgabenverwaltung nicht verfuegbar.',true);return;}
  var employees=window.DataLayer.getEmployees?window.DataLayer.getEmployees():[];
  var employeeIds=employees.map(function(employee){return employee.id;});
  var selected=Array.prototype.map.call(root.querySelectorAll('[data-assistant-task]:checked'),function(input){return assistantDraft.items[Number(input.getAttribute('data-assistant-task'))];}).filter(Boolean);
  if(!selected.length){notify('Bitte mindestens eine Aufgabe auswaehlen.',true);return;}
  var ownerId=String((root.querySelector('#ai-assistant-owner')||{}).value||assistantDraft.ownerId||'');
  if(assistantDraft.mode==='finish'&&!ownerId){notify('Bitte zuerst den Verantwortlichen fuer die Fertigstellung auswaehlen.',true);return;}
  var created=[];
  selected.forEach(function(item,index){
    var dependencyIds=item.dependsOnPrevious&&created.length?[created[created.length-1].id]:[];
    var assignedId=assistantDraft.mode==='finish'?ownerId:(employeeIds.indexOf(item.assigneeId)!==-1?item.assigneeId:null);
    var payload={title:item.title,description:item.description+(item.aiPrompt?'\n\nVorgefertigter KI-Prompt:\n'+item.aiPrompt:''),projectId:project.id,status:'backlog',priority:['low','medium','high','blocker'].indexOf(item.priority)!==-1?item.priority:'medium',effortHours:item.effortHours,sequenceIndex:item.sequenceIndex||index+1,dependsOnPrevious:!!item.dependsOnPrevious,dependencyTaskIds:dependencyIds,assigneeId:assignedId,subtasks:item.subtasks.map(function(subtask){return {title:String(subtask&&subtask.title||subtask),done:false};}).filter(function(subtask){return !!subtask.title;})};
    var task=window.DataLayer.createTask(payload);
    if(task)created.push(task);
    if(item.schedule&&window.DataLayer.createCalendarEvent)window.DataLayer.createCalendarEvent({title:'KI-Plan: '+item.title,description:'Aufgabe: '+item.title+'\n\n'+(item.aiPrompt||item.description||''),date:item.schedule.date,startDate:item.schedule.date,startTime:item.schedule.startTime,endTime:item.schedule.endTime,type:'task',projectId:project.id,attendeeIds:[assignedId]});
  });
  assistantDraft={projectId:'',mode:'',items:[]};
  renderAssistantDraft(root);
  notify(created.length+' Aufgaben fuer '+projectTitle(project)+' angelegt.',false);
}
function updateModelSelect(select,models,configuredValue){
  if(!select)return;
  var selected=select.dataset.modelsLoaded==='true'?select.value:configuredValue;
  select.innerHTML=modelOptions(models,selected);
  select.value=models.indexOf(selected)!==-1?selected:'';
  select.dataset.modelsLoaded='true';
}
function refreshModels(root,config,showChecking){
  if(healthCheckPending)return;
  healthCheckPending=true;
  var requestId=++healthRequestSequence;
  var state=root.querySelector('#ai-conf-runtime-state');
  var refreshButton=root.querySelector('#ai-conf-refresh');
  if(state&&showChecking){state.className='ai-conf-state is-checking';state.textContent='Verbindung wird geprueft';}
  if(refreshButton){refreshButton.disabled=true;refreshButton.classList.add('is-loading');}
  getModels().then(function(models){
    if(requestId!==healthRequestSequence||!root.isConnected)return;
    updateModelSelect(root.querySelector('#ai-primary-model'),models,config.primaryModel||'');
    updateModelSelect(root.querySelector('#ai-fallback-model'),models,config.fallbackModel||'');
    var current=root.querySelector('#ai-conf-runtime-state');
    if(current)current.outerHTML=statusLabel(models,'',false);
  }).catch(function(error){
    if(requestId!==healthRequestSequence||!root.isConnected)return;
    var current=root.querySelector('#ai-conf-runtime-state');
    if(current)current.outerHTML=statusLabel([],error&&error.message?error.message:'Verbindung fehlgeschlagen',false);
  }).finally(function(){
    if(requestId!==healthRequestSequence)return;
    healthCheckPending=false;
    lastHealthCheckAt=Date.now();
    var button=root.querySelector('#ai-conf-refresh');
    if(button){button.disabled=false;button.classList.remove('is-loading');}
  });
}
function activityDetail(status){
  var progress=Math.round(Math.max(0,Math.min(100,Number(status&&status.progress)||0)));
  if(status&&status.status==='working')return progress<40?'Kontext und Prompt werden vorbereitet':progress<75?'Das Modell generiert die Antwort':'Die Antwort wird verarbeitet';
  if(status&&status.status==='stopping')return 'Aktive Anfrage wird abgebrochen';
  if(status&&status.status==='error')return status.error||'Die letzte KI-Anfrage ist fehlgeschlagen';
  if(status&&status.status==='complete')return 'Die letzte Anfrage wurde erfolgreich abgeschlossen';
  if(status&&status.status==='stopped')return 'Die letzte Anfrage wurde abgebrochen';
  return 'Keine KI-Anfrage aktiv';
}
function syncActivityUI(status){
  var root=document.getElementById('ai-conf-root');
  if(!root)return;
  var current=status||{status:'idle',progress:0,label:'Bereit',activeCount:0};
  var progress=Math.round(Math.max(0,Math.min(100,Number(current.progress)||0)));
  var busy=current.status==='working'||current.status==='stopping';
  var monitor=root.querySelector('#ai-conf-activity');
  var label=root.querySelector('#ai-conf-activity-label');
  var detail=root.querySelector('#ai-conf-activity-detail');
  var value=root.querySelector('#ai-conf-progress-value');
  var bar=root.querySelector('#ai-conf-progress');
  var fill=root.querySelector('#ai-conf-progress-fill');
  var stop=root.querySelector('#ai-conf-stop');
  if(monitor)monitor.className='ai-conf-activity is-'+escapeHtml(current.status||'idle');
  if(label)label.textContent=current.label||'Bereit';
  if(detail)detail.textContent=activityDetail(current);
  if(value)value.textContent=progress+'%';
  if(bar){bar.setAttribute('aria-valuenow',String(progress));bar.setAttribute('aria-busy',busy?'true':'false');}
  if(fill)fill.style.width=progress+'%';
  if(stop)stop.disabled=!busy||current.status==='stopping';
}
function renderWorkspace(root,config,models,error,checking){
  var selectedPrimary=config.primaryModel||'';
  var selectedFallback=config.fallbackModel||'';
  root.innerHTML=''
    +'<div class="ai-conf-statusbar"><div><strong>Ollama Laufzeit</strong><span>Lokale Modelle und intelligente Zuweisung</span></div>'+statusLabel(models,error,checking)+'<button class="toolbar-icon-btn" type="button" id="ai-conf-refresh" title="Modelle neu laden" aria-label="Modelle neu laden"><span class="material-symbols-rounded" aria-hidden="true">refresh</span></button></div>'
    +'<div class="ai-conf-layout">'
      +'<section class="ai-conf-panel ai-conf-runtime"><div class="ai-conf-panel-head"><div><p class="section-kicker">Modellrouting</p><h2>Auswahl &amp; Fallback</h2></div><span class="material-symbols-rounded" aria-hidden="true">account_tree</span></div>'
        +'<div class="ai-conf-fields">'
          +'<label class="form-group"><span>Routing-Modus</span><select id="ai-routing"><option value="auto"'+(config.routing==='auto'?' selected':'')+'>Automatisch nach Aufgabe</option><option value="fixed"'+(config.routing==='fixed'?' selected':'')+'>Primärmodell erzwingen</option><option value="fallback"'+(config.routing==='fallback'?' selected':'')+'>Primärmodell mit Fallback</option></select></label>'
          +'<label class="form-group"><span>Primärmodell</span><select id="ai-primary-model">'+modelOptions(models,selectedPrimary)+'</select></label>'
          +'<label class="form-group"><span>Fallback-Modell</span><select id="ai-fallback-model">'+modelOptions(models,selectedFallback)+'</select></label>'
          +'<label class="form-group"><span>Temperatur <output id="ai-temperature-value">'+escapeHtml(config.temperature)+'</output></span><input id="ai-temperature" type="range" min="0" max="1" step="0.1" value="'+escapeHtml(config.temperature)+'"></label>'
          +'<label class="form-group"><span>Antwortbudget</span><input id="ai-max-tokens" type="number" min="200" max="6000" step="100" value="'+escapeHtml(config.maxTokens)+'"></label>'
        +'</div><button class="btn btn-primary" type="button" id="ai-conf-save"><span class="material-symbols-rounded" aria-hidden="true">save</span><span>KI-Konfiguration speichern</span></button>'
      +'</section>'
      +'<section class="ai-conf-panel ai-conf-operations"><div class="ai-conf-panel-head"><div><p class="section-kicker">Automationen</p><h2>Operativer Assistent</h2></div><span class="material-symbols-rounded" aria-hidden="true">auto_awesome</span></div>'
        +'<div class="ai-conf-activity is-idle" id="ai-conf-activity"><div class="ai-conf-activity-head"><span class="ai-conf-live-dot" aria-hidden="true"></span><div><strong id="ai-conf-activity-label">Bereit</strong><small id="ai-conf-activity-detail">Keine KI-Anfrage aktiv</small></div><output id="ai-conf-progress-value">0%</output></div><div class="ai-conf-progress" id="ai-conf-progress" role="progressbar" aria-label="Aktueller KI-Arbeitsfortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="ai-conf-progress-fill"></span></div><button class="btn btn-danger ai-conf-stop" type="button" id="ai-conf-stop" disabled><span class="material-symbols-rounded" aria-hidden="true">stop_circle</span><span>KI stoppen</span></button></div>'
        +'<label class="form-group ai-assistant-project"><span>Projekt fuer Assistenten</span><select id="ai-assistant-project">'+projectOptions(config.assistantProjectId||'')+'</select></label>'
        +'<div class="ai-assistant-list">'+assistantCards()+'</div>'
        +'<div class="ai-assistant-result" id="ai-assistant-result" hidden></div>'
        +'<div class="ai-routine-input"><label class="form-group"><span>Routine beschreiben</span><textarea id="ai-routine-description" rows="4" placeholder="Ziel, Ausloeser, erwartetes Ergebnis und Fehlerverhalten"></textarea></label><div class="ai-conf-fields"><label class="form-group"><span>Zielumgebung</span><select id="ai-routine-target"><option value="server">Dashboard-Server</option><option value="computer">Eigener Computer</option></select></label><label class="form-group"><span>Runtime</span><select id="ai-routine-runtime"><option value="bash">Bash</option><option value="python">Python</option></select></label></div><label class="form-group"><span>Eingaben, Pfade, Rechte und Parameter</span><textarea id="ai-routine-inputs" rows="3" placeholder="Alle bekannten Werte, niemals Secrets"></textarea></label><small>Die KI erzeugt keine Routine, solange wichtige Betriebsdaten fehlen.</small></div><div class="ai-assistant-result" id="ai-special-result" hidden></div>'
        +'<label class="ai-conf-switch"><input id="ai-auto-assign" type="checkbox"'+(config.autoAssign?' checked':'')+'><span><strong>Teamzuweisung vorschlagen</strong><small>Beruecksichtigt Kompetenz, offene Arbeit und Verfuegbarkeit.</small></span></label>'
        +'<label class="ai-conf-switch"><input id="ai-progress-review" type="checkbox"'+(config.progressReview?' checked':'')+'><span><strong>Fortschritt aktiv pruefen</strong><small>Markiert Risiken, Blocker und ueberfaellige Arbeit fruehzeitig.</small></span></label>'
        +'<div class="ai-conf-actions"><button class="btn btn-secondary" type="button" id="ai-open-quicktask"><span class="material-symbols-rounded" aria-hidden="true">add_task</span><span>Aufgabe mit KI erstellen</span></button><button class="btn btn-secondary" type="button" id="ai-open-health"><span class="material-symbols-rounded" aria-hidden="true">fact_check</span><span>Fortschritt pruefen</span></button></div>'
      +'</section>'
    +'</div>'
    +'<section class="ai-conf-panel ai-conf-library"><div class="ai-conf-panel-head"><div><p class="section-kicker">Prompt-Bibliothek</p><h2>Vorlagen bearbeiten</h2><p>Die Vorlagen geben den Automationen einen einheitlichen Arbeitsrahmen.</p></div><button class="btn btn-secondary" type="button" id="ai-add-template"><span class="material-symbols-rounded" aria-hidden="true">add</span><span>Vorlage</span></button></div>'
      +'<div class="ai-template-list">'+config.templates.map(function(template,index){return '<article class="ai-template-item" data-index="'+index+'"><div class="ai-template-meta"><input class="ai-template-name" value="'+escapeHtml(template.name)+'" aria-label="Vorlagenname"><input class="ai-template-scope" value="'+escapeHtml(template.scope)+'" aria-label="Einsatzbereich"></div><textarea class="ai-template-text" rows="3" aria-label="Prompt-Vorlage">'+escapeHtml(template.text)+'</textarea><button type="button" class="toolbar-icon-btn ai-template-delete" title="Vorlage entfernen" aria-label="Vorlage entfernen"><span class="material-symbols-rounded" aria-hidden="true">delete</span></button></article>';}).join('')+'</div>'
    +'</section>';
  bindEvents(root,config,models);
}
function navigate(page){
  var link=document.querySelector('.nav-menu [data-page="'+page+'"]');
  if(link)link.click();
}
function bindEvents(root,config,models){
  root.querySelector('#ai-conf-refresh').addEventListener('click',function(){refreshModels(root,config,true);});
  root.querySelector('#ai-conf-stop').addEventListener('click',function(){if(window.LocalOllama&&window.LocalOllama.stopAll)window.LocalOllama.stopAll();});
  root.querySelector('#ai-assistant-project').addEventListener('change',function(){config.assistantProjectId=this.value;saveConfig(config);assistantDraft={projectId:'',mode:'',items:[]};renderAssistantDraft(root);});
  root.querySelectorAll('[data-assistant]').forEach(function(button){button.addEventListener('click',function(){var mode=this.getAttribute('data-assistant');if(mode==='githubE2E'||mode==='routine')runSpecialAssistant(root,mode);else runAssistant(root,mode);});});
  root.querySelector('#ai-temperature').addEventListener('input',function(){root.querySelector('#ai-temperature-value').value=this.value;root.querySelector('#ai-temperature-value').textContent=this.value;});
  root.querySelector('#ai-open-quicktask').addEventListener('click',function(){navigate('quicktask');});
  root.querySelector('#ai-open-health').addEventListener('click',function(){navigate('healthcheck');});
  root.querySelector('#ai-add-template').addEventListener('click',function(){config.templates.push({id:'custom-'+Date.now(),name:'Neue Vorlage',scope:'Eigener Workflow',text:'Beschreibe Ziel, Kontext, Regeln und gewuenschtes Ausgabeformat.'});renderWorkspace(root,config,models,'');});
  root.querySelectorAll('.ai-template-delete').forEach(function(button){button.addEventListener('click',function(){var item=this.closest('.ai-template-item');config.templates.splice(Number(item.getAttribute('data-index')),1);renderWorkspace(root,config,models,'');});});
  root.querySelector('#ai-conf-save').addEventListener('click',function(){
    config.routing=root.querySelector('#ai-routing').value;
    config.primaryModel=root.querySelector('#ai-primary-model').value;
    config.fallbackModel=root.querySelector('#ai-fallback-model').value;
    config.temperature=Math.max(0,Math.min(1,Number(root.querySelector('#ai-temperature').value)||0.3));
    config.maxTokens=Math.max(200,Math.min(6000,Number(root.querySelector('#ai-max-tokens').value)||3200));
    config.autoAssign=root.querySelector('#ai-auto-assign').checked;
    config.progressReview=root.querySelector('#ai-progress-review').checked;
    config.assistantProjectId=root.querySelector('#ai-assistant-project').value;
    config.templates=Array.prototype.map.call(root.querySelectorAll('.ai-template-item'),function(item,index){return {id:config.templates[index]&&config.templates[index].id||'custom-'+Date.now()+'-'+index,name:item.querySelector('.ai-template-name').value.trim()||'Unbenannte Vorlage',scope:item.querySelector('.ai-template-scope').value.trim()||'Eigener Workflow',text:item.querySelector('.ai-template-text').value.trim()};});
    saveConfig(config);notify('AI Conf wurde zentral gespeichert.',false);
  });
  syncActivityUI(window.LocalOllama&&window.LocalOllama.getStatus?window.LocalOllama.getStatus():null);
}
window.AIConfModule={render:render,getConfiguration:readConfig};
window.addEventListener('localOllamaStatusChanged',function(event){syncActivityUI(event.detail);});
})();
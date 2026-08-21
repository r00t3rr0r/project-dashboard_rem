/* ========================================
   Meeting Module
   Meeting-Protokoll + KI-Aufarbeitung
   ======================================== */
(function(){'use strict';

var NAMESPACE='MeetingModule';
var STORAGE_PREFIX='meeting_notes_';
var WORKFLOW_PREFIX='meeting_workflow_';
var ACTIVE_PROJECT_KEY='meeting_active_project';
var MEETING_PROTOCOL_DEFAULT_STATUS='open';
var AI_BACKEND_URL=(window.location&&/^https?:/i.test(window.location.origin||''))?window.location.origin.replace(/\/$/,''):'';
var DEFAULT_LABELS=['Entscheidung','Offen','Technisch','Budget'];

var state={
  projectId:'',
  draftProjectId:'',
  entries:[],
  conceptMarkdown:'',
  planMarkdown:'',
  tasksSummary:'',
  taskItems:[],
  taskDraft:null,
  draftAssigneeMode:'all',
  draftAssigneeAll:'',
  draftAssigneeMain:'',
  draftAssigneeSubtasks:'',
  busy:false,
  activeStage:'',
  saveStatus:'Bereit'
};

function isLocalDevelopmentHost(){
  try{
    var hostname=(window.location&&window.location.hostname)?String(window.location.hostname):'';
    return hostname==='localhost'||hostname==='127.0.0.1';
  }catch(_err){
    return false;
  }
}

function byId(id){return document.getElementById(id);}

function escapeHtml(value){
  if(value===null||value===undefined)return '';
  var div=document.createElement('div');
  div.appendChild(document.createTextNode(String(value)));
  return div.innerHTML;
}

function createId(prefix){
  return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}

function notify(message,isError){
  if(window.QuickTaskModule&&typeof window.QuickTaskModule.showToast==='function'){
    window.QuickTaskModule.showToast(message,!!isError);
    return;
  }
  if(isError){
    alert(message);
  }else{
    console.log('[Meeting]',message);
  }
}

function closeModal(){
  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(!overlay||!content)return;
  overlay.classList.add('hidden');
  content.innerHTML='';
}

function openCreateProjectModal(){
  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(!overlay||!content){
    notify('Modal-Container nicht verfuegbar.',true);
    return;
  }

  content.innerHTML=''
    +'<div class="meeting-create-modal">'
      +'<h2>Neues Projekt anlegen</h2>'
      +'<p class="modal-hint">Das Projekt startet in Planung. KI-Aufgaben und Termine werden erst beim Projektstart uebernommen.</p>'
      +'<label class="form-group"><span>Projektname</span><input id="meeting-new-project-title" type="text" placeholder="z. B. KI-Portal Relaunch"></label>'
      +'<label class="form-group"><span>Beschreibung</span><textarea id="meeting-new-project-description" rows="4" placeholder="Optionaler Projektkontext"></textarea></label>'
      +'<div class="modal-actions">'
        +'<button type="button" class="btn btn-secondary" id="meeting-new-project-cancel">Abbrechen</button>'
        +'<button type="button" class="btn btn-primary" id="meeting-new-project-save">Projekt erstellen</button>'
      +'</div>'
    +'</div>';

  overlay.classList.remove('hidden');

  var titleInput=document.getElementById('meeting-new-project-title');
  if(titleInput&&titleInput.focus)titleInput.focus();

  document.getElementById('meeting-new-project-cancel').addEventListener('click',function(){
    closeModal();
  });

  document.getElementById('meeting-new-project-save').addEventListener('click',function(){
    createProjectQuick();
  });
}

function getBackendCandidates(){
  var origin=(window.location&&window.location.origin)?window.location.origin:'';
  var list=[origin,AI_BACKEND_URL];
  if(isLocalDevelopmentHost()){
    list.push('http://localhost:8766','http://127.0.0.1:8766','http://127.0.0.1:8765');
  }
  if(origin)list.push(origin);
  return list.filter(function(item,idx){return item&&list.indexOf(item)===idx;});
}

function requestMeetingApi(path,method,payload){
  var bases=getBackendCandidates();
  function tryBase(index,lastError){
    if(index>=bases.length)return Promise.reject(lastError||new Error('Kein Storage-Backend erreichbar.'));
    var endpoint=bases[index]+path;
    var options={method:method,headers:{'Content-Type':'application/json'}};
    if(method==='POST')options.body=JSON.stringify(payload||{});

    return fetch(endpoint,options).then(function(res){
      return res.json().catch(function(){return {};}).then(function(body){
        if(!res.ok){
          var err=new Error(body&&body.error?body.error:('HTTP '+res.status+' @ '+endpoint));
          if(res.status===404||res.status===405||res.status===501)return tryBase(index+1,err);
          throw err;
        }
        return body;
      });
    }).catch(function(err){
      if(index+1<bases.length)return tryBase(index+1,err);
      throw err;
    });
  }
  return tryBase(0,null);
}

function getProjectTitle(project){
  if(!project)return 'Unbenanntes Projekt';
  return project.title||project.name||'Unbenanntes Projekt';
}

function ensureMeetingProtocol(project){
  if(!project||typeof project!=='object')return {status:MEETING_PROTOCOL_DEFAULT_STATUS,closedAt:'',updatedAt:''};
  if(!project.meetingProtocol||typeof project.meetingProtocol!=='object'){
    project.meetingProtocol={status:MEETING_PROTOCOL_DEFAULT_STATUS,closedAt:'',updatedAt:''};
  }
  if(project.meetingProtocol.status!=='closed')project.meetingProtocol.status=MEETING_PROTOCOL_DEFAULT_STATUS;
  if(typeof project.meetingProtocol.closedAt!=='string')project.meetingProtocol.closedAt='';
  if(typeof project.meetingProtocol.updatedAt!=='string')project.meetingProtocol.updatedAt='';
  return project.meetingProtocol;
}

function updateMeetingProtocol(projectId,updater){
  if(!projectId||!window.DataLayer||typeof window.DataLayer.getProjectById!=='function'||typeof window.DataLayer.updateProject!=='function')return;
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;
  var protocol=ensureMeetingProtocol(project);
  if(typeof updater==='function')updater(protocol,project);
  window.DataLayer.updateProject(project);
}

function touchMeetingProtocol(projectId){
  updateMeetingProtocol(projectId,function(protocol){
    protocol.updatedAt=new Date().toISOString();
  });
}

function ensureExecutionPlanDraft(project){
  if(!project||typeof project!=='object')return {status:'empty',queuedTasks:[],queuedEvents:[],milestoneDraft:{status:'idle',summaryMarkdown:'',items:[],generatedAt:''}};
  if(!project.executionPlanDraft||typeof project.executionPlanDraft!=='object'){
    project.executionPlanDraft={};
  }
  var draft=project.executionPlanDraft;
  if(typeof draft.status!=='string'||!draft.status)draft.status='empty';
  if(typeof draft.generatedAt!=='string')draft.generatedAt='';
  if(typeof draft.updatedAt!=='string')draft.updatedAt='';
  if(!Array.isArray(draft.queuedTasks))draft.queuedTasks=[];
  if(!Array.isArray(draft.queuedEvents))draft.queuedEvents=[];
  if(!draft.milestoneDraft||typeof draft.milestoneDraft!=='object')draft.milestoneDraft={};
  if(typeof draft.milestoneDraft.status!=='string')draft.milestoneDraft.status='idle';
  if(typeof draft.milestoneDraft.summaryMarkdown!=='string')draft.milestoneDraft.summaryMarkdown='';
  if(typeof draft.milestoneDraft.generatedAt!=='string')draft.milestoneDraft.generatedAt='';
  if(!Array.isArray(draft.milestoneDraft.items))draft.milestoneDraft.items=[];
  return draft;
}

function queueExecutionPlanItems(projectId,items){
  if(!window.DataLayer||typeof window.DataLayer.getProjectById!=='function'||typeof window.DataLayer.updateProject!=='function'){
    throw new Error('DataLayer.updateProject ist nicht verfuegbar.');
  }
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)throw new Error('Projekt nicht gefunden.');

  var draft=ensureExecutionPlanDraft(project);
  var list=Array.isArray(items)?items:[];
  var nowIso=new Date().toISOString();
  var queuedTaskCount=0;
  var queuedEventCount=0;

  list.forEach(function(item){
    if(!item||typeof item!=='object')return;
    if(item.kind==='task'&&item.payload&&item.payload.title){
      draft.queuedTasks.push(item.payload);
      queuedTaskCount++;
    }
    if(item.kind==='event'&&item.payload&&item.payload.title&&item.payload.date){
      draft.queuedEvents.push(item.payload);
      queuedEventCount++;
    }
  });

  if(queuedTaskCount||queuedEventCount){
    draft.status='queued';
    draft.generatedAt=draft.generatedAt||nowIso;
    draft.updatedAt=nowIso;
    project.status=project.status==='done'?'done':'planning';
    window.DataLayer.updateProject(project);
  }

  return {tasks:queuedTaskCount,events:queuedEventCount};
}

function toggleMeetingProtocolStatus(){
  var project=currentProject();
  if(!project){
    notify('Bitte zuerst ein Projekt auswaehlen.',true);
    return;
  }

  var protocol=ensureMeetingProtocol(project);
  var nowIso=new Date().toISOString();
  var nextStatus=protocol.status==='closed'?'open':'closed';

  protocol.status=nextStatus;
  protocol.updatedAt=nowIso;
  protocol.closedAt=nextStatus==='closed'?nowIso:'';

  window.DataLayer.updateProject(project);
  renderProtocolState();
  notify('Meeting-Protokoll fuer '+getProjectTitle(project)+' ist jetzt '+(nextStatus==='closed'?'Closed':'Open')+'.',false);
}

function getProjects(){
  if(!window.DataLayer||typeof window.DataLayer.getProjects!=='function')return [];
  var list=window.DataLayer.getProjects()||[];
  return list.slice().sort(function(a,b){
    return getProjectTitle(a).localeCompare(getProjectTitle(b),'de');
  });
}

function localKey(projectId){
  return STORAGE_PREFIX+projectId;
}

function workflowKey(projectId){
  return WORKFLOW_PREFIX+projectId;
}

function readActiveProjectId(){
  try{
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY)||'';
  }catch(_err){
    return '';
  }
}

function writeActiveProjectId(projectId){
  try{
    if(projectId){
      window.localStorage.setItem(ACTIVE_PROJECT_KEY,projectId);
    }else{
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }catch(_err){}
}

function readEntriesFromLocal(projectId){
  if(!projectId)return [];
  try{
    var raw=window.localStorage.getItem(localKey(projectId));
    var parsed=raw?JSON.parse(raw):[];
    if(!Array.isArray(parsed))return [];
    return parsed.filter(function(item){
      return item&&typeof item.text==='string';
    });
  }catch(_err){
    return [];
  }
}

function writeEntriesToLocal(projectId,entries){
  if(!projectId)return;
  try{
    window.localStorage.setItem(localKey(projectId),JSON.stringify(entries||[]));
  }catch(_err){}
}

function readWorkflowState(projectId){
  if(!projectId)return {};
  try{
    var raw=window.localStorage.getItem(workflowKey(projectId));
    var parsed=raw?JSON.parse(raw):{};
    return parsed&&typeof parsed==='object'?parsed:{};
  }catch(_err){
    return {};
  }
}

function writeWorkflowState(projectId,data){
  if(!projectId)return;
  try{
    window.localStorage.setItem(workflowKey(projectId),JSON.stringify(data||{}));
  }catch(_err){}
}

function syncEntriesToServer(projectId,entries){
  if(!projectId)return Promise.resolve();
  return requestMeetingApi('/api/meetings/'+encodeURIComponent(projectId),'POST',{notes:entries||[]}).catch(function(){
    return null;
  });
}

function fetchEntriesFromServer(projectId){
  if(!projectId)return Promise.resolve([]);
  return requestMeetingApi('/api/meetings/'+encodeURIComponent(projectId),'GET').then(function(body){
    var notes=body&&Array.isArray(body.notes)?body.notes:[];
    return notes.filter(function(item){return item&&typeof item.text==='string';});
  }).catch(function(){
    return [];
  });
}

function getLabelOptions(){
  var labels=(window.DataLayer&&window.DataLayer.getLabels)?window.DataLayer.getLabels():[];
  var names=labels.map(function(item){return item&&item.name?String(item.name).trim():'';}).filter(function(name){return !!name;});
  DEFAULT_LABELS.forEach(function(label){
    if(names.indexOf(label)===-1)names.push(label);
  });
  return names;
}

function splitLines(text){
  return String(text||'').split(/\r?\n/).map(function(line){return line.trim();}).filter(function(line){return !!line;});
}

function toDateValue(value){
  var text=String(value||'').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

function toTimeValue(value){
  var text=String(value||'').trim();
  return /^\d{2}:\d{2}$/.test(text)?text:'';
}

function normalizeDraftSchedule(schedule){
  var item=schedule&&typeof schedule==='object'?schedule:{};
  var mode=String(item.mode||'none').trim().toLowerCase();
  if(['none','deadline','fixed','range','asap'].indexOf(mode)===-1)mode='none';
  return {
    mode:mode,
    deadline:toDateValue(item.deadline),
    fixedAt:toDateValue(item.fixedAt),
    rangeStart:toDateValue(item.rangeStart),
    rangeEnd:toDateValue(item.rangeEnd)
  };
}

function normalizeTaskDraft(rawDraft,options){
  var draft=rawDraft&&typeof rawDraft==='object'?rawDraft:{};
  var task=draft.task&&typeof draft.task==='object'?draft.task:{};
  var event=draft.event&&typeof draft.event==='object'?draft.event:{};
  var sourceEvents=Array.isArray(draft.events)?draft.events:[];
  if(!sourceEvents.length&&Object.keys(event).length)sourceEvents=[event];
  var fallbackScheduleMode=String(options&&options.scheduleMode||'none').trim().toLowerCase();
  var fallbackEventType=String(options&&options.eventType||'meeting').trim().toLowerCase();
  var sourceSuggestions=Array.isArray(draft.taskSuggestions)?draft.taskSuggestions:[];

  var normalizedEvents=sourceEvents.slice(0,12).map(function(item){
    var entry=item&&typeof item==='object'?item:{};
    var eventType=String(entry.type||fallbackEventType||'meeting').trim().toLowerCase();
    if(['meeting','deadline','release','holiday','task'].indexOf(eventType)===-1)eventType='meeting';
    return {
      create:entry.create!==false,
      title:String(entry.title||'').trim(),
      description:String(entry.description||'').trim(),
      type:eventType,
      date:toDateValue(entry.date),
      startTime:toTimeValue(entry.startTime),
      endTime:toTimeValue(entry.endTime)
    };
  }).filter(function(item){return !!(item.title||item.date);});
  var primaryEvent=normalizedEvents[0]||{
    create:!!event.create,
    title:String(event.title||'').trim(),
    description:String(event.description||'').trim(),
    type:String(event.type||fallbackEventType||'meeting').trim().toLowerCase(),
    date:toDateValue(event.date),
    startTime:toTimeValue(event.startTime),
    endTime:toTimeValue(event.endTime)
  };

  var normalized={
    summaryMarkdown:String(draft.summaryMarkdown||'').trim(),
    task:{
      titleDe:String(task.titleDe||'').trim(),
      titleEn:String(task.titleEn||'').trim(),
      descriptionDe:String(task.descriptionDe||'').trim(),
      descriptionEn:String(task.descriptionEn||'').trim(),
      priority:String(task.priority||'medium').trim().toLowerCase(),
      urgency:String(task.urgency||'normal').trim().toLowerCase(),
      effortHours:Number(task.effortHours||0)||0,
      labels:Array.isArray(task.labels)?task.labels.map(function(label){return String(label||'').trim();}).filter(function(label){return !!label;}):[],
      sequenceIndex:Number(task.sequenceIndex||0)||0,
      dependsOnPrevious:!!task.dependsOnPrevious,
      dependencyTaskId:normalizeTaskDependencyId(task.dependencyTaskId||''),
      schedule:normalizeDraftSchedule(task.schedule||{mode:fallbackScheduleMode}),
      subtasksDe:Array.isArray(task.subtasksDe)?task.subtasksDe.map(function(line){return String(line||'').trim();}).filter(function(line){return !!line;}):[],
      subtasksEn:Array.isArray(task.subtasksEn)?task.subtasksEn.map(function(line){return String(line||'').trim();}).filter(function(line){return !!line;}):[],
      note:String(task.note||'').trim()
    },
    taskSuggestions:sourceSuggestions.map(function(item){
      var entry=item&&typeof item==='object'?item:{};
      return {
        titleDe:String(entry.titleDe||'').trim(),
        titleEn:String(entry.titleEn||'').trim(),
        descriptionDe:String(entry.descriptionDe||'').trim(),
        descriptionEn:String(entry.descriptionEn||'').trim(),
        priority:String(entry.priority||'medium').trim().toLowerCase(),
        urgency:String(entry.urgency||'normal').trim().toLowerCase(),
        effortHours:Number(entry.effortHours||0)||0,
        labels:Array.isArray(entry.labels)?entry.labels.map(function(label){return String(label||'').trim();}).filter(function(label){return !!label;}):[],
        note:String(entry.note||'').trim(),
        assigneeId:normalizeAssigneeId(entry.assigneeId||''),
        sequenceIndex:Number(entry.sequenceIndex||0)||0,
        dependsOnPrevious:!!entry.dependsOnPrevious,
        dependencyTaskId:normalizeTaskDependencyId(entry.dependencyTaskId||''),
      };
    }).filter(function(item){return !!(item.titleDe||item.titleEn);}),
    events:normalizedEvents,
    event:primaryEvent
  };

  if(['low','medium','high','blocker'].indexOf(normalized.task.priority)===-1)normalized.task.priority='medium';
  if(['low','normal','high','critical'].indexOf(normalized.task.urgency)===-1)normalized.task.urgency='normal';
  if(['meeting','deadline','release','holiday','task'].indexOf(normalized.event.type)===-1)normalized.event.type='meeting';
  normalized.task.dependencyTaskId=normalizeTaskDependencyId(normalized.task.dependencyTaskId||'');
  normalized.taskSuggestions=normalized.taskSuggestions.map(function(item){
    if(['low','medium','high','blocker'].indexOf(item.priority)===-1)item.priority='medium';
    if(['low','normal','high','critical'].indexOf(item.urgency)===-1)item.urgency='normal';
    item.dependencyTaskId=normalizeTaskDependencyId(item.dependencyTaskId||'');
    return item;
  });
  if(!options||!options.createSubtasks){
    normalized.task.subtasksDe=[];
    normalized.task.subtasksEn=[];
  }

  return normalized;
}

function fallbackPopulateDraftFromInput(draft,inputText,options){
  function toEnglishFallback(text){
    var output=String(text||'').trim();
    if(!output)return '';
    var replacements=[
      [/\bAltauftragsdaten\b/gi,'legacy order data'],
      [/\bexportieren\b/gi,'export'],
      [/\binterface\b/gi,'interface'],
      [/\bdarstellen\b/gi,'display'],
      [/\bmit\b/gi,'with'],
      [/\bKI\b/g,'AI'],
      [/\bProgrammierung\b/gi,'programming'],
      [/\bund\b/gi,'and'],
      [/\bTeilaufgabe\b/gi,'subtask']
    ];
    replacements.forEach(function(rule){
      output=output.replace(rule[0],rule[1]);
    });
    return output;
  }

  function inferLabels(text){
    var source=String(text||'').toLowerCase();
    var labels=[];
    if(source.indexOf('ki')!==-1||source.indexOf('ai')!==-1)labels.push('Technisch');
    if(source.indexOf('export')!==-1||source.indexOf('daten')!==-1)labels.push('Offen');
    if(source.indexOf('interface')!==-1||source.indexOf('integration')!==-1)labels.push('Technisch');
    if(!labels.length)labels.push('Offen');
    return labels.filter(function(label,idx,list){return list.indexOf(label)===idx;});
  }

  function inferEffort(partsCount,text){
    var tokens=splitLines(String(text||'').replace(/[^a-zA-Z0-9]+/g,' ')).join(' ').split(' ').filter(Boolean);
    var complexity=Math.max(1,Math.min(8,Math.ceil(tokens.length/10)));
    return Math.max(2,Math.min(16,Math.round((partsCount*1.5+complexity)*2)/2));
  }

  var normalized=draft&&typeof draft==='object'?draft:{task:{},event:{},taskSuggestions:[]};
  if(!normalized.task)normalized.task={};
  if(!Array.isArray(normalized.taskSuggestions))normalized.taskSuggestions=[];

  var input=String(inputText||'').trim();
  if(!input)return normalized;

  var rawParts=splitLines(input.replace(/[;]+/g,'\n').replace(/[|]+/g,'\n').replace(/,+/g,'\n'));
  var parts=rawParts.slice();
  if(parts.length<=1){
    var undSplit=input.split(/\bund\b/i).map(function(item){return item.trim();}).filter(function(item){return !!item;});
    if(undSplit.length>1)parts=undSplit;
  }
  if(!parts.length)parts=[input];

  var titleSeed=parts[0]||input;
  var titleSeedEn=toEnglishFallback(titleSeed);
  var inferredLabels=inferLabels(input);
  var inferredEffort=inferEffort(parts.length,input);

  if(!String(normalized.task.titleDe||'').trim())normalized.task.titleDe=titleSeed;
  if(!String(normalized.task.titleEn||'').trim())normalized.task.titleEn=titleSeedEn||titleSeed;
  if(!String(normalized.task.descriptionDe||'').trim())normalized.task.descriptionDe=input;
  if(!String(normalized.task.descriptionEn||'').trim())normalized.task.descriptionEn=toEnglishFallback(input)||input;
  if(['low','medium','high','blocker'].indexOf(String(normalized.task.priority||''))===-1)normalized.task.priority='medium';
  if(['low','normal','high','critical'].indexOf(String(normalized.task.urgency||''))===-1)normalized.task.urgency='normal';
  if(!Array.isArray(normalized.task.labels)||!normalized.task.labels.length)normalized.task.labels=inferredLabels;
  if(typeof normalized.task.effortHours!=='number'||isNaN(normalized.task.effortHours)||normalized.task.effortHours<=0)normalized.task.effortHours=inferredEffort;
  if(!String(normalized.task.note||'').trim())normalized.task.note='Automatisch aus Eingabetext vorbefuellt. Bitte vor dem Anlegen pruefen.';

  if(!normalized.task.schedule||typeof normalized.task.schedule!=='object')normalized.task.schedule={};
  var mode=String((options&&options.scheduleMode)||normalized.task.schedule.mode||'none').toLowerCase();
  if(['none','deadline','fixed','range','asap'].indexOf(mode)===-1)mode='none';
  normalized.task.schedule.mode=mode;
  if(typeof normalized.task.schedule.deadline!=='string')normalized.task.schedule.deadline='';
  if(typeof normalized.task.schedule.fixedAt!=='string')normalized.task.schedule.fixedAt='';
  if(typeof normalized.task.schedule.rangeStart!=='string')normalized.task.schedule.rangeStart='';
  if(typeof normalized.task.schedule.rangeEnd!=='string')normalized.task.schedule.rangeEnd='';
  if(mode==='asap'&&!normalized.task.schedule.deadline){
    normalized.task.schedule.deadline=new Date().toISOString().slice(0,10);
  }

  if(options&&options.createSubtasks&&(!Array.isArray(normalized.task.subtasksDe)||!normalized.task.subtasksDe.length)){
    normalized.task.subtasksDe=parts.slice(0,6);
  }
  if(options&&options.createSubtasks&&(!Array.isArray(normalized.task.subtasksEn)||!normalized.task.subtasksEn.length)){
    normalized.task.subtasksEn=parts.slice(0,6).map(function(part){return toEnglishFallback(part)||part;});
  }

  if(!normalized.event||typeof normalized.event!=='object')normalized.event={};
  var eventType=String((options&&options.eventType)||normalized.event.type||'meeting').toLowerCase();
  if(['meeting','deadline','release','holiday','task'].indexOf(eventType)===-1)eventType='meeting';
  normalized.event.type=eventType;
  if(typeof normalized.event.create!=='boolean')normalized.event.create=(mode!=='none');
  if(!String(normalized.event.title||'').trim())normalized.event.title='Task: '+(normalized.task.titleDe||titleSeed);
  if(!String(normalized.event.description||'').trim())normalized.event.description='DE: '+(normalized.task.descriptionDe||input)+'\n\nEN: '+(normalized.task.descriptionEn||toEnglishFallback(input));
  if(typeof normalized.event.date!=='string')normalized.event.date='';
  if(typeof normalized.event.startTime!=='string')normalized.event.startTime='';
  if(typeof normalized.event.endTime!=='string')normalized.event.endTime='';

  var todayIso=new Date().toISOString().slice(0,10);
  if(!normalized.event.date)normalized.event.date=todayIso;
  if(!normalized.event.startTime)normalized.event.startTime='09:00';
  if(!normalized.event.endTime)normalized.event.endTime='10:00';

  if(mode==='deadline'&&normalized.task.schedule.deadline&&!normalized.event.date){
    normalized.event.date=normalized.task.schedule.deadline;
  }
  if(mode==='fixed'&&normalized.task.schedule.fixedAt&&!normalized.event.date){
    normalized.event.date=normalized.task.schedule.fixedAt;
  }
  if(mode==='range'&&normalized.task.schedule.rangeStart&&!normalized.event.date){
    normalized.event.date=normalized.task.schedule.rangeStart;
  }
  if(mode==='asap'&&!normalized.event.date){
    normalized.event.date=new Date().toISOString().slice(0,10);
  }
  if(!Array.isArray(normalized.events)||!normalized.events.length){
    normalized.events=normalized.event.create?[normalized.event]:[];
  }else{
    normalized.event=normalized.events[0];
  }

  if(options&&options.splitIntoMultiple&&parts.length>1&&!normalized.taskSuggestions.length){
    normalized.taskSuggestions=parts.slice(0,8).map(function(part,idx){
      var partEn=toEnglishFallback(part)||part;
      return {
        titleDe:part,
        titleEn:partEn,
        descriptionDe:'Teilaufgabe aus Eingabetext: '+part,
        descriptionEn:'Subtask derived from input: '+partEn,
        priority:normalized.task.priority||'medium',
        urgency:normalized.task.urgency||'normal',
        effortHours:Math.max(0.5,Math.round(((normalized.task.effortHours||2)/Math.max(parts.length,1))*100)/100),
        sequenceIndex:normalized.task.sequenceIndex?normalized.task.sequenceIndex+idx+1:idx+1,
        dependsOnPrevious:idx>0,
        labels:Array.isArray(normalized.task.labels)?normalized.task.labels.slice():[],
        note:''
      };
    });
  }

  normalized.taskSuggestions=normalized.taskSuggestions.map(function(item){
    if(!item.titleDe&&item.titleEn)item.titleDe=item.titleEn;
    if(!item.titleEn&&item.titleDe)item.titleEn=toEnglishFallback(item.titleDe)||item.titleDe;
    if(!item.descriptionDe)item.descriptionDe='Teilaufgabe: '+(item.titleDe||item.titleEn||'');
    if(!item.descriptionEn)item.descriptionEn='Subtask: '+(item.titleEn||item.titleDe||'');
    if(!item.labels||!item.labels.length)item.labels=Array.isArray(normalized.task.labels)?normalized.task.labels.slice():[];
    if(!item.effortHours||isNaN(Number(item.effortHours)))item.effortHours=Math.max(0.5,Math.round(((normalized.task.effortHours||2)/Math.max(normalized.taskSuggestions.length,1))*100)/100);
    if(!item.sequenceIndex)item.sequenceIndex=normalized.task.sequenceIndex||1;
    return item;
  });

  return normalized;
}

function resolveLabelIdsByNames(names){
  var source=Array.isArray(names)?names:[];
  var labels=(window.DataLayer&&window.DataLayer.getLabels)?window.DataLayer.getLabels():[];
  var map={};
  labels.forEach(function(label){
    var key=String((label&&label.name)||'').trim().toLowerCase();
    if(key)map[key]=label.id;
  });
  return source.map(function(name){
    var key=String(name||'').trim().toLowerCase();
    return map[key]||null;
  }).filter(function(id,idx,list){return !!id&&list.indexOf(id)===idx;});
}

function getEmployees(){
  if(!window.DataLayer||typeof window.DataLayer.getEmployees!=='function')return [];
  return (window.DataLayer.getEmployees()||[]).slice();
}

function isKnownEmployeeId(employeeId){
  if(!employeeId)return false;
  var id=String(employeeId);
  var employees=getEmployees();
  for(var i=0;i<employees.length;i++){
    if(String(employees[i]&&employees[i].id||'')===id)return true;
  }
  return false;
}

function normalizeAssigneeId(employeeId){
  return isKnownEmployeeId(employeeId)?String(employeeId):'';
}

function buildEmployeeSelectOptions(selectedId){
  var employees=getEmployees();
  var selected=normalizeAssigneeId(selectedId);
  var options=['<option value="">-- Nicht zugewiesen --</option>'];
  employees.sort(function(a,b){
    return String((a&&a.name)||'').localeCompare(String((b&&b.name)||''),'de');
  }).forEach(function(emp){
    var id=String(emp&&emp.id||'');
    if(!id)return;
    var name=String(emp&&emp.name||emp&&emp.title||id);
    var role=String(emp&&emp.role||'').trim();
    var label=role?(name+' ('+role+')'):name;
    options.push('<option value="'+escapeAttr(id)+'"'+(selected===id?' selected':'')+'>'+escapeHtml(label)+'</option>');
  });
  return options.join('');
}

function buildTaskDependencySelectOptions(projectId,selectedId){
  var tasks=window.DataLayer&&typeof window.DataLayer.getTasks==='function'?window.DataLayer.getTasks():[];
  var selected=String(selectedId||'');
  var options=['<option value="">-- Kein Vorgänger --</option>'];
  tasks.filter(function(task){
    return task&&String(task.projectId||'')===String(projectId||'');
  }).sort(function(a,b){
    var aSeq=Number(a&&a.sequenceIndex||0)||0;
    var bSeq=Number(b&&b.sequenceIndex||0)||0;
    if(aSeq||bSeq){
      if(aSeq&&!bSeq)return -1;
      if(!aSeq&&bSeq)return 1;
      if(aSeq!==bSeq)return aSeq-bSeq;
    }
    return String((a&&a.createdAt)||'').localeCompare(String((b&&b.createdAt)||''));
  }).forEach(function(task){
    var id=String(task&&task.id||'');
    if(!id)return;
    var label=(task.sequenceIndex?('#'+task.sequenceIndex+' '):'')+(task.title||'Ohne Titel');
    if(task.status==='done')label+=' · erledigt';
    options.push('<option value="'+escapeAttr(id)+'"'+(selected===id?' selected':'')+'>'+escapeHtml(label)+'</option>');
  });
  return options.join('');
}

function currentDependencyTaskId(selectId){
  return normalizeTaskDependencyId((byId(selectId)||{}).value||'');
}

function normalizeTaskDependencyId(taskId){
  return String(taskId||'').trim();
}

function updateDraftAssigneeVisibility(){
  var modeEl=byId('meeting-draft-assignee-mode');
  var mode=modeEl?String(modeEl.value||'all'):'all';
  if(mode!=='all'&&mode!=='per-task')mode='all';
  state.draftAssigneeMode=mode;

  var isAllMode=mode==='all';
  var allRows=document.querySelectorAll('.meeting-assignee-all-only');
  var perRows=document.querySelectorAll('.meeting-assignee-per-task');
  for(var i=0;i<allRows.length;i++)allRows[i].classList.toggle('hidden',!isAllMode);
  for(var j=0;j<perRows.length;j++)perRows[j].classList.toggle('hidden',isAllMode);
}

function syncDraftAssigneeStateFromUi(){
  state.draftAssigneeMode=((byId('meeting-draft-assignee-mode')||{}).value||'all');
  state.draftAssigneeAll=normalizeAssigneeId((byId('meeting-draft-assignee-all')||{}).value||'');
  state.draftAssigneeMain=normalizeAssigneeId((byId('meeting-draft-assignee-main')||{}).value||'');
  state.draftAssigneeSubtasks=normalizeAssigneeId((byId('meeting-draft-assignee-subtasks')||{}).value||'');
}

function resolveAssigneeForMainTask(){
  syncDraftAssigneeStateFromUi();
  if(state.draftAssigneeMode==='all')return state.draftAssigneeAll||null;
  return state.draftAssigneeMain||null;
}

function resolveAssigneeForBulkSubtasks(){
  syncDraftAssigneeStateFromUi();
  if(state.draftAssigneeMode==='all')return state.draftAssigneeAll||null;
  return state.draftAssigneeSubtasks||null;
}

function resolveEventAttendeeIds(){
  var assigneeId=resolveAssigneeForMainTask();
  return assigneeId?[assigneeId]:[];
}

function buildCalendarEventPayload(projectId,eventPayload,fallbackTitle){
  var attendeeIds=resolveEventAttendeeIds();
  var payload={
    title:eventPayload.title||fallbackTitle||'Termin',
    description:eventPayload.description||'',
    date:eventPayload.date,
    startDate:eventPayload.date,
    startTime:eventPayload.startTime||'',
    endTime:eventPayload.endTime||'',
    type:eventPayload.type||'meeting',
    projectId:projectId,
    attendeeIds:attendeeIds
  };
  if(attendeeIds.length===1)payload.attendeeId=attendeeIds[0];
  return payload;
}

function buildMeetingMarkdown(project,entries){
  var lines=[];
  lines.push('# Meeting Protokoll');
  lines.push('');
  lines.push('- Projekt: '+getProjectTitle(project));
  lines.push('- Projekt-ID: '+(project&&project.id?project.id:'n/a'));
  lines.push('- Exportiert: '+new Date().toISOString());
  lines.push('');

  if(!entries.length){
    lines.push('- (keine Eintraege)');
  }else{
    entries.forEach(function(item){
      var stamp=item.createdAt?String(item.createdAt).replace('T',' ').slice(0,16):'';
      var label=item.label?' ['+item.label+']':'';
      lines.push('-'+label+(stamp?' ('+stamp+')':'')+' '+item.text);
    });
  }

  return lines.join('\n');
}

function downloadFile(fileName,content,mimeType){
  var blob=new Blob([content],{type:mimeType||'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download=fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setBusy(stage,isBusy){
  state.busy=!!isBusy;
  state.activeStage=isBusy?stage:'';
  var root=byId('meeting-root');
  if(root){
    root.classList.toggle('is-busy',state.busy);
  }
  var spinner=byId('meeting-loading');
  if(spinner){
    spinner.textContent=isBusy?('KI arbeitet: '+stage+' ...'):state.saveStatus;
  }
  ['meeting-add-entry','meeting-analyze-note','meeting-run-concept','meeting-run-concept-inline','meeting-run-plan','meeting-run-tasks','meeting-save','meeting-run-task-draft','meeting-apply-task-draft','meeting-apply-bulk-task-draft','meeting-apply-suggested-tasks','meeting-apply-event-draft'].forEach(function(id){
    var btn=byId(id);
    if(btn)btn.disabled=!!isBusy;
  });
}

function setSaveStatus(message){
  state.saveStatus=message||'Bereit';
  if(!state.busy){
    var spinner=byId('meeting-loading');
    if(spinner)spinner.textContent=state.saveStatus;
  }
}

function currentProject(){
  if(!state.projectId||!window.DataLayer||typeof window.DataLayer.getProjectById!=='function')return null;
  return window.DataLayer.getProjectById(state.projectId);
}

function renderProjectSelect(){
  var select=byId('meeting-project-select');
  var draftSelect=byId('meeting-draft-project-select');
  if(!select)return;

  var projects=getProjects();
  if(!projects.length){
    select.innerHTML='<option value="">-- Kein Projekt vorhanden --</option>';
    if(draftSelect)draftSelect.innerHTML='<option value="">-- Kein Projekt vorhanden --</option>';
    state.projectId='';
    state.draftProjectId='';
    writeActiveProjectId('');
    return;
  }

  if(!state.projectId||!window.DataLayer.getProjectById(state.projectId)){
    var persisted=readActiveProjectId();
    state.projectId=window.DataLayer.getProjectById(persisted)?persisted:projects[0].id;
  }

  writeActiveProjectId(state.projectId);
  if(!state.draftProjectId||!window.DataLayer.getProjectById(state.draftProjectId)){
    state.draftProjectId=state.projectId;
  }

  select.innerHTML=projects.map(function(project){
    var selected=project.id===state.projectId?' selected':'';
    return '<option value="'+escapeHtml(project.id)+'"'+selected+'>'+escapeHtml(getProjectTitle(project))+'</option>';
  }).join('');

  if(draftSelect){
    draftSelect.innerHTML=projects.map(function(project){
      var selected=project.id===state.draftProjectId?' selected':'';
      return '<option value="'+escapeHtml(project.id)+'"'+selected+'>'+escapeHtml(getProjectTitle(project))+'</option>';
    }).join('');
  }
}

function renderEntries(){
  var list=byId('meeting-entry-list');
  if(!list)return;

  if(!state.entries.length){
    list.innerHTML='<div class="empty-state-panel"><p>Noch keine Stichpunkte. Starte mit dem Plus-Button.</p></div>';
    return;
  }

  list.innerHTML=state.entries.map(function(item){
    var stamp=item.createdAt?new Date(item.createdAt).toLocaleString('de-DE',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):'';
    var label=item.label?'<span class="meeting-chip">'+escapeHtml(item.label)+'</span>':'';
    return ''
      +'<article class="meeting-entry">'
        +'<div class="meeting-entry-head">'
          +'<div class="meeting-entry-meta">'+label+'<small>'+escapeHtml(stamp)+'</small></div>'
          +'<button class="btn btn-secondary meeting-entry-delete" data-id="'+escapeHtml(item.id)+'" type="button">Entfernen</button>'
        +'</div>'
        +'<p>'+escapeHtml(item.text)+'</p>'
      +'</article>';
  }).join('');
}

function renderWorkflow(){
  var conceptEl=byId('meeting-concept-output');
  var planEl=byId('meeting-plan-output');
  var tasksEl=byId('meeting-tasks-output');
  if(conceptEl)conceptEl.innerHTML=renderStageOutput(state.conceptMarkdown||'Noch kein Konzept generiert.','concept');
  if(planEl)planEl.innerHTML=renderStageOutput(state.planMarkdown||'Noch kein Plan generiert.','plan');
  if(tasksEl)tasksEl.innerHTML=renderTasksOutput(state.tasksSummary||'Noch keine Tasks generiert.',state.taskItems);

  var planBtn=byId('meeting-run-plan');
  var tasksBtn=byId('meeting-run-tasks');
  var saveBtn=byId('meeting-save');
  if(planBtn)planBtn.disabled=state.busy||!state.conceptMarkdown;
  if(tasksBtn)tasksBtn.disabled=state.busy||!state.planMarkdown;
  if(saveBtn)saveBtn.disabled=state.busy||!currentProject();
}

function renderDraftScheduleFields(containerId,schedule){
  var wrap=byId(containerId);
  if(!wrap)return;
  var cfg=normalizeDraftSchedule(schedule||{});
  var html='';
  if(cfg.mode==='deadline'){
    html='<label class="form-group"><span>Deadline</span><input type="date" id="meeting-draft-deadline" value="'+escapeAttr(cfg.deadline)+'"></label>';
  }else if(cfg.mode==='fixed'){
    html='<label class="form-group"><span>Fester Termin</span><input type="date" id="meeting-draft-fixed" value="'+escapeAttr(cfg.fixedAt)+'"></label>';
  }else if(cfg.mode==='range'){
    html=''
      +'<div class="meeting-draft-grid">'
        +'<label class="form-group"><span>Start</span><input type="date" id="meeting-draft-range-start" value="'+escapeAttr(cfg.rangeStart)+'"></label>'
        +'<label class="form-group"><span>Ende</span><input type="date" id="meeting-draft-range-end" value="'+escapeAttr(cfg.rangeEnd)+'"></label>'
      +'</div>';
  }else if(cfg.mode==='asap'){
    html='<p class="text-muted">Aufgabe wird als umgehend eingeplant.</p>';
  }
  wrap.innerHTML=html;
}

function buildDraftSubtaskListHtml(task){
  var subtasks=normalizeQueuedSubtaskList([
    ...(Array.isArray(task&&task.subtasksDe)?task.subtasksDe:[]),
    ...(Array.isArray(task&&task.subtasksEn)?task.subtasksEn:[])
  ]);
  if(!subtasks.length){
    return '<div class="task-cockpit-list"><p class="text-muted">Noch keine Teilaufgaben.</p></div>';
  }

  var html='<div class="task-cockpit-list">';
  subtasks.forEach(function(st, index){
    if(!st||!st.title)return;
    html+='<div class="task-cockpit-list-item" data-draft-subtask-item="'+escapeAttr(String(st.id||index))+'">';
    html+='<label><input type="checkbox" data-draft-subtask-toggle="'+escapeAttr(String(st.id||index))+'" '+(st.completed?'checked':'')+'> '+escapeHtml(st.title)+'</label>';
    html+='<button type="button" class="btn btn-secondary" data-draft-subtask-remove="'+escapeAttr(String(st.id||index))+'">Entfernen</button>';
    html+='</div>';
  });
  html+='</div>';
  return html;
}

function renderTaskDraftPreview(){
  var host=byId('meeting-task-draft-preview');
  if(!host)return;

  if(!state.taskDraft){
    host.innerHTML='<div class="empty-state-panel"><p>Hier erscheint der KI-Entwurf zur Pruefung und Bearbeitung.</p></div>';
    return;
  }

  var task=state.taskDraft.task||{};
  var event=state.taskDraft.event||{};
  var events=Array.isArray(state.taskDraft.events)&&state.taskDraft.events.length?state.taskDraft.events:[event];
  var summary=state.taskDraft.summaryMarkdown?'<div class="meeting-draft-summary">'+renderStructuredMarkdown(state.taskDraft.summaryMarkdown,'tasks')+'</div>':'';
  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  var subtasksDe=(Array.isArray(task.subtasksDe)?task.subtasksDe:[]).join('\n');
  var subtasksEn=(Array.isArray(task.subtasksEn)?task.subtasksEn:[]).join('\n');
  var suggestions=Array.isArray(state.taskDraft.taskSuggestions)?state.taskDraft.taskSuggestions:[];
  var draftSubtaskListHtml=buildDraftSubtaskListHtml(task);
  var allAssigneeOptions=buildEmployeeSelectOptions(state.draftAssigneeAll);
  var mainAssigneeOptions=buildEmployeeSelectOptions(state.draftAssigneeMain);
  var mainDependencyOptions=buildTaskDependencySelectOptions(projectId,task.dependencyTaskId||'');
  var subtaskAssigneeOptions=buildEmployeeSelectOptions(state.draftAssigneeSubtasks);
  var suggestionsHtml='';
  if(suggestions.length){
    suggestionsHtml=''
      +'<details class="meeting-draft-fold meeting-draft-fold-suggestions" open>'
        +'<summary class="meeting-draft-fold-summary">'
          +'<div><span class="meeting-draft-eyebrow">Teilaufgaben</span><strong>Vorschlag: Teilaufgaben der Hauptaufgabe</strong><small>'+suggestions.length+' Vorschlaege</small></div>'
          +'<span class="meeting-draft-fold-toggle">Details</span>'
        +'</summary>'
        +'<section class="meeting-draft-section meeting-draft-section-subtasks meeting-draft-suggestions">'
          +'<div class="meeting-draft-section-head">'
            +'<div><span class="meeting-draft-eyebrow">Teilaufgaben</span><h4>Vorschlag: Teilaufgaben der Hauptaufgabe</h4><p>Mehrere Arbeitspakete werden als Unterpunkte der Hauptaufgabe angelegt und verwaltet.</p></div>'
            +'<button type="button" class="btn btn-secondary" id="meeting-apply-suggested-tasks">Auswahl als Teilaufgaben speichern</button>'
          +'</div>'
          +'<div class="meeting-draft-suggestions-list">'
            +suggestions.map(function(item,idx){
              return ''
                +'<article class="meeting-draft-suggestion-card" data-suggestion-index="'+idx+'">'
                  +'<div class="meeting-draft-suggestion-head">'
                    +'<label class="meeting-draft-check"><input type="checkbox" id="meeting-draft-sugg-use-'+idx+'" checked> Aufgabe '+(idx+1)+' verwenden</label>'
                    +'<span class="meeting-draft-badge meeting-draft-badge-subtask">Subtask</span>'
                  +'</div>'
                  +'<div class="meeting-draft-meta-line">'+escapeHtml('Reihenfolge '+(item.sequenceIndex||idx+1)+(item.dependsOnPrevious?' · baut auf der vorherigen Aufgabe auf':''))+'</div>'
                  +'<div class="meeting-draft-grid meeting-draft-grid-3">'
                    +'<label class="form-group"><span>Vorgängeraufgabe</span><select id="meeting-draft-sugg-dependency-'+idx+'">'+buildTaskDependencySelectOptions(projectId,item.dependencyTaskId||'')+'</select></label>'
                    +'<span></span><span></span>'
                  +'</div>'
                  +'<div class="meeting-draft-grid">'
                    +'<label class="form-group"><span>Titel (DE)</span><input type="text" id="meeting-draft-sugg-title-de-'+idx+'" value="'+escapeAttr(item.titleDe||'')+'"></label>'
                    +'<label class="form-group"><span>Titel (EN)</span><input type="text" id="meeting-draft-sugg-title-en-'+idx+'" value="'+escapeAttr(item.titleEn||'')+'"></label>'
                  +'</div>'
                  +'<div class="meeting-draft-grid">'
                    +'<label class="form-group"><span>Beschreibung (DE)</span><textarea id="meeting-draft-sugg-desc-de-'+idx+'" rows="3">'+escapeHtml(item.descriptionDe||'')+'</textarea></label>'
                    +'<label class="form-group"><span>Beschreibung (EN)</span><textarea id="meeting-draft-sugg-desc-en-'+idx+'" rows="3">'+escapeHtml(item.descriptionEn||'')+'</textarea></label>'
                  +'</div>'
                  +'<div class="meeting-draft-grid meeting-draft-grid-4">'
                    +'<label class="form-group"><span>Prioritaet</span><select id="meeting-draft-sugg-priority-'+idx+'">'
                      +'<option value="low"'+((item.priority||'')==='low'?' selected':'')+'>Niedrig</option>'
                      +'<option value="medium"'+((item.priority||'')==='medium'?' selected':'')+'>Mittel</option>'
                      +'<option value="high"'+((item.priority||'')==='high'?' selected':'')+'>Hoch</option>'
                      +'<option value="blocker"'+((item.priority||'')==='blocker'?' selected':'')+'>Blocker</option>'
                    +'</select></label>'
                    +'<label class="form-group"><span>Dringlichkeit</span><select id="meeting-draft-sugg-urgency-'+idx+'">'
                      +'<option value="low"'+((item.urgency||'')==='low'?' selected':'')+'>Niedrig</option>'
                      +'<option value="normal"'+((item.urgency||'')==='normal'?' selected':'')+'>Normal</option>'
                      +'<option value="high"'+((item.urgency||'')==='high'?' selected':'')+'>Hoch</option>'
                      +'<option value="critical"'+((item.urgency||'')==='critical'?' selected':'')+'>Kritisch</option>'
                    +'</select></label>'
                    +'<label class="form-group"><span>Aufwand (h)</span><input type="number" min="0" step="0.5" id="meeting-draft-sugg-effort-'+idx+'" value="'+escapeAttr(item.effortHours||0)+'"></label>'
                    +'<label class="form-group"><span>Labels</span><input type="text" id="meeting-draft-sugg-labels-'+idx+'" value="'+escapeAttr((item.labels||[]).join(', '))+'"></label>'
                  +'</div>'
                  +'<label class="form-group meeting-assignee-per-task"><span>Mitarbeiter</span><select id="meeting-draft-sugg-assignee-'+idx+'">'+buildEmployeeSelectOptions(item.assigneeId||'')+'</select></label>'
                  +'<label class="form-group"><span>Hinweis / Notiz</span><textarea id="meeting-draft-sugg-note-'+idx+'" rows="2">'+escapeHtml(item.note||'')+'</textarea></label>'
                +'</article>';
            }).join('')
          +'</div>'
        +'</section>'
      +'</details>';
  }

  var additionalEventsHtml=events.slice(1).map(function(item,offset){
    var idx=offset+1;
    return ''
      +'<article class="meeting-draft-additional-event">'
        +'<div class="meeting-draft-suggestion-head">'
          +'<label class="meeting-draft-check"><input type="checkbox" id="meeting-draft-event-create-'+idx+'"'+(item.create!==false?' checked':'')+'> Termin '+(idx+1)+' uebernehmen</label>'
          +'<span class="meeting-draft-badge meeting-draft-badge-event">Termin</span>'
        +'</div>'
        +'<div class="meeting-draft-grid meeting-draft-grid-3">'
          +'<label class="form-group"><span>Titel</span><input type="text" id="meeting-draft-event-title-'+idx+'" value="'+escapeAttr(item.title||'')+'"></label>'
          +'<label class="form-group"><span>Datum</span><input type="date" id="meeting-draft-event-date-'+idx+'" value="'+escapeAttr(item.date||'')+'"></label>'
          +'<label class="form-group"><span>Typ</span><select id="meeting-draft-event-type-'+idx+'">'
            +'<option value="meeting"'+((item.type||'meeting')==='meeting'?' selected':'')+'>Meeting</option>'
            +'<option value="deadline"'+((item.type||'')==='deadline'?' selected':'')+'>Deadline</option>'
            +'<option value="release"'+((item.type||'')==='release'?' selected':'')+'>Release</option>'
            +'<option value="holiday"'+((item.type||'')==='holiday'?' selected':'')+'>Urlaub</option>'
            +'<option value="task"'+((item.type||'')==='task'?' selected':'')+'>Task</option>'
          +'</select></label>'
        +'</div>'
        +'<div class="meeting-draft-grid meeting-draft-grid-3">'
          +'<label class="form-group"><span>Start</span><input type="time" id="meeting-draft-event-start-'+idx+'" value="'+escapeAttr(item.startTime||'')+'"></label>'
          +'<label class="form-group"><span>Ende</span><input type="time" id="meeting-draft-event-end-'+idx+'" value="'+escapeAttr(item.endTime||'')+'"></label>'
          +'<span></span>'
        +'</div>'
        +'<label class="form-group"><span>Beschreibung</span><textarea id="meeting-draft-event-description-'+idx+'" rows="2">'+escapeHtml(item.description||'')+'</textarea></label>'
      +'</article>';
  }).join('');

  host.innerHTML=''
    +summary
    +'<div class="meeting-draft-editor">'
      +'<div class="meeting-draft-assignment-panel">'
        +'<div class="meeting-draft-section-head">'
          +'<div><span class="meeting-draft-eyebrow">Zuweisung</span><h4>Mitarbeiter schnell zuweisen</h4><p>Schnellauswahl fuer alle Aufgaben oder differenziert pro Aufgabe.</p></div>'
        +'</div>'
        +'<div class="meeting-draft-grid meeting-draft-grid-3">'
          +'<label class="form-group"><span>Zuweisungsmodus</span><select id="meeting-draft-assignee-mode">'
            +'<option value="all"'+(state.draftAssigneeMode==='all'?' selected':'')+'>Schnellauswahl: Ein Mitarbeiter fuer alle Aufgaben</option>'
            +'<option value="per-task"'+(state.draftAssigneeMode==='per-task'?' selected':'')+'>Differenziert je Aufgabe</option>'
          +'</select></label>'
          +'<label class="form-group meeting-assignee-all-only"><span>Mitarbeiter fuer alle</span><select id="meeting-draft-assignee-all">'+allAssigneeOptions+'</select></label>'
          +'<label class="form-group meeting-assignee-per-task"><span>Hauptaufgabe</span><select id="meeting-draft-assignee-main">'+mainAssigneeOptions+'</select></label>'
        +'</div>'
        +'<div class="meeting-draft-grid meeting-draft-grid-3">'
          +'<label class="form-group meeting-assignee-per-task"><span>Unteraufgaben (Bulk)</span><select id="meeting-draft-assignee-subtasks">'+subtaskAssigneeOptions+'</select></label>'
          +'<span></span><span></span>'
        +'</div>'
      +'</div>'
      +'<div class="meeting-draft-primary-grid">'
        +'<section class="meeting-draft-section meeting-draft-section-task">'
          +'<div class="meeting-draft-section-head">'
            +'<div><span class="meeting-draft-eyebrow">Aufgabe</span><h4>Hauptaufgabe</h4><p>Kerninformation, Priorisierung und Projektzuordnung auf einen Blick.</p></div>'
            +'<span class="meeting-draft-badge meeting-draft-badge-task">Task</span>'
          +'</div>'
          +'<div class="meeting-draft-meta-line">'+escapeHtml('Reihenfolge '+(task.sequenceIndex||1)+(task.dependsOnPrevious?' · baut auf einer vorherigen Aufgabe auf':''))+'</div>'
          +'<div class="meeting-draft-grid meeting-draft-grid-3">'
            +'<label class="form-group"><span>Vorgängeraufgabe</span><select id="meeting-draft-dependency-task">'+mainDependencyOptions+'</select></label>'
            +'<span></span><span></span>'
          +'</div>'
          +'<div class="meeting-draft-grid">'
            +'<label class="form-group"><span>Titel (DE) *</span><input type="text" id="meeting-draft-title-de" value="'+escapeAttr(task.titleDe||'')+'"></label>'
            +'<label class="form-group"><span>Titel (EN) *</span><input type="text" id="meeting-draft-title-en" value="'+escapeAttr(task.titleEn||'')+'"></label>'
          +'</div>'
          +'<div class="meeting-draft-grid">'
            +'<label class="form-group"><span>Beschreibung (DE)</span><textarea id="meeting-draft-desc-de" rows="4">'+escapeHtml(task.descriptionDe||'')+'</textarea></label>'
            +'<label class="form-group"><span>Beschreibung (EN)</span><textarea id="meeting-draft-desc-en" rows="4">'+escapeHtml(task.descriptionEn||'')+'</textarea></label>'
          +'</div>'
          +'<div class="meeting-draft-grid meeting-draft-grid-4">'
            +'<label class="form-group"><span>Prioritaet *</span><select id="meeting-draft-priority">'
              +'<option value="low"'+((task.priority||'')==='low'?' selected':'')+'>Niedrig</option>'
              +'<option value="medium"'+((task.priority||'')==='medium'?' selected':'')+'>Mittel</option>'
              +'<option value="high"'+((task.priority||'')==='high'?' selected':'')+'>Hoch</option>'
              +'<option value="blocker"'+((task.priority||'')==='blocker'?' selected':'')+'>Blocker</option>'
            +'</select></label>'
            +'<label class="form-group"><span>Dringlichkeit</span><select id="meeting-draft-urgency">'
              +'<option value="low"'+((task.urgency||'')==='low'?' selected':'')+'>Niedrig</option>'
              +'<option value="normal"'+((task.urgency||'')==='normal'?' selected':'')+'>Normal</option>'
              +'<option value="high"'+((task.urgency||'')==='high'?' selected':'')+'>Hoch</option>'
              +'<option value="critical"'+((task.urgency||'')==='critical'?' selected':'')+'>Kritisch</option>'
            +'</select></label>'
            +'<label class="form-group"><span>Aufwand (h)</span><input type="number" id="meeting-draft-effort" min="0" step="0.5" value="'+escapeAttr(task.effortHours||0)+'"></label>'
            +'<label class="form-group"><span>Projekt</span><select id="meeting-draft-project-select"></select></label>'
          +'</div>'
          +'<label class="form-group"><span>Labels (Komma-getrennt)</span><input type="text" id="meeting-draft-labels" value="'+escapeAttr((task.labels||[]).join(', '))+'"></label>'
          +'<label class="form-group"><span>Hinweis / Notiz</span><textarea id="meeting-draft-note" rows="3">'+escapeHtml(task.note||'')+'</textarea></label>'
        +'</section>'
        +'<section class="meeting-draft-section meeting-draft-section-event">'
          +'<div class="meeting-draft-section-head">'
            +'<div><span class="meeting-draft-eyebrow">Termin</span><h4>Kalender- und Zeitplanung</h4><p>Termintyp, Datum und Zeitfenster kompakt zusammengefasst.</p></div>'
            +'<span class="meeting-draft-badge meeting-draft-badge-event">Event</span>'
          +'</div>'
          +'<div class="meeting-draft-grid meeting-draft-grid-3">'
            +'<label class="form-group"><span>Terminart</span><select id="meeting-draft-schedule-mode">'
              +'<option value="none"'+((task.schedule&&task.schedule.mode||'none')==='none'?' selected':'')+'>Kein Termin</option>'
              +'<option value="deadline"'+((task.schedule&&task.schedule.mode||'')==='deadline'?' selected':'')+'>Deadline</option>'
              +'<option value="fixed"'+((task.schedule&&task.schedule.mode||'')==='fixed'?' selected':'')+'>Fester Termin</option>'
              +'<option value="range"'+((task.schedule&&task.schedule.mode||'')==='range'?' selected':'')+'>Zeitraum</option>'
              +'<option value="asap"'+((task.schedule&&task.schedule.mode||'')==='asap'?' selected':'')+'>Umgehend</option>'
            +'</select></label>'
            +'<label class="form-group meeting-draft-toggle"><span>Kalendereintrag anlegen</span><input type="checkbox" id="meeting-draft-event-create"'+(event.create?' checked':'')+'></label>'
            +'<label class="form-group"><span>Termin-Typ</span><select id="meeting-draft-event-type">'
              +'<option value="meeting"'+((event.type||'meeting')==='meeting'?' selected':'')+'>Meeting</option>'
              +'<option value="deadline"'+((event.type||'')==='deadline'?' selected':'')+'>Deadline</option>'
              +'<option value="release"'+((event.type||'')==='release'?' selected':'')+'>Release</option>'
              +'<option value="holiday"'+((event.type||'')==='holiday'?' selected':'')+'>Urlaub</option>'
              +'<option value="task"'+((event.type||'')==='task'?' selected':'')+'>Task</option>'
            +'</select></label>'
          +'</div>'
          +'<div id="meeting-draft-schedule-fields"></div>'
          +'<div class="meeting-draft-grid">'
            +'<label class="form-group"><span>Termin Titel</span><input type="text" id="meeting-draft-event-title" value="'+escapeAttr(event.title||'')+'"></label>'
            +'<label class="form-group"><span>Termin Datum</span><input type="date" id="meeting-draft-event-date" value="'+escapeAttr(event.date||'')+'"></label>'
          +'</div>'
          +'<div class="meeting-draft-grid meeting-draft-grid-3">'
            +'<label class="form-group"><span>Start</span><input type="time" id="meeting-draft-event-start" value="'+escapeAttr(event.startTime||'')+'"></label>'
            +'<label class="form-group"><span>Ende</span><input type="time" id="meeting-draft-event-end" value="'+escapeAttr(event.endTime||'')+'"></label>'
            +'<div class="meeting-draft-meta-card"><span>Dauer</span><strong>'+(event.startTime&&event.endTime?escapeHtml(event.startTime+' - '+event.endTime):'Flexibel')+'</strong></div>'
          +'</div>'
          +'<label class="form-group"><span>Termin Beschreibung</span><textarea id="meeting-draft-event-description" rows="3">'+escapeHtml(event.description||'')+'</textarea></label>'
          +(additionalEventsHtml?'<div class="meeting-draft-additional-events"><h5>Weitere erkannte Termine</h5>'+additionalEventsHtml+'</div>':'')
          +'<div class="meeting-draft-inline-actions"><button type="button" class="btn btn-secondary" id="meeting-apply-event-draft">Termin(e) in Startvorlage speichern</button></div>'
        +'</section>'
      +'</div>'
      +'<details class="meeting-draft-fold meeting-draft-fold-subtasks" open>'
        +'<summary class="meeting-draft-fold-summary">'
          +'<div><span class="meeting-draft-eyebrow">Teilaufgaben</span><strong>Kanban-Teilaufgaben</strong><small>'+(subtasksDe||subtasksEn?'Vorhanden':'Leer')+'</small></div>'
          +'<span class="meeting-draft-fold-toggle">Details</span>'
        +'</summary>'
        +'<section class="meeting-draft-section meeting-draft-section-subtasks">'
          +'<div class="meeting-draft-section-head">'
            +'<div><span class="meeting-draft-eyebrow">Teilaufgaben</span><h4>Kanban-Teilaufgaben</h4><p>Diese Eintraege werden als Teilaufgaben der Hauptaufgabe gespeichert und im Kanban Board bearbeitet.</p></div>'
            +'<span class="meeting-draft-badge meeting-draft-badge-subtask">Teilaufgaben</span>'
          +'</div>'
          +'<div class="task-cockpit-panel">'
            +'<div id="meeting-draft-subtask-list">'+draftSubtaskListHtml+'</div>'
            +'<div class="task-cockpit-inline">'
              +'<input type="text" id="meeting-draft-subtask-input" placeholder="Neue Teilaufgabe">'
              +'<button type="button" class="btn btn-secondary" id="meeting-draft-subtask-add">Hinzufügen</button>'
            +'</div>'
          +'</div>'
          +'<div class="meeting-draft-grid">'
            +'<label class="form-group"><span>Teilaufgaben (DE, eine pro Zeile)</span><textarea id="meeting-draft-subtasks-de" rows="4">'+escapeHtml(subtasksDe)+'</textarea></label>'
            +'<label class="form-group"><span>Teilaufgaben (EN, eine pro Zeile)</span><textarea id="meeting-draft-subtasks-en" rows="4">'+escapeHtml(subtasksEn)+'</textarea></label>'
          +'</div>'
        +'</section>'
      +'</details>'
      +suggestionsHtml
      +'<div class="meeting-draft-actions">'
        +'<button type="button" class="btn btn-secondary" id="meeting-apply-bulk-task-draft">Hauptaufgabe mit Teilaufgaben in Startvorlage</button>'
        +'<button type="button" class="btn btn-primary" id="meeting-apply-task-draft">In Startvorlage speichern</button>'
      +'</div>'
    +'</div>';

  var scheduleModeEl=byId('meeting-draft-schedule-mode');
  if(scheduleModeEl){
    scheduleModeEl.addEventListener('change',function(){
      renderDraftScheduleFields('meeting-draft-schedule-fields',{mode:this.value});
    });
  }
  renderDraftScheduleFields('meeting-draft-schedule-fields',task.schedule||{});

  var projectSelect=byId('meeting-draft-project-select');
  if(projectSelect){
    state.draftProjectId=state.draftProjectId||state.projectId;
    renderProjectSelect();
    projectSelect.value=state.draftProjectId||state.projectId||projectSelect.value||'';
    projectSelect.addEventListener('change',function(){
      state.draftProjectId=this.value||state.projectId;
    });
  }

  var applyBtn=byId('meeting-apply-task-draft');
  if(applyBtn)applyBtn.disabled=state.busy;
  var applyBulkBtn=byId('meeting-apply-bulk-task-draft');
  if(applyBulkBtn)applyBulkBtn.disabled=state.busy;
  var applySuggestedBtn=byId('meeting-apply-suggested-tasks');
  if(applySuggestedBtn)applySuggestedBtn.disabled=state.busy;
  var applyEventBtn=byId('meeting-apply-event-draft');
  if(applyEventBtn)applyEventBtn.disabled=state.busy;

  var assigneeModeEl=byId('meeting-draft-assignee-mode');
  if(assigneeModeEl){
    assigneeModeEl.addEventListener('change',updateDraftAssigneeVisibility);
  }
  ['meeting-draft-assignee-all','meeting-draft-assignee-main','meeting-draft-assignee-subtasks'].forEach(function(id){
    var el=byId(id);
    if(el)el.addEventListener('change',syncDraftAssigneeStateFromUi);
  });
  updateDraftAssigneeVisibility();
  syncDraftAssigneeStateFromUi();
}

function syncTaskDraftSubtaskListFromInputs(){
  var deInput=byId('meeting-draft-subtasks-de');
  var enInput=byId('meeting-draft-subtasks-en');
  var deItems=splitLines(deInput?deInput.value:'');
  var enItems=splitLines(enInput?enInput.value:'');
  var max=Math.max(deItems.length,enItems.length);
  var combined=[];
  for(var i=0;i<max;i++){
    var item=(deItems[i]||enItems[i]||'').trim();
    if(item)combined.push(item);
  }
  if(state.taskDraft&&state.taskDraft.task){
    state.taskDraft.task.subtasksDe=combined.slice();
    state.taskDraft.task.subtasksEn=combined.slice();
  }
  return combined;
}

function handleTaskDraftSubtaskUi(event){
  var addBtn=event.target && event.target.closest ? event.target.closest('#meeting-draft-subtask-add') : null;
  if(addBtn){
    var input=byId('meeting-draft-subtask-input');
    var value=(input?input.value:'').trim();
    if(!value){
      notify('Bitte eine Teilaufgabe eingeben.',true);
      return;
    }
    var deInput=byId('meeting-draft-subtasks-de');
    var enInput=byId('meeting-draft-subtasks-en');
    var deList=splitLines(deInput?deInput.value:'');
    var enList=splitLines(enInput?enInput.value:'');
    deList.push(value);
    enList.push(value);
    if(deInput)deInput.value=deList.join('\n');
    if(enInput)enInput.value=enList.join('\n');
    if(input)input.value='';
    renderTaskDraftPreview();
    return;
  }

  var removeBtn=event.target && event.target.closest ? event.target.closest('[data-draft-subtask-remove]') : null;
  if(removeBtn){
    var removeId=String(removeBtn.getAttribute('data-draft-subtask-remove')||'');
    var deInput=byId('meeting-draft-subtasks-de');
    var enInput=byId('meeting-draft-subtasks-en');
    var deList=splitLines(deInput?deInput.value:'');
    var enList=splitLines(enInput?enInput.value:'');
    var nextDe = [];
    var nextEn = [];
    for(var i=0;i<Math.max(deList.length,enList.length);i++){
      var de = deList[i]||'';
      var en = enList[i]||'';
      if(!de&&!en)continue;
      var itemId = String((de||en)+'-'+i);
      if(itemId!==removeId && itemId!==String((de||en)||'')){
        nextDe.push(de || en);
        nextEn.push(en || de);
      }
    }
    if(deInput)deInput.value=nextDe.join('\n');
    if(enInput)enInput.value=nextEn.join('\n');
    renderTaskDraftPreview();
    return;
  }

  var toggle=event.target && event.target.closest ? event.target.closest('[data-draft-subtask-toggle]') : null;
  if(toggle){
    var isChecked=!!toggle.checked;
    var deInput=byId('meeting-draft-subtasks-de');
    var enInput=byId('meeting-draft-subtasks-en');
    var deList=splitLines(deInput?deInput.value:'');
    var enList=splitLines(enInput?enInput.value:'');
    if(deInput)deInput.value=deList.join('\n');
    if(enInput)enInput.value=enList.join('\n');
    syncTaskDraftSubtaskListFromInputs();
    if(state.taskDraft&&state.taskDraft.task){
      state.taskDraft.task.subtasksDe = state.taskDraft.task.subtasksDe.map(function(item){
        return item;
      });
    }
    renderTaskDraftPreview();
  }
}

var taskDraftPreviewUiHandled=false;
if(!taskDraftPreviewUiHandled){
  taskDraftPreviewUiHandled=true;
  document.addEventListener('click',function(event){
    var target=event.target;
    if(!target||!target.closest)return;
    if(target.closest('#meeting-draft-subtask-add')||target.closest('[data-draft-subtask-remove]')){
      handleTaskDraftSubtaskUi(event);
    }
  });
  document.addEventListener('change',function(event){
    var target=event.target;
    if(!target||!target.closest)return;
    if(target.closest('[data-draft-subtask-toggle]')){
      handleTaskDraftSubtaskUi(event);
    }
  });
}

function readSuggestedTasksFromPreview(){
  var source=Array.isArray(state.taskDraft&&state.taskDraft.taskSuggestions)?state.taskDraft.taskSuggestions:[];
  syncDraftAssigneeStateFromUi();
  var mode=state.draftAssigneeMode==='per-task'?'per-task':'all';
  var list=[];
  for(var i=0;i<source.length;i++){
    var use=!!((byId('meeting-draft-sugg-use-'+i)||{}).checked);
    if(!use)continue;
    var titleDe=((byId('meeting-draft-sugg-title-de-'+i)||{}).value||'').trim();
    var titleEn=((byId('meeting-draft-sugg-title-en-'+i)||{}).value||'').trim();
    if(!titleDe&&!titleEn)continue;
    var labels=splitLines(String((byId('meeting-draft-sugg-labels-'+i)||{}).value||'').replace(/,/g,'\n'));
    list.push({
      titleDe:titleDe,
      titleEn:titleEn,
      descriptionDe:((byId('meeting-draft-sugg-desc-de-'+i)||{}).value||'').trim(),
      descriptionEn:((byId('meeting-draft-sugg-desc-en-'+i)||{}).value||'').trim(),
      priority:((byId('meeting-draft-sugg-priority-'+i)||{}).value||'medium').toLowerCase(),
      urgency:((byId('meeting-draft-sugg-urgency-'+i)||{}).value||'normal').toLowerCase(),
      effortHours:Number((byId('meeting-draft-sugg-effort-'+i)||{}).value||0)||0,
      sequenceIndex:Number((source[i]&&source[i].sequenceIndex)||i+1)||i+1,
      dependsOnPrevious:!!(source[i]&&source[i].dependsOnPrevious),
      dependencyTaskId:normalizeTaskDependencyId((byId('meeting-draft-sugg-dependency-'+i)||{}).value||((source[i]&&source[i].dependencyTaskId)||'')),
      labels:labels,
      note:((byId('meeting-draft-sugg-note-'+i)||{}).value||'').trim(),
      assigneeId:mode==='all'
        ?normalizeAssigneeId(state.draftAssigneeAll||'')
        :normalizeAssigneeId((byId('meeting-draft-sugg-assignee-'+i)||{}).value||'')
    });
  }
  return list;
}

function applySuggestedTasks(){
  if(!window.DataLayer||typeof window.DataLayer.updateProject!=='function'){
    notify('DataLayer.updateProject ist nicht verfuegbar.',true);
    return;
  }
  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  if(!projectId){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }

  var selected=readSuggestedTasksFromPreview();
  if(!selected.length){
    notify('Keine KI-Vorschlaege ausgewaehlt.',true);
    return;
  }

  var base=readDraftTaskPayload();
  var parentTitle=(base.title||'').trim()||selected.map(function(item){
    return item.titleDe||item.titleEn||'';
  }).filter(Boolean).join(' | ')||'KI-Analyse';
  var transformedSubtasks=selected.sort(function(a,b){
    var aSeq=Number(a.sequenceIndex||0)||0;
    var bSeq=Number(b.sequenceIndex||0)||0;
    if(aSeq&&!bSeq)return -1;
    if(!aSeq&&bSeq)return 1;
    if(aSeq!==bSeq)return aSeq-bSeq;
    return 0;
  }).map(function(item){
    var title=(item.titleDe||item.titleEn)+(item.titleDe&&item.titleEn?' | '+item.titleEn:'');
    return {
      id:createId('subtask'),
      title:title,
      completed:false,
      createdAt:new Date().toISOString()
    };
  });

  var queued=[{
    kind:'task',
    payload:{
      id:createId('qtask'),
      source:'meeting-task-draft-suggestion-parent',
      title:parentTitle,
      description:base.description||selected.map(function(item){
        var text='DE:\n'+(item.descriptionDe||'')+'\n\nEN:\n'+(item.descriptionEn||'');
        if(item.note){
          text+='\n\nHinweis:\n'+item.note;
        }
        return text;
      }).join('\n\n---\n\n'),
      assigneeId:resolveAssigneeForMainTask(),
      priority:base.priority||'medium',
      urgency:base.urgency||'normal',
      effortHours:base.effortHours||0,
      labels:Array.isArray(base.labels)?base.labels.slice():[],
      schedule:base.schedule||{mode:'none',deadline:'',fixedAt:'',rangeStart:'',rangeEnd:''},
      sequenceIndex:Number(base.sequenceIndex||1)||1,
      dependsOnPrevious:!!base.dependsOnPrevious,
      chainWithPrevious:!!base.dependsOnPrevious,
      externalDependencyTaskId:normalizeTaskDependencyId(base.dependencyTaskId||''),
      subtasks:transformedSubtasks,
      notes:Array.isArray(base.notes)?base.notes.slice():[],
      queuedAt:new Date().toISOString()
    }
  }];

  try{
    var result=queueExecutionPlanItems(projectId,queued);
    touchMeetingProtocol(state.projectId);
    notify(result.tasks+' Aufgabe mit '+transformedSubtasks.length+' Teilaufgaben in Projekt-Startvorlage gespeichert.',false);
  }catch(err){
    notify('Speichern in Startvorlage fehlgeschlagen: '+(err.message||String(err)),true);
  }
}

function normalizeQueuedSubtaskList(items){
  var source=Array.isArray(items)?items:[];
  return source.map(function(item){
    if(typeof item==='string'){
      var title=item.trim();
      if(!title)return null;
      return {id:createId('subtask'), title:title, completed:false, createdAt:new Date().toISOString()};
    }
    if(item&&typeof item==='object'){
      var title=String(item.title||item.text||'').trim();
      if(!title)return null;
      return {
        id:item.id||createId('subtask'),
        title:title,
        completed:!!item.completed,
        createdAt:item.createdAt||new Date().toISOString()
      };
    }
    return null;
  }).filter(function(item){return !!item && !!item.title;});
}

function readDraftSubtaskPairs(){
  var subtasksDe=splitLines((byId('meeting-draft-subtasks-de')||{}).value);
  var subtasksEn=splitLines((byId('meeting-draft-subtasks-en')||{}).value);
  var maxSubtasks=Math.max(subtasksDe.length,subtasksEn.length);
  var pairs=[];
  for(var i=0;i<maxSubtasks;i++){
    var de=subtasksDe[i]||'';
    var en=subtasksEn[i]||'';
    if(!de&&!en)continue;
    var base=de||en;
    pairs.push({
      de:de||base,
      en:en||base,
      title:base+(en&&de!==en?' | '+en:'')
    });
  }
  return pairs;
}

function readDraftTaskPayload(){
  var draftTask=state.taskDraft&&state.taskDraft.task?state.taskDraft.task:{};
  var titleDe=(byId('meeting-draft-title-de')||{}).value||'';
  var titleEn=(byId('meeting-draft-title-en')||{}).value||'';
  var descDe=(byId('meeting-draft-desc-de')||{}).value||'';
  var descEn=(byId('meeting-draft-desc-en')||{}).value||'';
  var labels=splitLines(String((byId('meeting-draft-labels')||{}).value||'').replace(/,/g,'\n'));
  var scheduleMode=((byId('meeting-draft-schedule-mode')||{}).value||'none').toLowerCase();

  var schedule={mode:scheduleMode,deadline:'',fixedAt:'',rangeStart:'',rangeEnd:''};
  if(scheduleMode==='deadline')schedule.deadline=toDateValue((byId('meeting-draft-deadline')||{}).value);
  if(scheduleMode==='fixed')schedule.fixedAt=toDateValue((byId('meeting-draft-fixed')||{}).value);
  if(scheduleMode==='range'){
    schedule.rangeStart=toDateValue((byId('meeting-draft-range-start')||{}).value);
    schedule.rangeEnd=toDateValue((byId('meeting-draft-range-end')||{}).value);
  }

  var pairs=readDraftSubtaskPairs();
  var subtasks=normalizeQueuedSubtaskList(pairs.map(function(pair){return pair.title;}));

  return {
    title:(titleDe||titleEn)+(titleDe&&titleEn?' | '+titleEn:''),
    description:'DE:\n'+String(descDe||'').trim()+'\n\nEN:\n'+String(descEn||'').trim(),
    priority:((byId('meeting-draft-priority')||{}).value||'medium').toLowerCase(),
    urgency:((byId('meeting-draft-urgency')||{}).value||'normal').toLowerCase(),
    effortHours:Number((byId('meeting-draft-effort')||{}).value||0)||0,
    sequenceIndex:Number(draftTask.sequenceIndex||1)||1,
    dependsOnPrevious:!!draftTask.dependsOnPrevious,
    dependencyTaskId:normalizeTaskDependencyId((byId('meeting-draft-dependency-task')||{}).value||draftTask.dependencyTaskId||''),
    labels:resolveLabelIdsByNames(labels),
    schedule:schedule,
    subtasks:subtasks,
    notes:[{id:createId('note'),text:(byId('meeting-draft-note')||{}).value||'',createdAt:new Date().toISOString()}]
  };
}

function readDraftEventPayload(index){
  var suffix=index?'-'+index:'';
  return {
    create:!!((byId('meeting-draft-event-create'+suffix)||{}).checked),
    type:String((byId('meeting-draft-event-type'+suffix)||{}).value||'meeting').toLowerCase(),
    title:String((byId('meeting-draft-event-title'+suffix)||{}).value||'').trim(),
    description:String((byId('meeting-draft-event-description'+suffix)||{}).value||'').trim(),
    date:toDateValue((byId('meeting-draft-event-date'+suffix)||{}).value),
    startTime:toTimeValue((byId('meeting-draft-event-start'+suffix)||{}).value),
    endTime:toTimeValue((byId('meeting-draft-event-end'+suffix)||{}).value)
  };
}

function readDraftEventPayloads(){
  var source=Array.isArray(state.taskDraft&&state.taskDraft.events)?state.taskDraft.events:[];
  var count=Math.max(source.length,1);
  var events=[];
  for(var i=0;i<count;i++)events.push(readDraftEventPayload(i));
  return events;
}

function applyDraftEventOnly(){
  if(!window.DataLayer||typeof window.DataLayer.updateProject!=='function'){
    notify('DataLayer.updateProject ist nicht verfuegbar.',true);
    return;
  }
  if(!state.taskDraft){
    notify('Bitte zuerst einen KI-Entwurf erzeugen.',true);
    return;
  }

  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  if(!projectId){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }

  var eventPayloads=readDraftEventPayloads().filter(function(item){return item.create;});
  if(!eventPayloads.length){
    notify('Bitte mindestens einen Termin zur Uebernahme auswaehlen.',true);
    return;
  }
  if(eventPayloads.some(function(item){return !item.title||!item.date;})){
    notify('Jeder ausgewaehlte Termin braucht Titel und Datum.',true);
    return;
  }

  try{
    queueExecutionPlanItems(projectId,eventPayloads.map(function(eventPayload){
      return {kind:'event',payload:Object.assign({
        id:createId('qevent'),
        source:'meeting-task-draft-event',
        queuedAt:new Date().toISOString()
      },buildCalendarEventPayload(projectId,eventPayload,eventPayload.title))};
    }));
    touchMeetingProtocol(state.projectId);
    notify(eventPayloads.length+' Termin(e) in Projekt-Startvorlage gespeichert.',false);
  }catch(err){
    notify('Speichern in Startvorlage fehlgeschlagen: '+(err.message||String(err)),true);
  }
}

function runTaskDraft(){
  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  var project=projectId&&window.DataLayer&&window.DataLayer.getProjectById?window.DataLayer.getProjectById(projectId):null;
  if(!project){
    notify('Bitte zuerst ein Projekt fuer den KI-Entwurf auswaehlen.',true);
    return;
  }

  var draftInput=((byId('meeting-task-draft-input')||{}).value||'').trim();
  if(!draftInput){
    notify('Bitte gib zuerst die Aufgaben-/Termin-Informationen ein.',true);
    return;
  }

  var options={
    scheduleMode:((byId('meeting-task-draft-schedule-mode')||{}).value||'none').toLowerCase(),
    eventType:((byId('meeting-task-draft-event-type')||{}).value||'meeting').toLowerCase(),
    createSubtasks:!!((byId('meeting-task-draft-subtasks')||{}).checked),
    splitIntoMultiple:!!((byId('meeting-task-draft-multi')||{}).checked)
  };

  state.draftProjectId=project.id;
  setBusy('Aufgabe+Termin Entwurf',true);
  window.KIWorkflow.runTaskDraft(project,state.entries,draftInput,options,{}).then(function(result){
    state.taskDraft=normalizeTaskDraft(result&&result.draft?result.draft:{summaryMarkdown:(window.KIWorkflow.readResponseMarkdown?window.KIWorkflow.readResponseMarkdown(result):'')},options);
    state.taskDraft=fallbackPopulateDraftFromInput(state.taskDraft,draftInput,options);
    renderTaskDraftPreview();
    touchMeetingProtocol(state.projectId);
  }).catch(function(err){
    notify('KI-Entwurf konnte nicht erstellt werden: '+(err.message||String(err)),true);
  }).finally(function(){
    setBusy('',false);
  });
}

function analyzeNoteInput(){
  var noteInput=byId('meeting-note-input');
  var draftInput=byId('meeting-task-draft-input');
  var text=String(noteInput&&noteInput.value||'').trim();
  if(!text){
    notify('Bitte zuerst Stichpunkte fuer die KI-Analyse eingeben.',true);
    return;
  }

  if(draftInput)draftInput.value=text;
  var createSubtasks=byId('meeting-task-draft-subtasks');
  var splitMultiple=byId('meeting-task-draft-multi');
  if(createSubtasks)createSubtasks.checked=true;
  if(splitMultiple)splitMultiple.checked=true;
  var scheduleMode=byId('meeting-task-draft-schedule-mode');
  if(scheduleMode)scheduleMode.value='auto';
  var details=byId('meeting-task-draft-collapsible');
  if(details)details.open=true;
  if(details&&details.scrollIntoView)details.scrollIntoView({behavior:'smooth',block:'start'});
  runTaskDraft();
}

function applyTaskDraft(){
  if(!window.DataLayer||typeof window.DataLayer.updateProject!=='function'){
    notify('DataLayer.updateProject ist nicht verfuegbar.',true);
    return;
  }
  if(!state.taskDraft){
    notify('Bitte zuerst einen KI-Entwurf erzeugen.',true);
    return;
  }

  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  if(!projectId){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }

  var payload=readDraftTaskPayload();
  if(!payload.title.trim()){
    notify('Titel (DE/EN) ist erforderlich.',true);
    return;
  }

  var queueItems=[{
    kind:'task',
    payload:{
      id:createId('qtask'),
      source:'meeting-task-draft-main',
      title:payload.title,
      description:payload.description,
      assigneeId:resolveAssigneeForMainTask(),
      priority:payload.priority,
      urgency:payload.urgency,
      effortHours:payload.effortHours,
      labels:Array.isArray(payload.labels)?payload.labels.slice():[],
      schedule:payload.schedule,
      sequenceIndex:payload.sequenceIndex,
      dependsOnPrevious:!!payload.dependsOnPrevious,
      chainWithPrevious:!!payload.dependsOnPrevious,
      externalDependencyTaskId:normalizeTaskDependencyId(payload.dependencyTaskId||''),
      subtasks:Array.isArray(payload.subtasks)?payload.subtasks.slice():[],
      notes:Array.isArray(payload.notes)?payload.notes.slice():[],
      queuedAt:new Date().toISOString()
    }
  }];

  var queuedEvents=0;
  readDraftEventPayloads().forEach(function(eventPayload){
    if(!eventPayload.create||!eventPayload.date||!eventPayload.title)return;
    queueItems.push({
      kind:'event',
      payload:Object.assign({
        id:createId('qevent'),
        source:'meeting-task-draft-main',
        queuedAt:new Date().toISOString()
      },buildCalendarEventPayload(projectId,eventPayload,'Termin: '+payload.title))
    });
    queuedEvents++;
  });

  try{
    queueExecutionPlanItems(projectId,queueItems);
    touchMeetingProtocol(state.projectId);
    notify('Aufgabe in Projekt-Startvorlage gespeichert'+(queuedEvents?' und '+queuedEvents+' Termin(e) vorgemerkt':'')+'.',false);
  }catch(err){
    notify('Speichern in Startvorlage fehlgeschlagen: '+(err.message||String(err)),true);
  }
}

function applyTaskDraftBulk(){
  if(!window.DataLayer||typeof window.DataLayer.updateProject!=='function'){
    notify('DataLayer.updateProject ist nicht verfuegbar.',true);
    return;
  }
  if(!state.taskDraft){
    notify('Bitte zuerst einen KI-Entwurf erzeugen.',true);
    return;
  }

  var projectId=((byId('meeting-draft-project-select')||{}).value||state.draftProjectId||state.projectId||'').trim();
  if(!projectId){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }

  var base=readDraftTaskPayload();
  if(!base.title.trim()){
    notify('Titel (DE/EN) ist erforderlich.',true);
    return;
  }
  var pairs=readDraftSubtaskPairs();
  if(!pairs.length){
    notify('Keine Unteraufgaben vorhanden. Bitte erst Unteraufgaben ergaenzen.',true);
    return;
  }

  var queueItems=[];

  base.assigneeId=resolveAssigneeForMainTask();
  base.sequenceIndex=Number(base.sequenceIndex||1)||1;
  base.dependsOnPrevious=!!base.dependsOnPrevious;

  var bulkSubtasks=normalizeQueuedSubtaskList(pairs.map(function(pair){return pair.title;}));

  queueItems.push({
    kind:'task',
    payload:{
      id:createId('qtask'),
      source:'meeting-task-draft-bulk-main',
      title:base.title,
      description:base.description,
      assigneeId:base.assigneeId,
      priority:base.priority,
      urgency:base.urgency,
      effortHours:base.effortHours,
      labels:Array.isArray(base.labels)?base.labels.slice():[],
      schedule:base.schedule,
      sequenceIndex:base.sequenceIndex,
      dependsOnPrevious:base.dependsOnPrevious,
      chainWithPrevious:base.dependsOnPrevious,
      externalDependencyTaskId:normalizeTaskDependencyId(base.dependencyTaskId||''),
      subtasks:bulkSubtasks,
      notes:Array.isArray(base.notes)?base.notes.slice():[],
      queuedAt:new Date().toISOString()
    }
  });

  var createdEvents=0;
  readDraftEventPayloads().forEach(function(eventPayload){
    if(!eventPayload.create||!eventPayload.date||!eventPayload.title)return;
    queueItems.push({
      kind:'event',
      payload:Object.assign({
        id:createId('qevent'),
        source:'meeting-task-draft-bulk-main',
        queuedAt:new Date().toISOString()
      },buildCalendarEventPayload(projectId,eventPayload,'Termin: '+base.title))
    });
    createdEvents++;
  });

  try{
    var result=queueExecutionPlanItems(projectId,queueItems);
    touchMeetingProtocol(state.projectId);
    notify(result.tasks+' Aufgaben in Startvorlage gespeichert'+(createdEvents?' und '+createdEvents+' Termin(e) vorgemerkt':'')+'.',false);
  }catch(err){
    notify('Speichern in Startvorlage fehlgeschlagen: '+(err.message||String(err)),true);
  }
}

function renderProtocolState(){
  var statusEl=byId('meeting-protocol-status');
  var toggleBtn=byId('meeting-toggle-closed');
  var project=currentProject();

  if(!project){
    if(statusEl)statusEl.textContent='Status: n/a';
    if(toggleBtn){
      toggleBtn.textContent='Als Closed markieren';
      toggleBtn.disabled=true;
    }
    return;
  }

  var protocol=ensureMeetingProtocol(project);
  var isClosed=protocol.status==='closed';
  var statusText=isClosed?'Closed':'Open';
  var closedSuffix=isClosed&&protocol.closedAt?(' ('+new Date(protocol.closedAt).toLocaleDateString('de-DE')+')'):'';

  if(statusEl)statusEl.textContent='Status: '+statusText+closedSuffix;
  if(toggleBtn){
    toggleBtn.textContent=isClosed?'Wieder oeffnen':'Als Closed markieren';
    toggleBtn.disabled=false;
  }
}

function escapeAttr(value){
  return escapeHtml(value).replace(/"/g,'&quot;');
}

function looksLikeNoiseLine(line){
  return /^here'?s a thinking process/i.test(line)
    || /^analyze user input/i.test(line)
    || /^deconstruct requirements/i.test(line)
    || /^draft - section by section/i.test(line)
    || /^analysis:/i.test(line)
    || /^thinking/i.test(line)
    || /^role:/i.test(line)
    || /^task:/i.test(line)
    || /^language:/i.test(line)
    || /^output format:/i.test(line)
    || /^project:/i.test(line)
    || /^preset:/i.test(line)
    || /^meeting notes:/i.test(line)
    || /^existing data:/i.test(line)
    || /^required sections:/i.test(line)
    || /^constraints met:/i.test(line)
    || /^output ready/i.test(line);
}

var STAGE_SECTION_ORDER={
  concept:['Zielbild','Scope','Stakeholder','Risiken','Annahmen','Nächste Schritte'],
  plan:['Phasen','Meilensteine','Abhängigkeiten','Ressourcen','Risiken','6-Wochen-Plan']
};

var STAGE_SECTION_ALIASES={
  concept:{
    'zielbild':'Zielbild',
    'ziel':'Zielbild',
    'vision':'Zielbild',
    'scope':'Scope',
    'umfang':'Scope',
    'stakeholder':'Stakeholder',
    'beteiligte':'Stakeholder',
    'risiken':'Risiken',
    'annahmen':'Annahmen',
    'nächste schritte':'Nächste Schritte',
    'naechste schritte':'Nächste Schritte'
  },
  plan:{
    'phasen':'Phasen',
    'meilensteine':'Meilensteine',
    'abhängigkeiten':'Abhängigkeiten',
    'abhaengigkeiten':'Abhängigkeiten',
    'ressourcen':'Ressourcen',
    'risiken':'Risiken',
    '6-wochen-plan':'6-Wochen-Plan',
    '6 wochen plan':'6-Wochen-Plan',
    'plan':'6-Wochen-Plan'
  }
};

function normalizeHeadingTitle(title,stage){
  var clean=String(title||'').trim().replace(/[:：]+$/,'');
  var lower=clean.toLowerCase();
  var aliases=STAGE_SECTION_ALIASES[stage]||{};
  return aliases[lower]||clean;
}

function renderStructuredMarkdown(markdown,stage){
  var text=String(markdown||'').trim();
  if(!text)return '<p class="meeting-md-empty">Keine Inhalte vorhanden.</p>';
  if(text==='Noch kein Konzept generiert.'||text==='Noch kein Plan generiert.'||text==='Noch keine Tasks generiert.'){
    return '<p class="meeting-md-empty">'+escapeHtml(text)+'</p>';
  }

  var sections=[];
  var current={title:'',items:[],paragraphs:[]};
  var lines=text.split(/\r?\n/);

  function pushCurrent(){
    if(current.title||current.items.length||current.paragraphs.length)sections.push(current);
    current={title:'',items:[],paragraphs:[]};
  }

  lines.forEach(function(line){
    var trimmed=line.trim();
    if(/^#{1,3}\s+/.test(trimmed)){
      pushCurrent();
      current.title=normalizeHeadingTitle(trimmed.replace(/^#{1,3}\s+/,''),stage||'concept');
      return;
    }
    if(/^[-*+]\s+/.test(trimmed)){
      current.items.push(trimmed.replace(/^[-*+]\s+/,'').trim());
      return;
    }
    if(trimmed){
      current.paragraphs.push(trimmed);
    }
  });
  pushCurrent();

  if(!sections.length){
    return '<div class="meeting-md-card"><p>'+escapeHtml(text)+'</p></div>';
  }

  if(stage&&STAGE_SECTION_ORDER[stage]){
    var order=STAGE_SECTION_ORDER[stage];
    sections.sort(function(a,b){
      var ai=order.indexOf(a.title);
      var bi=order.indexOf(b.title);
      if(ai===-1&&bi===-1)return a.title.localeCompare(b.title,'de');
      if(ai===-1)return 1;
      if(bi===-1)return -1;
      return ai-bi;
    });
  }

  return sections.map(function(section){
    var title=section.title||'Ergebnis';
    var body='';
    if(section.paragraphs.length){
      body+='<p>'+escapeHtml(section.paragraphs.join(' '))+'</p>';
    }
    if(section.items.length){
      body+='<ul>' + section.items.map(function(item){return '<li>'+escapeHtml(item)+'</li>';}).join('') + '</ul>';
    }
    if(!body)body='<p>'+escapeHtml(text)+'</p>';
    return '<section class="meeting-md-card"><h4>'+escapeHtml(title)+'</h4>'+body+'</section>';
  }).join('');
}

function renderStageOutput(markdown,stage){
  var output=renderStructuredMarkdown(markdown,stage);
  if(stage==='concept'&&output.indexOf('meeting-md-card')===-1){
    return '<section class="meeting-md-card"><h4>Konzept</h4>'+output+'</section>';
  }
  if(stage==='plan'&&output.indexOf('meeting-md-card')===-1){
    return '<section class="meeting-md-card"><h4>Projektplan</h4>'+output+'</section>';
  }
  return output;
}

function normalizeTaskItems(items){
  return (Array.isArray(items)?items:[]).map(function(item){
    var labels=Array.isArray(item&&item.labels)?item.labels.map(function(label){
      if(typeof label==='string')return label.trim();
      return String((label&&label.name)||'').trim();
    }).filter(function(label){return !!label;}):[];
    var subtasks=Array.isArray(item&&item.subtasks)?item.subtasks.map(function(subtask){
      if(typeof subtask==='string')return subtask.trim();
      return String((subtask&&subtask.title)||'').trim();
    }).filter(function(subtask){return !!subtask;}):[];
    return {
      title:String(item&&item.title||'').trim(),
      description:String(item&&item.description||'').trim(),
      status:String(item&&item.status||'').trim(),
      priority:String(item&&item.priority||'').trim(),
      effortHours:Number(item&&item.effortHours||0)||0,
      sequenceIndex:Number(item&&item.sequenceIndex||0)||0,
      dependsOnPrevious:!!(item&&item.dependsOnPrevious),
      dependencyTaskIds:Array.isArray(item&&item.dependencyTaskIds)?item.dependencyTaskIds.map(function(id){return String(id||'').trim();}).filter(function(id){return !!id;}):[],
      dependencyBlocked:!!(item&&item.dependencyBlocked),
      dependencyBlockReason:String(item&&item.dependencyBlockReason||''),
      labels:labels,
      subtasks:subtasks
    };
  }).filter(function(item){return !!item.title;});
}

function renderTasksOutput(summaryMarkdown,taskItems){
  var summary=renderStructuredMarkdown(summaryMarkdown,'tasks');
  var items=normalizeTaskItems(taskItems);
  if(!items.length){
    return summary;
  }

  var cards=items.map(function(item){
    var meta=[];
    if(item.sequenceIndex)meta.push('#'+item.sequenceIndex);
    if(item.status)meta.push(item.status);
    if(item.priority)meta.push(item.priority);
    if(item.effortHours)meta.push(item.effortHours+'h');
    if(item.dependencyBlocked)meta.push('wartet auf '+(item.dependencyTaskIds.length||1)+' Aufgabe(n)');
    var labelText=item.labels.length?'<div class="meeting-task-labels">'+item.labels.map(function(label){return '<span class="meeting-chip">'+escapeHtml(label)+'</span>';}).join('')+'</div>':'';
    var subtasks=item.subtasks.length?'<ul class="meeting-task-subtasks">'+item.subtasks.map(function(subtask){return '<li>'+escapeHtml(subtask)+'</li>';}).join('')+'</ul>':'';
    return ''
      +'<article class="meeting-task-card">'
        +'<div class="meeting-task-head">'
          +'<h4>'+escapeHtml(item.title)+'</h4>'
          +(meta.length?'<small>'+escapeHtml(meta.join(' · '))+'</small>':'')
        +'</div>'
        +(item.description?'<p>'+escapeHtml(item.description)+'</p>':'')
        +labelText
        +subtasks
      +'</article>';
  }).join('');

  return '<div class="meeting-task-summary">'+summary+'</div><div class="meeting-task-grid">'+cards+'</div>';
}

function extractFinalResultText(markdown){
  var text=String(markdown||'').trim();
  if(!text)return '';

  var lines=text.split(/\r?\n/);
  var result=[];
  var started=false;

  lines.forEach(function(line){
    var trimmed=line.trim();
    if(!trimmed)return;
    if(/^here'?s a thinking process/i.test(trimmed))return;
    if(/^analysis:/i.test(trimmed))return;
    if(/^1\./.test(trimmed)||/^2\./.test(trimmed)||/^3\./.test(trimmed)){
      if(started)return;
      return;
    }
    if(/^#{1,3}\s+/.test(trimmed))started=true;
    if(started||/^[-*+]\s+/.test(trimmed))result.push(trimmed);
  });

  return result.join('\n').trim() || text;
}

function render(){
  renderProjectSelect();
  renderEntries();
  renderTaskDraftPreview();
  renderWorkflow();
  renderProtocolState();
}

function updateWorkflowPersisted(){
  writeWorkflowState(state.projectId,{
    conceptMarkdown:state.conceptMarkdown||'',
    planMarkdown:state.planMarkdown||'',
    tasksSummary:state.tasksSummary||'',
    taskItems:normalizeTaskItems(state.taskItems||[])
  });
}

function saveMeetingState(){
  var project=currentProject();
  if(!project){
    notify('Bitte zuerst ein Projekt auswaehlen.',true);
    return Promise.resolve(false);
  }

  setSaveStatus('Speichert ...');
  writeActiveProjectId(state.projectId);
  writeEntriesToLocal(state.projectId,state.entries);
  updateWorkflowPersisted();
  touchMeetingProtocol(state.projectId);

  return syncEntriesToServer(state.projectId,state.entries).then(function(){
    setSaveStatus('Gespeichert: '+getProjectTitle(project));
    renderProjectSelect();
    notify('Meeting-Protokoll fuer '+getProjectTitle(project)+' gespeichert.',false);
    return true;
  }).catch(function(err){
    setSaveStatus('Lokale Kopie gespeichert');
    notify('Speichern lokal abgeschlossen, Server-Sync fehlgeschlagen: '+(err.message||String(err)),true);
    return false;
  });
}

function loadStateForProject(projectId){
  state.projectId=projectId||'';
  state.draftProjectId=state.projectId;
  writeActiveProjectId(state.projectId);
  state.entries=readEntriesFromLocal(state.projectId);
  var flow=readWorkflowState(state.projectId);
  state.conceptMarkdown=flow.conceptMarkdown||'';
  state.planMarkdown=flow.planMarkdown||'';
  state.tasksSummary=flow.tasksSummary||'';
  state.taskItems=normalizeTaskItems(flow.taskItems||[]);

  fetchEntriesFromServer(state.projectId).then(function(serverNotes){
    if(serverNotes.length>=state.entries.length){
      state.entries=serverNotes;
      writeEntriesToLocal(state.projectId,state.entries);
      renderEntries();
    }
  });
}

function addEntry(){
  var input=byId('meeting-note-input');
  if(!input)return;
  var text=(input.value||'').trim();
  if(!text){
    notify('Bitte zuerst einen Stichpunkt eingeben.',true);
    return;
  }

  var labelSelect=byId('meeting-label-select');
  var label=labelSelect?labelSelect.value:'';

  state.entries.push({
    id:createId('note'),
    text:text,
    label:label||'',
    createdAt:new Date().toISOString()
  });

  writeEntriesToLocal(state.projectId,state.entries);
  touchMeetingProtocol(state.projectId);
  syncEntriesToServer(state.projectId,state.entries);
  input.value='';
  renderEntries();
}

function removeEntry(entryId){
  state.entries=state.entries.filter(function(item){return item.id!==entryId;});
  writeEntriesToLocal(state.projectId,state.entries);
  touchMeetingProtocol(state.projectId);
  syncEntriesToServer(state.projectId,state.entries);
  renderEntries();
}

function createProjectQuick(){
  var titleInput=document.getElementById('meeting-new-project-title');
  var descInput=document.getElementById('meeting-new-project-description');
  var clean=titleInput?titleInput.value.trim():'';
  if(!clean)return;

  if(!window.DataLayer||typeof window.DataLayer.createProject!=='function'){
    notify('DataLayer.createProject ist nicht verfuegbar.',true);
    return;
  }

  var project=window.DataLayer.createProject({
    title:clean,
    description:descInput&&descInput.value?descInput.value.trim():'Angelegt im Meeting-Protokoll',
    status:'planning',
    createdAt:new Date().toISOString()
  });

  state.projectId=project.id;
  writeActiveProjectId(project.id);
  loadStateForProject(project.id);
  render();
  closeModal();
}

function exportMarkdown(){
  var project=currentProject();
  if(!project){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }
  var content=buildMeetingMarkdown(project,state.entries);
  var safeTitle=getProjectTitle(project).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'projekt';
  var datePart=new Date().toISOString().slice(0,10);
  downloadFile('meeting-'+safeTitle+'-'+datePart+'.md',content,'text/markdown;charset=utf-8');
}

function exportJson(){
  var project=currentProject();
  if(!project){
    notify('Bitte ein Projekt auswaehlen.',true);
    return;
  }
  var payload={
    exportedAt:new Date().toISOString(),
    project:{id:project.id,title:getProjectTitle(project)},
    entries:state.entries
  };
  var safeTitle=getProjectTitle(project).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'projekt';
  var datePart=new Date().toISOString().slice(0,10);
  downloadFile('meeting-'+safeTitle+'-'+datePart+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8');
}

function buildExistingDataSummary(project){
  if(!window.DataLayer)return '{}';
  var tasks=window.DataLayer.getTasks?window.DataLayer.getTasks().filter(function(task){return task.projectId===project.id;}):[];
  var events=window.DataLayer.getCalendarEvents?window.DataLayer.getCalendarEvents().filter(function(evt){return evt.projectId===project.id;}):[];
  var releases=window.DataLayer.getReleases?window.DataLayer.getReleases().filter(function(rel){return rel.projectId===project.id;}):[];
  return JSON.stringify({
    project:{
      id:project.id,
      title:getProjectTitle(project),
      description:project.description||'',
      status:project.status||''
    },
    taskCount:tasks.length,
    releaseCount:releases.length,
    eventCount:events.length
  },null,2);
}

function openPromptAdapter(stageKey,stageTitle,presetKey){
  var project=currentProject();
  if(!project)return Promise.reject(new Error('Projekt nicht gefunden.'));
  if(!window.PromptConfig||typeof window.PromptConfig.open!=='function'){
    return Promise.reject(new Error('PromptConfig Modul ist nicht geladen.'));
  }

  return window.KIWorkflow.listAvailableModels().then(function(models){
    return window.PromptConfig.open({
      stageKey:stageKey,
      stageTitle:stageTitle,
      presetKey:presetKey,
      models:models,
      projectTitle:getProjectTitle(project),
      meetingNotes:window.KIWorkflow.notesToMarkdown(state.entries),
      existingData:buildExistingDataSummary(project),
      language:'DE'
    });
  });
}

function runConcept(){
  var project=currentProject();
  if(!project){
    notify('Bitte zuerst ein Projekt auswaehlen.',true);
    return;
  }

  setBusy('Konzept',true);
  openPromptAdapter('concept','Stufe 1: Projekt-Konzept','creative').then(function(config){
    if(!config){
      setBusy('',false);
      return null;
    }
    return window.KIWorkflow.runConcept(project,state.entries,config).then(function(result){
      state.conceptMarkdown=window.KIWorkflow.readResponseMarkdown?window.KIWorkflow.readResponseMarkdown(result):(result.markdown||result.result||'');
      if(!state.conceptMarkdown)state.conceptMarkdown='(Leere Antwort erhalten)';
      updateWorkflowPersisted();
      touchMeetingProtocol(state.projectId);
      renderWorkflow();
      return result;
    });
  }).catch(function(err){
    notify('Konzept konnte nicht erstellt werden: '+(err.message||String(err)),true);
  }).finally(function(){
    setBusy('',false);
  });
}

function runPlan(){
  var project=currentProject();
  if(!project){
    notify('Bitte zuerst ein Projekt auswaehlen.',true);
    return;
  }
  if(!state.conceptMarkdown){
    notify('Bitte zuerst ein Konzept erstellen.',true);
    return;
  }

  setBusy('Plan',true);
  openPromptAdapter('plan','Stufe 2: Projektplan','manager').then(function(config){
    if(!config){
      setBusy('',false);
      return null;
    }
    return window.KIWorkflow.runPlan(project,state.entries,state.conceptMarkdown,config).then(function(result){
      state.planMarkdown=window.KIWorkflow.readResponseMarkdown?window.KIWorkflow.readResponseMarkdown(result):(result.markdown||result.result||'');
      if(!state.planMarkdown)state.planMarkdown='(Leere Antwort erhalten)';
      updateWorkflowPersisted();
      touchMeetingProtocol(state.projectId);
      renderWorkflow();
      return result;
    });
  }).catch(function(err){
    notify('Plan konnte nicht erstellt werden: '+(err.message||String(err)),true);
  }).finally(function(){
    setBusy('',false);
  });
}

function runTasks(){
  var project=currentProject();
  if(!project){
    notify('Bitte zuerst ein Projekt auswaehlen.',true);
    return;
  }
  if(!state.planMarkdown){
    notify('Bitte zuerst einen Projektplan erstellen.',true);
    return;
  }

  setBusy('Tasks',true);
  openPromptAdapter('tasks','Stufe 3: Aufgaben erzeugen','technical').then(function(config){
    if(!config){
      setBusy('',false);
      return null;
    }
    return window.KIWorkflow.runTasks(project,state.entries,state.conceptMarkdown,state.planMarkdown,config).then(function(result){
      var count=result&&Array.isArray(result.createdTasks)?result.createdTasks.length:0;
      state.taskItems=normalizeTaskItems(result.createdTasks||result.tasks||[]);
      var taskMarkdown=window.KIWorkflow.readResponseMarkdown?window.KIWorkflow.readResponseMarkdown(result):(result.summaryMarkdown||result.markdown||result.result||'');
      state.tasksSummary='Erstellte Tasks: '+count+'\n\n'+taskMarkdown;
      updateWorkflowPersisted();
      touchMeetingProtocol(state.projectId);
      renderWorkflow();
      notify(count+' Tasks ins Dashboard importiert.',false);
      return result;
    });
  }).catch(function(err){
    notify('Tasks konnten nicht erzeugt werden: '+(err.message||String(err)),true);
  }).finally(function(){
    setBusy('',false);
  });
}

function bind(){
  var root=byId('meeting-root');
  if(!root||root.dataset.meetingBound==='1')return;
  root.dataset.meetingBound='1';

  root.innerHTML=''
    +'<div class="meeting-panel">'
      +'<div class="meeting-toolbar">'
        +'<label class="form-group"><span>Projekt</span><select id="meeting-project-select"></select></label>'
        +'<button type="button" class="btn btn-secondary" id="meeting-create-project">Neues Projekt</button>'
        +'<button type="button" class="btn btn-secondary" id="meeting-toggle-closed">Als Closed markieren</button>'
        +'<span id="meeting-protocol-status" class="meeting-loading">Status: Open</span>'
        +'<button type="button" class="btn btn-primary" id="meeting-save">Speichern</button>'
        +'<span id="meeting-loading" class="meeting-loading">Bereit</span>'
      +'</div>'

      +'<section class="meeting-flow-shell">'
        +'<div class="meeting-editor">'
          +'<div class="meeting-editor-head">'
            +'<label class="form-group meeting-editor-field"><span>Neuer Stichpunkt</span><textarea id="meeting-note-input" rows="5" placeholder="z. B. Budgetrahmen ca. 50k, Deadline Q4, Team: Max/Julia/Tom"></textarea></label>'
            +'<div class="meeting-editor-side">'
              +'<label class="form-group"><span>Label (optional)</span><select id="meeting-label-select"></select></label>'
              +'<div class="meeting-editor-actions">'
                +'<button type="button" class="btn btn-primary" id="meeting-add-entry" title="Stichpunkt speichern" aria-label="Stichpunkt speichern">+</button>'
                +'<button type="button" class="btn btn-secondary" id="meeting-analyze-note">Mit KI analysieren</button>'
              +'</div>'
            +'</div>'
          +'</div>'
          +'<div class="meeting-entry-list" id="meeting-entry-list"></div>'
        +'</div>'

        +'<div class="meeting-flow-body">'
          +'<div class="meeting-actions">'
            +'<button type="button" class="btn btn-primary" id="meeting-run-concept">KI Aufarbeitung starten</button>'
            +'<button type="button" class="btn btn-secondary" id="meeting-export-md">Export Markdown</button>'
            +'<button type="button" class="btn btn-secondary" id="meeting-export-json">Export JSON</button>'
          +'</div>'

          +'<div class="meeting-workflow-grid">'
            +'<section class="meeting-workflow-card">'
              +'<div class="meeting-workflow-head"><h3>Stufe 1: Konzept</h3><button type="button" class="btn btn-secondary" id="meeting-run-concept-inline">Neu generieren</button></div>'
              +'<pre id="meeting-concept-output" class="meeting-output"></pre>'
            +'</section>'
            +'<section class="meeting-workflow-card">'
              +'<div class="meeting-workflow-head"><h3>Stufe 2: Projektplan</h3><button type="button" class="btn btn-secondary" id="meeting-run-plan">Plan erstellen</button></div>'
              +'<pre id="meeting-plan-output" class="meeting-output"></pre>'
            +'</section>'
            +'<section class="meeting-workflow-card">'
              +'<div class="meeting-workflow-head"><h3>Stufe 3: Tasks</h3><button type="button" class="btn btn-secondary" id="meeting-run-tasks">Tasks erstellen</button></div>'
              +'<pre id="meeting-tasks-output" class="meeting-output"></pre>'
            +'</section>'
          +'</div>'

          +'<section class="meeting-task-draft-panel">'
            +'<details id="meeting-task-draft-collapsible" class="meeting-collapsible">'
              +'<summary class="meeting-collapsible-summary">'
                +'<span class="meeting-collapsible-title">KI: Aufgabe + Termin Entwurf</span>'
                +'<span class="meeting-collapsible-hint">Aufklappen</span>'
              +'</summary>'
              +'<div class="meeting-collapsible-content">'
                +'<div class="meeting-workflow-head">'
                  +'<h3>KI: Aufgabe + Termin Entwurf</h3>'
                  +'<button type="button" class="btn btn-primary" id="meeting-run-task-draft">Entwurf erzeugen</button>'
                +'</div>'
                +'<div class="meeting-draft-grid meeting-draft-grid-3">'
                  +'<label class="form-group"><span>Projekt</span><select id="meeting-draft-project-select"></select></label>'
                  +'<label class="form-group"><span>Terminart</span><select id="meeting-task-draft-schedule-mode">'
                    +'<option value="auto" selected>Automatisch erkennen</option>'
                    +'<option value="none">Kein Termin</option>'
                    +'<option value="deadline">Deadline</option>'
                    +'<option value="fixed">Fester Termin</option>'
                    +'<option value="range">Zeitraum</option>'
                    +'<option value="asap">Umgehend</option>'
                  +'</select></label>'
                  +'<label class="form-group"><span>Kalender-Typ</span><select id="meeting-task-draft-event-type">'
                    +'<option value="meeting">Meeting</option>'
                    +'<option value="deadline">Deadline</option>'
                    +'<option value="release">Release</option>'
                    +'<option value="holiday">Urlaub</option>'
                    +'<option value="task">Task</option>'
                  +'</select></label>'
                +'</div>'
                +'<label class="meeting-draft-check"><input type="checkbox" id="meeting-task-draft-subtasks" checked> Unteraufgaben automatisch erzeugen</label>'
                +'<label class="meeting-draft-check"><input type="checkbox" id="meeting-task-draft-multi" checked> Bei Bedarf als Teilaufgaben der Hauptaufgabe vorschlagen</label>'
                +'<label class="form-group"><span>Input fuer KI (Stichpunkte oder Freitext)</span><textarea id="meeting-task-draft-input" rows="4" placeholder="z. B. Kundenabnahme vorbereiten, bis Ende naechster Woche, Risiko: fehlende Testdaten, Team DE+EN"></textarea></label>'
                +'<div id="meeting-task-draft-preview" class="meeting-task-draft-preview"></div>'
              +'</div>'
            +'</details>'
          +'</section>'
        +'</div>'
      +'</section>'
    +'</div>';

  var labelSelect=byId('meeting-label-select');
  if(labelSelect){
    var options=['<option value="">-- Kein Label --</option>'];
    getLabelOptions().forEach(function(label){
      options.push('<option value="'+escapeHtml(label)+'">'+escapeHtml(label)+'</option>');
    });
    labelSelect.innerHTML=options.join('');
  }

  var select=byId('meeting-project-select');
  if(select){
    select.addEventListener('change',function(){
      loadStateForProject(this.value||'');
      render();
    });
  }

  var input=byId('meeting-note-input');
  if(input){
    input.addEventListener('keydown',function(evt){
      if((evt.ctrlKey||evt.metaKey)&&evt.key==='Enter'){
        evt.preventDefault();
        addEntry();
      }
    });
  }

  byId('meeting-create-project').addEventListener('click',openCreateProjectModal);
  byId('meeting-toggle-closed').addEventListener('click',toggleMeetingProtocolStatus);
  byId('meeting-save').addEventListener('click',saveMeetingState);
  byId('meeting-add-entry').addEventListener('click',addEntry);
  byId('meeting-analyze-note').addEventListener('click',analyzeNoteInput);
  byId('meeting-export-md').addEventListener('click',exportMarkdown);
  byId('meeting-export-json').addEventListener('click',exportJson);
  byId('meeting-run-concept').addEventListener('click',runConcept);
  byId('meeting-run-concept-inline').addEventListener('click',runConcept);
  byId('meeting-run-plan').addEventListener('click',runPlan);
  byId('meeting-run-tasks').addEventListener('click',runTasks);
  byId('meeting-run-task-draft').addEventListener('click',runTaskDraft);

  byId('meeting-task-draft-preview').addEventListener('click',function(evt){
    if(evt.target&&evt.target.id==='meeting-apply-task-draft'){
      applyTaskDraft();
      return;
    }
    if(evt.target&&evt.target.id==='meeting-apply-event-draft'){
      applyDraftEventOnly();
      return;
    }
    if(evt.target&&evt.target.id==='meeting-apply-bulk-task-draft'){
      applyTaskDraftBulk();
      return;
    }
    if(evt.target&&evt.target.id==='meeting-apply-suggested-tasks'){
      applySuggestedTasks();
    }
  });

  var draftProjectSelect=byId('meeting-draft-project-select');
  if(draftProjectSelect){
    draftProjectSelect.addEventListener('change',function(){
      state.draftProjectId=this.value||state.projectId;
    });
  }

  byId('meeting-entry-list').addEventListener('click',function(evt){
    var target=evt.target;
    if(!target||!target.dataset||!target.dataset.id)return;
    removeEntry(target.dataset.id);
  });

  var projects=getProjects();
  if(projects.length){
    var preferred=readActiveProjectId();
    var initial=window.DataLayer.getProjectById(preferred)?preferred:projects[0].id;
    loadStateForProject(initial);
  }

  setSaveStatus('Bereit');
  render();
}

function init(){
  if(!window.DataLayer){
    console.warn('[Meeting] DataLayer nicht verfuegbar.');
    return;
  }

  bind();

  if(window.DataLayer.on){
    window.DataLayer.on('dataChanged',function(){
      var labelSelect=byId('meeting-label-select');
      if(labelSelect){
        var options=['<option value="">-- Kein Label --</option>'];
        getLabelOptions().forEach(function(label){
          options.push('<option value="'+escapeHtml(label)+'">'+escapeHtml(label)+'</option>');
        });
        labelSelect.innerHTML=options.join('');
      }
      renderProjectSelect();
    });
  }
}

function openProject(projectId){
  var targetId=String(projectId||'').trim();
  if(!targetId||!window.DataLayer||typeof window.DataLayer.getProjectById!=='function')return false;
  var project=window.DataLayer.getProjectById(targetId);
  if(!project)return false;
  loadStateForProject(targetId);
  render();
  return true;
}

window[NAMESPACE]={
  init:init,
  render:render,
  openProject:openProject,
  getState:function(){return JSON.parse(JSON.stringify(state));}
};

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

})();

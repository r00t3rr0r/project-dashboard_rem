/* ========================================
   KI Workflow Module
   3-stufige Meeting-Aufarbeitung
   ======================================== */
(function(){'use strict';

var NAMESPACE='KIWorkflow';
var AI_BACKEND_URL='http://127.0.0.1:8766';

function getBackendCandidates(){
  var origin=(window.location&&window.location.origin)?window.location.origin:'';
  var list=[AI_BACKEND_URL,'http://localhost:8766','http://127.0.0.1:8765'];
  if(origin)list.push(origin);
  return list.filter(function(item,idx){return item&&list.indexOf(item)===idx;});
}

function isFallbackableStatus(status){
  return status===404||status===405||status===501;
}

function requestJson(path,method,payload,extraHeaders){
  var bases=getBackendCandidates();
  var headers={'Content-Type':'application/json'};
  if(extraHeaders&&typeof extraHeaders==='object'){
    Object.keys(extraHeaders).forEach(function(key){headers[key]=extraHeaders[key];});
  }

  function tryBase(index,lastError){
    if(index>=bases.length)return Promise.reject(lastError||new Error('Kein KI-Backend erreichbar.'));
    var endpoint=bases[index]+path;
    var options={method:method,headers:headers};
    if(method==='POST'&&payload!==undefined){
      options.body=JSON.stringify(payload||{});
    }

    return fetch(endpoint,options).then(function(res){
      return res.json().catch(function(){return {};}).then(function(body){
        if(!res.ok){
          var err=new Error(body&&body.error?body.error:('HTTP '+res.status+' @ '+endpoint));
          if(isFallbackableStatus(res.status))return tryBase(index+1,err);
          throw err;
        }
        return {endpoint:endpoint,body:body};
      });
    }).catch(function(err){
      if(index+1<bases.length)return tryBase(index+1,err);
      throw err;
    });
  }

  return tryBase(0,null);
}

function getProjectSnapshot(project){
  var tasks=window.DataLayer&&window.DataLayer.getTasks?window.DataLayer.getTasks():[];
  var events=window.DataLayer&&window.DataLayer.getCalendarEvents?window.DataLayer.getCalendarEvents():[];
  var releases=window.DataLayer&&window.DataLayer.getReleases?window.DataLayer.getReleases():[];

  return {
    project:{
      id:project&&project.id?project.id:'',
      title:project&&project.title?project.title:'',
      description:project&&project.description?project.description:'',
      status:project&&project.status?project.status:'',
      startDate:project&&project.startDate?project.startDate:'',
      endDate:project&&project.endDate?project.endDate:''
    },
    tasks:tasks.filter(function(item){return item&&item.projectId===project.id;}).map(function(item){
      return {
        id:item.id,
        title:item.title||'',
        description:item.description||'',
        status:item.status||'',
        priority:item.priority||'',
        assigneeId:item.assigneeId||'',
        labels:Array.isArray(item.labels)?item.labels:[]
      };
    }),
    releases:releases.filter(function(item){return item&&item.projectId===project.id;}).map(function(item){
      return {
        id:item.id,
        title:item.title||'',
        status:item.status||'',
        releaseDate:item.releaseDate||''
      };
    }),
    events:events.filter(function(item){return item&&item.projectId===project.id;}).map(function(item){
      return {
        id:item.id,
        title:item.title||'',
        date:item.date||'',
        type:item.type||''
      };
    })
  };
}

function notesToMarkdown(entries){
  if(!Array.isArray(entries)||!entries.length)return '- (keine Notizen)';
  return entries.map(function(item){
    var label=item&&item.label?(' ['+item.label+']'):'';
    var stamp=item&&item.createdAt?(' ('+String(item.createdAt).replace('T',' ').slice(0,16)+')'):'';
    return '-'+label+stamp+' '+(item&&item.text?item.text:'');
  }).join('\n');
}

function notify(message,isError){
  if(window.QuickTaskModule&&typeof window.QuickTaskModule.showToast==='function'){
    window.QuickTaskModule.showToast(message,!!isError);
    return;
  }
  if(isError){
    console.error('[KIWorkflow]',message);
  }else{
    console.log('[KIWorkflow]',message);
  }
}

function listAvailableModels(){
  return requestJson('/api/ai/health','GET').then(function(result){
    var body=result.body||{};
    if(body.status!=='ok'||!Array.isArray(body.models))return [];
    var models=[];
    body.models.forEach(function(item){
      var name=item&&item.name?String(item.name).trim():'';
      if(!name&&item&&item.model)name=String(item.model).trim();
      if(name&&models.indexOf(name)===-1)models.push(name);
    });
    return models;
  }).catch(function(){
    return [];
  });
}

function processStage(path,payload){
  return requestJson(path,'POST',payload).then(function(result){
    return result.body||{};
  });
}

function combineChunks(chunks){
  if(!Array.isArray(chunks)||!chunks.length)return '';
  return chunks.map(function(chunk){return String(chunk||'');}).join('');
}

function readResponseMarkdown(result){
  if(!result||typeof result!=='object')return '';
  if(Array.isArray(result.markdownChunks)&&result.markdownChunks.length){
    return combineChunks(result.markdownChunks).trim();
  }
  if(Array.isArray(result.chunks)&&result.chunks.length){
    return combineChunks(result.chunks).trim();
  }
  if(Array.isArray(result.responseChunks)&&result.responseChunks.length){
    return combineChunks(result.responseChunks).trim();
  }
  return String(result.markdown||result.result||'').trim();
}

function runConcept(project,meetingEntries,promptConfig){
  var snapshot=getProjectSnapshot(project);
  var payload={
    projectId:project.id,
    projectTitle:project.title||project.name||'Unbenanntes Projekt',
    meetingNotes:Array.isArray(meetingEntries)?meetingEntries:[],
    meetingNotesMarkdown:notesToMarkdown(meetingEntries),
    existingData:snapshot,
    promptConfig:promptConfig||{}
  };

  return processStage('/api/ai/meeting-to-concept',payload).then(function(result){
    notify('Projektkonzept durch KI erstellt.',false);
    return result;
  });
}

function runPlan(project,meetingEntries,conceptMarkdown,promptConfig){
  var snapshot=getProjectSnapshot(project);
  var payload={
    projectId:project.id,
    projectTitle:project.title||project.name||'Unbenanntes Projekt',
    meetingNotes:Array.isArray(meetingEntries)?meetingEntries:[],
    meetingNotesMarkdown:notesToMarkdown(meetingEntries),
    conceptMarkdown:String(conceptMarkdown||''),
    existingData:snapshot,
    promptConfig:promptConfig||{}
  };

  return processStage('/api/ai/concept-to-plan',payload).then(function(result){
    notify('Projektplan durch KI erstellt.',false);
    return result;
  });
}

function resolveLabelIdsByNames(names){
  var labels=window.DataLayer&&window.DataLayer.getLabels?window.DataLayer.getLabels():[];
  if(!Array.isArray(names)||!names.length)return [];
  var lowerMap={};
  labels.forEach(function(label){
    var key=String((label&&label.name)||'').trim().toLowerCase();
    if(key)lowerMap[key]=label.id;
  });

  return names.map(function(name){
    var key=String(name||'').trim().toLowerCase();
    return lowerMap[key]||null;
  }).filter(function(id,idx,list){
    return !!id&&list.indexOf(id)===idx;
  });
}

function importTasks(project,taskItems){
  if(!window.DataLayer||typeof window.DataLayer.createTask!=='function'){
    throw new Error('DataLayer.createTask nicht verfuegbar.');
  }
  var list=Array.isArray(taskItems)?taskItems:[];
  var ordered=list.map(function(item,idx){
    var entry=item&&typeof item==='object'?item:{};
    var sequenceIndex=Number(entry.sequenceIndex||entry.orderIndex||0)||0;
    return Object.assign({__importIndex:idx,sequenceIndex:sequenceIndex},entry);
  }).filter(function(item){
    return !!String(item.title||'').trim();
  }).sort(function(a,b){
    var aSeq=Number(a.sequenceIndex||0)||0;
    var bSeq=Number(b.sequenceIndex||0)||0;
    if(aSeq&&!bSeq)return -1;
    if(!aSeq&&bSeq)return 1;
    if(aSeq&&bSeq&&aSeq!==bSeq)return aSeq-bSeq;
    return a.__importIndex-b.__importIndex;
  });
  var created=[];

  ordered.forEach(function(item,idx){
    if(!item||typeof item!=='object')return;
    var title=String(item.title||'').trim();
    if(!title)return;

    var rawStatus=String(item.status||'todo').toLowerCase();
    var rawPriority=String(item.priority||'medium').toLowerCase();
    var statusMap={
      backlog:'backlog',
      todo:'todo',
      'to-do':'todo',
      inprogress:'in-progress',
      'in-progress':'in-progress',
      review:'review',
      done:'done'
    };
    var priorityMap={low:'low',medium:'medium',high:'high',blocker:'blocker'};
    var schedule=item.schedule&&typeof item.schedule==='object'?item.schedule:{};
    var dependencyTaskIds=[];
    if((item.dependsOnPrevious || (item.sequenceIndex && Number(item.sequenceIndex)>1)) && created.length){
      dependencyTaskIds.push(created[created.length-1].id);
    }

    var task={
      title:title,
      description:String(item.description||''),
      projectId:project.id,
      status:statusMap[rawStatus]||'todo',
      priority:priorityMap[rawPriority]||'medium',
      effortHours:Number(item.effortHours||0)||0,
      labels:resolveLabelIdsByNames(item.labels),
      notes:[],
      attachments:[],
      subtasks:Array.isArray(item.subtasks)?item.subtasks.map(function(sub){
        var text=typeof sub==='string'?sub:String((sub&&sub.title)||'').trim();
        return {title:text,done:false};
      }).filter(function(sub){return !!sub.title;}):[]
    };

    task.sequenceIndex=item.sequenceIndex&&Number(item.sequenceIndex)>0?Number(item.sequenceIndex):idx+1;
    task.dependsOnPrevious=!!item.dependsOnPrevious || idx>0;
    task.dependencyTaskIds=dependencyTaskIds;
    task.schedule={
      mode:String(schedule.mode||'none').toLowerCase(),
      deadline:String(schedule.deadline||item.deadline||item.dueDate||'').trim(),
      fixedAt:String(schedule.fixedAt||item.fixedAt||'').trim(),
      rangeStart:String(schedule.rangeStart||item.rangeStart||'').trim(),
      rangeEnd:String(schedule.rangeEnd||item.rangeEnd||'').trim()
    };
    if(item.note){
      task.notes=[{text:String(item.note),createdAt:new Date().toISOString()}];
    }
    if(item.assigneeId){
      task.assigneeId=String(item.assigneeId).trim();
    }

    created.push(window.DataLayer.createTask(task));
  });

  if(typeof window.DataLayer.emit==='function'){
    window.DataLayer.emit('dataChanged', {action:'import', entity:'tasks'});
  }

  return created;
}

function runTasks(project,meetingEntries,conceptMarkdown,planMarkdown,promptConfig){
  var snapshot=getProjectSnapshot(project);
  var payload={
    projectId:project.id,
    projectTitle:project.title||project.name||'Unbenanntes Projekt',
    meetingNotes:Array.isArray(meetingEntries)?meetingEntries:[],
    meetingNotesMarkdown:notesToMarkdown(meetingEntries),
    conceptMarkdown:String(conceptMarkdown||''),
    planMarkdown:String(planMarkdown||''),
    existingData:snapshot,
    promptConfig:promptConfig||{}
  };

  return processStage('/api/ai/plan-to-tasks',payload).then(function(result){
    var createdTasks=importTasks(project,result.tasks||[]);
    notify(createdTasks.length+' Aufgaben aus KI-Plan erstellt.',false);
    result.createdTasks=createdTasks;
    return result;
  });
}

function runTaskDraft(project,meetingEntries,draftInput,options,promptConfig){
  if(!project||!project.id)throw new Error('Projekt fehlt.');
  var snapshot=getProjectSnapshot(project);
  var payload={
    projectId:project.id,
    projectTitle:project.title||project.name||'Unbenanntes Projekt',
    meetingNotes:Array.isArray(meetingEntries)?meetingEntries:[],
    meetingNotesMarkdown:notesToMarkdown(meetingEntries),
    draftInput:String(draftInput||''),
    options:options&&typeof options==='object'?options:{},
    existingData:snapshot,
    promptConfig:promptConfig||{}
  };

  return processStage('/api/ai/meeting-task-draft',payload).then(function(result){
    notify('KI-Entwurf fuer Aufgabe/Termin erstellt.',false);
    return result;
  });
}

window[NAMESPACE]={
  listAvailableModels:listAvailableModels,
  runConcept:runConcept,
  runPlan:runPlan,
  runTasks:runTasks,
  runTaskDraft:runTaskDraft,
  notesToMarkdown:notesToMarkdown,
  readResponseMarkdown:readResponseMarkdown,
  combineChunks:combineChunks
};

})();

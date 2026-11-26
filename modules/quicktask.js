/* ========================================
   QuickTask — Schnellaufgabe erstellen (Page + Modal)
   ======================================== */
(function(){'use strict';

function escapeHtml(str){
  if(!str)return'';
  var div=document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

function escapeAttr(str){
  return escapeHtml(str).replace(/"/g,'&quot;');
}

function getAuthManager(){
  return window.AuthManager || null;
}

function setSharedModalCloseGuard(owner){
  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(!overlay||!content)return;
  overlay.setAttribute('data-close-guard-owner',owner||'quicktask');
  content.setAttribute('data-modal-owner',owner||'quicktask');
  content.setAttribute('data-prevent-overlay-close','true');
  content.setAttribute('data-prevent-escape-close','true');
}

function clearSharedModalCloseGuard(){
  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(overlay)overlay.removeAttribute('data-close-guard-owner');
  if(content){
    content.removeAttribute('data-modal-owner');
    content.removeAttribute('data-prevent-overlay-close');
    content.removeAttribute('data-prevent-escape-close');
  }
}

function closeSharedModal(){
  clearSharedModalCloseGuard();
  if(typeof window.closeModal==='function'){
    window.closeModal();
    return;
  }
  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(!overlay||!content)return;
  overlay.classList.add('hidden');
  content.innerHTML='';
}

function getVisibleProjects(){
  var auth=getAuthManager();
  var projects=window.DataLayer.getProjects();
  if(auth&&typeof auth.getVisibleProjects==='function'){
    return auth.getVisibleProjects(projects);
  }
  return projects;
}

function getAssignableEmployees(){
  var auth=getAuthManager();
  var employees=window.DataLayer.getEmployees();
  if(auth&&typeof auth.getAssignableEmployees==='function'){
    return auth.getAssignableEmployees(employees);
  }
  return employees;
}

function isAdminMode(auth){
  if(!auth||typeof auth.getMode!=='function')return false;
  var mode=String(auth.getMode()||'').toLowerCase();
  return mode==='setup'||mode==='admin';
}

function requestAiTaskDraft(payload){
  if(!window.LocalOllama||typeof window.LocalOllama.generate!=='function'){
    return Promise.reject(new Error('Lokaler Ollama-Client wurde nicht geladen.'));
  }
  return window.LocalOllama.generate('/api/ai/meeting-task-draft',payload||{});
}

function translateGitHubCommits(commits,project){
  if(!window.LocalOllama||typeof window.LocalOllama.generate!=='function'||!window.AIConfModule||typeof window.AIConfModule.translateCommitBatch!=='function'){
    return Promise.reject(new Error('Die KI-Uebersetzung ist nicht verfuegbar.'));
  }
  var translated=[],chain=Promise.resolve();
  for(var offset=0;offset<commits.length;offset+=4){
    (function(batch){
      chain=chain.then(function(){
        return window.AIConfModule.translateCommitBatch(project,batch).then(function(items){translated=translated.concat(items);});
      });
    })(commits.slice(offset,offset+4));
  }
  return chain.then(function(){return translated;});
}

function formatGitHubCommitDraft(commits){
  var titles=[];
  commits.forEach(function(commit){
    var title=String(commit.title||'').replace(/\s+/g,' ').trim();
    if(title&&!titles.some(function(existing){return existing.toLowerCase()===title.toLowerCase();}))titles.push(title);
  });
  if(!titles.length)throw new Error('Fuer die Tagesaufgabe fehlen deutsche Commit-Titel.');
  var displayed=titles.slice(0,2).map(function(title){
    if(title.length<=60)return title;
    var shortened=title.slice(0,59);
    var boundary=shortened.lastIndexOf(' ');
    return (boundary>29?shortened.slice(0,boundary):shortened)+'…';
  });
  return {
    title:displayed.join(' · ')+(titles.length>displayed.length?' (+'+(titles.length-displayed.length)+' weitere Commit-Titel)':''),
    description:'Nachtraegliche Dokumentation der GitHub-Commits.\n\nCommits:\n'+commits.map(function(commit){
      return commit.sha+' ('+commit.author+')'+(commit.branches&&commit.branches.length?'\nBranch: '+commit.branches.join(', '):'')
        +'\nDE: '+commit.title+'\n'+commit.descriptionDe
        +'\nEN: '+commit.titleEn+'\n'+commit.descriptionEn
        +'\nOriginal: '+commit.message;
    }).join('\n\n'),
    subtasks:commits.map(function(commit){return 'DE: '+commit.title+' | EN: '+commit.titleEn+' | Commit: '+commit.sha+(commit.branches&&commit.branches.length?' | Branch: '+commit.branches.join(', '):'');})
  };
}

function groupGitHubCommitsByDay(commits){
  if(!window.AIConfModule||typeof window.AIConfModule.commitCalendarData!=='function')throw new Error('GitHub-Kalenderdaten sind nicht verfuegbar.');
  var byKey=Object.create(null);
  commits.forEach(function(commit){
    var entry=commit.calendarDate&&commit.calendarTime?commit:window.AIConfModule.commitCalendarData(commit);
    // commitCalendarData kennt employeeId nicht: Zuordnung des Quell-Commits erhalten
    if(commit.employeeId!==undefined&&entry.employeeId===undefined)entry=Object.assign({},entry,{employeeId:commit.employeeId});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.calendarDate)||!/^\d{2}:\d{2}$/.test(entry.calendarTime)||!isFinite(Date.parse(entry.date)))throw new Error('Ungueltiger Commit-Zeitpunkt: '+entry.sha);
    var employeeId=String(entry.employeeId||'');
    var key=entry.calendarDate+'::'+employeeId;
    if(!byKey[key])byKey[key]={date:entry.calendarDate,employeeId:employeeId,commits:[]};
    byKey[key].commits.push(entry);
  });
  return Object.keys(byKey).sort().map(function(key){
    var group=byKey[key];
    var entries=group.commits.sort(function(a,b){return Date.parse(a.date)-Date.parse(b.date)||a.sha.localeCompare(b.sha);});
    return {date:group.date,employeeId:group.employeeId,commits:entries,draft:formatGitHubCommitDraft(entries)};
  });
}

function findGitHubCommitEmployee(commit,employees){
  var login=String(commit.authorLogin||'').trim().replace(/^@/,'').toLowerCase();
  var author=String(commit.author||'').trim().toLowerCase();
  if(!login&&!author)return '';
  var matches=employees.filter(function(employee){
    var github=employee&&employee.github||{};
    var username=String(github.username||'').trim().replace(/^@/,'');
    if(!username){
      var profile=String(github.profileUrl||'').trim().match(/^https?:\/\/(?:www\.)?github\.com\/([a-z0-9-]+)\/?(?:[?#].*)?$/i);
      username=profile?profile[1]:'';
    }
    if(!employee||!employee.id)return false;
    if(login)return username.toLowerCase()===login;
    var name=String(employee.name||'').trim().toLowerCase();
    return Array.isArray(github.aliases)&&github.aliases.some(function(alias){
      var value=String(alias||'').trim().toLowerCase();
      return value&&value===author&&(value===name||value!==username.toLowerCase());
    });
  });
  return matches.length===1?String(matches[0].id):'';
}

function fetchQuickTaskGitHubCommits(project){
  if(!window.AIConfModule||typeof window.AIConfModule.fetchRecentCommits!=='function')return Promise.reject(new Error('Der GitHub-Commit-Abruf ist nicht verfuegbar.'));
  return window.AIConfModule.fetchRecentCommits(project,'',new Date().toISOString());
}

function getGitHubCommitDocumentationTaskId(sha,project){
  var target='github-commit:'+String(sha||'').trim();
  var repository=String(project.github.owner+'/'+project.github.repo).toLowerCase();
  var tasks=window.DataLayer&&typeof window.DataLayer.getTasks==='function'?window.DataLayer.getTasks():[];
  var existing=tasks.find(function(task){
    if(!task||!window.DataLayer.isTaskLinkedToProject(task,project.id))return false;
    if(String(task.externalId||'')===target)return true;
    var source=task.githubCommitImport;
    if(source&&String(source.repository||'').toLowerCase()===repository&&Array.isArray(source.shas)&&source.shas.indexOf(sha)!==-1)return true;
    return Array.isArray(task.sourceCommitShas)&&task.sourceCommitShas.indexOf(String(sha||'').trim())!==-1;
  });
  return existing?String(existing.id||''):'';
}

function setMultiSelectValues(selectEl,values){
  if(!selectEl||!selectEl.options)return;
  var map={};
  (Array.isArray(values)?values:[]).forEach(function(value){
    map[String(value)]=true;
  });
  for(var i=0;i<selectEl.options.length;i++){
    var option=selectEl.options[i];
    option.selected=!!map[String(option.value)];
  }
}

function normalizeText(value){
  return String(value||'').toLowerCase();
}

function normalizeAssigneeIds(values){
  var out=[];
  var seen={};
  (Array.isArray(values)?values:[]).forEach(function(value){
    var id=String(value||'').trim();
    if(!id||seen[id])return;
    seen[id]=true;
    out.push(id);
  });
  return out;
}

function getTaskAssigneeIds(task){
  if(!task||typeof task!=='object')return [];
  var ids=[];
  if(Array.isArray(task.assigneeIds)){
    ids=ids.concat(task.assigneeIds);
  }
  if(task.assigneeId)ids.push(task.assigneeId);
  return normalizeAssigneeIds(ids);
}

function collectEmployeeLoad(projectId){
  var tasks=(window.DataLayer&&typeof window.DataLayer.getTasks==='function')?window.DataLayer.getTasks():[];
  var loads={};
  tasks.forEach(function(task){
    if(!task)return;
    var assigneeIds=getTaskAssigneeIds(task);
    if(!assigneeIds.length)return;
    var status=String(task.status||'').toLowerCase();
    if(status==='done'||status==='closed')return;
    var isCritical=String(task.priority||'')==='blocker'||String(task.priority||'')==='high'||String(task.urgency||'')==='critical'||String(task.urgency||'')==='high'||!!task.blocked;
    assigneeIds.forEach(function(id){
      var key=String(id);
      if(!loads[key])loads[key]={open:0,openInProject:0,highPressure:0};
      loads[key].open++;
      if(projectId&&window.DataLayer.isTaskLinkedToProject(task,projectId))loads[key].openInProject++;
      if(isCritical)loads[key].highPressure++;
    });
  });
  return loads;
}

function rankAssigneeSuggestions(taskText,projectId,employees){
  var list=Array.isArray(employees)?employees:[];
  if(!list.length)return [];

  var text=normalizeText(taskText);
  var loads=collectEmployeeLoad(projectId);
  var roleHintMap=[
    {keywords:['frontend','ui','css','html','design'],roles:['frontend','ui','designer']},
    {keywords:['backend','api','server','datenbank','db'],roles:['backend','api','devops']},
    {keywords:['test','qa','bug','qualitaet'],roles:['qa','quality','test']},
    {keywords:['deploy','infrastruktur','infra','ci','pipeline'],roles:['devops','platform','infrastruktur']},
    {keywords:['planung','abstimmung','stakeholder','konzept'],roles:['project lead','manager','product']}
  ];

  function computeRoleFit(roleText){
    var fit=0;
    for(var i=0;i<roleHintMap.length;i++){
      var hint=roleHintMap[i];
      var keywordHit=hint.keywords.some(function(word){return text.indexOf(word)!==-1;});
      if(!keywordHit)continue;
      var roleHit=hint.roles.some(function(role){return roleText.indexOf(role)!==-1;});
      if(roleHit)fit++;
    }
    return fit;
  }

  return list.map(function(employee){
    var id=String(employee&&employee.id||'');
    var roleText=normalizeText((employee&&employee.role||'')+' '+(employee&&employee.name||''));
    var fit=computeRoleFit(roleText);
    var load=loads[id]||{open:0,openInProject:0,highPressure:0};
    var score=(load.open*1.2)+(load.openInProject*0.8)+(load.highPressure*1.5)-(fit*1.35);
    return {
      employee:employee,
      score:Math.round(score*100)/100,
      roleFit:fit,
      load:load
    };
  }).sort(function(a,b){return a.score-b.score;});
}

function getDateKey(offsetDays){
  var now=new Date();
  if(offsetDays)now.setDate(now.getDate()+offsetDays);
  return now.toISOString().slice(0,10);
}

function parseSubtasksFromText(text){
  return String(text||'').split('\n').map(function(line){return line.trim();}).filter(Boolean).map(function(title){
    return {id:window.DataLayer.generateId(),title:title,completed:false,createdAt:new Date().toISOString()};
  });
}

function parseAttachmentsFromText(text){
  return String(text||'').split('\n').map(function(line){return line.trim();}).filter(Boolean).map(function(line){
    var parts=line.split('|');
    var name='';
    var url='';
    if(parts.length>=2){
      name=parts[0].trim();
      url=parts.slice(1).join('|').trim();
    }else{
      url=line;
      name=line;
    }
    return {id:window.DataLayer.generateId(),name:name||url,url:url,type:'link',addedAt:new Date().toISOString()};
  }).filter(function(item){return !!item.url;});
}

function buildSchedule(mode,deadline,fixedAt,rangeStart,rangeEnd){
  return {
    mode:mode||'none',
    deadline:deadline||'',
    fixedAt:fixedAt||'',
    rangeStart:rangeStart||'',
    rangeEnd:rangeEnd||''
  };
}

function buildTaskPayloadFromFields(fields){
  var noteText=(fields.noteText||'').trim();
  var normalizedAssigneeIds=normalizeAssigneeIds(
    Array.isArray(fields.assigneeIds)&&fields.assigneeIds.length
      ? fields.assigneeIds
      : (fields.assigneeId?[fields.assigneeId]:[])
  );
  return {
    title:(fields.title||'').trim(),
    description:(fields.description||'').trim(),
    priority:fields.priority||'medium',
    urgency:fields.urgency||'normal',
    projectId:(Array.isArray(fields.projectIds)&&fields.projectIds.length?fields.projectIds[0]:fields.projectId)||null,
    projectIds:Array.isArray(fields.projectIds)?fields.projectIds.slice():(fields.projectId?[fields.projectId]:[]),
    assigneeId:normalizedAssigneeIds.length?normalizedAssigneeIds[0]:null,
    assigneeIds:normalizedAssigneeIds,
    labels:Array.isArray(fields.labels)?fields.labels:[],
    status:fields.status||'backlog',
    effortHours:parseFloat(fields.effortHours||'0')||0,
    createdAt:new Date().toISOString(),
    schedule:buildSchedule(fields.scheduleMode,fields.deadline,fields.fixedAt,fields.rangeStart,fields.rangeEnd),
    subtasks:parseSubtasksFromText(fields.subtasksText),
    notes:noteText?[{id:window.DataLayer.generateId(),text:noteText,createdAt:new Date().toISOString()}]:[],
    attachments:parseAttachmentsFromText(fields.attachmentsText)
  };
}

function getNextProjectSequenceIndex(projectId){
  var maxIndex=0;
  (window.DataLayer.getTasks()||[]).forEach(function(task){
    if(!task)return;
    if(projectId&&!window.DataLayer.isTaskLinkedToProject(task,projectId))return;
    var seq=Number(task.sequenceIndex||0)||0;
    if(seq>maxIndex)maxIndex=seq;
  });
  return maxIndex+1;
}

function buildProjectOptions(projects,emptyLabel){
  var opts='<option value="">'+escapeHtml(emptyLabel||'-- Projekt waehlen --')+'</option>';
  return opts+projects.map(function(project){
    return '<option value="'+escapeAttr(project.id)+'">'+escapeHtml(project.title||project.name||'Ohne Titel')+'</option>';
  }).join('');
}

function buildEmployeeOptions(employees,emptyLabel){
  var opts='<option value="">'+escapeHtml(emptyLabel||'-- Zuweisen --')+'</option>';
  return opts+employees.map(function(employee){
    var label=(employee.name||'')+(employee.role?' ('+employee.role+')':'');
    return '<option value="'+escapeAttr(employee.id)+'">'+escapeHtml(label||'Mitarbeiter')+'</option>';
  }).join('');
}

function buildLabelOptions(labels){
  return labels.map(function(label){
    return '<option value="'+escapeAttr(label.id)+'" style="background:'+escapeAttr(label.color||'transparent')+'">'+escapeHtml(label.name||'')+'</option>';
  }).join('');
}

/* ---------- Modal-Popup (Bestandteil) ---------- */
function openQuickTaskModal(prefill){
  try{
    prefill=prefill&&typeof prefill==='object'?prefill:{};
    var auth=getAuthManager();
    if(auth&&typeof auth.canCreateTask==='function'&&!auth.canCreateTask()){
      alert('QuickTask ist nur fuer angemeldete Mitarbeiter freigeschaltet.');
      return;
    }
    var overlay=document.getElementById('modal-overlay');if(!overlay)return;
    var content=document.getElementById('modal-content');if(!content)return;
    
    var projects=getVisibleProjects();
    var employees=getAssignableEmployees();
    var labels=window.DataLayer.getLabels();
    var adminMode=isAdminMode(auth);
    
    var lOpts=buildLabelOptions(labels);
    var aiToolsHtml=adminMode
      ? '<div class="task-ai-panel">'
        +'<div class="task-ai-head"><strong>KI-Assistent (Admin)</strong><small>Aus Titel und Beschreibung automatisch Entwurf und Verteilung erzeugen</small></div>'
        +(window.LocalOllama&&window.LocalOllama.providerSelectHtml?window.LocalOllama.providerSelectHtml('qtm-ai-provider'):'')
        +'<div class="task-ai-actions">'
          +'<button type="button" class="btn btn-secondary" id="qtm-ai-fill">KI-Entwurf aus Titel + Beschreibung</button>'
          +'<button type="button" class="btn btn-secondary" id="qtm-ai-assign">KI-Zuweisung</button>'
          +'<button type="button" class="btn btn-secondary" id="qtm-github-commits">Neue GitHub-Commits abrufen</button>'
          +'<button type="button" class="btn btn-secondary hidden" id="qtm-ai-chain">Kettenvorschlag uebernehmen</button>'
        +'</div>'
        +'<label class="task-ai-check"><input type="checkbox" id="qtm-ai-autoassign" checked> Mitarbeiter automatisch vorschlagen</label>'
        +'<div class="task-ai-status" id="qtm-ai-status">Bereit fuer KI-Vervollstaendigung.</div>'
        +'<div class="task-ai-hint hidden" id="qtm-ai-hint"></div>'
        +'<div class="task-ai-hint hidden" id="qtm-github-commit-review"></div>'
      +'</div>'
      : '';
    
    content.innerHTML='<header class="qtm-new-header"><p class="qtm-new-eyebrow">Aufgaben</p><h2>Neue Aufgabe</h2></header>' +
      '<div class="qtm-new-layout">' +
      '<section class="qtm-new-section"><h3>Aufgabendaten</h3>' +
      '<div class="form-group"><label for="qtm-title">Titel *</label><input type="text" id="qtm-title"></div>' +
      '<div class="form-group"><label for="qtm-project">Projekte</label><select id="qtm-project" multiple size="4">'+projects.map(function(project){return '<option value="'+escapeAttr(project.id)+'">'+escapeHtml(project.title||project.name||'Ohne Titel')+'</option>';}).join('')+'</select><small class="text-muted">Optional: keine Auswahl fuer eine projektuebergreifende Aufgabe; mehrere Projekte per STRG-/CMD-Klick verknuepfen.</small></div>' +
      '<div class="form-group"><label>Mitarbeiter</label><div id="qtm-assignee-picker" class="qtm-assignee-picker"></div><small id="qtm-assignee-help" style="color:var(--text-muted)">Mehrfachauswahl: Mitarbeiter per Klick zuweisen</small></div>' +
      '<div class="form-group"><label for="qtm-desc">Beschreibung</label><textarea id="qtm-desc" rows="6"></textarea></div>' +
      '</section>' +
      '<section class="qtm-new-section"><h3>Planung</h3>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label for="qtm-prio">Priorität *</label><select id="qtm-prio"><option value="low">Niedrig</option><option value="medium" selected>Mittel</option><option value="high">Hoch</option><option value="blocker">Blocker</option></select></div>' +
      '  <div class="form-group"><label for="qtm-urgency">Dringlichkeit</label><select id="qtm-urgency"><option value="low">Niedrig</option><option value="normal" selected>Normal</option><option value="high">Hoch</option><option value="critical">Kritisch</option></select></div>' +
      '  <div class="form-group"><label for="qtm-effort">Aufwand (h)</label><input type="number" min="0" step="0.5" id="qtm-effort" value="0"></div>' +
      '</div>' +
      '  <div class="form-group"><label for="qtm-schedule-mode">Terminart</label><select id="qtm-schedule-mode"><option value="none">Kein Termin</option><option value="deadline">Deadline</option><option value="fixed">Fester Termin</option><option value="range">Zeitraum</option><option value="asap">Umgehend</option></select></div>' +
      '<div id="qtm-schedule-fields"></div>' +
      '<div class="form-group"><label for="qtm-labels">Labels</label><select id="qtm-labels" multiple style="height:80px;">'+lOpts+'</select><br><small style="color:var(--text-muted)">STRG+Klick für mehrere</small></div>' +
      '</section>' +
      '<section class="qtm-new-section"><h3>Weitere Informationen</h3>' +
      '<div class="form-group"><label for="qtm-subtasks">Teilaufgaben (eine pro Zeile)</label><textarea id="qtm-subtasks" rows="4" placeholder="Konzept abstimmen&#10;Implementierung&#10;Abnahme"></textarea></div>' +
      '<div class="form-group"><label for="qtm-note">Hinweis / Notiz</label><textarea id="qtm-note" rows="2" placeholder="z. B. Kunde priorisiert dieses Thema"></textarea></div>' +
      '<div class="form-group"><label>Dateien</label><button type="button" class="btn btn-secondary" id="qtm-upload"><span class="material-symbols-rounded" aria-hidden="true">attach_file</span> Dateien auswählen</button><input type="file" id="qtm-files" class="sr-only" multiple><div id="qtm-file-list" class="qtm-file-list"></div><p id="qtm-upload-status" class="text-muted" role="status" aria-live="polite"></p></div>' +
      '<div class="form-group"><label for="qtm-attachments">Links (eine pro Zeile, optional Name|URL)</label><textarea id="qtm-attachments" rows="2" placeholder="Spezifikation|https://...&#10;https://..."></textarea></div>' +
      aiToolsHtml +
      '</section></div>' +
      '<div id="qtm-github-daily-drafts" class="hidden"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-secondary" id="qt-cancel">Abbrechen</button>' +
      '<button class="btn btn-primary" id="qt-submit">'+escapeHtml(prefill.submitLabel||'Erstellen')+'</button></div>';

    var initialTask=prefill.task&&typeof prefill.task==='object'?prefill.task:{};
    document.getElementById('qtm-title').value=String(initialTask.title||'');
    document.getElementById('qtm-desc').value=String(initialTask.description||'');
    document.getElementById('qtm-prio').value=String(initialTask.priority||'medium');
    document.getElementById('qtm-effort').value=String(initialTask.effortHours===undefined?'0':initialTask.effortHours);
    var initialProjectIds=Array.isArray(initialTask.projectIds)&&initialTask.projectIds.length?initialTask.projectIds:(initialTask.projectId?[initialTask.projectId]:[]);
    setMultiSelectValues(document.getElementById('qtm-project'),initialProjectIds.map(String));
    if(Array.isArray(prefill.subtasks))document.getElementById('qtm-subtasks').value=prefill.subtasks.map(function(subtask){return String(subtask&&subtask.title||subtask||'');}).filter(Boolean).join('\n');

    var aiState={loading:false,draft:null,suggestions:[]};
    var githubDraftGroups=[];
    var githubDraftSourceCommits=[];
    var githubDraftProjectId='';
    var selectedAssigneeIds=[];
    var pendingFiles=[];

    function renderPendingFiles(){
      document.getElementById('qtm-file-list').innerHTML=pendingFiles.map(function(entry,index){
        return '<div class="qtm-file-item"><span>'+escapeHtml(entry.file.name)+'</span><button type="button" class="kanban-icon-btn" data-qtm-remove-file="'+index+'" title="Datei entfernen" aria-label="Datei entfernen: '+escapeAttr(entry.file.name)+'"><span class="material-symbols-rounded" aria-hidden="true">close</span></button></div>';
      }).join('');
    }

    document.getElementById('qtm-upload').addEventListener('click',function(){document.getElementById('qtm-files').click();});
    document.getElementById('qtm-files').addEventListener('change',function(event){
      Array.prototype.forEach.call(event.target.files,function(file){pendingFiles.push({file:file,attachment:null});});
      event.target.value='';
      renderPendingFiles();
    });
    document.getElementById('qtm-file-list').addEventListener('click',function(event){
      var button=event.target.closest('[data-qtm-remove-file]');
      if(!button)return;
      pendingFiles.splice(Number(button.getAttribute('data-qtm-remove-file')),1);
      renderPendingFiles();
    });

    function uploadPendingFiles(){
      return pendingFiles.reduce(function(previous,entry,index){
        return previous.then(function(){
          if(entry.attachment)return;
          document.getElementById('qtm-upload-status').textContent='Datei '+(index+1)+' von '+pendingFiles.length+' wird hochgeladen: '+entry.file.name;
          return fetch('/api/task-attachments',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:entry.file}).then(function(response){
            if(!response.ok)throw new Error('Upload fehlgeschlagen (HTTP '+response.status+').');
            return response.json();
          }).then(function(result){
            if(!result.url||!/^\/api\/task-attachments\/[0-9a-f]{32}$/.test(result.url))throw new Error('Ungültige Upload-Antwort.');
            entry.attachment={id:window.DataLayer.generateId(),name:entry.file.name,url:result.url,type:entry.file.type||'application/octet-stream',size:entry.file.size,addedAt:new Date().toISOString()};
          });
        });
      },Promise.resolve());
    }

    function renderAssigneePicker(){
      var picker=document.getElementById('qtm-assignee-picker');
      if(!picker)return;
      if(!employees.length){
        picker.innerHTML='<p class="text-muted" style="margin:0;">Keine Mitarbeiter verfuegbar.</p>';
        return;
      }
      var selectedMap={};
      selectedAssigneeIds.forEach(function(id){selectedMap[String(id)]=true;});
      picker.innerHTML=employees.map(function(employee){
        var id=String(employee&&employee.id||'').trim();
        if(!id)return '';
        var label=(employee.name||'Mitarbeiter')+(employee.role?' ('+employee.role+')':'');
        var selectedClass=selectedMap[id]?' is-selected':'';
        return '<button type="button" class="qtm-assignee-chip'+selectedClass+'" data-assignee-id="'+escapeAttr(id)+'" aria-pressed="'+(selectedMap[id]?'true':'false')+'">'+escapeHtml(label)+'</button>';
      }).join('')
      +'<button type="button" class="qtm-assignee-clear" data-clear-assignees="1">Zuweisung entfernen</button>';
    }

    function setSelectedAssigneeIds(ids){
      selectedAssigneeIds=normalizeAssigneeIds(ids);
      renderAssigneePicker();
    }

    function toggleAssigneeSelection(employeeId){
      var id=String(employeeId||'').trim();
      if(!id)return;
      var index=selectedAssigneeIds.indexOf(id);
      if(index===-1)selectedAssigneeIds.push(id);
      else selectedAssigneeIds.splice(index,1);
      renderAssigneePicker();
    }

    setSelectedAssigneeIds([]);

    var assigneePicker=document.getElementById('qtm-assignee-picker');
    if(assigneePicker){
      assigneePicker.addEventListener('click',function(event){
        var clearBtn=event.target.closest('[data-clear-assignees]');
        if(clearBtn){
          event.preventDefault();
          setSelectedAssigneeIds([]);
          return;
        }
        var chip=event.target.closest('[data-assignee-id]');
        if(!chip)return;
        event.preventDefault();
        toggleAssigneeSelection(chip.getAttribute('data-assignee-id')||'');
      });
    }

    function updateAiStatus(message,isError){
      var statusEl=document.getElementById('qtm-ai-status');
      if(!statusEl)return;
      statusEl.textContent=String(message||'');
      statusEl.classList.toggle('is-error',!!isError);
    }

    function toggleAiButtons(disabled){
      ['qtm-ai-fill','qtm-ai-assign','qtm-github-commits','qtm-ai-chain'].forEach(function(id){
        var btn=document.getElementById(id);
        if(btn)btn.disabled=!!disabled||(id==='qtm-ai-assign'&&githubDraftGroups.length>0);
      });
    }

    function getProjectSelection(){
      var projectSelect=document.getElementById('qtm-project');
      var projectIds=[];
      if(projectSelect&&projectSelect.selectedOptions){
        for(var i=0;i<projectSelect.selectedOptions.length;i++)projectIds.push(String(projectSelect.selectedOptions[i].value||'').trim());
      }
      if(!projectIds.length&&projectSelect&&projectSelect.value)projectIds.push(String(projectSelect.value).trim());
      var projectId=projectIds[0]||'';
      var project=projects.find(function(item){return String(item.id)===projectId;})||null;
      return {projectId:projectId,projectIds:projectIds,project:project};
    }

    function applyLabelSuggestions(labelNames){
      var names=(Array.isArray(labelNames)?labelNames:[]).map(function(item){
        return String(item||'').trim().toLowerCase();
      }).filter(Boolean);
      if(!names.length)return;
      var matched=[];
      labels.forEach(function(label){
        var labelName=String(label&&label.name||'').trim().toLowerCase();
        if(!labelName)return;
        if(names.indexOf(labelName)!==-1)matched.push(String(label.id));
      });
      var labelsSelect=document.getElementById('qtm-labels');
      if(labelsSelect&&matched.length)setMultiSelectValues(labelsSelect,matched);
    }

    function applyScheduleSuggestion(schedule){
      if(!schedule||typeof schedule!=='object')return;
      var modeSelect=document.getElementById('qtm-schedule-mode');
      if(!modeSelect)return;
      var mode=String(schedule.mode||'none');
      modeSelect.value=mode;
      renderModalScheduleFields();
      if(mode==='deadline'){
        var dl=document.getElementById('qtm-deadline');
        if(dl)dl.value=String(schedule.deadline||'');
      }else if(mode==='fixed'){
        var fx=document.getElementById('qtm-fixed');
        if(fx)fx.value=String(schedule.fixedAt||'');
      }else if(mode==='range'){
        var rs=document.getElementById('qtm-range-start');
        var re=document.getElementById('qtm-range-end');
        if(rs)rs.value=String(schedule.rangeStart||'');
        if(re)re.value=String(schedule.rangeEnd||'');
      }
    }

    function renderAssigneeHint(ranking){
      var hintEl=document.getElementById('qtm-ai-hint');
      if(!hintEl)return;
      if(!ranking||!ranking.length){
        hintEl.classList.add('hidden');
        hintEl.innerHTML='';
        return;
      }
      var top=ranking.slice(0,3).map(function(entry,index){
        var employee=entry.employee||{};
        var load=entry.load||{open:0,openInProject:0,highPressure:0};
        var role=employee.role?(' - '+employee.role):'';
        return '<div><strong>'+(index+1)+'. '+escapeHtml(employee.name||'Mitarbeiter')+role+'</strong> '
          +'<span>Score '+escapeHtml(String(entry.score))+' | Offen '+escapeHtml(String(load.open))+' | Projekt '+escapeHtml(String(load.openInProject))+' | Kritisch '+escapeHtml(String(load.highPressure))+'</span></div>';
      }).join('');
      hintEl.innerHTML=top;
      hintEl.classList.remove('hidden');
    }

    function applyAssigneeRecommendation(){
      var title=((document.getElementById('qtm-title')||{}).value||'').trim();
      var desc=((document.getElementById('qtm-desc')||{}).value||'').trim();
      var projectInfo=getProjectSelection();
      var ranking=rankAssigneeSuggestions(title+' '+desc,projectInfo.projectId,employees);
      renderAssigneeHint(ranking);
      if(!ranking.length){
        updateAiStatus('Keine Mitarbeiterdaten fuer KI-Zuweisung verfuegbar.',true);
        return;
      }
      var best=ranking[0];
      if(best&&best.employee&&best.employee.id){
        setSelectedAssigneeIds([String(best.employee.id)]);
        updateAiStatus('Vorgeschlagene Zuweisung: '+String(best.employee.name||'Mitarbeiter')+'.',false);
      }
    }

    function buildChainRowsFromSuggestions(taskSuggestions){
      var out=[];
      (Array.isArray(taskSuggestions)?taskSuggestions:[]).forEach(function(item){
        if(!item||typeof item!=='object')return;
        var title=String(item.titleDe||item.titleEn||'').trim();
        if(!title)return;
        out.push({
          title:title,
          description:String(item.descriptionDe||item.descriptionEn||'').trim(),
          effortHours:String(item.effortHours||'0')
        });
      });
      return out;
    }

    function applyTaskDraftToForm(draft){
      if(!draft||typeof draft!=='object')return;
      var task=draft.task&&typeof draft.task==='object'?draft.task:{};
      var taskSuggestions=Array.isArray(draft.taskSuggestions)?draft.taskSuggestions:[];
      aiState.suggestions=taskSuggestions;
      aiState.draft=draft;

      var descEl=document.getElementById('qtm-desc');
      var prioEl=document.getElementById('qtm-prio');
      var urgencyEl=document.getElementById('qtm-urgency');
      var effortEl=document.getElementById('qtm-effort');
      var subtaskEl=document.getElementById('qtm-subtasks');
      var noteEl=document.getElementById('qtm-note');

      if(descEl){
        descEl.value=String(task.descriptionDe||task.descriptionEn||descEl.value||'').trim();
      }
      if(prioEl&&task.priority)prioEl.value=String(task.priority);
      if(urgencyEl&&task.urgency)urgencyEl.value=String(task.urgency);
      if(effortEl&&task.effortHours!==undefined&&task.effortHours!==null){
        var effortNum=parseFloat(task.effortHours);
        if(!isNaN(effortNum))effortEl.value=String(Math.max(0,Math.round(effortNum*2)/2));
      }

      applyScheduleSuggestion(task.schedule||{});

      if(subtaskEl){
        var subtasks=Array.isArray(task.subtasksDe)&&task.subtasksDe.length?task.subtasksDe:(Array.isArray(task.subtasksEn)?task.subtasksEn:[]);
        if(subtasks.length){
          subtaskEl.value=subtasks.join('\n');
        }else if(taskSuggestions.length){
          subtaskEl.value=taskSuggestions.map(function(item){
            return String(item.titleDe||item.titleEn||'').trim();
          }).filter(Boolean).join('\n');
        }
      }

      if(noteEl&&task.note){
        var existing=String(noteEl.value||'').trim();
        noteEl.value=existing?(existing+'\n\n'+String(task.note).trim()):String(task.note).trim();
      }

      resizeQuickTaskTextareas();

      applyLabelSuggestions(task.labels);

      if(Array.isArray(task.assigneeIds)&&task.assigneeIds.length){
        setSelectedAssigneeIds(task.assigneeIds);
      }else if(task.assigneeId){
        setSelectedAssigneeIds([task.assigneeId]);
      }

      var chainBtn=document.getElementById('qtm-ai-chain');
      if(chainBtn){
        chainBtn.classList.toggle('hidden',taskSuggestions.length<2);
      }

      var autoAssign=((document.getElementById('qtm-ai-autoassign')||{}).checked)!==false;
      if(autoAssign)applyAssigneeRecommendation();
    }

    function collectAiContext(project){
      var tasks=(window.DataLayer&&typeof window.DataLayer.getTasks==='function')?window.DataLayer.getTasks():[];
      var employeesSafe=Array.isArray(employees)?employees:[];
      var projectTasks=tasks.filter(function(task){
        return task&&window.DataLayer.isTaskLinkedToProject(task,project.id);
      }).slice(0,120).map(function(task){
        var assigneeIds=getTaskAssigneeIds(task);
        return {
          id:task.id,
          title:task.title||'',
          status:task.status||'',
          priority:task.priority||'',
          urgency:task.urgency||'',
          assigneeId:assigneeIds[0]||'',
          assigneeIds:assigneeIds,
          effortHours:task.effortHours||0
        };
      });

      return {
        project:{
          id:project.id||'',
          title:project.title||project.name||'',
          description:project.description||'',
          status:project.status||''
        },
        team:employeesSafe.map(function(employee){
          return {id:employee.id||'',name:employee.name||'',role:employee.role||''};
        }),
        tasks:projectTasks
      };
    }

    function runAiDraftFromTitle(){
      if(aiState.loading)return;
      var title=((document.getElementById('qtm-title')||{}).value||'').trim();
      var description=((document.getElementById('qtm-desc')||{}).value||'').trim();
      if(!title){
        updateAiStatus('Bitte zuerst einen kurzen Aufgabentitel eingeben.',true);
        var titleEl=document.getElementById('qtm-title');
        if(titleEl&&titleEl.focus)titleEl.focus();
        return;
      }
      var selection=getProjectSelection();
      if(!selection.project){
        updateAiStatus('Fuer die KI-Generierung bitte zuerst ein Projekt waehlen.',true);
        return;
      }

      aiState.loading=true;
      toggleAiButtons(true);
      updateAiStatus('KI erzeugt Entwurf aus Titel und Beschreibung ...',false);

      var draftInput='Titel: '+title;
      if(description){
        draftInput+='\n\nBeschreibung:\n'+description;
      }

      var mode=((document.getElementById('qtm-schedule-mode')||{}).value||'none').trim()||'none';
      var payload={
        projectId:String(selection.project.id||''),
        projectTitle:String(selection.project.title||selection.project.name||'Projekt'),
        draftInput:draftInput,
        draftTitle:title,
        draftDescription:description,
        options:{
          scheduleMode:mode,
          eventType:'task',
          createSubtasks:true,
          splitIntoMultiple:true,
          planningStyle:'development-workflow',
          estimateEffortFromSubtasks:true,
          fillOptionalFields:true
        },
        existingData:collectAiContext(selection.project)
      };

      requestAiTaskDraft(payload).then(function(result){
        var draft=result&&result.draft&&typeof result.draft==='object'?result.draft:null;
        if(!draft){
          throw new Error('KI konnte keinen verwertbaren Entwurf liefern.');
        }
        applyTaskDraftToForm(draft);
        var suggestionCount=(Array.isArray(draft.taskSuggestions)?draft.taskSuggestions.length:0);
        updateAiStatus('KI-Entwurf uebernommen. '+(suggestionCount?String(suggestionCount)+' Folgeaufgaben erkannt.':'Keine Folgeaufgaben erkannt.'),false);
      }).catch(function(err){
        updateAiStatus('KI-Entwurf fehlgeschlagen: '+String(err&&err.message?err.message:err),true);
      }).finally(function(){
        aiState.loading=false;
        toggleAiButtons(false);
      });
    }
    
    function renderModalScheduleFields(){
      var modeEl=document.getElementById('qtm-schedule-mode');
      var wrap=document.getElementById('qtm-schedule-fields');
      if(!modeEl||!wrap)return;
      var mode=modeEl.value;
      var html='';
      if(mode==='deadline'){
        html='<div class="form-group"><label>Deadline</label><input type="date" id="qtm-deadline"></div>';
      }else if(mode==='fixed'){
        html='<div class="form-group"><label>Fester Termin</label><input type="date" id="qtm-fixed"></div>';
      }else if(mode==='range'){
        html='<div class="task-cockpit-grid"><div class="form-group"><label>Start</label><input type="date" id="qtm-range-start"></div><div class="form-group"><label>Ende</label><input type="date" id="qtm-range-end"></div></div>';
      }else if(mode==='asap'){
        html='<p class="text-muted">Aufgabe wird als umgehend markiert und im Team-Kalender für heute eingetragen.</p>';
      }
      wrap.innerHTML=html;
    }

    var modeSelect=document.getElementById('qtm-schedule-mode');
    if(modeSelect){
      modeSelect.addEventListener('change',renderModalScheduleFields);
      renderModalScheduleFields();
    }

    overlay.classList.remove('hidden');
    setSharedModalCloseGuard('quicktask-task');

    function resizeQuickTaskTextareas(){
      content.querySelectorAll('.qtm-new-layout textarea').forEach(function(textarea){
        textarea.style.height='auto';
        textarea.style.height=(textarea.scrollHeight+textarea.offsetHeight-textarea.clientHeight+2)+'px';
      });
    }
    content.querySelectorAll('.qtm-new-layout textarea').forEach(function(textarea){
      textarea.addEventListener('input',resizeQuickTaskTextareas);
    });
    resizeQuickTaskTextareas();

    function applyGitHubCommitDrafts(commits,project){
      // Zuordnung je Commit: explizite Auswahl oder Vorschlag aus GitHub-Konto/Aliasen
      githubDraftSourceCommits=commits.map(function(commit){
        var employeeId=commit.employeeId!==undefined&&commit.employeeId!==null
          ?String(commit.employeeId)
          :findGitHubCommitEmployee(commit,window.DataLayer.getEmployees()||[]);
        return Object.assign({},commit,{employeeId:employeeId});
      });
      var groups=groupGitHubCommitsByDay(githubDraftSourceCommits);
      if(!groups.length)throw new Error('Keine Commits ausgewaehlt.');
      githubDraftGroups=groups;
      githubDraftProjectId=String(project.id);
      function groupEmployeeName(group){
        var employee=employees.find(function(item){return String(item&&item.id||'')===String(group.employeeId||'');});
        return employee?String(employee.name||employee.id):'';
      }
      function groupHeading(group){
        return group.date+' · '+(groupEmployeeName(group)||'Nicht zugeordnet');
      }
      function groupTitle(group){
        var name=groupEmployeeName(group);
        return group.draft.title+' - '+group.date+(name?' · '+name:'');
      }
      document.getElementById('qtm-assignee-picker').classList.add('hidden');
      document.getElementById('qtm-assignee-help').textContent='Mitarbeiter werden unten pro Commit zugeordnet.';
      var first=groups[0];
      document.getElementById('qtm-title').value=groupTitle(first);
      document.getElementById('qtm-desc').value=first.draft.description;
      document.getElementById('qtm-subtasks').value=first.draft.subtasks.join('\n');
      document.getElementById('qtm-attachments').value=first.commits.filter(function(commit){return commit.url;}).map(function(commit){return 'GitHub Commit '+commit.sha+'|'+commit.url;}).join('\n');
      var host=document.getElementById('qtm-github-daily-drafts');
      host.innerHTML='<h3>GitHub-Tagesaufgaben</h3><p>Die Felder oben gelten fuer '+escapeHtml(groupHeading(first))+'. Pro Mitarbeiter und Tag wird eine eigene erledigte Aufgabe erstellt und dem jeweiligen Mitarbeiter zugewiesen. Planung, Aufwand, Labels und Dateien gelten fuer jede Tagesaufgabe.</p><p id="qtm-github-daily-status" role="status" aria-live="polite"></p>'
        +groups.slice(1).map(function(group,index){
          var key=String(index+1);
          return '<section class="qtm-new-section"><h3>'+escapeHtml(groupHeading(group))+'</h3>'
            +'<div class="form-group"><label for="qtm-github-title-'+key+'">Titel</label><input id="qtm-github-title-'+key+'" value="'+escapeAttr(groupTitle(group))+'"></div>'
            +'<div class="form-group"><label for="qtm-github-desc-'+key+'">Beschreibung</label><textarea id="qtm-github-desc-'+key+'" rows="6">'+escapeHtml(group.draft.description)+'</textarea></div>'
            +'<div class="form-group"><label for="qtm-github-subtasks-'+key+'">Teilaufgaben (eine pro Zeile)</label><textarea id="qtm-github-subtasks-'+key+'" rows="4">'+escapeHtml(group.draft.subtasks.join('\n'))+'</textarea></div></section>';
        }).join('')
        +'<h3>Commit-Autoren zuordnen</h3><p>GitHub-Konten und hinterlegte Commit-Aliase werden vorgeschlagen. Bitte jede Zuordnung pruefen; unbekannte Autoren muessen manuell zugewiesen werden. Beim Aendern einer Zuordnung werden die Tagesaufgaben pro Mitarbeiter neu gruppiert.</p>'
        +groups.map(function(group){
          return '<section class="qtm-new-section"><h3>'+escapeHtml(groupHeading(group))+'</h3>'+group.commits.map(function(commit){
            var id='qtm-github-assignee-'+commit.sha;
            return '<div class="form-group"><label for="'+escapeAttr(id)+'">'+escapeHtml(commit.title)+' · '+escapeHtml(commit.author)+(commit.authorLogin?' (@'+escapeHtml(commit.authorLogin)+')':'')+' ['+escapeHtml(commit.sha.slice(0,7))+']</label>'
              +'<select id="'+escapeAttr(id)+'" required><option value="">-- Mitarbeiter auswaehlen --</option>'
              +employees.map(function(employee){
                var employeeId=String(employee&&employee.id||'');
                return '<option value="'+escapeAttr(employeeId)+'"'+(employeeId===String(commit.employeeId||'')?' selected':'')+'>'+escapeHtml(employee.name||employeeId)+'</option>';
              }).join('')+'</select></div>';
          }).join('')+'</section>';
        }).join('');
      host.classList.remove('hidden');
      groups.forEach(function(group){
        group.commits.forEach(function(commit){
          var select=document.getElementById('qtm-github-assignee-'+commit.sha);
          if(!select)return;
          select.value=String(commit.employeeId||'');
          select.addEventListener('change',function(){
            var nextEmployeeId=String(select.value||'');
            githubDraftSourceCommits=githubDraftSourceCommits.map(function(item){
              return item.sha===commit.sha?Object.assign({},item,{employeeId:nextEmployeeId}):item;
            });
            applyGitHubCommitDrafts(githubDraftSourceCommits,project);
            updateAiStatus('Zuordnung aktualisiert: Tagesaufgaben wurden pro Mitarbeiter neu gruppiert.',false);
          });
        });
      });
      toggleAiButtons(false);
      resizeQuickTaskTextareas();
    }

    function updateGitHubDraftStatus(message){
      var status=document.getElementById('qtm-github-daily-status');
      if(status)status.textContent=message;
      updateAiStatus(message,true);
    }

    if(Array.isArray(prefill.githubCommits)&&prefill.githubCommits.length){
      var prefillProject=projects.find(function(project){return String(project.id)===String(initialTask.projectId||'');});
      if(!prefillProject)throw new Error('Projekt fuer GitHub-Tagesaufgaben nicht gefunden.');
      applyGitHubCommitDrafts(prefill.githubCommits,prefillProject);
    }

    var cancelBtn=document.getElementById('qt-cancel');
    if(cancelBtn){
      cancelBtn.addEventListener('click',closeSharedModal);
    }

    if(adminMode){
      if(window.LocalOllama&&window.LocalOllama.bindProviderSelect)window.LocalOllama.bindProviderSelect(document.getElementById('modal-content'));
      var aiFillBtn=document.getElementById('qtm-ai-fill');
      if(aiFillBtn)aiFillBtn.addEventListener('click',runAiDraftFromTitle);

      var aiAssignBtn=document.getElementById('qtm-ai-assign');
      if(aiAssignBtn)aiAssignBtn.addEventListener('click',function(){
        applyAssigneeRecommendation();
      });

      var githubCommitBtn=document.getElementById('qtm-github-commits');
      var githubProjectSelect=document.getElementById('qtm-project');
      githubProjectSelect.addEventListener('change',function(){
        var review=document.getElementById('qtm-github-commit-review');
        if(review)review.classList.add('hidden');
        if(githubDraftGroups.length&&githubDraftProjectId!==getProjectSelection().projectId){
          githubDraftGroups=[];
          githubDraftSourceCommits=[];
          githubDraftProjectId='';
          document.getElementById('qtm-github-daily-drafts').classList.add('hidden');
          document.getElementById('qtm-assignee-picker').classList.remove('hidden');
          document.getElementById('qtm-assignee-help').textContent='Mehrfachauswahl: Mitarbeiter per Klick zuweisen';
          toggleAiButtons(false);
          updateAiStatus('Projekt geaendert: Commit-Zuordnung entfernt. Bitte den Entwurf pruefen.',true);
        }
      });
      if(githubCommitBtn)githubCommitBtn.addEventListener('click',function(){
        if(aiState.loading)return;
        var selection=getProjectSelection();
        var review=document.getElementById('qtm-github-commit-review');
        if(!selection.project){
          updateAiStatus('Fuer den GitHub-Abruf bitte zuerst ein Projekt waehlen.',true);
          return;
        }
        review.classList.add('hidden');
        aiState.loading=true;
        toggleAiButtons(true);
        githubProjectSelect.disabled=true;
        updateAiStatus('GitHub-Commits werden abgerufen ...',false);
        fetchQuickTaskGitHubCommits(selection.project).then(function(commits){
          commits=commits.filter(function(commit){return !getGitHubCommitDocumentationTaskId(commit.sha,selection.project);});
          if(!commits.length){
            review.innerHTML='<div>Keine neuen Commits in den Branches gefunden.</div>';
            review.classList.remove('hidden');
            updateAiStatus('Keine neuen Commits gefunden.',false);
            return;
          }
          if(!window.AIConfModule||typeof window.AIConfModule.renderCommitSelection!=='function')throw new Error('Die Commit-Auswahl ist nicht verfuegbar.');
          window.AIConfModule.renderCommitSelection(review,commits,function(selected,progress){
            var newCommits=selected.filter(function(commit){return !getGitHubCommitDocumentationTaskId(commit.sha,selection.project);});
            if(newCommits.length!==selected.length)throw new Error('Mindestens ein ausgewaehlter Commit wurde inzwischen dokumentiert. Bitte erneut abrufen.');
            aiState.loading=true;
            toggleAiButtons(true);
            githubProjectSelect.disabled=true;
            progress('Commit-Informationen werden auf Deutsch und Englisch vorbereitet ...');
            updateAiStatus('Commit-Informationen werden auf Deutsch und Englisch vorbereitet ...',false);
            return translateGitHubCommits(newCommits,selection.project).then(function(translatedCommits){
              review.innerHTML='<strong>Commit-Teilaufgaben pruefen</strong>'
                +'<div>KI-Uebersetzungen koennen Fehler enthalten. Bitte vor dem Erstellen pruefen.</div>'
                +translatedCommits.map(function(commit){
                  var existing=getGitHubCommitDocumentationTaskId(commit.sha,selection.project);
                  var checked=existing?'':' checked';
                  var disabled=existing?' disabled':'';
                  var state=existing?' (bereits dokumentiert)':'';
                  return '<label style="display:block;margin-top:0.45rem;opacity:'+(existing?'0.6':'1')+';">'
                    +'<input type="checkbox" data-github-commit-sha="'+escapeAttr(commit.sha)+'"'+checked+disabled+'>'
                    +' DE: '+escapeHtml(commit.title)+' <small>'+escapeHtml(commit.author)+' · '+escapeHtml(new Date(commit.date).toLocaleString('de-DE'))+escapeHtml(state)+'</small>'
                    +'<br><small>EN: '+escapeHtml(commit.titleEn)+'</small>'
                    +'</label>';
                }).join('')
                +'<button type="button" class="btn btn-primary" id="qtm-github-create" style="margin-top:0.7rem;">Tagesaufgaben entwerfen</button>';
              review.classList.remove('hidden');
              review._commits=translatedCommits;
              updateAiStatus(String(translatedCommits.length)+' Commit(s) vorbereitet (deutsch + englisch).',false);
              var createBtn=document.getElementById('qtm-github-create');
              if(createBtn)createBtn.addEventListener('click',function(){
                var selected=[];
                review.querySelectorAll('[data-github-commit-sha]:checked').forEach(function(input){
                  var commit=translatedCommits.find(function(item){return item.sha===input.getAttribute('data-github-commit-sha');});
                  if(commit)selected.push(commit);
                });
                var newCommits=selected.filter(function(commit){return !getGitHubCommitDocumentationTaskId(commit.sha,selection.project);});
                if(!newCommits.length){
                  review.classList.add('hidden');
                  updateAiStatus('Keine neuen Aufgaben ausgewaehlt.',false);
                  return;
                }
                try{applyGitHubCommitDrafts(newCommits,selection.project);}
                catch(error){updateAiStatus('Tagesaufgaben konnten nicht vorbereitet werden: '+String(error&&error.message||error),true);return;}
                review.classList.add('hidden');
                updateAiStatus(String(githubDraftGroups.length)+' Tagesaufgabe(n) vorbereitet. Bitte pruefen und erstellen.',false);
              });
            }).catch(function(error){
              updateAiStatus('GitHub-Commits konnten nicht vorbereitet werden: '+String(error&&error.message||error),true);
              throw error;
            }).finally(function(){
              aiState.loading=false;
              toggleAiButtons(false);
              githubProjectSelect.disabled=false;
            });
          });
          review.classList.remove('hidden');
          updateAiStatus('Commits vor der Uebersetzung auswaehlen.',false);
        }).catch(function(error){
          updateAiStatus('GitHub-Commits konnten nicht vorbereitet werden: '+String(error&&error.message||error),true);
        }).finally(function(){
          aiState.loading=false;
          toggleAiButtons(false);
          githubProjectSelect.disabled=false;
        });
      });

      var aiChainBtn=document.getElementById('qtm-ai-chain');
      if(aiChainBtn){
        aiChainBtn.addEventListener('click',function(){
          var rows=buildChainRowsFromSuggestions(aiState.suggestions);
          if(rows.length<2){
            updateAiStatus('Fuer eine Kettenaufgabe werden mindestens zwei KI-Vorschlaege benoetigt.',true);
            return;
          }
          var projectId=((document.getElementById('qtm-project')||{}).value||'').trim();
          var assigneeId=selectedAssigneeIds[0]||'';
          var priority=((document.getElementById('qtm-prio')||{}).value||'medium').trim();
          var urgency=((document.getElementById('qtm-urgency')||{}).value||'normal').trim();
          var noteText=((document.getElementById('qtm-note')||{}).value||'').trim();
          var labelValues=[];
          var labelSelect=document.getElementById('qtm-labels');
          if(labelSelect&&labelSelect.selectedOptions){
            for(var li=0;li<labelSelect.selectedOptions.length;li++)labelValues.push(labelSelect.selectedOptions[li].value);
          }
          closeSharedModal();
          openTaskChainModal({
            projectId:projectId,
            assigneeId:assigneeId,
            priority:priority,
            urgency:urgency,
            noteText:noteText,
            labelIds:labelValues,
            rows:rows
          });
        });
      }
    }
    
    document.getElementById('qt-submit').addEventListener('click',function(){
      if(aiState.loading){
        updateAiStatus('Bitte warten, bis die KI-Verarbeitung abgeschlossen ist.',true);
        return;
      }
      if(auth&&typeof auth.canCreateTask==='function'&&!auth.canCreateTask()){
        alert('QuickTask ist nur fuer angemeldete Mitarbeiter freigeschaltet.');
        return;
      }
      var title=document.getElementById('qtm-title').value.trim();
      if(!title){alert('Titel erforderlich!');return;}
      
      // Get selected labels
      var selLabels=[];
      var selOpts=document.getElementById('qtm-labels').selectedOptions;
      for(var i=0;i<selOpts.length;i++)selLabels.push(selOpts[i].value);

      var mode=document.getElementById('qtm-schedule-mode').value;
      var payload=buildTaskPayloadFromFields({
        title:title,
        description:document.getElementById('qtm-desc').value,
        priority:document.getElementById('qtm-prio').value,
        urgency:document.getElementById('qtm-urgency').value,
        projectIds:getProjectSelection().projectIds,
        assigneeId:selectedAssigneeIds[0]||null,
        assigneeIds:selectedAssigneeIds,
        labels:selLabels,
        effortHours:document.getElementById('qtm-effort').value,
        scheduleMode:mode,
        deadline:(document.getElementById('qtm-deadline')||{}).value||'',
        fixedAt:(document.getElementById('qtm-fixed')||{}).value||'',
        rangeStart:(document.getElementById('qtm-range-start')||{}).value||'',
        rangeEnd:(document.getElementById('qtm-range-end')||{}).value||'',
        subtasksText:document.getElementById('qtm-subtasks').value,
        noteText:document.getElementById('qtm-note').value,
        attachmentsText:document.getElementById('qtm-attachments').value,
        status:initialTask.status||'backlog'
      });
      if(initialTask.status==='done')payload.progress=100;
      if(prefill.completedSubtasks)payload.subtasks.forEach(function(subtask){subtask.completed=true;});
      if(prefill.taskMetadata&&typeof prefill.taskMetadata==='object')Object.assign(payload,prefill.taskMetadata);
      var payloads=[payload];
      if(githubDraftGroups.length){
        if(String(payload.projectId||'')!==githubDraftProjectId){
          updateGitHubDraftStatus('Projekt hat sich geaendert. Bitte Commits erneut abrufen.');
          return;
        }
        var selectedProject=projects.find(function(project){return String(project.id)===githubDraftProjectId;});
        if(!selectedProject){updateGitHubDraftStatus('Projekt fuer GitHub-Tagesaufgaben nicht gefunden.');return;}
        var alreadyImported=githubDraftGroups.some(function(group){return group.commits.some(function(commit){return !!getGitHubCommitDocumentationTaskId(commit.sha,selectedProject);});});
        if(alreadyImported){updateGitHubDraftStatus('Mindestens ein Commit wurde inzwischen dokumentiert. Bitte Commits erneut abrufen.');return;}
        var missingAssignee=githubDraftGroups.some(function(group){return group.commits.some(function(commit){
          var select=document.getElementById('qtm-github-assignee-'+commit.sha);
          return !select||!employees.some(function(employee){return String(employee.id)===String(select.value||'');});
        });});
        if(missingAssignee){updateGitHubDraftStatus('Bitte jedem Commit einen Mitarbeiter zuordnen.');return;}
        payloads=githubDraftGroups.map(function(group,index){
          var dayPayload=Object.assign({},payload);
          if(index){
            dayPayload.title=document.getElementById('qtm-github-title-'+index).value.trim();
            dayPayload.description=document.getElementById('qtm-github-desc-'+index).value.trim();
            dayPayload.subtasks=parseSubtasksFromText(document.getElementById('qtm-github-subtasks-'+index).value);
            dayPayload.attachments=parseAttachmentsFromText(group.commits.filter(function(commit){return commit.url;}).map(function(commit){return 'GitHub Commit '+commit.sha+'|'+commit.url;}).join('\n'));
          }
          dayPayload.subtasks.forEach(function(subtask){subtask.completed=true;});
          dayPayload.status='done';
          dayPayload.progress=100;
          var assignedCommits=group.commits.map(function(commit){
            return Object.assign({},commit,{employeeId:document.getElementById('qtm-github-assignee-'+commit.sha).value});
          });
          dayPayload.assigneeIds=normalizeAssigneeIds(assignedCommits.map(function(commit){return commit.employeeId;}));
          dayPayload.assigneeId=dayPayload.assigneeIds[0]||null;
          dayPayload.sourceCommitShas=group.commits.map(function(commit){return commit.sha;});
          dayPayload.externalSource='github';
          dayPayload.documentationOnly=true;
          var previousImport=prefill.taskMetadata&&prefill.taskMetadata.githubCommitImport||{};
          dayPayload.githubCommitImport=Object.assign({},previousImport,{
            repository:String(selectedProject.github.owner)+'/'+String(selectedProject.github.repo),
            dailyTaskDate:group.date,
            shas:dayPayload.sourceCommitShas.slice(),
            commits:assignedCommits
          });
          dayPayload.subtasks.forEach(function(subtask){
            var matches=assignedCommits.filter(function(commit){return subtask.title.indexOf(commit.sha)!==-1;});
            if(matches.length===1){subtask.assigneeId=matches[0].employeeId;subtask.sourceCommitSha=matches[0].sha;}
          });
          return dayPayload;
        });
        if(payloads.some(function(dayPayload){return !dayPayload.title;})){
          updateGitHubDraftStatus('Bitte fuer jede Tagesaufgabe einen Titel eingeben.');
          return;
        }
        if(payloads.some(function(dayPayload){
          return dayPayload.sourceCommitShas.some(function(sha){
            return dayPayload.subtasks.filter(function(subtask){return subtask.title.indexOf(sha)!==-1;}).length!==1;
          })||dayPayload.subtasks.some(function(subtask){
            return dayPayload.sourceCommitShas.filter(function(sha){return subtask.title.indexOf(sha)!==-1;}).length>1;
          });
        })){
          updateGitHubDraftStatus('Jeder ausgewaehlte Commit muss mit seiner SHA genau einer eigenen Teilaufgabe zugeordnet sein.');
          return;
        }
      }
      
      var controls=Array.prototype.map.call(content.querySelectorAll('input, select, textarea, button'),function(control){
        var wasDisabled=control.disabled;
        control.disabled=true;
        return {control:control,wasDisabled:wasDisabled};
      });
      var createdTasks=[];
      uploadPendingFiles().then(function(){
        payloads.forEach(function(dayPayload){
          dayPayload.attachments=dayPayload.attachments.concat(pendingFiles.map(function(entry){return entry.attachment;}));
        });
        return (githubDraftGroups.length?window.DataLayer.waitForTaskAndCalendarSave():Promise.resolve(true)).then(function(ready){
          if(!ready)throw new Error('Vorherige Aufgaben oder Kalendereintraege konnten nicht dauerhaft gespeichert werden.');
          createdTasks=githubDraftGroups.length?window.DataLayer.createTasks(payloads):[window.DataLayer.createTask(payloads[0])];
          if(!Array.isArray(createdTasks)||createdTasks.length!==payloads.length||createdTasks.some(function(task){return !task||!task.id;})){
            createdTasks=[];
            throw new Error('Aufgaben konnten nicht angelegt werden.');
          }
          if(githubDraftGroups.length)return window.DataLayer.waitForTaskAndCalendarSave().then(function(saved){
            if(!saved)throw new Error('Aufgaben oder Kalendereintraege konnten nicht dauerhaft gespeichert werden.');
          });
        });
      }).then(function(){
        closeSharedModal();
        if(typeof prefill.onCreated==='function')prefill.onCreated(createdTasks[0],createdTasks);
      }).catch(function(error){
        controls.forEach(function(item){item.control.disabled=item.wasDisabled;});
        document.getElementById('qtm-upload-status').textContent='Speichern fehlgeschlagen: '+String(error&&error.message||error)+(createdTasks.length?' Bereits erstellte Tagesaufgaben: '+createdTasks.length+'. Bitte Commits erneut abrufen.':'');
      });
    });
    
    // Focus title input for instant typing
    setTimeout(function(){var t=document.getElementById('qtm-title');if(t)t.focus();},50);
  }catch(e){console.error('[QuickTask]',e);}
}

function openQuickCalendarModal(){
  try{
    var auth=getAuthManager();
    if(auth&&typeof auth.canCreateCalendarEvent==='function'&&!auth.canCreateCalendarEvent()){
      alert('Nur angemeldete Mitarbeiter duerfen Termine anlegen.');
      return;
    }
    if(window.CalendarModule&&typeof window.CalendarModule.openModal==='function'){
      window.CalendarModule.openModal(null,getDateKey(0),{preventAccidentalClose:true,source:'quicktask'});
      return;
    }
    alert('Kalender-Modul ist aktuell nicht verfuegbar.');
  }catch(e){console.error('[QuickTask calendar]',e);}
}

function openBlockerModal(){
  try{
    var auth=getAuthManager();
    if(auth&&typeof auth.canCreateTask==='function'&&!auth.canCreateTask()){
      alert('Nur angemeldete Mitarbeiter duerfen Blocker anlegen.');
      return;
    }

    var overlay=document.getElementById('modal-overlay');
    var content=document.getElementById('modal-content');
    if(!overlay||!content)return;

    var projects=getVisibleProjects();
    var projectById={};
    projects.forEach(function(project){projectById[String(project.id)]=project;});

    var allTasks=window.DataLayer.getTasks()||[];
    var tasks=allTasks.filter(function(task){
      if(!task)return false;
      if((Array.isArray(task.projectIds)?task.projectIds:(task.projectId?[task.projectId]:[])).some(function(id){return !!projectById[String(id)];}))return true;
      if(auth&&typeof auth.canEditTask==='function')return auth.canEditTask(task);
      return true;
    }).sort(function(a,b){
      return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
    }).slice(0,300);

    var taskOptions=tasks.map(function(task){
      var linkedProjects=(Array.isArray(task.projectIds)?task.projectIds:(task.projectId?[task.projectId]:[])).map(function(id){return projectById[String(id)];}).filter(Boolean);
      var projectTitle=linkedProjects.length?linkedProjects.map(function(project){return project.title||project.name||'Projekt';}).join(', '):'Ohne Projekt';
      var label='['+projectTitle+'] '+(task.title||'(Ohne Titel)');
      return '<option value="'+escapeAttr(task.id)+'">'+escapeHtml(label)+'</option>';
    }).join('');

    content.innerHTML=''
      +'<h2>Neuer Blocker</h2>'
      +'<p class="text-muted" style="margin-bottom:0.9rem;">Blocker koennen Aufgaben oder ganze Projekte blockieren. Ein Grund ist verpflichtend.</p>'
      +'<div class="task-cockpit-grid">'
      +'  <div class="form-group"><label>Blockiert</label><select id="qbm-target-type"><option value="task">Aufgabe</option><option value="project">Projekt</option></select></div>'
      +'  <div class="form-group"><label>Prioritaet</label><input type="text" value="Blocker" disabled></div>'
      +'</div>'
      +'<div class="form-group" id="qbm-task-wrap"><label>Ziel-Aufgabe *</label><select id="qbm-target-task">'+(taskOptions||'<option value="">Keine Aufgabe verfuegbar</option>')+'</select></div>'
      +'<div class="form-group hidden" id="qbm-project-wrap"><label>Ziel-Projekt *</label><select id="qbm-target-project">'+buildProjectOptions(projects,'-- Projekt waehlen --')+'</select></div>'
      +'<div class="form-group"><label>Blocker-Titel</label><input type="text" id="qbm-title" placeholder="z. B. Externe Freigabe fehlt"></div>'
      +'<div class="form-group"><label>Grund *</label><textarea id="qbm-reason" rows="4" placeholder="Warum blockiert dieses Thema? Was fehlt zur Aufloesung?"></textarea></div>'
      +'<div class="form-group"><label>Zusatzdetails</label><textarea id="qbm-details" rows="2" placeholder="Optional: Kontext, Ansprechpartner, naechster Schritt"></textarea></div>'
      +'<div class="modal-actions">'
      +'  <button class="btn btn-secondary" id="qbm-cancel">Abbrechen</button>'
      +'  <button class="btn btn-primary" id="qbm-submit">Blocker anlegen</button>'
      +'</div>';

    overlay.classList.remove('hidden');
  setSharedModalCloseGuard('quicktask-blocker');

    var targetTypeEl=document.getElementById('qbm-target-type');
    var taskWrap=document.getElementById('qbm-task-wrap');
    var projectWrap=document.getElementById('qbm-project-wrap');
    function syncTargetUi(){
      var isTask=targetTypeEl&&targetTypeEl.value==='task';
      if(taskWrap)taskWrap.classList.toggle('hidden',!isTask);
      if(projectWrap)projectWrap.classList.toggle('hidden',isTask);
    }
    if(targetTypeEl){
      targetTypeEl.addEventListener('change',syncTargetUi);
      syncTargetUi();
    }

    var cancelBtn=document.getElementById('qbm-cancel');
    if(cancelBtn)cancelBtn.addEventListener('click',closeSharedModal);

    var submitBtn=document.getElementById('qbm-submit');
    if(submitBtn){
      submitBtn.addEventListener('click',function(){
        var targetType=(document.getElementById('qbm-target-type')||{}).value||'task';
        var reason=((document.getElementById('qbm-reason')||{}).value||'').trim();
        var title=((document.getElementById('qbm-title')||{}).value||'').trim();
        var details=((document.getElementById('qbm-details')||{}).value||'').trim();

        if(!reason){
          alert('Bitte einen Grund fuer den Blocker angeben.');
          return;
        }

        var targetId='';
        var targetLabel='';
        var projectId='';

        if(targetType==='task'){
          targetId=((document.getElementById('qbm-target-task')||{}).value||'').trim();
          if(!targetId){
            alert('Bitte eine Ziel-Aufgabe auswaehlen.');
            return;
          }
          var targetTask=window.DataLayer.getTaskById(targetId);
          if(!targetTask){
            alert('Die ausgewaehlte Aufgabe wurde nicht gefunden.');
            return;
          }
          targetLabel=targetTask.title||'Aufgabe';
          projectId=targetTask.projectId||'';
        }else{
          targetId=((document.getElementById('qbm-target-project')||{}).value||'').trim();
          if(!targetId){
            alert('Bitte ein Ziel-Projekt auswaehlen.');
            return;
          }
          var targetProject=window.DataLayer.getProjectById(targetId);
          if(!targetProject){
            alert('Das ausgewaehlte Projekt wurde nicht gefunden.');
            return;
          }
          targetLabel=targetProject.title||targetProject.name||'Projekt';
          projectId=targetProject.id||'';
        }

        var blockerTitle=title||('Blocker fuer '+(targetType==='task'?'Aufgabe':'Projekt')+': '+targetLabel);
        var blockerDescription='Grund: '+reason+(details?'\n\nDetails: '+details:'');
        var nowIso=new Date().toISOString();
        var payload=buildTaskPayloadFromFields({
          title:blockerTitle,
          description:blockerDescription,
          priority:'blocker',
          urgency:'critical',
          projectId:projectId,
          assigneeId:null,
          labels:[],
          effortHours:'0',
          scheduleMode:'none',
          subtasksText:'',
          noteText:reason,
          attachmentsText:'',
          status:'backlog'
        });

        payload.isBlocker=true;
        payload.blocked=true;
        payload.blockedAt=nowIso;
        payload.blockedUntil='';
        payload.blockedUpdatedAt=nowIso;
        payload.blockerReason=reason;
        payload.blockedTargetType=targetType;
        payload.blockedTargetId=targetId;
        payload.blockedTargetTitle=targetLabel;

        var created=window.DataLayer.createTask(payload);
        if(!created||!created.id)return;

        if(window.DataLayer&&typeof window.DataLayer.linkBlockerToTarget==='function'){
          window.DataLayer.linkBlockerToTarget({
            blockerTaskId:created.id,
            blockerTitle:blockerTitle,
            targetType:targetType,
            targetId:targetId,
            targetTitle:targetLabel,
            reason:reason,
            at:nowIso
          });
        }

        closeSharedModal();
        showToast('Blocker wurde erstellt.');
      });
    }

    setTimeout(function(){
      var reasonInput=document.getElementById('qbm-reason');
      if(reasonInput&&reasonInput.focus)reasonInput.focus();
    },50);
  }catch(e){console.error('[QuickTask blocker]',e);}
}

function openDepartmentNoticeModal(){
  try{
    var auth=getAuthManager();
    if(auth&&typeof auth.getMode==='function'&&auth.getMode()==='guest'){
      alert('Gastnutzer duerfen keine Abteilungshinweise anlegen.');
      return;
    }

    var overlay=document.getElementById('modal-overlay');
    var content=document.getElementById('modal-content');
    if(!overlay||!content)return;

    content.innerHTML=''
      +'<h2>Neuer Abteilungshinweis</h2>'
      +'<p class="text-muted" style="margin-bottom:0.9rem;">Hinweis wird prominent auf dem Dashboard dargestellt, bis er als gelesen markiert wird.</p>'
      +'<div class="task-cockpit-grid">'
      +'  <div class="form-group"><label>Titel *</label><input type="text" id="qnm-title" placeholder="z. B. Wartungsfenster Freitag"></div>'
      +'  <div class="form-group"><label>Prioritaet</label><select id="qnm-severity"><option value="info">Info</option><option value="warning" selected>Wichtig</option><option value="critical">Kritisch</option></select></div>'
      +'</div>'
      +'<div class="form-group"><label>Hinweistext *</label><textarea id="qnm-message" rows="4" placeholder="Kurze Information fuer die gesamte Abteilung"></textarea></div>'
      +'<div class="modal-actions">'
      +'  <button class="btn btn-secondary" id="qnm-cancel">Abbrechen</button>'
      +'  <button class="btn btn-primary" id="qnm-submit">Hinweis veroeffentlichen</button>'
      +'</div>';

    overlay.classList.remove('hidden');
  setSharedModalCloseGuard('quicktask-notice');

    var cancelBtn=document.getElementById('qnm-cancel');
    if(cancelBtn)cancelBtn.addEventListener('click',closeSharedModal);

    var submitBtn=document.getElementById('qnm-submit');
    if(submitBtn){
      submitBtn.addEventListener('click',function(){
        var title=((document.getElementById('qnm-title')||{}).value||'').trim();
        var message=((document.getElementById('qnm-message')||{}).value||'').trim();
        var severity=((document.getElementById('qnm-severity')||{}).value||'info').trim();

        if(!title){
          alert('Bitte einen Titel eingeben.');
          return;
        }
        if(!message){
          alert('Bitte einen Hinweistext eingeben.');
          return;
        }

        window.DataLayer.createNotification({
          type:'department_notice',
          title:title,
          message:message,
          severity:severity,
          pinToDashboard:true,
          createdAt:new Date().toISOString(),
          read:false
        });

        closeSharedModal();
        showToast('Abteilungshinweis wurde veroeffentlicht.');
        if(location.hash!=='#page=dashboard')location.hash='#page=dashboard';
      });
    }

    setTimeout(function(){
      var titleInput=document.getElementById('qnm-title');
      if(titleInput&&titleInput.focus)titleInput.focus();
    },50);
  }catch(e){console.error('[QuickTask notice]',e);}
}

function openTaskChainModal(prefill){
  try{
    var auth=getAuthManager();
    if(auth&&typeof auth.canCreateTask==='function'&&!auth.canCreateTask()){
      alert('QuickTask ist nur fuer angemeldete Mitarbeiter freigeschaltet.');
      return;
    }

    var overlay=document.getElementById('modal-overlay');
    var content=document.getElementById('modal-content');
    if(!overlay||!content)return;

    var projects=getVisibleProjects();
    var employees=getAssignableEmployees();
    var labels=window.DataLayer.getLabels();
    var pOpts=buildProjectOptions(projects,'-- Projekt waehlen --');
    var eOpts=buildEmployeeOptions(employees,'-- Optional zuweisen --');
    var lOpts=buildLabelOptions(labels);

    var prefilledRows=Array.isArray(prefill&&prefill.rows)?prefill.rows.filter(function(row){
      return row&&String(row.title||'').trim();
    }).map(function(row){
      return {
        title:String(row.title||'').trim(),
        description:String(row.description||'').trim(),
        effortHours:String(row.effortHours||'0')
      };
    }):[];

    var state={
      rows:prefilledRows.length?prefilledRows:[
        {title:'',description:'',effortHours:'0'},
        {title:'',description:'',effortHours:'0'}
      ]
    };

    content.innerHTML=''
      +'<h2>Kettenaufgabe anlegen</h2>'
      +'<p class="text-muted" style="margin-bottom:0.9rem;">Nur die naechste offene Aufgabe der Kette wird im ToDo-Bereich priorisiert angezeigt.</p>'
      +'<div class="task-cockpit-grid">'
      +'  <div class="form-group"><label>Projekt *</label><select id="qcm-project">'+pOpts+'</select></div>'
      +'  <div class="form-group"><label>Mitarbeiter</label><select id="qcm-assignee">'+eOpts+'</select></div>'
      +'</div>'
      +'<div class="task-cockpit-grid">'
      +'  <div class="form-group"><label>Prioritaet</label><select id="qcm-prio"><option value="low">Niedrig</option><option value="medium" selected>Mittel</option><option value="high">Hoch</option><option value="blocker">Blocker</option></select></div>'
      +'  <div class="form-group"><label>Dringlichkeit</label><select id="qcm-urgency"><option value="low">Niedrig</option><option value="normal" selected>Normal</option><option value="high">Hoch</option><option value="critical">Kritisch</option></select></div>'
      +'</div>'
      +'<div class="form-group"><label>Labels fuer alle Aufgaben</label><select id="qcm-labels" multiple style="height:80px;">'+lOpts+'</select><br><small style="color:var(--text-muted)">STRG+Klick fuer mehrere</small></div>'
      +'<div class="form-group"><label>Hinweis fuer die Kette (optional)</label><textarea id="qcm-note" rows="2" placeholder="z. B. Muss in dieser Reihenfolge abgearbeitet werden"></textarea></div>'
      +'<div class="form-group">'
      +'  <div class="quicktask-chain-head"><label>Aufgabenkette</label><button type="button" class="btn btn-secondary" id="qcm-add-row">+ Schritt hinzufuegen</button></div>'
      +'  <div id="qcm-rows" class="quicktask-chain-rows"></div>'
      +'</div>'
      +'<div class="modal-actions">'
      +'  <button class="btn btn-secondary" id="qcm-cancel">Abbrechen</button>'
      +'  <button class="btn btn-primary" id="qcm-submit">Kette erstellen</button>'
      +'</div>';

    overlay.classList.remove('hidden');
  setSharedModalCloseGuard('quicktask-chain');

    var rowsWrap=document.getElementById('qcm-rows');

    function readRowsFromDom(){
      var list=[];
      if(!rowsWrap)return list;
      var rowEls=rowsWrap.querySelectorAll('[data-chain-row]');
      for(var i=0;i<rowEls.length;i++){
        var rowEl=rowEls[i];
        list.push({
          title:((rowEl.querySelector('[data-chain-field="title"]')||{}).value||'').trim(),
          description:((rowEl.querySelector('[data-chain-field="description"]')||{}).value||'').trim(),
          effortHours:((rowEl.querySelector('[data-chain-field="effort"]')||{}).value||'0')
        });
      }
      return list;
    }

    function renderRows(){
      if(!rowsWrap)return;
      var html='';
      for(var i=0;i<state.rows.length;i++){
        var row=state.rows[i]||{};
        html+=''
          +'<div class="quicktask-chain-row" data-chain-row="'+i+'">'
          +'  <div class="quicktask-chain-row-head">'
          +'    <strong>Schritt '+(i+1)+'</strong>'
          +'    <button type="button" class="btn btn-secondary quicktask-chain-remove" data-chain-action="remove-row" data-row-index="'+i+'" '+(state.rows.length<=1?'disabled':'')+'>Entfernen</button>'
          +'  </div>'
          +'  <div class="form-group"><label>Titel *</label><input type="text" data-chain-field="title" value="'+escapeAttr(row.title||'')+'" placeholder="Was soll in diesem Schritt erledigt werden?"></div>'
          +'  <div class="form-group"><label>Beschreibung</label><textarea rows="2" data-chain-field="description" placeholder="Optionaler Kontext">'+escapeHtml(row.description||'')+'</textarea></div>'
          +'  <div class="form-group"><label>Aufwand (h)</label><input type="number" min="0" step="0.5" data-chain-field="effort" value="'+escapeAttr(row.effortHours||'0')+'"></div>'
          +'</div>';
      }
      rowsWrap.innerHTML=html;
    }

    function persistRows(){
      state.rows=readRowsFromDom();
    }

    var addRowBtn=document.getElementById('qcm-add-row');
    if(addRowBtn){
      addRowBtn.addEventListener('click',function(){
        persistRows();
        state.rows.push({title:'',description:'',effortHours:'0'});
        renderRows();
        var latest=rowsWrap&&rowsWrap.querySelector('[data-chain-row="'+(state.rows.length-1)+'"] [data-chain-field="title"]');
        if(latest&&latest.focus)latest.focus();
      });
    }

    if(rowsWrap){
      rowsWrap.addEventListener('click',function(event){
        var removeBtn=event.target.closest('[data-chain-action="remove-row"]');
        if(!removeBtn)return;
        var index=parseInt(removeBtn.getAttribute('data-row-index')||'-1',10);
        if(index<0)return;
        persistRows();
        if(state.rows.length<=1)return;
        state.rows.splice(index,1);
        renderRows();
      });
    }

    renderRows();

    if(prefill&&typeof prefill==='object'){
      var projectSelect=document.getElementById('qcm-project');
      if(projectSelect&&prefill.projectId)projectSelect.value=String(prefill.projectId);
      var assigneeSelect=document.getElementById('qcm-assignee');
      if(assigneeSelect&&prefill.assigneeId)assigneeSelect.value=String(prefill.assigneeId);
      var prioSelect=document.getElementById('qcm-prio');
      if(prioSelect&&prefill.priority)prioSelect.value=String(prefill.priority);
      var urgencySelect=document.getElementById('qcm-urgency');
      if(urgencySelect&&prefill.urgency)urgencySelect.value=String(prefill.urgency);
      var noteInput=document.getElementById('qcm-note');
      if(noteInput&&prefill.noteText)noteInput.value=String(prefill.noteText);
      var labelsSelect=document.getElementById('qcm-labels');
      if(labelsSelect&&Array.isArray(prefill.labelIds)&&prefill.labelIds.length){
        setMultiSelectValues(labelsSelect,prefill.labelIds);
      }
    }

    var cancelBtn=document.getElementById('qcm-cancel');
    if(cancelBtn)cancelBtn.addEventListener('click',closeSharedModal);

    var submitBtn=document.getElementById('qcm-submit');
    if(submitBtn){
      submitBtn.addEventListener('click',function(){
        var projectId=((document.getElementById('qcm-project')||{}).value||'').trim();
        if(!projectId){
          alert('Bitte ein Projekt auswaehlen.');
          return;
        }

        persistRows();
        var rows=state.rows.filter(function(item){
          return !!String(item&&item.title||'').trim();
        });
        if(!rows.length){
          alert('Bitte mindestens einen Kettenschritt mit Titel erfassen.');
          return;
        }

        var assigneeId=((document.getElementById('qcm-assignee')||{}).value||'').trim();
        var priority=((document.getElementById('qcm-prio')||{}).value||'medium').trim();
        var urgency=((document.getElementById('qcm-urgency')||{}).value||'normal').trim();
        var noteText=((document.getElementById('qcm-note')||{}).value||'').trim();

        var selLabels=[];
        var selOpts=(document.getElementById('qcm-labels')||{}).selectedOptions||[];
        for(var i=0;i<selOpts.length;i++)selLabels.push(selOpts[i].value);

        var nextSequence=getNextProjectSequenceIndex(projectId);
        var created=[];

        rows.forEach(function(row,rowIndex){
          var payload=buildTaskPayloadFromFields({
            title:row.title,
            description:row.description,
            priority:priority,
            urgency:urgency,
            projectId:projectId,
            assigneeId:assigneeId||null,
            labels:selLabels,
            effortHours:row.effortHours||'0',
            scheduleMode:'none',
            deadline:'',
            fixedAt:'',
            rangeStart:'',
            rangeEnd:'',
            subtasksText:'',
            noteText:noteText,
            attachmentsText:'',
            status:'backlog'
          });

          payload.sequenceIndex=nextSequence+rowIndex;
          payload.dependsOnPrevious=rowIndex>0;
          payload.chainWithPrevious=rowIndex>0;
          payload.dependencyTaskIds=[];
          if(rowIndex>0&&created[rowIndex-1]&&created[rowIndex-1].id){
            payload.dependencyTaskIds.push(created[rowIndex-1].id);
          }

          var createdTask=window.DataLayer.createTask(payload);
          if(createdTask)created.push(createdTask);
        });

        closeSharedModal();
        showToast(created.length+' Kettenaufgaben erstellt.');
        if(window.KanbanBoard&&typeof window.KanbanBoard.renderAllColumns==='function'){
          window.KanbanBoard.renderAllColumns();
        }
      });
    }

    setTimeout(function(){
      var projectInput=document.getElementById('qcm-project');
      if(projectInput&&projectInput.focus)projectInput.focus();
    },50);
  }catch(e){console.error('[QuickTask chain]',e);}
}

function runQuickAction(action){
  if(action==='task'){
    openQuickTaskModal();
    return;
  }
  if(action==='event'){
    openQuickCalendarModal();
    return;
  }
  if(action==='blocker'){
    openBlockerModal();
    return;
  }
  if(action==='notice'){
    openDepartmentNoticeModal();
    return;
  }
  if(action==='chain'){
    openTaskChainModal();
  }
}

var quickActionMenu=null;

function ensureQuickActionMenu(){
  if(quickActionMenu&&quickActionMenu.parentNode)return quickActionMenu;

  quickActionMenu=document.createElement('div');
  quickActionMenu.id='quicktask-action-menu';
  quickActionMenu.className='quicktask-action-menu hidden';
  quickActionMenu.innerHTML=''
    +'<button type="button" class="quicktask-action-item" data-action="task"><span class="quicktask-action-title">Neue Aufgabe</span><span class="quicktask-action-sub">Anlegen einer neuen Aufgabe</span></button>'
    +'<button type="button" class="quicktask-action-item" data-action="chain"><span class="quicktask-action-title">Neue Kettenaufgabe</span><span class="quicktask-action-sub">Aufgabenkette mit Reihenfolge erstellen</span></button>'
    +'<button type="button" class="quicktask-action-item" data-action="event"><span class="quicktask-action-title">Neuer Termin</span><span class="quicktask-action-sub">Anlegen eines neuen Termins</span></button>'
    +'<button type="button" class="quicktask-action-item" data-action="blocker"><span class="quicktask-action-title">Neuer Blocker</span><span class="quicktask-action-sub">Blockiert Aufgaben oder Projekte, inkl. Grund</span></button>'
    +'<button type="button" class="quicktask-action-item" data-action="notice"><span class="quicktask-action-title">Neuer Abteilungshinweis</span><span class="quicktask-action-sub">Wird prominent auf dem Dashboard angezeigt</span></button>';

  quickActionMenu.addEventListener('click',function(event){
    var trigger=event.target.closest('[data-action]');
    if(!trigger)return;
    event.preventDefault();
    hideQuickActionMenu();
    runQuickAction(trigger.getAttribute('data-action')||'');
  });

  document.body.appendChild(quickActionMenu);
  return quickActionMenu;
}

function positionQuickActionMenu(fab){
  if(!quickActionMenu||!fab)return;
  var rect=fab.getBoundingClientRect();
  var menuWidth=320;
  var right=Math.max(16,window.innerWidth-rect.right);
  var bottom=Math.max(16,window.innerHeight-rect.top+12);
  quickActionMenu.style.width=Math.min(menuWidth,window.innerWidth-32)+'px';
  quickActionMenu.style.right=right+'px';
  quickActionMenu.style.bottom=bottom+'px';
}

function hideQuickActionMenu(){
  if(!quickActionMenu)return;
  quickActionMenu.classList.add('hidden');
  quickActionMenu.classList.remove('is-open');
  var fab=document.getElementById('quicktask-fab');
  if(fab)fab.setAttribute('aria-expanded','false');
}

function toggleQuickActionMenu(fab){
  var menu=ensureQuickActionMenu();
  if(!menu||!fab)return;

  var isHidden=menu.classList.contains('hidden');
  if(isHidden){
    positionQuickActionMenu(fab);
    menu.classList.remove('hidden');
    window.requestAnimationFrame(function(){menu.classList.add('is-open');});
    fab.setAttribute('aria-expanded','true');
  }else{
    hideQuickActionMenu();
  }
}

/* ---------- QuickTask Page ---------- */
function populateQuickTaskPage(){
  try {
    // Populate employee dropdown
    var empSelect = document.getElementById('qt-assignee');
    if (empSelect) {
      var employees = getAssignableEmployees();
      var opts = '<option value="">— Nicht zugewiesen —</option>' + 
        employees.map(function(e){ return '<option value="'+escapeAttr(e.id)+'">'+escapeHtml(e.name||'')+'</option>'; }).join('');
      empSelect.innerHTML = opts;
    }

    // Populate project dropdown
    var projSelect = document.getElementById('qt-project');
    if (projSelect) {
      var projects = getVisibleProjects();
      var pOpts = projects.map(function(p){ return '<option value="'+escapeAttr(p.id)+'">'+escapeHtml(p.title||p.name||'')+'</option>'; }).join('');
      projSelect.innerHTML = pOpts;
    }

    // Render recent tasks
    renderRecentTasks();
  } catch(e) {
    console.error('[QuickTask Page]', e);
  }
}

function renderRecentTasks(){
  try{
    var container=document.getElementById('quicktask-recent-list');
    if(!container)return;
    
    var tasks=window.DataLayer.getTasks();
    // Sort by createdAt desc, take last 10
    var sorted=tasks.slice().sort(function(a,b){
      return (b.createdAt||'').localeCompare(a.createdAt||'');
    });
    
    if(sorted.length===0){
      container.innerHTML='<p class="quicktask-empty">Noch keine Aufgaben vorhanden.</p>';
      return;
    }
    
    var recent=sorted.slice(0,10);
    var employees=window.DataLayer.getEmployees()||[];
    var employeeNameById={};
    employees.forEach(function(employee){
      if(!employee||!employee.id)return;
      employeeNameById[String(employee.id)]=String(employee.name||'');
    });
    var html='';
    for(var i=0;i<recent.length;i++){
      var t=recent[i];
      var prioClass=t.priority||'medium';
      var empName='—';
      var assigneeIds=getTaskAssigneeIds(t);
      if(assigneeIds.length){
        var names=assigneeIds.map(function(id){
          return employeeNameById[String(id)]||String(id);
        }).filter(Boolean);
        if(names.length)empName=names.join(', ');
      }
      var dateStr=(t.createdAt)?new Date(t.createdAt).toLocaleDateString('de-DE'):'';
      html+='<div class="recent-task-item">' +
        '<span class="recent-task-priority '+prioClass+'" title="Priorität: '+(t.priority||'medium')+'"></span>'+
        '<span class="recent-task-name" title="'+(t.title||'').replace(/"/g,'&quot;')+'">'+escapeHtml(t.title||'(Kein Titel)')+'</span>';
      if(empName!=='—'){
        html+='<small style="color:var(--text-muted);font-size:0.75rem;">'+escapeHtml(empName)+'</small>';
      }
      if(t.schedule&&t.schedule.mode&&t.schedule.mode!=='none'){
        html+='<small style="color:var(--accent-cyan);font-size:0.72rem;">'+escapeHtml(t.schedule.mode)+'</small>';
      }
      html+='<span class="recent-task-date">'+dateStr+'</span></div>';
    }
    container.innerHTML=html;
  }catch(e){console.error('[QuickTask renderRecent]',e);}
}

function showToast(message, isError){
  try{
    // Remove existing toast
    var existing=document.querySelector('.quicktask-toast');
    if(existing)existing.remove();
    
    var toast=document.createElement('div');
    toast.className='quicktask-toast'+(isError?' error':'');
    toast.textContent=message;
    document.body.appendChild(toast);
    setTimeout(function(){if(toast.parentNode)toast.remove();},3000);
  }catch(e){console.error('[QuickTask showToast]',e);}
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded',function(){
  // Legacy toolbar quicktask button was removed from UI.
  var legacyQuickTaskBtn=document.getElementById('quicktask-btn');
  if(legacyQuickTaskBtn&&legacyQuickTaskBtn.parentNode){
    legacyQuickTaskBtn.parentNode.removeChild(legacyQuickTaskBtn);
  }
  
  // QuickTask Page - form handler
  var qtForm=document.getElementById('quicktask-form');
  if(qtForm){
    function renderPageScheduleFields(){
      var mode=document.getElementById('qt-schedule-mode');
      var wrap=document.getElementById('qt-schedule-fields');
      if(!mode||!wrap)return;
      var html='';
      if(mode.value==='deadline'){
        html='<div class="form-group"><label for="qt-deadline">Deadline</label><input type="date" id="qt-deadline"></div>';
      }else if(mode.value==='fixed'){
        html='<div class="form-group"><label for="qt-fixed">Fester Termin</label><input type="date" id="qt-fixed"></div>';
      }else if(mode.value==='range'){
        html='<div class="task-cockpit-grid"><div class="form-group"><label for="qt-range-start">Start</label><input type="date" id="qt-range-start"></div><div class="form-group"><label for="qt-range-end">Ende</label><input type="date" id="qt-range-end"></div></div>';
      }else if(mode.value==='asap'){
        html='<p class="text-muted">Aufgabe wird als umgehend markiert.</p>';
      }
      wrap.innerHTML=html;
    }

    var scheduleModeEl=document.getElementById('qt-schedule-mode');
    if(scheduleModeEl){
      scheduleModeEl.addEventListener('change',renderPageScheduleFields);
      renderPageScheduleFields();
    }

    qtForm.addEventListener('submit',function(e){
      e.preventDefault();
      var auth = getAuthManager();
      if(auth&&typeof auth.canCreateTask==='function'&&!auth.canCreateTask()){
        showToast('QuickTask ist nur fuer angemeldete Mitarbeiter freigeschaltet.',true);
        return;
      }
      
      var titleInput=document.getElementById('qt-title');
      var title=titleInput.value.trim();
      if(!title){
        showToast('Aufgabenname erforderlich!',true);
        titleInput.focus();
        return;
      }
      
      var payload=buildTaskPayloadFromFields({
        title:title,
        description:(document.getElementById('qt-desc')||{}).value||'',
        priority:document.getElementById('qt-priority').value||'medium',
        urgency:(document.getElementById('qt-urgency')||{}).value||'normal',
        assigneeId:document.getElementById('qt-assignee').value||null,
        projectIds:Array.prototype.map.call((document.getElementById('qt-project')||{}).selectedOptions||[],function(option){return option.value;}),
        effortHours:(document.getElementById('qt-effort')||{}).value||'0',
        scheduleMode:(document.getElementById('qt-schedule-mode')||{}).value||'none',
        deadline:(document.getElementById('qt-deadline')||{}).value||'',
        fixedAt:(document.getElementById('qt-fixed')||{}).value||'',
        rangeStart:(document.getElementById('qt-range-start')||{}).value||'',
        rangeEnd:(document.getElementById('qt-range-end')||{}).value||'',
        subtasksText:(document.getElementById('qt-subtasks')||{}).value||'',
        noteText:(document.getElementById('qt-note')||{}).value||'',
        attachmentsText:(document.getElementById('qt-attachments')||{}).value||'',
        status:'backlog'
      });

      window.DataLayer.createTask(payload);
      
      titleInput.value='';
      showToast('Aufgabe erstellt! \u2713');
      renderRecentTasks();
    });
    
    // Enter-key shortcut (already handled via form submit, but provide visual hint)
    var statusEl=document.getElementById('qt-status');
    if(statusEl){
      var titleInput2=document.getElementById('qt-title');
      if(titleInput2){
        titleInput2.addEventListener('keydown',function(e){
          if(e.key==='Enter'&&!e.shiftKey){
            e.preventDefault();
            qtForm.dispatchEvent(new Event('submit'));
          }
        });
      }
    }
  }
  
  // FAB on Kanban page
  var kanbanPage=document.getElementById('kanban');
  if(kanbanPage){
    var fab=document.createElement('button');fab.id='quicktask-fab';
    fab.className='btn btn-primary';fab.style.cssText='position:fixed;bottom:2rem;right:2rem;border-radius:50%;width:60px;height:60px;font-size:1.5rem;z-index:999;box-shadow:0 4px 16px var(--shadow-color);';
    fab.textContent='\u{2795}';
    fab.type='button';
    fab.setAttribute('aria-label','Quick Actions oeffnen');
    fab.setAttribute('aria-haspopup','menu');
    fab.setAttribute('aria-expanded','false');
    fab.addEventListener('click',function(event){
      event.preventDefault();
      event.stopPropagation();
      toggleQuickActionMenu(fab);
    });
    document.body.appendChild(fab);

    ensureQuickActionMenu();

    window.addEventListener('resize',function(){
      if(quickActionMenu&&!quickActionMenu.classList.contains('hidden'))positionQuickActionMenu(fab);
    });

    document.addEventListener('click',function(event){
      if(!quickActionMenu||quickActionMenu.classList.contains('hidden'))return;
      var isInsideMenu=quickActionMenu.contains(event.target);
      var isFab=event.target===fab||fab.contains(event.target);
      if(!isInsideMenu&&!isFab)hideQuickActionMenu();
    });

    document.addEventListener('keydown',function(event){
      if(event.key==='Escape')hideQuickActionMenu();
    });
  }
});

window.QuickTaskModule={
  open:openQuickTaskModal,
  openChain:openTaskChainModal,
  openCalendar:openQuickCalendarModal,
  openBlocker:openBlockerModal,
  openDepartmentNotice:openDepartmentNoticeModal,
  renderRecentTasks:renderRecentTasks,
  showToast:showToast
};
})();

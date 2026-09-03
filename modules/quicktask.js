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

function translateGitHubCommitToGerman(commit){
  var original=String(commit&&commit.fullMessage||commit&&commit.message||'').trim();
  if(!original||!window.LocalOllama||typeof window.LocalOllama.generate!=='function')return Promise.resolve({title:original,description:''});
  return window.LocalOllama.generate('/api/ai/meeting-task-draft',{
    projectId:'github-commit-translation',
    projectTitle:'GitHub-Commit-Dokumentation',
    draftTitle:original,
    draftDescription:'Commit-SHA: '+String(commit.sha||''),
    promptConfig:{prompt:'Uebersetze den folgenden GitHub-Commit fuer deutschsprachige Mitarbeitende. Formuliere einen kurzen deutschen Aufgabentitel und eine sachliche deutsche Beschreibung der technischen Aenderung. Erhalte technische Begriffe, Dateinamen und Versionsnummern. Antworte ausschliesslich als JSON mit einem Objekt task, das die Felder titleDe und descriptionDe enthaelt.'}
  }).then(function(result){
    var task=result&&result.draft&&result.draft.task||{};
    return {
      title:String(task.titleDe||'').trim()||original,
      description:String(task.descriptionDe||'').trim()
    };
  }).catch(function(){return {title:original,description:''};});
}

function createGermanGitHubTaskDraft(commits,project){
  var entries=(Array.isArray(commits)?commits:[]).map(function(commit){
    return {sha:commit.sha,title:commit.germanTitle||commit.message,description:commit.germanDescription||'',author:commit.author};
  });
  var fallbackSubtasks=entries.map(function(entry){return 'Umsetzung aus Commit '+entry.sha+' dokumentieren';});
  var fallbackTitle='Implementierungen der letzten 12 Stunden dokumentieren';
  var fallbackDescription='Nachtraegliche Dokumentation der bereits umgesetzten GitHub-Commits fuer das Projekt.';
  if(!window.LocalOllama||typeof window.LocalOllama.generate!=='function')return Promise.resolve({title:fallbackTitle,description:fallbackDescription,subtasks:fallbackSubtasks,effortHours:Math.max(0,entries.length)});
  return window.LocalOllama.generate('/api/ai/meeting-task-draft',{
    projectId:String(project&&project.id||''),
    projectTitle:String(project&&project.title||project&&project.name||'Projekt'),
    draftInput:JSON.stringify(entries),
    promptConfig:{prompt:'Erstelle aus den deutschen Commit-Beschreibungen einen deutschen Aufgabenentwurf fuer die nachtraegliche Dokumentation bereits erledigter Implementierungen. Erzeuge einen passenden kurzen Titel, eine sachliche Beschreibung, fuer jeden Commit genau eine deutsche Teilaufgabe und schaetze den Gesamtaufwand in Stunden. Der Aufwand muss groesser als 0 sein und die Summe der Commit-Aufwaende abbilden. Antworte ausschliesslich als JSON mit task.titleDe, task.descriptionDe, task.effortHours und task.subtasksDe.'}
  }).then(function(result){
    var task=result&&result.draft&&result.draft.task||{};
    var subtasks=Array.isArray(task.subtasksDe)?task.subtasksDe.map(function(item){return String(item||'').trim();}).filter(Boolean):[];
    return {
      title:String(task.titleDe||'').trim()||fallbackTitle,
      description:String(task.descriptionDe||'').trim()||fallbackDescription,
      subtasks:subtasks.length?subtasks:fallbackSubtasks,
      effortHours:Math.max(0,parseFloat(task.effortHours)||entries.length)
    };
  }).catch(function(){return {title:fallbackTitle,description:fallbackDescription,subtasks:fallbackSubtasks,effortHours:Math.max(0,entries.length)};});
}

function getQuickTaskGitHubToken(){
  var auth=getAuthManager();
  var user=auth&&typeof auth.getCurrentUser==='function'?auth.getCurrentUser():null;
  var token=user&&user.github?String(user.github.privateAccessToken||'').trim():'';
  if(token)return token;
  try{return String(window.sessionStorage.getItem('projektDashboard.githubApiToken')||'').trim();}catch(_err){return '';}
}

function fetchQuickTaskGitHubCommits(project){
  var github=project&&project.github?project.github:{};
  if(!github.owner||!github.repo)return Promise.reject(new Error('Das Projekt hat keinen GitHub-Link.'));
  var since=Date.now()-(12*60*60*1000);
  var token=getQuickTaskGitHubToken();

  function requestPage(page,found){
    var url='/api/github/commits?owner='+encodeURIComponent(github.owner)+'&repo='+encodeURIComponent(github.repo)+'&per_page=100&page='+page;
    return fetch(url,{headers:token?{'X-GitHub-Token':token}:{}}).then(function(response){
      return response.json().catch(function(){return {};}).then(function(body){
        if(!response.ok)throw new Error(body&&body.message?body.message:('GitHub API HTTP '+response.status));
        return Array.isArray(body)?body:[];
      });
    }).then(function(items){
      var pageCommits=items.map(function(item){
        var commit=item&&item.commit||{};
        var author=commit.author||{};
        var committer=commit.committer||{};
        var timestamp=author.date||committer.date||'';
        return {
          sha:String(item&&item.sha||'').trim(),
          message:String(commit.message||'').split('\n')[0].trim(),
          fullMessage:String(commit.message||'').trim(),
          author:String(author.name||(item&&item.author&&item.author.login)||'Unbekannt').trim(),
          authorLogin:String(item&&item.author&&item.author.login||'').trim(),
          date:timestamp,
          url:String(item&&item.html_url||'').trim()
        };
      }).filter(function(commit){return commit.sha&&Date.parse(commit.date)>=since;});
      var all=found.concat(pageCommits);
      var oldest=items.length?Date.parse(((items[items.length-1].commit||{}).author||{}).date||''):NaN;
      if(items.length===100&&(!isFinite(oldest)||oldest>=since)&&page<5)return requestPage(page+1,all);
      return all;
    });
  }
  return requestPage(1,[]);
}

function getGitHubCommitDocumentationTaskId(sha){
  var target='github-commit:'+String(sha||'').trim();
  var tasks=window.DataLayer&&typeof window.DataLayer.getTasks==='function'?window.DataLayer.getTasks():[];
  var existing=tasks.find(function(task){
    if(!task)return false;
    if(String(task.externalId||'')===target)return true;
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
      if(projectId&&String(task.projectId||'')===String(projectId))loads[key].openInProject++;
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
    projectId:fields.projectId||null,
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
    if(projectId&&task.projectId!==projectId)return;
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
function openQuickTaskModal(){
  try{
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
    
    var pOpts=buildProjectOptions(projects,'-- Projekt waehlen --');
    var lOpts=buildLabelOptions(labels);
    var aiToolsHtml=adminMode
      ? '<div class="task-ai-panel">'
        +'<div class="task-ai-head"><strong>KI-Assistent (Admin)</strong><small>Aus Titel und Beschreibung automatisch Entwurf und Verteilung erzeugen</small></div>'
        +'<div class="task-ai-actions">'
          +'<button type="button" class="btn btn-secondary" id="qtm-ai-fill">KI-Entwurf aus Titel + Beschreibung</button>'
          +'<button type="button" class="btn btn-secondary" id="qtm-ai-assign">KI-Zuweisung</button>'
          +'<button type="button" class="btn btn-secondary" id="qtm-github-commits">GitHub-Commits der letzten 12 Stunden</button>'
          +'<button type="button" class="btn btn-secondary hidden" id="qtm-ai-chain">Kettenvorschlag uebernehmen</button>'
        +'</div>'
        +'<label class="task-ai-check"><input type="checkbox" id="qtm-ai-autoassign" checked> Mitarbeiter automatisch vorschlagen</label>'
        +'<div class="task-ai-status" id="qtm-ai-status">Bereit fuer KI-Vervollstaendigung.</div>'
        +'<div class="task-ai-hint hidden" id="qtm-ai-hint"></div>'
        +'<div class="task-ai-hint hidden" id="qtm-github-commit-review"></div>'
      +'</div>'
      : '';
    
    content.innerHTML='<h2>Neue Aufgabe</h2>' +
      '<div class="form-group"><label>Titel *</label><input type="text" id="qtm-title"></div>' +
      aiToolsHtml +
      '<div class="form-group"><label>Beschreibung</label><textarea id="qtm-desc" rows="3"></textarea></div>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label>Priorität *</label><select id="qtm-prio"><option value="low">Niedrig</option><option value="medium" selected>Mittel</option><option value="high">Hoch</option><option value="blocker">Blocker</option></select></div>' +
      '  <div class="form-group"><label>Dringlichkeit</label><select id="qtm-urgency"><option value="low">Niedrig</option><option value="normal" selected>Normal</option><option value="high">Hoch</option><option value="critical">Kritisch</option></select></div>' +
      '  <div class="form-group"><label>Aufwand (h)</label><input type="number" min="0" step="0.5" id="qtm-effort" value="0"></div>' +
      '</div>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label>Projekt</label><select id="qtm-project">'+pOpts+'</select></div>' +
      '  <div class="form-group"><label>Mitarbeiter</label><div id="qtm-assignee-picker" class="qtm-assignee-picker"></div><small style="color:var(--text-muted)">Mehrfachauswahl: Mitarbeiter per Klick zuweisen</small></div>' +
      '</div>' +
      '<div class="form-group"><label>Labels</label><select id="qtm-labels" multiple style="height:80px;">'+lOpts+'</select><br><small style="color:var(--text-muted)">STRG+Klick für mehrere</small></div>' +
      '<div class="form-group"><label>Terminart</label><select id="qtm-schedule-mode"><option value="none">Kein Termin</option><option value="deadline">Deadline</option><option value="fixed">Fester Termin</option><option value="range">Zeitraum</option><option value="asap">Umgehend</option></select></div>' +
      '<div id="qtm-schedule-fields"></div>' +
      '<div class="form-group"><label>Teilaufgaben (eine pro Zeile)</label><textarea id="qtm-subtasks" rows="3" placeholder="Konzept abstimmen&#10;Implementierung&#10;Abnahme"></textarea></div>' +
      '<div class="form-group"><label>Hinweis / Notiz</label><textarea id="qtm-note" rows="2" placeholder="z. B. Kunde priorisiert dieses Thema"></textarea></div>' +
      '<div class="form-group"><label>Dateien/Links (eine pro Zeile, optional Name|URL)</label><textarea id="qtm-attachments" rows="2" placeholder="Spezifikation|https://...&#10;https://..."></textarea></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-secondary" id="qt-cancel">Abbrechen</button>' +
      '<button class="btn btn-primary" id="qt-submit">Erstellen</button></div>';

    var aiState={loading:false,draft:null,suggestions:[]};
    var githubDraftCommits=[];
    var selectedAssigneeIds=[];

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
        if(btn)btn.disabled=!!disabled;
      });
    }

    function getProjectSelection(){
      var projectId=((document.getElementById('qtm-project')||{}).value||'').trim();
      var project=projects.find(function(item){return String(item.id)===projectId;})||null;
      return {projectId:projectId,project:project};
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
        return task&&String(task.projectId||'')===String(project.id||'');
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

    var cancelBtn=document.getElementById('qt-cancel');
    if(cancelBtn){
      cancelBtn.addEventListener('click',closeSharedModal);
    }

    if(adminMode){
      var aiFillBtn=document.getElementById('qtm-ai-fill');
      if(aiFillBtn)aiFillBtn.addEventListener('click',runAiDraftFromTitle);

      var aiAssignBtn=document.getElementById('qtm-ai-assign');
      if(aiAssignBtn)aiAssignBtn.addEventListener('click',function(){
        applyAssigneeRecommendation();
      });

      var githubCommitBtn=document.getElementById('qtm-github-commits');
      if(githubCommitBtn)githubCommitBtn.addEventListener('click',function(){
        var selection=getProjectSelection();
        var review=document.getElementById('qtm-github-commit-review');
        if(!selection.project){
          updateAiStatus('Fuer den GitHub-Abruf bitte zuerst ein Projekt waehlen.',true);
          return;
        }
        githubCommitBtn.disabled=true;
        updateAiStatus('GitHub-Commits werden abgerufen ...',false);
        fetchQuickTaskGitHubCommits(selection.project).then(function(commits){
          if(!review)return;
          if(!commits.length){
            review.innerHTML='<div>Keine neuen Commits der letzten 12 Stunden gefunden.</div>';
            review.classList.remove('hidden');
            updateAiStatus('Keine neuen Commits im Zeitfenster.',false);
            return;
          }
          updateAiStatus('Commit-Informationen werden auf Deutsch vorbereitet ...',false);
          Promise.all(commits.map(function(commit){
            return translateGitHubCommitToGerman(commit).then(function(translation){
              commit.germanTitle=translation.title;
              commit.germanDescription=translation.description;
              return commit;
            });
          })).then(function(translatedCommits){
          review.innerHTML='<strong>Commit-Teilaufgaben pruefen</strong>'
            +translatedCommits.map(function(commit){
              var existing=getGitHubCommitDocumentationTaskId(commit.sha);
              var checked=existing?'':' checked';
              var disabled=existing?' disabled':'';
              var state=existing?' (bereits dokumentiert)':'';
              return '<label style="display:block;margin-top:0.45rem;opacity:'+(existing?'0.6':'1')+';">'
                +'<input type="checkbox" data-github-commit-sha="'+escapeAttr(commit.sha)+'"'+checked+disabled+'>'
                +' '+escapeHtml(commit.germanTitle||commit.message||'(ohne Nachricht)')+' <small>'+escapeHtml(commit.author)+' · '+escapeHtml(new Date(commit.date).toLocaleString('de-DE'))+escapeHtml(state)+'</small>'
                +'</label>';
            }).join('')
            +'<button type="button" class="btn btn-primary" id="qtm-github-create" style="margin-top:0.7rem;">Ausgewählte als Teilaufgaben in der Aufgabe entwerfen</button>';
          review.classList.remove('hidden');
          review._commits=translatedCommits;
          githubDraftCommits=translatedCommits;
          updateAiStatus(String(translatedCommits.length)+' Commit(s) auf Deutsch vorbereitet.',false);
          var createBtn=document.getElementById('qtm-github-create');
          if(createBtn)createBtn.addEventListener('click',function(){
            var selected=[];
            review.querySelectorAll('[data-github-commit-sha]:checked').forEach(function(input){
              var commit=translatedCommits.find(function(item){return item.sha===input.getAttribute('data-github-commit-sha');});
              if(commit)selected.push(commit);
            });
            var newCommits=selected.filter(function(commit){return !getGitHubCommitDocumentationTaskId(commit.sha);});
            if(!newCommits.length){
              review.classList.add('hidden');
              updateAiStatus('Keine neuen Aufgaben ausgewaehlt.',false);
              return;
            }
            createBtn.disabled=true;
            updateAiStatus('Aufgabenentwurf aus den ausgewaehlten Commits wird erstellt ...',false);
            githubDraftCommits=newCommits;
            createGermanGitHubTaskDraft(newCommits,selection.project).then(function(draft){
              var titleEl=document.getElementById('qtm-title');
              var descEl=document.getElementById('qtm-desc');
              var effortEl=document.getElementById('qtm-effort');
              var subtaskEl=document.getElementById('qtm-subtasks');
              if(titleEl)titleEl.value=draft.title;
              if(descEl)descEl.value=draft.description+'\n\nCommits:\n'+newCommits.map(function(commit){return commit.sha+' - '+(commit.germanDescription||commit.germanTitle);}).join('\n');
              if(effortEl)effortEl.value=String(Math.max(0,Math.round(draft.effortHours*2)/2));
              if(subtaskEl)subtaskEl.value=draft.subtasks.join('\n');
              var attachmentEl=document.getElementById('qtm-attachments');
              if(attachmentEl)attachmentEl.value=newCommits.filter(function(commit){return commit.url;}).map(function(commit){return 'GitHub Commit '+commit.sha+'|'+commit.url;}).join('\n');
              review.classList.add('hidden');
              updateAiStatus('Entwurf uebernommen. Bitte pruefen und mit „Erstellen“ anlegen.',false);
            }).catch(function(error){
              updateAiStatus('Aufgabenentwurf fehlgeschlagen: '+String(error&&error.message||error),true);
            }).finally(function(){createBtn.disabled=false;});
          });
          }).catch(function(error){
            updateAiStatus('Uebersetzung fehlgeschlagen: '+String(error&&error.message||error),true);
          });
        }).catch(function(error){
          updateAiStatus('GitHub-Abruf fehlgeschlagen: '+String(error&&error.message||error),true);
        }).finally(function(){githubCommitBtn.disabled=false;});
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
        projectId:document.getElementById('qtm-project').value,
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
        status:'backlog'
      });
      if(githubDraftCommits.length){
        payload.sourceCommitShas=githubDraftCommits.map(function(commit){return commit.sha;});
        payload.externalSource='github';
        payload.documentationOnly=true;
      }
      
      window.DataLayer.createTask(payload);
      
      closeSharedModal();
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
      if(task.projectId&&projectById[String(task.projectId)])return true;
      if(auth&&typeof auth.canEditTask==='function')return auth.canEditTask(task);
      return true;
    }).sort(function(a,b){
      return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
    }).slice(0,300);

    var taskOptions=tasks.map(function(task){
      var projectTitle=task.projectId&&projectById[String(task.projectId)]?(projectById[String(task.projectId)].title||projectById[String(task.projectId)].name||'Projekt'):'Ohne Projekt';
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
      var pOpts = '<option value="">— Kein Projekt —</option>' + 
        projects.map(function(p){ return '<option value="'+escapeAttr(p.id)+'">'+escapeHtml(p.title||p.name||'')+'</option>'; }).join('');
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
        projectId:document.getElementById('qt-project').value||null,
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

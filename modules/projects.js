/* ========================================
   Projects Module
   Projekt-Menue mit CRUD, GitHub und Info-Hub
   ======================================== */
(function(){'use strict';

var NAMESPACE='ProjectsModule';
var REPO_URL_RE=/(?:^|\/\/)(?:www\.)?github\.com\/([^\/#?]+)\/([^\/#?]+)(?:[\/#?]|$)/i;
var MAX_ATTACHMENT_SIZE=1024*1024;
var MAX_TOTAL_ATTACHMENT_SIZE=6*1024*1024;
var AI_BACKEND_URL=(window.location&&/^https?:/i.test(window.location.origin||''))?window.location.origin.replace(/\/$/,''):'';
var DEFAULT_OLLAMA_MODEL='hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M';
var GITHUB_TOKEN_SESSION_KEY='projektDashboard.githubApiToken';
var MEETING_NOTES_PREFIX='meeting_notes_';
var MEETING_WORKFLOW_PREFIX='meeting_workflow_';
var MEETING_ACTIVE_PROJECT_KEY='meeting_active_project';
var MEETING_PROTOCOL_DEFAULT_STATUS='open';
var PROJECT_PAGE_DRAFT_KEY='projektDashboard.projectPageDraft';
var PROJECT_PAGE_STATE_KEY='projektDashboard.projectPageState';
var SECRET_VIEW_STATE={};
var AI_HEALTH_STATE={
  backendStatus:'unknown',
  ollamaStatus:'unknown',
  checkedAt:'',
  endpoint:'',
  error:'',
  models:[],
  loading:false
};
var AI_HEALTH_PROMISE=null;

function byId(id){return document.getElementById(id);}

function getAuthManager(){
  return window.AuthManager || null;
}

function getVisibleProjects(){
  var projects = window.DataLayer.getProjects().slice();
  var auth = getAuthManager();
  if (auth && typeof auth.getMode === 'function' && auth.getMode() === 'guest') {
    return projects;
  }
  if (auth && typeof auth.getVisibleProjects === 'function') {
    return auth.getVisibleProjects(projects);
  }
  return projects;
}

function canAdjustProjectProgress(project){
  var auth=getAuthManager();
  if(!auth)return true;

  var mode=typeof auth.getMode==='function'?String(auth.getMode()||'').toLowerCase():'';
  if(mode==='setup'||mode==='admin')return true;

  var currentUser=typeof auth.getCurrentUser==='function'?auth.getCurrentUser():null;
  var userId=currentUser&&currentUser.id?String(currentUser.id):'';
  if(!userId)return false;

  if(String(project&&project.createdByEmployeeId||'')===userId)return true;

  var contactIds=[];
  if(project&&project.contactEmployeeId)contactIds.push(String(project.contactEmployeeId));

  var team=Array.isArray(project&&project.teamMembers)?project.teamMembers:[];
  team.forEach(function(member){
    var employeeId=String(member&&member.employeeId||'');
    var role=String(member&&member.role||'').toLowerCase();
    if(!employeeId)return;
    if(/owner|ansprech|kontakt|contact|lead/.test(role))contactIds.push(employeeId);
  });

  if(!contactIds.length){
    return !!(typeof auth.canEditProject==='function'&&auth.canEditProject(project));
  }

  return contactIds.some(function(id){return id===userId;});
}

function escapeHtml(value){
  if(value===null||value===undefined)return '';
  var div=document.createElement('div');
  div.appendChild(document.createTextNode(String(value)));
  return div.innerHTML;
}

function formatDate(iso){
  if(!iso)return 'n/a';
  var date=new Date(iso);
  if(isNaN(date.getTime()))return 'n/a';
  return date.toLocaleDateString('de-DE',{year:'numeric',month:'2-digit',day:'2-digit'});
}

function formatDateTime(iso){
  if(!iso)return 'n/a';
  var date=new Date(iso);
  if(isNaN(date.getTime()))return 'n/a';
  return date.toLocaleString('de-DE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function progressFromStatus(status){
  var value=String(status||'').toLowerCase();
  if(value==='done')return 100;
  if(value==='active')return 45;
  return 0;
}

function sanitizeProgressValue(value, fallback){
  var number=Number(value);
  if(!isFinite(number))number=Number(fallback);
  if(!isFinite(number))number=0;
  number=Math.round(number);
  if(number<0)number=0;
  if(number>100)number=100;
  return number;
}

function getProjectProgressValue(project, flow){
  var fallback=progressFromStatus(project&&project.status);
  if(flow&&typeof flow.doneRatio==='number'&&isFinite(flow.doneRatio))fallback=flow.doneRatio;
  return sanitizeProgressValue(project&&project.progress,fallback);
}

function askResolutionText(message, defaultValue){
  var fallback=String(defaultValue||'Blocker geloest');
  var quickOptions=[
    'Blocker geloest',
    'Freigabe erhalten',
    'Abhaengigkeit geklaert',
    'Ressourcen wieder verfuegbar'
  ];

  return new Promise(function(resolve){
    if(!document||!document.body||typeof HTMLDialogElement==='undefined'){
      try {
        if(typeof window.prompt==='function'){
          resolve(window.prompt(message,fallback));
          return;
        }
      } catch(_err){}
      resolve(fallback);
      return;
    }

    var dialog=document.createElement('dialog');
    dialog.className='resolution-dialog';
    dialog.style.padding='1rem';
    dialog.style.border='1px solid var(--border-color)';
    dialog.style.borderRadius='0.9rem';
    dialog.style.background='var(--bg-card)';
    dialog.style.color='var(--text-primary)';
    dialog.style.maxWidth='520px';
    dialog.style.width='min(92vw, 520px)';

    var quickHtml=quickOptions.map(function(item){
      return '<button type="button" data-quick-resolution="'+escapeHtml(item)+'" class="btn btn-secondary" style="padding:0.35rem 0.6rem;font-size:0.75rem;">'+escapeHtml(item)+'</button>';
    }).join('');

    dialog.innerHTML=''
      +'<form method="dialog" style="display:grid;gap:0.75rem;">'
      +'  <h3 style="margin:0;font-size:1rem;">'+escapeHtml(message||'Grund fuer Entblockung')+'</h3>'
      +'  <div style="display:flex;flex-wrap:wrap;gap:0.45rem;">'+quickHtml+'</div>'
      +'  <textarea id="resolution-input" rows="3" placeholder="Grund eingeben" style="width:100%;"></textarea>'
      +'  <div style="display:flex;justify-content:flex-end;gap:0.5rem;">'
      +'    <button type="button" class="btn btn-secondary" data-resolution-cancel>Abbrechen</button>'
      +'    <button type="button" class="btn btn-primary" data-resolution-save>Speichern</button>'
      +'  </div>'
      +'</form>';

    document.body.appendChild(dialog);
    var input=dialog.querySelector('#resolution-input');
    if(input)input.value=fallback;

    function closeWith(value){
      try { dialog.close(); } catch(_errClose){}
      if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
      resolve(value);
    }

    dialog.addEventListener('click',function(event){
      var quick=event.target&&event.target.closest?event.target.closest('[data-quick-resolution]'):null;
      if(quick&&input){
        input.value=quick.getAttribute('data-quick-resolution')||'';
        input.focus();
        return;
      }
      var cancel=event.target&&event.target.closest?event.target.closest('[data-resolution-cancel]'):null;
      if(cancel){
        closeWith(null);
        return;
      }
      var save=event.target&&event.target.closest?event.target.closest('[data-resolution-save]'):null;
      if(save){
        var value=String((input&&input.value)||'').trim();
        if(!value){
          alert('Bitte einen Grund angeben oder eine Schnellauswahl waehlen.');
          if(input)input.focus();
          return;
        }
        closeWith(value);
      }
    });

    dialog.addEventListener('cancel',function(event){
      event.preventDefault();
      closeWith(null);
    });

    dialog.showModal();
    if(input&&input.focus)input.focus();
  });
}

function getOpenBlockerHistoryEntry(entity){
  var history=entity&&Array.isArray(entity.blockerHistory)?entity.blockerHistory:[];
  for(var i=history.length-1;i>=0;i--){
    if(!history[i].until)return history[i];
  }
  return null;
}

function renderBlockerHistory(entity){
  var history=entity&&Array.isArray(entity.blockerHistory)?entity.blockerHistory.slice():[];
  if(!history.length)return '<p class="text-muted">Keine Blocker-Historie.</p>';

  history.sort(function(a,b){
    return String(b.from||'').localeCompare(String(a.from||''));
  });

  var html='<ul class="blocker-history-list">';
  history.slice(0,6).forEach(function(entry){
    var from=formatDateTime(entry.from);
    var until=entry.until?formatDateTime(entry.until):'offen';
    var reason=entry.reason||'Kein Grund hinterlegt';
    var resolution=entry.resolution?(' · Aufloesung: '+entry.resolution):'';
    html+='<li>'
      +'<span class="blocker-history-period">'+escapeHtml(from)+' -> '+escapeHtml(until)+'</span>'
      +'<span class="blocker-history-message">'+escapeHtml(reason+resolution)+'</span>'
      +'</li>';
  });
  html+='</ul>';
  return html;
}

function formatBytes(bytes){
  var value=Number(bytes)||0;
  if(value<1024)return value+' B';
  if(value<1024*1024)return Math.round(value/1024)+' KB';
  return (Math.round((value/(1024*1024))*10)/10)+' MB';
}

function getContributionDayKey(value){
  var date=value instanceof Date?value:new Date(value);
  if(isNaN(date.getTime()))return '';
  return date.toISOString().slice(0,10);
}

function buildProjectContributionMatrix(project){
  var commits=Array.isArray(project&&project.githubCommits)?project.githubCommits:[];
  if(!commits.length)return [];

  var earliestTs=Infinity;
  var latestTs=-Infinity;
  commits.forEach(function(commit){
    var ts=Date.parse(commit&&commit.date||'');
    if(isNaN(ts))return;
    if(ts<earliestTs)earliestTs=ts;
    if(ts>latestTs)latestTs=ts;
  });

  if(!isFinite(earliestTs)||!isFinite(latestTs))return [];

  var startDay=new Date(earliestTs);
  startDay.setHours(0,0,0,0);
  var endDay=new Date(Math.max(Date.now(),latestTs));
  endDay.setHours(0,0,0,0);

  var countsByDay={};
  var days=[];
  for(var day=new Date(startDay.getTime());day<=endDay;day.setDate(day.getDate()+1)){
    var key=getContributionDayKey(day);
    countsByDay[key]=0;
    days.push({
      key:key,
      label:day.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'}),
      count:0
    });
  }

  commits.forEach(function(commit){
    var ts=Date.parse(commit&&commit.date||'');
    if(isNaN(ts))return;
    var key=getContributionDayKey(new Date(ts));
    if(!Object.prototype.hasOwnProperty.call(countsByDay,key))return;
    countsByDay[key]+=1;
  });

  days.forEach(function(day){
    day.count=countsByDay[day.key]||0;
  });

  return days;
}

function getContributionLevel(count){
  if(!count)return 0;
  return Math.min(4,count);
}

function renderProjectGitHubMatrixHeader(project){
  var commits=Array.isArray(project&&project.githubCommits)?project.githubCommits:[];
  if(!commits.length)return '';
  var days=buildProjectContributionMatrix(project);
  if(!days.length)return '';
  var weeks=[];
  for(var i=0;i<days.length;i+=7){weeks.push(days.slice(i,i+7));}
  var matrixHtml=weeks.map(function(week){
    return '<div class="employee-github-week">'+week.map(function(day){
      var level=getContributionLevel(day.count);
      return '<span class="employee-github-cell lvl-'+level+'" title="'+escapeHtml(day.label+': '+day.count+' Commits')+'"></span>';
    }).join('')+'</div>';
  }).join('');
  return '<div class="project-card-head-matrix">'
    +'<span class="project-card-head-matrix-label">GitHub Matrix</span>'
    +'<div class="employee-github-matrix" aria-label="GitHub Matrix">'+matrixHtml+'</div>'
    +'</div>';
}

function renderProjectGitHubMatrix(project){
  var commits=Array.isArray(project&&project.githubCommits)?project.githubCommits:[];
  if(!commits.length)return '';

  var days=buildProjectContributionMatrix(project);
  var weeks=[];
  for(var i=0;i<days.length;i+=7){
    weeks.push(days.slice(i,i+7));
  }

  var matrixHtml=weeks.map(function(week){
    return '<div class="employee-github-week">'+week.map(function(day){
      var level=getContributionLevel(day.count);
      var title=escapeHtml(day.label+': '+day.count+' Commits');
      return '<span class="employee-github-cell lvl-'+level+'" title="'+title+'" aria-label="'+title+'"></span>';
    }).join('')+'</div>';
  }).join('');

  return '<div class="employee-github-panel" style="margin-top:0.7rem;">'+
    '<div class="employee-github-head">'+
      '<div>' +
        '<div class="employee-github-title">Contribution Matrix</div>' +
        '<div class="employee-github-subtitle">Gesamte Commit-Historie</div>' +
      '</div>' +
    '</div>' +
    '<div class="employee-github-matrix-shell">' +
      '<div class="employee-github-matrix-daylabels"><span>Mo</span><span>Mi</span><span>Fr</span><span>So</span></div>' +
      '<div class="employee-github-matrix">'+matrixHtml+'</div>' +
      '<div class="employee-github-legend"><span>Weniger</span><i class="employee-github-cell lvl-0"></i><i class="employee-github-cell lvl-1"></i><i class="employee-github-cell lvl-2"></i><i class="employee-github-cell lvl-3"></i><i class="employee-github-cell lvl-4"></i><span>Mehr</span></div>' +
    '</div>' +
  '</div>';
}

function normalizeRepoUrl(url){
  var clean=(url||'').trim();
  if(!clean)return null;
  clean=clean.replace(/^git@github\.com:/i,'https://github.com/');
  clean=clean.replace(/\.git$/i,'');
  clean=clean.replace(/\/+$/,'');

  if(/^api\.github\.com\//i.test(clean))clean='https://'+clean;
  if(/^github\.com\//i.test(clean)||/^www\.github\.com\//i.test(clean))clean='https://'+clean;

  var owner='';
  var repo='';
  try {
    if(/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)){
      var parsedUrl=new URL(clean);
      var host=(parsedUrl.hostname||'').toLowerCase();
      var segments=(parsedUrl.pathname||'').split('/').filter(Boolean);

      if((host==='github.com'||host==='www.github.com')&&segments.length>=2){
        owner=segments[0];
        repo=segments[1];
      } else if(host==='api.github.com'&&segments.length>=3&&segments[0].toLowerCase()==='repos'){
        owner=segments[1];
        repo=segments[2];
      }
    }
  } catch(_err){}

  if(!owner||!repo){
    var match=clean.match(REPO_URL_RE);
    if(match){
      owner=match[1];
      repo=match[2];
    }
  }

  owner=decodeURIComponent(owner||'').trim();
  repo=decodeURIComponent(repo||'').trim().replace(/\.git$/i,'');
  if(!owner||!repo)return null;

  return {
    owner:owner,
    repo:repo,
    url:'https://github.com/'+owner+'/'+repo
  };
}

function getProjectTitle(project){
  return project.title||project.name||'Unbenanntes Projekt';
}

function safeReadLocalStorage(key){
  try {
    return window.localStorage.getItem(key);
  } catch(_err){
    return null;
  }
}

function readJsonFromLocalStorage(key,fallback){
  var raw=safeReadLocalStorage(key);
  if(!raw)return fallback;
  try {
    var parsed=JSON.parse(raw);
    return parsed===undefined||parsed===null?fallback:parsed;
  } catch(_err){
    return fallback;
  }
}

function ensureProjectMeetingProtocol(project){
  if(!project||typeof project!=='object')return {status:MEETING_PROTOCOL_DEFAULT_STATUS,closedAt:'',updatedAt:''};
  if(!project.meetingProtocol||typeof project.meetingProtocol!=='object'){
    project.meetingProtocol={status:MEETING_PROTOCOL_DEFAULT_STATUS,closedAt:'',updatedAt:''};
  }
  if(project.meetingProtocol.status!=='closed')project.meetingProtocol.status=MEETING_PROTOCOL_DEFAULT_STATUS;
  if(typeof project.meetingProtocol.closedAt!=='string')project.meetingProtocol.closedAt='';
  if(typeof project.meetingProtocol.updatedAt!=='string')project.meetingProtocol.updatedAt='';
  return project.meetingProtocol;
}

function ensureProjectExecutionPlan(project){
  if(!project||typeof project!=='object'){
    return {status:'empty',queuedTasks:[],queuedEvents:[],milestoneDraft:{status:'idle',summaryMarkdown:'',items:[],generatedAt:''}};
  }
  if(!project.executionPlanDraft||typeof project.executionPlanDraft!=='object')project.executionPlanDraft={};
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

function normalizeMilestoneDate(value){
  var text=String(value||'').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';
}

function normalizeMilestoneTime(value){
  var text=String(value||'').trim();
  return /^\d{2}:\d{2}$/.test(text)?text:'';
}

function normalizeMilestoneItem(item,index){
  var source=item&&typeof item==='object'?item:{};
  var title=String(source.title||source.name||'').trim()||('Meilenstein '+(index+1));
  return {
    id:String(source.id||window.DataLayer.generateId()),
    title:title,
    description:String(source.description||'').trim(),
    date:normalizeMilestoneDate(source.date),
    startTime:normalizeMilestoneTime(source.startTime),
    endTime:normalizeMilestoneTime(source.endTime),
    type:'release'
  };
}

function buildMilestonePromptPayload(project){
  var meeting=getMeetingSnapshot(project);
  var workflow=readMeetingWorkflow(project.id);
  var draft=ensureProjectExecutionPlan(project);
  return {
    projectId:project.id,
    projectTitle:getProjectTitle(project),
    projectDescription:String(project.description||''),
    projectStatus:String(project.status||''),
    meeting:{
      conceptMarkdown:String(workflow.conceptMarkdown||''),
      planMarkdown:String(workflow.planMarkdown||''),
      tasksSummary:String(workflow.tasksSummary||''),
      notes:(meeting.entries||[]).slice(-60)
    },
    queued:{
      taskCount:draft.queuedTasks.length,
      eventCount:draft.queuedEvents.length,
      tasks:draft.queuedTasks.slice(0,80),
      events:draft.queuedEvents.slice(0,80)
    }
  };
}

function generateMilestonesDraft(projectId,force){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project) return Promise.reject(new Error('Projekt nicht gefunden.'));
  var draft=ensureProjectExecutionPlan(project);
  if(!force&&draft.milestoneDraft.status==='ready'&&draft.milestoneDraft.items.length){
    return Promise.resolve(draft.milestoneDraft);
  }

  var payload=buildMilestonePromptPayload(project);
  return postJsonWithFallback('/api/ai/project-milestones-draft',payload).then(function(body){
    var fresh=window.DataLayer.getProjectById(projectId);
    if(!fresh)throw new Error('Projekt nicht mehr verfuegbar.');
    var freshDraft=ensureProjectExecutionPlan(fresh);
    var result=body&&body.draft&&typeof body.draft==='object'?body.draft:{};
    var list=Array.isArray(result.milestones)?result.milestones:[];
    freshDraft.milestoneDraft.status='ready';
    freshDraft.milestoneDraft.summaryMarkdown=String(result.summaryMarkdown||'').trim();
    freshDraft.milestoneDraft.generatedAt=String(body.generatedAt||new Date().toISOString());
    freshDraft.milestoneDraft.items=list.map(function(item,idx){return normalizeMilestoneItem(item,idx);});
    freshDraft.updatedAt=new Date().toISOString();
    if(freshDraft.queuedTasks.length||freshDraft.queuedEvents.length)freshDraft.status='queued';
    window.DataLayer.updateProject(fresh);
    return freshDraft.milestoneDraft;
  });
}

function openMilestoneReviewDialog(project,milestoneDraft){
  return new Promise(function(resolve){
    var items=Array.isArray(milestoneDraft&&milestoneDraft.items)?milestoneDraft.items:[];
    var dialog=document.createElement('dialog');
    dialog.className='resolution-dialog';

    function renderRows(seed){
      var list=Array.isArray(seed)?seed:[];
      if(!list.length)list=[normalizeMilestoneItem({},0)];
      return list.map(function(item,idx){
        return ''
          +'<article class="infohub-card" data-milestone-row="'+idx+'">'
            +'<div class="project-form-grid">'
              +'<label class="form-group"><span>Titel</span><input type="text" data-field="title" value="'+escapeHtml(item.title||'')+'"></label>'
              +'<label class="form-group"><span>Datum</span><input type="date" data-field="date" value="'+escapeHtml(item.date||'')+'"></label>'
            +'</div>'
            +'<div class="project-form-grid">'
              +'<label class="form-group"><span>Start</span><input type="time" data-field="startTime" value="'+escapeHtml(item.startTime||'')+'"></label>'
              +'<label class="form-group"><span>Ende</span><input type="time" data-field="endTime" value="'+escapeHtml(item.endTime||'')+'"></label>'
            +'</div>'
            +'<label class="form-group"><span>Beschreibung</span><textarea rows="2" data-field="description">'+escapeHtml(item.description||'')+'</textarea></label>'
            +'<div class="project-actions-inline mt-1"><button type="button" class="btn btn-secondary" data-action="remove-row">Entfernen</button></div>'
          +'</article>';
      }).join('');
    }

    dialog.innerHTML=''
      +'<form method="dialog" class="resolution-form">'
        +'<h3>Projektstart: Meilensteine pruefen</h3>'
        +'<p class="text-muted">Projekt: '+escapeHtml(getProjectTitle(project))+'</p>'
        +(milestoneDraft&&milestoneDraft.summaryMarkdown?'<p class="text-muted">'+escapeHtml(milestoneDraft.summaryMarkdown)+'</p>':'')
        +'<div id="milestone-review-rows">'+renderRows(items)+'</div>'
        +'<div class="project-actions-inline mt-1">'
          +'<button type="button" class="btn btn-secondary" data-action="add-row">Meilenstein hinzufuegen</button>'
        +'</div>'
        +'<div class="resolution-actions">'
          +'<button type="button" class="btn btn-secondary" data-action="cancel">Abbrechen</button>'
          +'<button type="button" class="btn btn-secondary" data-action="regenerate">Neu mit KI erzeugen</button>'
          +'<button type="button" class="btn btn-primary" data-action="confirm">Projekt starten & eintragen</button>'
        +'</div>'
      +'</form>';

    document.body.appendChild(dialog);

    function closeWith(value){
      try{dialog.close();}catch(_errClose){}
      if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
      resolve(value);
    }

    function readRows(){
      var rows=dialog.querySelectorAll('[data-milestone-row]');
      var result=[];
      rows.forEach(function(row,idx){
        var titleEl=row.querySelector('[data-field="title"]');
        var dateEl=row.querySelector('[data-field="date"]');
        var startEl=row.querySelector('[data-field="startTime"]');
        var endEl=row.querySelector('[data-field="endTime"]');
        var descEl=row.querySelector('[data-field="description"]');
        var title=String(titleEl&&titleEl.value||'').trim();
        var date=normalizeMilestoneDate(dateEl&&dateEl.value||'');
        if(!title||!date)return;
        result.push(normalizeMilestoneItem({
          id:window.DataLayer.generateId(),
          title:title,
          description:String(descEl&&descEl.value||'').trim(),
          date:date,
          startTime:normalizeMilestoneTime(startEl&&startEl.value||''),
          endTime:normalizeMilestoneTime(endEl&&endEl.value||'')
        },idx));
      });
      return result;
    }

    dialog.addEventListener('click',function(event){
      var target=event.target&&event.target.closest?event.target.closest('[data-action]'):null;
      if(!target)return;
      var action=target.getAttribute('data-action');
      if(action==='cancel'){
        closeWith(null);
        return;
      }
      if(action==='regenerate'){
        closeWith({action:'regenerate'});
        return;
      }
      if(action==='add-row'){
        var rowsWrap=dialog.querySelector('#milestone-review-rows');
        if(rowsWrap){
          var nextCount=rowsWrap.querySelectorAll('[data-milestone-row]').length;
          rowsWrap.insertAdjacentHTML('beforeend',renderRows([normalizeMilestoneItem({},nextCount)]));
        }
        return;
      }
      if(action==='remove-row'){
        var card=target.closest('[data-milestone-row]');
        if(card&&card.parentNode)card.parentNode.removeChild(card);
        return;
      }
      if(action==='confirm'){
        var edited=readRows();
        if(!edited.length){
          alert('Bitte mindestens einen Meilenstein mit Titel und Datum erfassen.');
          return;
        }
        closeWith({action:'confirm',items:edited});
      }
    });

    dialog.showModal();
  });
}

function applyProjectStart(projectId,milestones){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)throw new Error('Projekt nicht gefunden.');
  var draft=ensureProjectExecutionPlan(project);
  var queueTasks=(draft.queuedTasks||[]).slice();
  var queueEvents=(draft.queuedEvents||[]).slice();
  var createdTasks=[];

  queueTasks.sort(function(a,b){
    var aSeq=Number(a&&a.sequenceIndex||0)||0;
    var bSeq=Number(b&&b.sequenceIndex||0)||0;
    if(aSeq&&!bSeq)return -1;
    if(!aSeq&&bSeq)return 1;
    if(aSeq!==bSeq)return aSeq-bSeq;
    return 0;
  });

  queueTasks.forEach(function(item){
    if(!item||!item.title)return;
    var dependencyTaskIds=[];
    var previous=createdTasks.length?createdTasks[createdTasks.length-1]:null;
    if(item.chainWithPrevious&&previous&&previous.id)dependencyTaskIds.push(previous.id);
    var externalId=String(item.externalDependencyTaskId||'').trim();
    if(externalId&&window.DataLayer.getTaskById&&window.DataLayer.getTaskById(externalId))dependencyTaskIds.push(externalId);
    var payload={
      title:item.title,
      description:item.description||'',
      projectId:projectId,
      assigneeId:item.assigneeId||null,
      status:'todo',
      priority:item.priority||'medium',
      urgency:item.urgency||'normal',
      effortHours:Number(item.effortHours||0)||0,
      labels:Array.isArray(item.labels)?item.labels.slice():[],
      schedule:item.schedule&&typeof item.schedule==='object'?item.schedule:{mode:'none',deadline:'',fixedAt:'',rangeStart:'',rangeEnd:''},
      sequenceIndex:Number(item.sequenceIndex||0)||0,
      dependsOnPrevious:!!item.dependsOnPrevious,
      dependencyTaskIds:dependencyTaskIds,
      subtasks:Array.isArray(item.subtasks)?item.subtasks.slice():[],
      notes:Array.isArray(item.notes)?item.notes.slice():[]
    };
    var created=window.DataLayer.createTask(payload);
    if(created)createdTasks.push(created);
  });

  queueEvents.forEach(function(item){
    if(!item||!item.title||!item.date)return;
    window.DataLayer.createCalendarEvent({
      title:item.title,
      description:item.description||'',
      date:item.date,
      startDate:item.date,
      startTime:item.startTime||'',
      endTime:item.endTime||'',
      type:item.type||'meeting',
      projectId:projectId,
      attendeeIds:Array.isArray(item.attendeeIds)?item.attendeeIds.slice():[]
    });
  });

  (Array.isArray(milestones)?milestones:[]).forEach(function(item){
    if(!item||!item.title||!item.date)return;
    window.DataLayer.createCalendarEvent({
      title:'Meilenstein: '+item.title,
      description:item.description||'',
      date:item.date,
      startDate:item.date,
      startTime:item.startTime||'',
      endTime:item.endTime||'',
      type:'release',
      projectId:projectId
    });
  });

  if(project.status!=='done')project.status='active';
  if(!project.startDate)project.startDate=new Date().toISOString().slice(0,10);
  draft.queuedTasks=[];
  draft.queuedEvents=[];
  draft.status='applied';
  draft.updatedAt=new Date().toISOString();
  draft.milestoneDraft.status='applied';
  draft.milestoneDraft.items=(Array.isArray(milestones)?milestones:[]).map(function(item,idx){return normalizeMilestoneItem(item,idx);});
  draft.milestoneDraft.generatedAt=draft.updatedAt;
  window.DataLayer.updateProject(project);

  return {
    taskCount:createdTasks.length,
    eventCount:queueEvents.length,
    milestoneCount:Array.isArray(milestones)?milestones.length:0
  };
}

function startProjectWithMilestones(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return Promise.reject(new Error('Projekt nicht gefunden.'));
  if(String(project.status||'').toLowerCase()==='active'){
    notify('Projekt ist bereits gestartet.','info');
    return Promise.resolve();
  }

  function openReviewAfterDraft(forceRegenerate){
    return generateMilestonesDraft(projectId,!!forceRegenerate).then(function(milestoneDraft){
      var fresh=window.DataLayer.getProjectById(projectId);
      if(!fresh)throw new Error('Projekt nicht gefunden.');
      return openMilestoneReviewDialog(fresh,milestoneDraft).then(function(result){
        if(!result)return null;
        if(result.action==='regenerate')return openReviewAfterDraft(true);
        if(result.action==='confirm'){
          var applied=applyProjectStart(projectId,result.items||[]);
          notify('Projekt gestartet: '+applied.taskCount+' Aufgaben, '+applied.eventCount+' Termine und '+applied.milestoneCount+' Meilensteine eingetragen.','info');
          render();
          return applied;
        }
        return null;
      });
    });
  }

  notify('KI ermittelt Meilensteine fuer den Projektstart ...','info');
  return openReviewAfterDraft(false);
}

function readMeetingEntries(projectId){
  var key=MEETING_NOTES_PREFIX+String(projectId||'');
  var entries=readJsonFromLocalStorage(key,[]);
  if(!Array.isArray(entries))return [];
  return entries.filter(function(item){
    return item&&typeof item.text==='string';
  });
}

function readMeetingWorkflow(projectId){
  var key=MEETING_WORKFLOW_PREFIX+String(projectId||'');
  var workflow=readJsonFromLocalStorage(key,{});
  if(!workflow||typeof workflow!=='object')return {};
  return workflow;
}

function summarizeText(value,maxLength){
  var text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  var clean=text.replace(/^#+\s+/,'');
  if(clean.length<=maxLength)return clean;
  return clean.slice(0,maxLength-3)+'...';
}

function getMeetingSnapshot(project){
  var projectId=project&&project.id?project.id:'';
  var entries=readMeetingEntries(projectId);
  var workflow=readMeetingWorkflow(projectId);
  var protocol=ensureProjectMeetingProtocol(project);

  var lastEntryAt='';
  entries.forEach(function(entry){
    if(entry&&entry.createdAt&&String(entry.createdAt)>String(lastEntryAt))lastEntryAt=entry.createdAt;
  });

  var concept=summarizeText(workflow.conceptMarkdown||'',220);
  var plan=summarizeText(workflow.planMarkdown||'',220);
  var tasks=summarizeText(workflow.tasksSummary||'',220);
  var updatedAt=protocol.updatedAt||lastEntryAt||'';

  return {
    status:protocol.status,
    closedAt:protocol.closedAt||'',
    updatedAt:updatedAt,
    entries:entries,
    concept:concept,
    plan:plan,
    tasks:tasks
  };
}

function openMeetingForProject(projectId){
  var id=String(projectId||'').trim();
  if(!id)return;
  var project=window.DataLayer.getProjectById(id);
  if(!project)return;

  try {
    window.localStorage.setItem(MEETING_ACTIVE_PROJECT_KEY,id);
  } catch(_err){}

  if(window.MeetingModule&&typeof window.MeetingModule.openProject==='function'){
    window.MeetingModule.openProject(id);
  }

  if(window.location.hash!=='#page=meeting'){
    window.location.hash='page=meeting';
  }
}

function toggleMeetingProtocolStatus(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var protocol=ensureProjectMeetingProtocol(project);
  var nowIso=new Date().toISOString();
  var nextStatus=protocol.status==='closed'?'open':'closed';

  protocol.status=nextStatus;
  protocol.updatedAt=nowIso;
  protocol.closedAt=nextStatus==='closed'?nowIso:'';

  window.DataLayer.updateProject(project);
  notify('Meeting-Protokoll fuer '+getProjectTitle(project)+' ist jetzt '+(nextStatus==='closed'?'Closed':'Open')+'.','info');
  render();
}

function setLiveMessage(message){
  var live=byId('projects-live-region');
  if(live)live.textContent=message||'';
}

function notify(message,type){
  setLiveMessage(message);
  if(window.QuickTaskModule&&typeof window.QuickTaskModule.showToast==='function'){
    window.QuickTaskModule.showToast(message,type==='error');
    return;
  }
  if(type==='error'){
    alert(message);
  } else {
    console.log('[Projects]',message);
  }
}

function getAiBackendCandidates(){
  var origin=(window.location&&window.location.origin)?window.location.origin:'';
  var bases=[];
  if(origin)bases.push(origin);
  if(AI_BACKEND_URL)bases.push(AI_BACKEND_URL);
  if('http://localhost:8766'!==AI_BACKEND_URL)bases.push('http://localhost:8766');
  if('http://127.0.0.1:8766'!==AI_BACKEND_URL)bases.push('http://127.0.0.1:8766');
  if('http://127.0.0.1:8765'!==AI_BACKEND_URL)bases.push('http://127.0.0.1:8765');
  return bases.filter(function(item,idx){return item&&bases.indexOf(item)===idx;});
}

function isFallbackableStatus(status){
  return status===404||status===405||status===501;
}

function fetchJsonWithFallback(path,options){
  var bases=getAiBackendCandidates();
  if(bases.length===0)bases.push(AI_BACKEND_URL);
  var requestOptions=options||{};
  var requestHeaders={};
  if(requestOptions.headers&&typeof requestOptions.headers==='object'){
    requestHeaders=requestOptions.headers;
  }

  function tryBase(index,lastError){
    if(index>=bases.length){
      return Promise.reject(lastError||new Error('Kein KI-Backend erreichbar.'));
    }
    var endpoint=bases[index]+path;
    return fetch(endpoint,{method:'GET',headers:requestHeaders}).then(function(res){
      return res.json().catch(function(){return {};}).then(function(body){
        if(!res.ok){
          var err=new Error(body&&body.error?body.error:'HTTP '+res.status+' an '+endpoint);
          if(isFallbackableStatus(res.status))return tryBase(index+1,err);
          throw err;
        }
        return {body:body,endpoint:endpoint};
      });
    }).catch(function(err){
      if(index+1<bases.length)return tryBase(index+1,err);
      throw err;
    });
  }

  return tryBase(0,null);
}

function postJsonWithFallback(path,payload){
  var bases=getAiBackendCandidates();
  if(bases.length===0)bases.push(AI_BACKEND_URL);

  function tryBase(index,lastError){
    if(index>=bases.length){
      return Promise.reject(lastError||new Error('Kein KI-Backend erreichbar.'));
    }
    var endpoint=bases[index]+path;
    return fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(function(res){
      return res.json().catch(function(){return {};}).then(function(body){
        if(!res.ok){
          var fallbackable=isFallbackableStatus(res.status);
          var err=new Error(body&&body.error?body.error:'HTTP '+res.status+' an '+endpoint);
          if(fallbackable)return tryBase(index+1,err);
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

function statusClassFromState(state){
  if(state==='ok')return 'ok';
  if(state==='error')return 'error';
  return 'unknown';
}

function statusTextFromState(state){
  if(state==='ok')return 'OK';
  if(state==='error')return 'Fehler';
  return 'Unbekannt';
}

function isModelAvailableInHealth(model){
  var target=(model||'').trim();
  if(!target)return null;
  if(AI_HEALTH_STATE.ollamaStatus!=='ok')return null;
  if(!Array.isArray(AI_HEALTH_STATE.models)||!AI_HEALTH_STATE.models.length)return null;

  var found=AI_HEALTH_STATE.models.some(function(item){
    var byName=item&&item.name?String(item.name).trim():'';
    var byModel=item&&item.model?String(item.model).trim():'';
    return byName===target||byModel===target;
  });

  return found;
}

function getAvailableOllamaModels(){
  var names=[];
  if(!Array.isArray(AI_HEALTH_STATE.models))return names;
  AI_HEALTH_STATE.models.forEach(function(item){
    var value='';
    if(item&&item.name)value=String(item.name).trim();
    if(!value&&item&&item.model)value=String(item.model).trim();
    if(value&&names.indexOf(value)===-1)names.push(value);
  });
  names.sort(function(a,b){
    return a.localeCompare(b);
  });
  return names;
}

function renderModelOptions(selectedModel){
  var models=getAvailableOllamaModels();
  var selected=(selectedModel||'').trim()||DEFAULT_OLLAMA_MODEL;
  var html='';
  var hasSelected=models.indexOf(selected)!==-1;

  if(!hasSelected){
    html+='<option value="'+escapeHtml(selected)+'" selected>'+escapeHtml(selected)+' (gespeichert)</option>';
  }

  if(models.length===0){
    html+='<option value="'+escapeHtml(selected)+'" '+(hasSelected?'selected':'')+'>Keine Modelle aus Health-Check gefunden</option>';
    return html;
  }

  models.forEach(function(model){
    var isSelected=model===selected;
    html+='<option value="'+escapeHtml(model)+'" '+(isSelected?'selected':'')+'>'+escapeHtml(model)+'</option>';
  });

  return html;
}

function refreshAiHealthStatus(force){
  var checkedAtTs=AI_HEALTH_STATE.checkedAt?Date.parse(AI_HEALTH_STATE.checkedAt):0;
  var cacheValid=checkedAtTs&&((Date.now()-checkedAtTs)<45000)&&AI_HEALTH_STATE.backendStatus!=='unknown';
  if(!force&&cacheValid)return Promise.resolve(AI_HEALTH_STATE);
  if(AI_HEALTH_STATE.loading&&AI_HEALTH_PROMISE)return AI_HEALTH_PROMISE;

  AI_HEALTH_STATE.loading=true;
  AI_HEALTH_PROMISE=fetchJsonWithFallback('/api/ai/health').then(function(result){
    var body=result.body||{};
    AI_HEALTH_STATE.endpoint=result.endpoint||'';
    AI_HEALTH_STATE.checkedAt=new Date().toISOString();
    AI_HEALTH_STATE.models=Array.isArray(body.models)?body.models:[];
    AI_HEALTH_STATE.backendStatus='ok';
    if(body.status==='ok'){
      AI_HEALTH_STATE.ollamaStatus='ok';
      AI_HEALTH_STATE.error='';
    } else {
      AI_HEALTH_STATE.ollamaStatus='error';
      AI_HEALTH_STATE.error=body.error||'Ollama meldet keinen OK-Status.';
    }
    AI_HEALTH_STATE.loading=false;
    return AI_HEALTH_STATE;
  }).catch(function(err){
    AI_HEALTH_STATE.checkedAt=new Date().toISOString();
    AI_HEALTH_STATE.backendStatus='error';
    AI_HEALTH_STATE.ollamaStatus='unknown';
    AI_HEALTH_STATE.models=[];
    AI_HEALTH_STATE.error=err&&err.message?err.message:String(err);
    AI_HEALTH_STATE.loading=false;
    throw err;
  });

  return AI_HEALTH_PROMISE;
}

function getTasksForProject(projectId){
  return window.DataLayer.getTasks().filter(function(task){return task.projectId===projectId;});
}

function hasEmployeeActiveTask(projectId){
  return getTasksForProject(projectId).some(function(task){
    if(!task)return false;
    if(String(task.status||'').toLowerCase()!=='in-progress')return false;
    var assigneeId=String(task.assigneeId||task.employeeId||'').trim();
    return !!assigneeId;
  });
}

function getLatestEmployeeActiveTaskTimestamp(projectId){
  var latest=0;
  getTasksForProject(projectId).forEach(function(task){
    if(!task)return;
    if(String(task.status||'').toLowerCase()!=='in-progress')return;
    var assigneeId=String(task.assigneeId||task.employeeId||'').trim();
    if(!assigneeId)return;
    var ts=Date.parse(task.updatedAt||task.createdAt||task.startedAt||'');
    if(!isNaN(ts)&&ts>latest)latest=ts;
  });
  return latest;
}

function getEventsForProject(projectId){
  if(!window.DataLayer.getCalendarEvents)return [];
  return window.DataLayer.getCalendarEvents().filter(function(evt){return evt.projectId===projectId;});
}

function getEmployeesForTasks(tasks){
  var employees=window.DataLayer.getEmployees();
  var byIdMap={};
  employees.forEach(function(emp){byIdMap[emp.id]=emp;});
  var seen={};
  var list=[];
  tasks.forEach(function(task){
    if(task.assigneeId&&byIdMap[task.assigneeId]&&!seen[task.assigneeId]){
      seen[task.assigneeId]=true;
      list.push(byIdMap[task.assigneeId]);
    }
  });
  return list;
}

function sanitizeGitHubUsername(value){
  var username=String(value||'').trim();
  if(!username)return '';
  username=username.replace(/^@+/,'');
  username=username.replace(/\/$/,'');
  username=username.replace(/[^A-Za-z0-9-]/g,'');
  return username;
}

function extractGitHubUsername(value){
  var input=String(value||'').trim();
  if(!input)return '';
  var direct=sanitizeGitHubUsername(input);
  if(direct&&direct.indexOf('githubcom')===-1&&input.indexOf('http')!==0){
    return direct;
  }
  var match=input.match(/github\.com\/([^\/#?]+)/i);
  if(match&&match[1])return sanitizeGitHubUsername(match[1]);
  return direct;
}

function getEmployeeGitHubAvatarUrl(employee){
  if(!employee||!employee.github||typeof employee.github!=='object')return '';
  var github=employee.github;
  var avatarUrl=typeof github.avatarUrl==='string'?github.avatarUrl.trim():'';
  if(avatarUrl)return avatarUrl;
  var username=sanitizeGitHubUsername(github.username||extractGitHubUsername(github.profileUrl||''));
  if(!username)return '';
  return 'https://github.com/'+encodeURIComponent(username)+'.png?size=200';
}

function getEmployeeInitials(name){
  var text=String(name||'').trim();
  if(!text)return 'NA';
  var parts=text.split(/\s+/).filter(Boolean);
  if(!parts.length)return 'NA';
  return parts.slice(0,2).map(function(part){return part.charAt(0).toUpperCase();}).join('');
}

function getTaskCompletionTimestamp(task){
  var fallback=Date.parse(task&&task.updatedAt||task&&task.createdAt||'')||0;
  if(!task||!Array.isArray(task.history))return fallback;
  for(var i=task.history.length-1;i>=0;i--){
    var entry=task.history[i];
    if((entry&&entry.type)==='completed'||(entry&&entry.status)==='done'){
      var doneTs=Date.parse(entry.at||'');
      return isNaN(doneTs)?fallback:doneTs;
    }
  }
  return fallback;
}

function getTaskPriorityWeight(priority){
  var map={blocker:4,high:3,medium:2,low:1};
  return map[String(priority||'').toLowerCase()]||0;
}

function getTaskDueTimestamp(task){
  if(!task||!task.dueDate)return Number.POSITIVE_INFINITY;
  var ts=Date.parse(task.dueDate);
  return isNaN(ts)?Number.POSITIVE_INFINITY:ts;
}

function getProjectTimelineDayTimestamp(value){
  var text=String(value||'').trim();
  if(!text)return NaN;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return Date.parse(text+'T12:00:00');
  return Date.parse(text);
}

function getStartOfDayTimestamp(ts){
  var date=new Date(ts);
  date.setHours(0,0,0,0);
  return date.getTime();
}

function getStartOfWeekTimestamp(ts){
  var date=new Date(ts);
  date.setHours(0,0,0,0);
  var weekday=(date.getDay()+6)%7;
  date.setDate(date.getDate()-weekday);
  return date.getTime();
}

function formatProjectTimelineRelativeLabel(dayDelta){
  if(dayDelta<0)return 'Vor '+Math.abs(dayDelta)+' Tag'+(Math.abs(dayDelta)===1?'':'en');
  if(dayDelta===0)return 'Heute';
  if(dayDelta===1)return 'Morgen';
  return 'In '+dayDelta+' Tagen';
}

function formatProjectTimelineDateLabel(item){
  var label=formatDate(item.date);
  if(item.startTime)label+=' · '+item.startTime;
  return label;
}

function formatProjectTimelineWeekRangeLabel(startTs){
  var startDate=new Date(startTs);
  var endDate=new Date(startTs);
  endDate.setDate(endDate.getDate()+6);
  var startLabel=startDate.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  var endLabel=endDate.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
  return startLabel+' - '+endLabel;
}

function getProjectTimelineWeekdayShort(index){
  return ['Mo','Di','Mi','Do','Fr','Sa','So'][index]||'';
}

function getProjectTimelineCompactTitle(title){
  var text=String(title||'').replace(/^Task:\s*/i,'').replace(/^Meilenstein:\s*/i,'').trim();
  if(text.length<=26)return text;
  return text.slice(0,23).trim()+'...';
}

function renderProjectTimelineDayPopover(entries){
  if(!entries.length){
    return '<div class="project-head-timeline-week-day-popover" aria-hidden="true">'
      +'<p class="project-head-timeline-week-day-popover-empty">Keine Termine</p>'
    +'</div>';
  }

  var items=entries.map(function(item){
    return '<li class="project-head-timeline-week-day-popover-item'+(item.isThisWeek?' is-highlight':'')+'">'
      +'<span class="project-head-timeline-week-day-popover-time">'+escapeHtml(item.startTime||'Ganztags')+'</span>'
      +'<span class="project-head-timeline-week-day-popover-title">'+escapeHtml(getProjectTimelineCompactTitle(item.title))+'</span>'
    +'</li>';
  });

  return '<div class="project-head-timeline-week-day-popover" aria-hidden="true">'
    +'<ul class="project-head-timeline-week-day-popover-list">'+items.join('')+'</ul>'
  +'</div>';
}

function renderProjectTimelineWeekCalendar(preview){
  var merged=Array.isArray(preview&&preview.allItems)?preview.allItems:[];
  var now=Date.now();
  var todayStart=getStartOfDayTimestamp(now);
  var upcoming=merged.filter(function(item){return item.dayDelta>=0;});
  var anchorTimestamp=upcoming[0]?upcoming[0].timestamp:(merged[0]?merged[0].timestamp:now);
  var weekStart=getStartOfWeekTimestamp(anchorTimestamp);
  var agendaItems=[];
  var dayCells=[];

  for(var dayIndex=0;dayIndex<7;dayIndex++){
    var dayTs=weekStart+(dayIndex*24*60*60*1000);
    var dayStart=getStartOfDayTimestamp(dayTs);
    var entries=merged.filter(function(item){
      return getStartOfDayTimestamp(item.timestamp)===dayStart;
    }).sort(function(a,b){return a.timestamp-b.timestamp;});
    var isToday=dayStart===todayStart;
    var badgeHtml=entries.length?'<span class="project-head-timeline-week-count">'+entries.length+'</span>':'';
    var dayLabel=getProjectTimelineWeekdayShort(dayIndex);
    var dateLabel=new Date(dayTs).toLocaleDateString('de-DE',{day:'2-digit'});
    var popoverHtml=renderProjectTimelineDayPopover(entries);
    var dayAria=dayLabel+' '+dateLabel+'. '+(entries.length?(entries.length+' Termin'+(entries.length===1?'':'e')):'Keine Termine');
    dayCells.push(
      '<div class="project-head-timeline-week-day'+(entries.length?' has-entry':'')+(isToday?' is-today':'')+'" tabindex="0" aria-label="'+escapeHtml(dayAria)+'">'
        +'<span class="project-head-timeline-weekday">'+dayLabel+'</span>'
        +'<span class="project-head-timeline-weekdate">'+dateLabel+'</span>'
        +badgeHtml
        +popoverHtml
      +'</div>'
    );

    entries.forEach(function(item){
      agendaItems.push(
        '<li class="project-head-timeline-week-agenda-item'+(item.isThisWeek?' is-highlight':'')+'">'
          +'<span class="project-head-timeline-week-agenda-day">'+dayLabel+'</span>'
          +'<span class="project-head-timeline-week-agenda-time">'+escapeHtml(item.startTime||'Ganztags')+'</span>'
          +'<span class="project-head-timeline-week-agenda-title">'+escapeHtml(getProjectTimelineCompactTitle(item.title))+'</span>'
        +'</li>'
      );
    });
  }

  if(!agendaItems.length){
    agendaItems.push('<li class="project-head-timeline-week-agenda-empty">Keine Termine in dieser Woche.</li>');
  }

  return '<div class="project-head-timeline-week">'
    +'<div class="project-head-timeline-week-head">'
      +'<span class="project-head-timeline-week-kicker">Wochenkalender</span>'
      +'<span class="project-head-timeline-week-range">'+escapeHtml(formatProjectTimelineWeekRangeLabel(weekStart))+'</span>'
    +'</div>'
    +'<div class="project-head-timeline-week-grid">'+dayCells.join('')+'</div>'
    +'<ul class="project-head-timeline-week-agenda">'+agendaItems.join('')+'</ul>'
  +'</div>';
}

function buildProjectTimelinePreview(project, limit){
  var maxItems=Math.max(1, Number(limit)||3);
  var now=Date.now();
  var todayStart=getStartOfDayTimestamp(now);
  var nextWeekStart=getStartOfWeekTimestamp(now)+(7*24*60*60*1000);
  var executionPlan=ensureProjectExecutionPlan(project);
  var merged=[];
  var seen={};

  function pushItem(raw, sourceKind){
    var date=String(raw&&raw.date||raw&&raw.startDate||raw&&raw.releaseDate||'').trim();
    var ts=getProjectTimelineDayTimestamp(date);
    if(!date||isNaN(ts))return;
    var title=String(raw&&raw.title||'').trim();
    if(!title)return;
    var normalizedTitle=title.replace(/^Meilenstein:\s*/i,'').trim();
    var kind=sourceKind==='milestone'?'milestone':'event';
    var key=kind+'|'+date+'|'+normalizedTitle.toLowerCase();
    if(seen[key])return;
    seen[key]=true;

    var dayDelta=Math.round((getStartOfDayTimestamp(ts)-todayStart)/(24*60*60*1000));
    var isThisWeek=ts>=todayStart && ts<nextWeekStart;
    merged.push({
      kind:kind,
      title:normalizedTitle,
      date:date,
      startTime:String(raw&&raw.startTime||'').trim(),
      timestamp:ts,
      dayDelta:dayDelta,
      isThisWeek:isThisWeek,
      typeLabel:kind==='milestone'?'Meilenstein':'Termin',
      relativeLabel:formatProjectTimelineRelativeLabel(dayDelta)
    });
  }

  getEventsForProject(project.id).forEach(function(item){
    var type=String(item&&item.type||'').toLowerCase();
    pushItem(item, type==='release'?'milestone':'event');
  });

  if(executionPlan.milestoneDraft&&Array.isArray(executionPlan.milestoneDraft.items)){
    executionPlan.milestoneDraft.items.forEach(function(item){
      pushItem(item,'milestone');
    });
  }

  var upcoming=merged.filter(function(item){return item.dayDelta>=0;}).sort(function(a,b){
    return a.timestamp-b.timestamp;
  });
  var recentPast=merged.filter(function(item){return item.dayDelta<0;}).sort(function(a,b){
    return b.timestamp-a.timestamp;
  });
  var items=upcoming.slice(0,maxItems);
  if(items.length<maxItems)items=items.concat(recentPast.slice(0,maxItems-items.length));

  return {
    items:items,
    allItems:merged.slice().sort(function(a,b){return a.timestamp-b.timestamp;}),
    totalCount:merged.length,
    upcomingCount:upcoming.length,
    thisWeekCount:upcoming.filter(function(item){return item.isThisWeek;}).length
  };
}

function renderProjectCardHeadTimeline(project){
  var preview=buildProjectTimelinePreview(project,3);
  var summaryParts=[];
  if(preview.upcomingCount)summaryParts.push(preview.upcomingCount+' anstehend');
  if(preview.thisWeekCount)summaryParts.push(preview.thisWeekCount+' diese Woche');
  var summaryText=preview.totalCount?(summaryParts.join(' · ')||'Zuletzt geplant'):'Keine Termine geplant';
  var itemsHtml='';
  if(preview.items.length){
    itemsHtml=preview.items.map(function(item){
      var toneClass=item.dayDelta<0?'is-past':(item.isThisWeek?'is-this-week':(item.dayDelta<=14?'is-upcoming':''));
      return '<li class="project-head-timeline-item '+toneClass+'">'
        +'<span class="project-head-timeline-type">'+escapeHtml(item.typeLabel)+'</span>'
        +'<strong class="project-head-timeline-title">'+escapeHtml(item.title)+'</strong>'
        +'<div class="project-head-timeline-meta">'
        +'<span class="project-head-timeline-date">'+escapeHtml(formatProjectTimelineDateLabel(item))+'</span>'
        +'<span class="project-head-timeline-countdown">'+escapeHtml(item.relativeLabel)+'</span>'
        +'</div>'
        +'</li>';
    }).join('');
  }else{
    itemsHtml='<li class="project-head-timeline-empty">Keine Termine oder Meilensteine geplant.</li>';
  }

  return '<aside class="project-head-timeline" aria-label="Projekttermine">'
    +'<div class="project-head-timeline-head">'
    +'<span class="project-head-timeline-kicker">Termine & Meilensteine</span>'
    +'<span class="project-head-timeline-summary">'+escapeHtml(summaryText)+'</span>'
    +'</div>'
    +'<ul class="project-head-timeline-list">'+itemsHtml+'</ul>'
    +renderProjectTimelineWeekCalendar(preview)
    +'</aside>';
}

function buildProjectHeadTaskSummary(project){
  var tasks=getTasksForProject(project.id).slice();
  var employees=(window.DataLayer&&typeof window.DataLayer.getEmployees==='function')?window.DataLayer.getEmployees():[];
  var employeeById={};
  employees.forEach(function(emp){
    if(emp&&emp.id)employeeById[String(emp.id)]=emp;
  });

  var activeTasks=tasks.filter(function(task){return task&&task.status==='in-progress';});
  activeTasks.sort(function(a,b){
    var delta=(Date.parse(b.updatedAt||b.createdAt||'')||0)-(Date.parse(a.updatedAt||a.createdAt||'')||0);
    if(delta!==0)return delta;
    return getTaskPriorityWeight(b.priority)-getTaskPriorityWeight(a.priority);
  });

  var doneTasks=tasks.filter(function(task){return task&&task.status==='done';});
  doneTasks.sort(function(a,b){
    return getTaskCompletionTimestamp(b)-getTaskCompletionTimestamp(a);
  });

  var nextTasks=tasks.filter(function(task){
    if(!task)return false;
    if(task.status==='done'||task.status==='in-progress')return false;
    return true;
  });
  nextTasks.sort(function(a,b){
    var dueDelta=getTaskDueTimestamp(a)-getTaskDueTimestamp(b);
    if(dueDelta!==0)return dueDelta;
    var aSeq=(typeof a.sequenceIndex==='number'&&a.sequenceIndex>0)?a.sequenceIndex:Number.MAX_SAFE_INTEGER;
    var bSeq=(typeof b.sequenceIndex==='number'&&b.sequenceIndex>0)?b.sequenceIndex:Number.MAX_SAFE_INTEGER;
    if(aSeq!==bSeq)return aSeq-bSeq;
    var prioDelta=getTaskPriorityWeight(b.priority)-getTaskPriorityWeight(a.priority);
    if(prioDelta!==0)return prioDelta;
    return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
  });

  var activeTask=activeTasks[0]||null;
  var lastDoneTask=doneTasks[0]||null;
  var nextTask=nextTasks[0]||null;
  if(!nextTask&&!activeTask){
    nextTask=tasks.filter(function(task){return task&&task.status!=='done';})[0]||null;
  }

  var contactEmployee=null;
  var contactTask=activeTask||nextTask||lastDoneTask;
  if(contactTask&&contactTask.assigneeId&&employeeById[String(contactTask.assigneeId)]){
    contactEmployee=employeeById[String(contactTask.assigneeId)];
  }

  if(!contactEmployee){
    var teamMembers=normalizeProjectTeamMembers(project);
    if(teamMembers.length&&employeeById[String(teamMembers[0].employeeId)]){
      contactEmployee=employeeById[String(teamMembers[0].employeeId)];
    }
  }

  return {
    activeTask:activeTask,
    lastDoneTask:lastDoneTask,
    nextTask:nextTask,
    contactEmployee:contactEmployee
  };
}

function getProjectHeadTaskMeta(task, kind){
  if(!task)return '';
  if(kind==='done'){
    var doneTs=getTaskCompletionTimestamp(task);
    return doneTs?('Erledigt '+formatDateTime(new Date(doneTs).toISOString())):'';
  }
  if(kind==='active'){
    if(task.dueDate)return 'Faellig '+formatDate(task.dueDate);
    return 'Aktiv';
  }
  if(task.dueDate)return 'Faellig '+formatDate(task.dueDate);
  return 'Geplant';
}

function renderProjectHeadTaskRow(label, task, kind, emptyText){
  var title=task&&task.title?task.title:emptyText;
  var meta=task?getProjectHeadTaskMeta(task,kind):'';
  return '<li class="project-head-task-row">'
    +'<span class="project-head-task-label">'+escapeHtml(label)+'</span>'
    +'<span class="project-head-task-title">'+escapeHtml(title)+'</span>'
    +(meta?'<span class="project-head-task-meta">'+escapeHtml(meta)+'</span>':'')
    +'</li>';
}

function renderProjectHeadContact(summary){
  var employee=summary&&summary.contactEmployee?summary.contactEmployee:null;
  if(!employee){
    return '<div class="project-head-contact">'
      +'<span class="project-head-contact-label">Ansprechpartner</span>'
      +'<div class="project-head-contact-user">'
      +'<span class="project-head-contact-avatar">NA</span>'
      +'<span class="project-head-contact-name">Nicht zugewiesen</span>'
      +'</div></div>';
  }

  var name=employee.name||'Unbekannt';
  var initials=getEmployeeInitials(name);
  var avatarUrl=getEmployeeGitHubAvatarUrl(employee);
  var avatarHtml='<span class="project-head-contact-avatar" aria-hidden="true">'+escapeHtml(initials)+'</span>';
  if(avatarUrl){
    var safeUrl=String(avatarUrl).replace(/'/g,'%27');
    avatarHtml='<span class="project-head-contact-avatar project-head-contact-avatar-image" style="background-image:url(\''+escapeHtml(safeUrl)+'\')" aria-hidden="true"></span>';
  }

  return '<div class="project-head-contact">'
    +'<span class="project-head-contact-label">Ansprechpartner</span>'
    +'<div class="project-head-contact-user">'
    +avatarHtml
    +'<span class="project-head-contact-name">'+escapeHtml(name)+'</span>'
    +'</div></div>';
}

function progressToneClass(progress){
  if(progress>=75)return 'is-strong';
  if(progress>=40)return 'is-mid';
  return 'is-low';
}

function renderProjectHeadProgress(project, summary){
  var flow=calculateProjectFlowMetrics(project);
  var progress=getProjectProgressValue(project,flow);
  var toneClass=progressToneClass(progress);
  var isRunning=!!(summary&&summary.activeTask);
  var stateClass=isRunning?'is-running':'is-idle';
  var liveHtml=isRunning
    ?'<span class="project-head-progress-live-dot" aria-label="Aktive Bearbeitung"></span><span class="project-head-progress-live-text">In Arbeit</span>'
    :'';

  return '<div class="project-head-progress '+toneClass+' '+stateClass+'">'
    +'<span class="project-head-progress-label">Aktueller Fortschritt</span>'
    +'<div class="project-head-progress-track" aria-hidden="true">'
    +'<span class="project-head-progress-fill" style="--project-progress:'+progress+'%;"></span>'
    +'</div>'
    +'<div class="project-head-progress-meta">'
    +'<span class="project-head-progress-value">'+progress+'%</span>'
    +liveHtml
    +'</div>'
    +'</div>';
}

function renderProjectCardHeadSummary(project){
  var summary=buildProjectHeadTaskSummary(project);
  var matrixHtml=renderProjectGitHubMatrixHeader(project);
  var taskListHtml=''
    +renderProjectHeadTaskRow('Zuletzt erledigt',summary.lastDoneTask,'done','Keine erledigte Aufgabe')
    +renderProjectHeadTaskRow('Aktive Aufgabe',summary.activeTask,'active','Keine aktive Aufgabe')
    +renderProjectHeadTaskRow('Naechste Aufgabe',summary.nextTask,'next','Keine naechste Aufgabe');

  return '<div class="project-card-head-summary">'
    +'<ul class="project-head-task-list">'+taskListHtml+'</ul>'
    +'<div class="project-head-matrix-slot">'+matrixHtml+'</div>'
    +'<div class="project-head-side">'
    +renderProjectHeadContact(summary)
    +renderProjectHeadProgress(project,summary)
    +'</div>'
    +'</div>';
}

function getSortedEmployeesForProjectTeam(){
  var employees=(window.DataLayer&&window.DataLayer.getEmployees?window.DataLayer.getEmployees():[])||[];
  return employees.slice().sort(function(a,b){
    return String(a&&a.name||'').localeCompare(String(b&&b.name||''),'de');
  });
}

function normalizeProjectTeamMembers(project){
  var employees=getSortedEmployeesForProjectTeam();
  var employeeById={};
  employees.forEach(function(emp){
    employeeById[emp.id]=emp;
  });

  var source=project&&Array.isArray(project.teamMembers)?project.teamMembers:[];
  var seen={};
  var team=[];
  source.forEach(function(member){
    if(!member||typeof member!=='object')return;
    var employeeId=String(member.employeeId||member.id||'').trim();
    if(!employeeId||seen[employeeId])return;
    seen[employeeId]=true;

    var employee=employeeById[employeeId]||{};
    var role=String(member.role||'').trim()||String(employee.role||'').trim();
    team.push({
      employeeId:employeeId,
      employeeName:String(employee.name||member.employeeName||'Unbekannt'),
      role:role
    });
  });

  return team;
}

function buildProjectTeamEmployeeOptions(selectedEmployeeId){
  var options='<option value="">Mitarbeiter waehlen</option>';
  getSortedEmployeesForProjectTeam().forEach(function(emp){
    var id=String(emp.id||'');
    var selected=id===String(selectedEmployeeId||'')?' selected':'';
    var roleSuffix=emp.role?' ('+escapeHtml(emp.role)+')':'';
    options+='<option value="'+escapeHtml(id)+'"'+selected+'>'+escapeHtml(emp.name||'Unbenannt')+roleSuffix+'</option>';
  });
  return options;
}

function readProjectTeamRowsFromForm(){
  var container=byId('project-team-rows');
  if(!container)return [];

  var rows=container.querySelectorAll('.project-team-row');
  var data=[];
  rows.forEach(function(row){
    var employeeSelect=row.querySelector('.project-team-employee');
    var roleInput=row.querySelector('.project-team-role');
    data.push({
      employeeId:employeeSelect&&employeeSelect.value?String(employeeSelect.value).trim():'',
      role:roleInput&&roleInput.value?String(roleInput.value).trim():''
    });
  });
  return data;
}

function renderProjectTeamRows(rows){
  var container=byId('project-team-rows');
  if(!container)return;

  var source=Array.isArray(rows)?rows:[];
  if(source.length===0)source=[{employeeId:'',role:''}];

  container.innerHTML=source.map(function(member,index){
    var employeeId=String(member&&member.employeeId||'').trim();
    var role=String(member&&member.role||'').trim();
    return ''
      +'<div class="project-team-row" data-index="'+index+'">'
      +'<select class="project-team-employee">'+buildProjectTeamEmployeeOptions(employeeId)+'</select>'
      +'<input type="text" class="project-team-role" placeholder="Projektrolle (z. B. Product Owner)" value="'+escapeHtml(role)+'">'
      +'<button type="button" class="btn btn-secondary" data-action="remove-team-row" data-index="'+index+'" '+(source.length===1?'disabled':'')+'>Entfernen</button>'
      +'</div>';
  }).join('');
}

function readProjectTeamAssignmentsFromForm(){
  var rows=readProjectTeamRowsFromForm();
  var seen={};
  var team=[];

  rows.forEach(function(member){
    var employeeId=String(member.employeeId||'').trim();
    if(!employeeId)return;
    if(seen[employeeId]){
      throw new Error('Mitarbeiter darf pro Projekt nur einmal zugewiesen werden.');
    }
    seen[employeeId]=true;
    team.push({
      employeeId:employeeId,
      role:String(member.role||'').trim()
    });
  });

  return team;
}

function addProjectTeamRow(){
  var rows=readProjectTeamRowsFromForm();
  rows.push({employeeId:'',role:''});
  renderProjectTeamRows(rows);
}

function removeProjectTeamRow(index){
  var rows=readProjectTeamRowsFromForm();
  var targetIndex=Number(index);
  if(isNaN(targetIndex))return;

  var next=rows.filter(function(_row,rowIndex){
    return rowIndex!==targetIndex;
  });
  renderProjectTeamRows(next);
}

function buildGitHubHeaders(token,includeApiVersion){
  var headers={'Accept':'application/vnd.github+json'};
  if(includeApiVersion!==false){
    headers['X-GitHub-Api-Version']='2022-11-28';
  }
  if(token)headers['Authorization']='token '+token;
  return headers;
}

function getCurrentUserGitHubToken(){
  var auth=getAuthManager();
  if(!auth||typeof auth.getCurrentUser!=='function')return '';
  var user=auth.getCurrentUser();
  if(!user||!user.github||typeof user.github!=='object')return '';
  return String(user.github.privateAccessToken||'').trim();
}

function getGitHubApiToken(){
  var token='';
  var primary=byId('project-github-token');
  var secondary=byId('github-bootstrap-token');
  if(primary&&primary.value)token=String(primary.value).trim();
  if(!token&&secondary&&secondary.value)token=String(secondary.value).trim();

  if(token){
    try { window.sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY,token); } catch(_err){}
    return token;
  }

  try {
    token=String(window.sessionStorage.getItem(GITHUB_TOKEN_SESSION_KEY)||'').trim();
  } catch(_err2){
    token='';
  }

  if(token)return token;

  token=getCurrentUserGitHubToken();
  if(token){
    try { window.sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY,token); } catch(_err3){}
  }
  return token;
}

function hasGitHubApiToken(){
  return !!getGitHubApiToken();
}

function buildPrivateRepoTokenHint(){
  return hasGitHubApiToken()
    ? ''
    : ' Fuer private Repositories bitte einen gueltigen GitHub Token setzen (Projektformular, Import-Dialog oder im Mitarbeiterprofil).';
}

function isGitHubEmptyRepoError(err){
  var message=String(err&&err.message||'').toLowerCase();
  return message.indexOf('repository is empty')!==-1||message.indexOf('git repository is empty')!==-1;
}

function setGitHubApiToken(token){
  var value=String(token||'').trim();
  var primary=byId('project-github-token');
  var secondary=byId('github-bootstrap-token');
  if(primary&&primary.value!==value)primary.value=value;
  if(secondary&&secondary.value!==value)secondary.value=value;
  try {
    if(value){
      window.sessionStorage.setItem(GITHUB_TOKEN_SESSION_KEY,value);
    } else {
      window.sessionStorage.removeItem(GITHUB_TOKEN_SESSION_KEY);
    }
  } catch(_err){}
}

function fetchGitHubViaBackend(path,token){
  return fetchJsonWithFallback(path,{
    headers:token?{'X-GitHub-Token':token}:{}
  }).then(function(result){
    return result&&result.body!==undefined?result.body:{};
  });
}

function fetchGitHubJson(url){
  var token=getGitHubApiToken();
  return fetch(url,{headers:buildGitHubHeaders(token,true)}).then(function(res){
    if(!res.ok){
      return res.json().catch(function(){return {};}).then(function(body){
        var apiMessage=body&&body.message?String(body.message):'';
        var msg=apiMessage||('HTTP '+res.status);
        if(res.status===404&&apiMessage.toLowerCase()==='not found'){
          msg='Repository nicht gefunden. Bitte GitHub-Link pruefen. Private Repositories sind ohne Authentifizierung nicht ueber die GitHub-API abrufbar.';
        } else if(res.status===403&&apiMessage.toLowerCase().indexOf('rate limit')!==-1){
          msg='GitHub API Rate Limit erreicht. Bitte spaeter erneut versuchen.';
        }
        throw new Error(msg);
      });
    }
    return res.json();
  });
}

function fetchRepoMeta(owner,repo){
  var token=getGitHubApiToken();
  var backendPath='/api/github/repo?owner='+encodeURIComponent(owner)+'&repo='+encodeURIComponent(repo);
  return fetchGitHubViaBackend(backendPath,token).then(function(body){
    return body||{};
  }).catch(function(){
    return fetchGitHubJson('https://api.github.com/repos/'+owner+'/'+repo);
  });
}

function fetchCommits(owner,repo,limit){
  var perPage=100;
  var maxItems=typeof limit==='number'&&limit>0?limit:0;
  var token=getGitHubApiToken();
  function mapCommitItems(items){
    if(!Array.isArray(items))return [];
    return items.map(function(item){
      var commit=item.commit||{};
      var author=commit.author||{};
      var committer=commit.committer||{};
      var githubAuthor=item.author||{};
      return {
        sha:item.sha||'',
        message:commit.message||'',
        author:(author.name||githubAuthor.login||'unknown'),
        authorLogin:githubAuthor.login||'',
        authorProfileUrl:githubAuthor.html_url||'',
        authorAvatarUrl:githubAuthor.avatar_url||'',
        authorEmail:author.email||'',
        date:(author.date||committer.date||new Date().toISOString()),
        url:item.html_url||''
      };
    });
  }

  function fetchCommitPage(page,collector){
    var currentPage=page||1;
    var collected=collector||[];
    var backendPath='/api/github/commits?owner='+encodeURIComponent(owner)+'&repo='+encodeURIComponent(repo)+'&per_page='+perPage+'&page='+currentPage;

    return fetchGitHubViaBackend(backendPath,token).catch(function(){
      return fetchGitHubJson('https://api.github.com/repos/'+owner+'/'+repo+'/commits?per_page='+perPage+'&page='+currentPage);
    }).then(function(items){
      var mapped=mapCommitItems(items);
      var nextCollected=collected.concat(mapped);
      if(mapped.length===perPage&&(!maxItems||nextCollected.length<maxItems)){
        return fetchCommitPage(currentPage+1,nextCollected);
      }
      return maxItems?nextCollected.slice(0,maxItems):nextCollected;
    }).catch(function(err){
      if(isGitHubEmptyRepoError(err)) return collected;
      throw err;
    });
  }

  return fetchCommitPage(1,[]);
}

function calculateGitHubMetrics(commits){
  var list=Array.isArray(commits)?commits:[];
  var total=list.length;
  var now=Date.now();
  var weekAgo=now-(7*24*60*60*1000);
  var monthAgo=now-(30*24*60*60*1000);
  var commits7d=0;
  var activeDaysMap={};
  var contributorsMap={};

  list.forEach(function(commit){
    var ts=Date.parse(commit.date||'');
    if(!isNaN(ts)){
      if(ts>=weekAgo)commits7d++;
      if(ts>=monthAgo){
        activeDaysMap[new Date(ts).toISOString().slice(0,10)]=true;
      }
    }
    var author=(commit.author||'unknown').trim();
    if(author)contributorsMap[author]=true;
  });

  var activeDays30=Object.keys(activeDaysMap).length;
  var contributors=Object.keys(contributorsMap).length;

  var oldest=list.length?Date.parse(list[list.length-1].date||''):NaN;
  var newest=list.length?Date.parse(list[0].date||''):NaN;
  var durationWeeks=(!isNaN(oldest)&&!isNaN(newest)&&newest>oldest)?Math.max(1,(newest-oldest)/(7*24*60*60*1000)):1;
  var avgCommitsPerWeek=total?Math.round((total/durationWeeks)*10)/10:0;

  return {
    totalCommits:total,
    commitsLast7Days:commits7d,
    activeDaysLast30Days:activeDays30,
    contributors:contributors,
    avgCommitsPerWeek:avgCommitsPerWeek,
    lastCommitAt:list.length?list[0].date:null,
    firstCommitAt:list.length?list[list.length-1].date:null,
    syncedAt:new Date().toISOString()
  };
}

function ensureProjectInfoHub(project){
  if(!project.infoHub||typeof project.infoHub!=='object'){
    project.infoHub={};
  }
  if(!Array.isArray(project.infoHub.attachments))project.infoHub.attachments=[];
  if(!Array.isArray(project.infoHub.notes))project.infoHub.notes=[];
  if(!Array.isArray(project.infoHub.links))project.infoHub.links=[];
  if(!Array.isArray(project.infoHub.secrets))project.infoHub.secrets=[];
  if(typeof project.infoHub.scratchpad!=='string')project.infoHub.scratchpad='';
  if(typeof project.infoHub.envText!=='string')project.infoHub.envText='';
  return project.infoHub;
}

function ensureProjectAiKnowledge(project){
  if(!project.aiKnowledge||typeof project.aiKnowledge!=='object'){
    project.aiKnowledge={};
  }
  if(typeof project.aiKnowledge.preferredModel!=='string'||!project.aiKnowledge.preferredModel.trim()){
    project.aiKnowledge.preferredModel=DEFAULT_OLLAMA_MODEL;
  }
  if(typeof project.aiKnowledge.lastStatus!=='string')project.aiKnowledge.lastStatus='idle';
  if(typeof project.aiKnowledge.lastGeneratedAt!=='string')project.aiKnowledge.lastGeneratedAt='';
  if(typeof project.aiKnowledge.filePath!=='string')project.aiKnowledge.filePath='';
  if(typeof project.aiKnowledge.lastError!=='string')project.aiKnowledge.lastError='';
  if(typeof project.aiKnowledge.lastModel!=='string')project.aiKnowledge.lastModel='';
  if(typeof project.aiKnowledge.sourceCommitSha!=='string')project.aiKnowledge.sourceCommitSha='';
  if(typeof project.aiKnowledge.lastKnowledgeSize!=='number')project.aiKnowledge.lastKnowledgeSize=0;
  if(typeof project.aiKnowledge.lastTaskDraftAt!=='string')project.aiKnowledge.lastTaskDraftAt='';
  if(typeof project.aiKnowledge.lastTaskDraftCount!=='number')project.aiKnowledge.lastTaskDraftCount=0;
  return project.aiKnowledge;
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

function getAssignableEmployeesForProject(project){
  var employees=window.DataLayer&&window.DataLayer.getEmployees?window.DataLayer.getEmployees():[];
  var projectTeam=normalizeProjectTeamMembers(project);
  var byId={};
  var list=[];

  projectTeam.forEach(function(member){
    var employeeId=String(member&&member.employeeId||'').trim();
    if(!employeeId||byId[employeeId])return;
    var found=employees.find(function(emp){return String(emp&&emp.id||'')===employeeId;});
    if(found){
      byId[employeeId]=true;
      list.push(found);
    }
  });

  employees.forEach(function(emp){
    var employeeId=String(emp&&emp.id||'').trim();
    if(!employeeId||byId[employeeId])return;
    byId[employeeId]=true;
    list.push(emp);
  });

  return list;
}

function buildAssigneeOptionsHtml(employees,selectedId){
  var options=['<option value="">Nicht zugewiesen</option>'];
  (employees||[]).forEach(function(emp){
    var id=String(emp&&emp.id||'').trim();
    if(!id)return;
    var isSelected=id===String(selectedId||'');
    var label=(emp.name||'Unbekannt')+(emp.role?' ('+emp.role+')':'');
    options.push('<option value="'+escapeHtml(id)+'"'+(isSelected?' selected':'')+'>'+escapeHtml(label)+'</option>');
  });
  return options.join('');
}

function fetchKnowledgeMarkdownSnippet(filePath,maxLength){
  var path=String(filePath||'').trim();
  if(!path||typeof fetch!=='function')return Promise.resolve('');
  var limit=Math.max(1200,Number(maxLength)||6000);
  return fetch(path,{method:'GET'}).then(function(res){
    if(!res.ok)return '';
    return res.text();
  }).then(function(text){
    var clean=String(text||'').trim();
    if(clean.length<=limit)return clean;
    return clean.slice(0,limit)+'\n\n[... gekuerzt ...]';
  }).catch(function(){
    return '';
  });
}

function normalizeAiKnowledgeTaskDraft(draft){
  var source=draft&&typeof draft==='object'?draft:{};
  var task=source.task&&typeof source.task==='object'?source.task:{};
  var suggestions=Array.isArray(source.taskSuggestions)?source.taskSuggestions:[];

  function toItem(item,index,isMain){
    var entry=item&&typeof item==='object'?item:{};
    var titleDe=String(entry.titleDe||'').trim();
    var titleEn=String(entry.titleEn||'').trim();
    var descriptionDe=String(entry.descriptionDe||'').trim();
    var descriptionEn=String(entry.descriptionEn||'').trim();
    var description='';
    if(descriptionDe&&descriptionEn&&descriptionDe!==descriptionEn){
      description='DE: '+descriptionDe+'\n\nEN: '+descriptionEn;
    }else{
      description=descriptionDe||descriptionEn;
    }

    var seq=Number(entry.sequenceIndex||0)||0;
    if(!seq)seq=index+1;
    return {
      title:titleDe||titleEn,
      description:description,
      priority:String(entry.priority||'medium').toLowerCase(),
      urgency:String(entry.urgency||'normal').toLowerCase(),
      effortHours:Number(entry.effortHours||0)||0,
      labels:Array.isArray(entry.labels)?entry.labels.map(function(label){return String(label||'').trim();}).filter(function(label){return !!label;}):[],
      sequenceIndex:seq,
      dependsOnPrevious:!!entry.dependsOnPrevious,
      note:String(entry.note||'').trim(),
      subtasks:Array.isArray(entry.subtasksDe)?entry.subtasksDe.map(function(line){return String(line||'').trim();}).filter(function(line){return !!line;}):[],
      assigneeId:String(entry.assigneeId||'').trim(),
      isMain:!!isMain
    };
  }

  var items=[];
  var mainItem=toItem(task,0,true);
  if(mainItem.title)items.push(mainItem);

  suggestions.forEach(function(item,idx){
    var next=toItem(item,idx+1,false);
    if(next.title)items.push(next);
  });

  items.sort(function(a,b){
    var aSeq=Number(a.sequenceIndex||0)||0;
    var bSeq=Number(b.sequenceIndex||0)||0;
    if(aSeq&&!bSeq)return -1;
    if(!aSeq&&bSeq)return 1;
    if(aSeq!==bSeq)return aSeq-bSeq;
    if(a.isMain&&!b.isMain)return -1;
    if(!a.isMain&&b.isMain)return 1;
    return 0;
  });

  return {
    summaryMarkdown:String(source.summaryMarkdown||'').trim(),
    items:items
  };
}

function buildAiKnowledgeDraftInput(project,aiState,focusText,knowledgeSnippet){
  var flow=calculateProjectFlowMetrics(project);
  var focus=String(focusText||'').trim();
  var lines=[];
  lines.push('Bitte leite aus dem zuletzt generierten Projektwissen konkrete naechste Aufgaben fuer das Projekt ab.');
  lines.push('Projekt: '+getProjectTitle(project));
  lines.push('Projektstatus: '+String(project.status||'planning'));
  lines.push('KI-Wissensdatei: '+String(aiState.filePath||'n/a'));
  lines.push('KI-Lauf: '+String(aiState.lastGeneratedAt||'n/a'));
  lines.push('Offene Aufgaben: '+(flow.tasksTotal-flow.statusCounts.done)+', In Progress: '+flow.statusCounts['in-progress']+', Due soon: '+flow.dueSoon+', Overdue: '+flow.overdue);
  if(focus)lines.push('Fokus fuer diesen Lauf: '+focus);
  lines.push('Erzeuge bevorzugt mehrere umsetzbare Aufgabenpakete mit klaren Prioritaeten und realistischem Aufwand.');
  if(knowledgeSnippet){
    lines.push('Auszug aus dem generierten Projektwissen:');
    lines.push(knowledgeSnippet);
  }
  return lines.join('\n\n');
}

function buildProjectKnowledgeSnapshot(project){
  var hub=ensureProjectInfoHub(project);
  var flow=calculateProjectFlowMetrics(project);
  var tasks=getTasksForProject(project.id);
  var events=getEventsForProject(project.id);
  var releases=window.DataLayer.getReleases().filter(function(item){return item.projectId===project.id;});
  var assignees=getEmployeesForTasks(tasks);
  var projectTeam=normalizeProjectTeamMembers(project);
  var assigneeMap={};
  assignees.forEach(function(emp){
    assigneeMap[emp.id]={id:emp.id,name:emp.name||'unknown',role:emp.role||''};
  });
  projectTeam.forEach(function(member){
    assigneeMap[member.employeeId]={
      id:member.employeeId,
      name:member.employeeName||'unknown',
      role:member.role||''
    };
  });

  var tasksForAi=tasks.map(function(task){
    return {
      id:task.id,
      title:task.title||'',
      description:task.description||'',
      status:task.status||'',
      priority:task.priority||'',
      assigneeId:task.assigneeId||'',
      assigneeName:task.assigneeId&&assigneeMap[task.assigneeId]?assigneeMap[task.assigneeId].name:'',
      dueDate:task.dueDate||'',
      labels:Array.isArray(task.labels)?task.labels:[],
      updatedAt:task.updatedAt||task.createdAt||''
    };
  });

  return {
    generatedAt:new Date().toISOString(),
    project:{
      id:project.id,
      title:getProjectTitle(project),
      description:project.description||'',
      status:project.status||'',
      startDate:project.startDate||'',
      endDate:project.endDate||''
    },
    github:{
      source:(project.github&&project.github.source)||'',
      url:(project.github&&project.github.url)||'',
      owner:(project.github&&project.github.owner)||'',
      repo:(project.github&&project.github.repo)||'',
      defaultBranch:(project.github&&project.github.defaultBranch)||'',
      metrics:project.githubMetrics||{},
      recentCommits:(project.githubCommits||[]).slice(0,25),
      repoMeta:project.githubRepoMeta||{}
    },
    flow:flow,
    team:{
      assignees:assigneeMap,
      projectRoles:projectTeam
    },
    tasks:tasksForAi,
    releases:releases.map(function(item){
      return {
        id:item.id,
        title:item.title||'',
        status:item.status||'',
        releaseDate:item.releaseDate||'',
        notes:item.notes||''
      };
    }),
    events:events.map(function(item){
      return {
        id:item.id,
        title:item.title||'',
        date:item.date||'',
        type:item.type||''
      };
    }),
    knowledge:{
      links:hub.links,
      notes:hub.notes,
      envSummary:parseEnvSummary(hub.envText),
      attachmentNames:hub.attachments.map(function(item){return {name:item.name,size:item.size||0,type:item.type||''};}),
      scratchpad:hub.scratchpad||''
    }
  };
}

function maskSecret(value){
  var len=(value||'').length;
  if(!len)return 'leer';
  if(len<=6)return '******';
  return value.slice(0,2)+new Array(Math.max(4,len-4)).join('*')+value.slice(-2);
}

function getAttachmentTotalSize(attachments){
  return (attachments||[]).reduce(function(sum,item){return sum+(item.size||0);},0);
}

function readFileAsDataUrl(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(evt){resolve(evt.target.result);};
    reader.onerror=function(){reject(new Error('Datei konnte nicht gelesen werden.'));};
    reader.readAsDataURL(file);
  });
}

function parseEnvSummary(envText){
  var lines=(envText||'').split(/\r?\n/);
  var keys=[];
  lines.forEach(function(line){
    var trimmed=(line||'').trim();
    if(!trimmed||trimmed.charAt(0)==='#')return;
    var idx=trimmed.indexOf('=');
    if(idx<=0)return;
    keys.push(trimmed.slice(0,idx).trim());
  });
  return {
    keyCount:keys.length,
    sample:keys.slice(0,4)
  };
}

function calculateProjectFlowMetrics(project){
  var tasks=getTasksForProject(project.id);
  var events=getEventsForProject(project.id);
  var releases=window.DataLayer.getReleases().filter(function(r){return r.projectId===project.id;});
  var taskAssignees=getEmployeesForTasks(tasks);
  var teamMembers=normalizeProjectTeamMembers(project);
  var assigneeMap={};
  taskAssignees.forEach(function(emp){
    assigneeMap[emp.id]={
      employeeId:emp.id,
      employeeName:emp.name||'Unbekannt',
      role:emp.role||''
    };
  });
  teamMembers.forEach(function(member){
    assigneeMap[member.employeeId]={
      employeeId:member.employeeId,
      employeeName:member.employeeName||'Unbekannt',
      role:member.role||assigneeMap[member.employeeId]&&assigneeMap[member.employeeId].role||''
    };
  });
  var assignees=Object.keys(assigneeMap).map(function(employeeId){return assigneeMap[employeeId];});
  var infoHub=ensureProjectInfoHub(project);

  var statusCounts={backlog:0,todo:0,'in-progress':0,review:0,done:0,other:0};
  var overdue=0;
  var dueSoon=0;
  var now=Date.now();

  tasks.forEach(function(task){
    if(statusCounts[task.status]===undefined)statusCounts.other++;
    else statusCounts[task.status]++;

    if(task.dueDate&&task.status!=='done'){
      var dueTs=Date.parse(task.dueDate);
      if(!isNaN(dueTs)){
        if(dueTs<now)overdue++;
        else if(dueTs<=now+(7*24*60*60*1000))dueSoon++;
      }
    }
  });

  var doneRatio=tasks.length?Math.round((statusCounts.done/tasks.length)*100):0;
  var commitsPerWeek=project.githubMetrics&&project.githubMetrics.avgCommitsPerWeek?project.githubMetrics.avgCommitsPerWeek:0;
  var rhythmScore=Math.min(100,Math.round((project.githubMetrics?project.githubMetrics.commitsLast7Days:0)*8 + (project.githubMetrics?project.githubMetrics.activeDaysLast30Days:0)*1.7));
  var deliveryScore=Math.min(100,Math.round(doneRatio*0.7 + Math.min(30,commitsPerWeek*3)));

  return {
    tasksTotal:tasks.length,
    statusCounts:statusCounts,
    dueSoon:dueSoon,
    overdue:overdue,
    releases:releases.length,
    events:events.length,
    assignees:assignees,
    teamMembers:teamMembers,
    doneRatio:doneRatio,
    rhythmScore:rhythmScore,
    deliveryScore:deliveryScore,
    attachmentCount:infoHub.attachments.length,
    noteCount:infoHub.notes.length,
    linkCount:infoHub.links.length,
    secretCount:infoHub.secrets.length,
    envSummary:parseEnvSummary(infoHub.envText)
  };
}

function classifyProgress(project,flow){
  var status=(project.status||'').toLowerCase();
  if(status==='done')return 'Abgeschlossen';
  if(status==='blocked')return 'Blockiert';

  var score=Math.round((flow.rhythmScore+flow.deliveryScore+getProjectProgressValue(project,flow))/3);
  if(score>=75)return 'Sehr guter Fortschritt';
  if(score>=50)return 'Stabiler Fortschritt';
  if(score>=30)return 'Fruehe Entwicklungsphase';
  return 'Kritischer Verlauf';
}

function renderProjectMetaGrid(items, emptyText){
  var rows=[];

  (items||[]).forEach(function(item){
    if(!item)return;
    if(item.value===null||item.value===undefined||item.value==='')return;

    rows.push('<div class="project-meta-item'+(item.className?' '+item.className:'')+'">'+
      '<span class="project-meta-label">'+escapeHtml(item.label)+'</span>'+
      '<span class="project-meta-value">'+(item.html?item.value:escapeHtml(String(item.value)))+'</span>'+
      '</div>');
  });

  if(!rows.length){
    return emptyText?'<p class="project-meta-empty">'+escapeHtml(emptyText)+'</p>':'';
  }

  return '<div class="project-meta-grid">'+rows.join('')+'</div>';
}

function renderOverview(){
  var container=byId('projects-overview');
  if(!container)return;

  var projects=getVisibleProjects();
  if(projects.length===0){
    container.innerHTML='';
    return;
  }

  var linked=projects.filter(function(p){return p.github&&p.github.url;}).length;
  var withMetrics=projects.filter(function(p){return p.githubMetrics&&p.githubMetrics.totalCommits>0;}).length;
  var totalCommits=projects.reduce(function(sum,p){
    return sum+((p.githubMetrics&&p.githubMetrics.totalCommits)||0);
  },0);

  var sensitiveCount=projects.reduce(function(sum,p){
    var hub=ensureProjectInfoHub(p);
    return sum+hub.secrets.length+hub.links.length+hub.attachments.length+hub.notes.length;
  },0);

  container.innerHTML=''
    +'<div class="overview-grid">'
    +'<div class="stat-card"><h3>Projekte</h3><div class="stat-value">'+projects.length+'</div></div>'
    +'<div class="stat-card"><h3>GitHub verknuepft</h3><div class="stat-value">'+linked+'</div></div>'
    +'<div class="stat-card"><h3>Mit Commit-Metriken</h3><div class="stat-value">'+withMetrics+'</div></div>'
    +'<div class="stat-card"><h3>Erfasste Commits</h3><div class="stat-value">'+totalCommits+'</div></div>'
    +'<div class="stat-card"><h3>Info-Eintraege</h3><div class="stat-value">'+sensitiveCount+'</div></div>'
    +'</div>';
}

function renderLinks(links,projectId){
  if(!links.length)return '<p class="text-muted">Keine Links hinterlegt.</p>';
  var html='<ul class="hub-list">';
  links.forEach(function(item){
    html+='<li>'
      +'<span><strong>'+escapeHtml(item.kind||'link')+':</strong> <a href="'+escapeHtml(item.url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(item.label||item.url)+'</a></span>'
      +'<button class="btn btn-secondary" data-action="delete-link" data-id="'+escapeHtml(projectId)+'" data-link-id="'+escapeHtml(item.id)+'">Entfernen</button>'
      +'</li>';
  });
  html+='</ul>';
  return html;
}

function renderSecrets(secrets,projectId){
  if(!secrets.length)return '<p class="text-muted">Keine sensiblen Daten hinterlegt.</p>';
  var html='<ul class="hub-list">';
  secrets.forEach(function(item){
    var viewKey=projectId+'::'+item.id;
    var reveal=!!SECRET_VIEW_STATE[viewKey];
    var visibleValue=reveal?item.value:maskSecret(item.value||'');
    html+='<li>'
      +'<span><strong>'+escapeHtml(item.category||'secret')+' / '+escapeHtml(item.label||'Eintrag')+':</strong> '
      +'<span class="secret-value">'+escapeHtml(visibleValue)+'</span></span>'
      +'<div class="project-actions-inline">'
      +'<button class="btn btn-secondary" data-action="toggle-secret" data-id="'+escapeHtml(projectId)+'" data-secret-id="'+escapeHtml(item.id)+'">'+(reveal?'Maskieren':'Anzeigen')+'</button>'
      +'<button class="btn btn-danger" data-action="delete-secret" data-id="'+escapeHtml(projectId)+'" data-secret-id="'+escapeHtml(item.id)+'">Entfernen</button>'
      +'</div>'
      +'</li>';
  });
  html+='</ul>';
  return html;
}

function renderAttachments(attachments,projectId){
  if(!attachments.length)return '<p class="text-muted">Keine Dateien angehaengt.</p>';
  var html='<ul class="hub-list">';
  attachments.forEach(function(item){
    html+='<li>'
      +'<span><strong>'+escapeHtml(item.name)+'</strong> ('+formatBytes(item.size)+') · '+formatDateTime(item.uploadedAt)+'</span>'
      +'<div class="project-actions-inline">'
      +'<button class="btn btn-secondary" data-action="download-attachment" data-id="'+escapeHtml(projectId)+'" data-attachment-id="'+escapeHtml(item.id)+'">Download</button>'
      +'<button class="btn btn-danger" data-action="delete-attachment" data-id="'+escapeHtml(projectId)+'" data-attachment-id="'+escapeHtml(item.id)+'">Entfernen</button>'
      +'</div>'
      +'</li>';
  });
  html+='</ul>';
  return html;
}

function renderNotes(notes,projectId){
  if(!notes.length)return '<p class="text-muted">Noch keine Notizen.</p>';
  var html='<ul class="hub-list notes">';
  notes.forEach(function(item){
    html+='<li>'
      +'<span><strong>'+escapeHtml(item.title||'Notiz')+':</strong> '+escapeHtml(item.text||'')+'</span>'
      +'<div class="project-actions-inline">'
      +'<button class="btn btn-secondary" data-action="edit-note" data-id="'+escapeHtml(projectId)+'" data-note-id="'+escapeHtml(item.id)+'">Bearbeiten</button>'
      +'<button class="btn btn-danger" data-action="delete-note" data-id="'+escapeHtml(projectId)+'" data-note-id="'+escapeHtml(item.id)+'">Entfernen</button>'
      +'</div>'
      +'</li>';
  });
  html+='</ul>';
  return html;
}

function renderInfoHub(project,flow){
  var hub=ensureProjectInfoHub(project);
  var aiState=ensureProjectAiKnowledge(project);
  var hasGithubLink=!!(project.github&&project.github.url);
  var envSummary=parseEnvSummary(hub.envText);
  var selectedModel=aiState.preferredModel||DEFAULT_OLLAMA_MODEL;
  var modelAvailable=isModelAvailableInHealth(selectedModel);
  var modelState=modelAvailable===null?'unknown':(modelAvailable?'ok':'error');

  return ''
    +'<details class="project-infohub" data-project-state-key="project-infohub-'+escapeHtml(project.id)+'">'
    +'<summary>Projektwissen verwalten (Anhange, Secrets, Notizen, Links)</summary>'
    +'<div class="infohub-grid">'

    +'<section class="infohub-card">'
    +'<h4>Dateianhaenge</h4>'
    +'<p class="text-muted">Max. '+formatBytes(MAX_ATTACHMENT_SIZE)+' pro Datei, max. '+formatBytes(MAX_TOTAL_ATTACHMENT_SIZE)+' je Projekt.</p>'
    +'<input type="file" data-action="attachment-input" data-id="'+escapeHtml(project.id)+'" multiple>'
    +'<p class="text-muted mt-1">Gesamt: '+formatBytes(getAttachmentTotalSize(hub.attachments))+' · Dateien: '+flow.attachmentCount+'</p>'
    +renderAttachments(hub.attachments,project.id)
    +'</section>'

    +'<section class="infohub-card">'
    +'<h4>Sensible Daten</h4>'
    +'<div class="infohub-form-row">'
    +'<select id="secret-category-'+escapeHtml(project.id)+'">'
    +'<option value="deployment">Deployment</option>'
    +'<option value="login">Login</option>'
    +'<option value="token">API Token</option>'
    +'<option value="secret">Secret</option>'
    +'<option value="env">.env</option>'
    +'</select>'
    +'<input type="text" id="secret-label-'+escapeHtml(project.id)+'" placeholder="Bezeichnung (z. B. Prod API Token)">'
    +'</div>'
    +'<textarea id="secret-value-'+escapeHtml(project.id)+'" rows="2" placeholder="Wert/Secret"></textarea>'
    +'<button class="btn btn-primary mt-1" data-action="add-secret" data-id="'+escapeHtml(project.id)+'">Eintrag speichern</button>'
    +renderSecrets(hub.secrets,project.id)
    +'</section>'

    +'<section class="infohub-card">'
    +'<h4>Deployment- & Projekt-Links</h4>'
    +'<div class="infohub-form-row">'
    +'<select id="link-kind-'+escapeHtml(project.id)+'">'
    +'<option value="deployment">Deployment</option>'
    +'<option value="monitoring">Monitoring</option>'
    +'<option value="admin">Admin/Login</option>'
    +'<option value="docs">Dokumentation</option>'
    +'<option value="other">Sonstiges</option>'
    +'</select>'
    +'<input type="text" id="link-label-'+escapeHtml(project.id)+'" placeholder="Label (optional)">'
    +'</div>'
    +'<input type="text" id="link-url-'+escapeHtml(project.id)+'" placeholder="https://...">'
    +'<button class="btn btn-primary mt-1" data-action="add-link" data-id="'+escapeHtml(project.id)+'">Link speichern</button>'
    +renderLinks(hub.links,project.id)
    +'</section>'

    +'<section class="infohub-card">'
    +'<h4>.env Inhalt</h4>'
    +'<textarea id="env-text-'+escapeHtml(project.id)+'" rows="5" placeholder="KEY=value\nNEXT_KEY=value">'+escapeHtml(hub.envText||'')+'</textarea>'
    +'<button class="btn btn-secondary mt-1" data-action="save-env" data-id="'+escapeHtml(project.id)+'">.env sichern</button>'
    +'<p class="text-muted mt-1">Erkannte Keys: '+envSummary.keyCount+(envSummary.sample.length?' · '+escapeHtml(envSummary.sample.join(', ')):'')+'</p>'
    +'</section>'

    +'<section class="infohub-card">'
    +'<h4>Notizen / Merkzettel</h4>'
    +'<input type="text" id="note-title-'+escapeHtml(project.id)+'" placeholder="Titel (z. B. ToDo Spaeter)">'
    +'<textarea id="note-text-'+escapeHtml(project.id)+'" rows="3" placeholder="Notizinhalt"></textarea>'
    +'<button class="btn btn-primary mt-1" data-action="add-note" data-id="'+escapeHtml(project.id)+'">Notiz speichern</button>'
    +renderNotes(hub.notes,project.id)
    +'</section>'

    +'<section class="infohub-card">'
    +'<h4>Schmierzettel</h4>'
    +'<textarea id="scratchpad-'+escapeHtml(project.id)+'" rows="6" placeholder="Freier Projektzettel fuer alles, was schnell festgehalten werden muss">'+escapeHtml(hub.scratchpad||'')+'</textarea>'
    +'<button class="btn btn-secondary mt-1" data-action="save-scratchpad" data-id="'+escapeHtml(project.id)+'">Schmierzettel speichern</button>'
    +'</section>'

    +'<section class="infohub-card infohub-ai-card">'
    +'<h4>Lokale KI (Ollama) - Projektwissen</h4>'
    +(hasGithubLink
      ?'<p class="text-muted">Mit einem Klick werden Projektdaten lokal an Ollama gesendet und als Wissensdatei abgelegt.</p>'
      :'<p class="text-muted">Fuer KI-Aufbereitung bitte zuerst GitHub-Repository am Projekt hinterlegen.</p>')
    +'<div class="ai-health-grid">'
    +'<p>Backend: <span class="ai-health-pill '+statusClassFromState(AI_HEALTH_STATE.backendStatus)+'">'+statusTextFromState(AI_HEALTH_STATE.backendStatus)+'</span></p>'
    +'<p>Ollama: <span class="ai-health-pill '+statusClassFromState(AI_HEALTH_STATE.ollamaStatus)+'">'+statusTextFromState(AI_HEALTH_STATE.ollamaStatus)+'</span></p>'
    +'<p>Modell: <span class="ai-health-pill '+statusClassFromState(modelState)+'">'+statusTextFromState(modelState)+'</span></p>'
    +'</div>'
    +'<p class="text-muted mt-1">Letzter Health-Check: '+(AI_HEALTH_STATE.checkedAt?formatDateTime(AI_HEALTH_STATE.checkedAt):'n/a')+(AI_HEALTH_STATE.endpoint?' · Endpoint: '+escapeHtml(AI_HEALTH_STATE.endpoint):'')+'</p>'
    +'<label for="ai-model-'+escapeHtml(project.id)+'" class="text-muted">Modellname</label>'
    +'<select id="ai-model-'+escapeHtml(project.id)+'">'+renderModelOptions(selectedModel)+'</select>'
    +'<div class="project-actions-inline mt-1">'
    +'<button class="btn btn-secondary" data-action="check-ai-health" data-id="'+escapeHtml(project.id)+'">Verbindung pruefen</button>'
    +'<button class="btn btn-primary" data-action="generate-ai-knowledge" data-id="'+escapeHtml(project.id)+'" '+(hasGithubLink?'':'disabled')+'>Projektwissen KI erzeugen</button>'
    +'<button class="btn btn-secondary" data-action="generate-ai-tasks" data-id="'+escapeHtml(project.id)+'" '+(aiState.filePath?'':'disabled')+'>Aufgaben aus KI-Wissen</button>'
    +'</div>'
    +'<p class="text-muted mt-1">Status: '+escapeHtml(aiState.lastStatus||'idle')+(aiState.lastGeneratedAt?' · Letzter Lauf: '+formatDateTime(aiState.lastGeneratedAt):'')+'</p>'
    +(aiState.lastTaskDraftAt?'<p class="text-muted">Aufgaben abgeleitet: '+formatDateTime(aiState.lastTaskDraftAt)+' · Anzahl: '+Number(aiState.lastTaskDraftCount||0)+'</p>':'')
    +(aiState.filePath?'<p class="text-muted">Datei: <a href="'+escapeHtml(aiState.filePath)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(aiState.filePath)+'</a> ('+formatBytes(aiState.lastKnowledgeSize||0)+')</p>':'')
    +(AI_HEALTH_STATE.loading?'<p class="text-muted">Health-Check laeuft ...</p>':'')
    +(AI_HEALTH_STATE.error?'<p class="ai-status-error">Health: '+escapeHtml(AI_HEALTH_STATE.error)+'</p>':'')
    +(aiState.lastError?'<p class="ai-status-error">Fehler: '+escapeHtml(aiState.lastError)+'</p>':'')
    +'</section>'

    +'</div>'
    +'</details>';
}

function renderProjectList(){
  var container=byId('project-list');
  if(!container)return;

  var auth=getAuthManager();
  var projects=getVisibleProjects().slice();
  if(projects.length===0){
    container.innerHTML='<div class="chart-container"><p class="text-muted">Keine freigegebenen Projekte vorhanden.</p></div>';
    return;
  }

  var projectsWithMeta=projects.map(function(project){
    return {
      project:project,
      hasEmployeeActiveTask:hasEmployeeActiveTask(project.id),
      latestEmployeeActiveTaskTs:getLatestEmployeeActiveTaskTimestamp(project.id)
    };
  });

  projectsWithMeta.sort(function(a,b){
    if(a.hasEmployeeActiveTask!==b.hasEmployeeActiveTask){
      return a.hasEmployeeActiveTask?-1:1;
    }

    if(a.latestEmployeeActiveTaskTs!==b.latestEmployeeActiveTaskTs){
      return b.latestEmployeeActiveTaskTs-a.latestEmployeeActiveTaskTs;
    }

    return Date.parse(b.project.createdAt||0)-Date.parse(a.project.createdAt||0);
  });

  var html='';
  projectsWithMeta.forEach(function(entry){
    var project=entry.project;
    var hasEmployeeWork=entry.hasEmployeeActiveTask;
    var canEdit=!(auth&&typeof auth.canEditProject==='function')||auth.canEditProject(project);
    var canSetProgress=canEdit&&canAdjustProjectProgress(project);
    var flow=calculateProjectFlowMetrics(project);
    var currentProgress=getProjectProgressValue(project,flow);
    var progressLabel=classifyProgress(project,flow);
    var aiState=ensureProjectAiKnowledge(project);
    var meeting=getMeetingSnapshot(project);
    var executionPlan=ensureProjectExecutionPlan(project);
    var queuedTaskCount=executionPlan.queuedTasks.length;
    var queuedEventCount=executionPlan.queuedEvents.length;
    var hasQueuedPlan=queuedTaskCount>0||queuedEventCount>0;
    var isPlanning=String(project.status||'').toLowerCase()==='planning';
    var meetingIsClosed=meeting.status==='closed';
    var meetingEntriesPreview=meeting.entries.slice(-3).reverse();
    var gh=project.github||{};
    var gm=project.githubMetrics||{};
    var commitPreview=(project.githubCommits||[]).slice(0,5);
    var projectPeriod=[];
    var activityStatus='Done '+flow.statusCounts.done+' · In Progress '+flow.statusCounts['in-progress']+' · Todo '+flow.statusCounts.todo;
    var teamSummary=flow.teamMembers.length
      ?flow.teamMembers.map(function(member){
        return member.employeeName+' ('+(member.role||'ohne Rolle')+')';
      }).join(' · ')
      :'Keine Zuordnung';
    var canResolveProjectBlocker=!(window.DataLayer&&typeof window.DataLayer.canResolveBlocker==='function')||window.DataLayer.canResolveBlocker({
      targetType:'project',
      targetId:project.id
    });

    html+='<article class="project-card'+(hasEmployeeWork?' project-card-active-work':'')+'" data-project-id="'+escapeHtml(project.id)+'" data-project-editable="'+(canEdit?'true':'false')+'" data-has-active-work="'+(hasEmployeeWork?'true':'false')+'">';
    html+='<div class="project-card-head">';
    html+='<div class="project-card-head-main"><h3>'+escapeHtml(getProjectTitle(project))+'</h3>';
    html+='<p class="text-muted">'+escapeHtml(project.description||'Keine Beschreibung')+'</p>';
    if(hasEmployeeWork){
      html+='<p class="project-active-work-note">Mitarbeiter arbeitet aktuell an einer Aufgabe.</p>';
    }
    html+=renderProjectCardHeadSummary(project);
    html+='</div>';
    html+='<div class="project-card-head-rail">';
    html+=renderProjectCardHeadTimeline(project);
    html+='</div>';
    html+='<div class="project-card-head-actions">';
    html+='<details class="project-card-menu">';
    html+='<summary class="project-card-menu-toggle toolbar-icon-btn" aria-label="Projektaktionen oeffnen">';
    html+='<span class="material-symbols-rounded">more_horiz</span>';
    html+='</summary>';
    html+='<div class="project-card-menu-panel">';
    html+='<button class="project-card-menu-item" data-action="edit" data-id="'+escapeHtml(project.id)+'" '+(canEdit?'':'disabled')+'>Bearbeiten</button>';
    html+='<button class="project-card-menu-item" data-action="set-progress" data-id="'+escapeHtml(project.id)+'" '+(canSetProgress?'':'disabled')+'>Fortschritt setzen ('+currentProgress+'%)</button>';
    html+='<button class="project-card-menu-item project-card-menu-item-danger" data-action="delete" data-id="'+escapeHtml(project.id)+'" '+(canEdit?'':'disabled')+'>Loeschen</button>';
    html+='<button class="project-card-menu-item" data-action="sync" data-id="'+escapeHtml(project.id)+'" '+(canEdit?'':'disabled')+'>Commits aktualisieren</button>';
    html+='<button class="project-card-menu-item" data-action="generate-ai-knowledge" data-id="'+escapeHtml(project.id)+'" '+(gh.url&&canEdit?'':'disabled')+'>Projektwissen KI</button>';
    html+='</div>';
    html+='</details>';
    html+='</div></div>';

    html+='<details class="project-card-sections" data-project-state-key="project-card-sections-'+escapeHtml(project.id)+'">';
    html+='<summary class="project-card-sections-toggle">Projektdetails</summary>';
    html+='<div class="project-card-grid">';
    html+='<div class="project-meta-block">';
    html+='<h4>Projektablauf & Fortschritt</h4>';
    html+='<div class="project-badges">';
    html+='<span class="badge badge-blue">Status: '+escapeHtml(project.status||'active')+'</span>';
    html+='<span class="badge '+(currentProgress>=70?'badge-green':'badge-blue')+'">Fortschritt: '+currentProgress+'%</span>';
    html+='<span class="badge '+(flow.overdue>0?'badge-red':'badge-green')+'">'+escapeHtml(progressLabel)+'</span>';
    if(hasQueuedPlan)html+='<span class="badge badge-blue">Startvorlage: '+queuedTaskCount+' Tasks · '+queuedEventCount+' Termine</span>';
    html+='</div>';
    if(project.startDate)projectPeriod.push('Start '+formatDate(project.startDate));
    if(project.endDate)projectPeriod.push('Ende '+formatDate(project.endDate));
    html+=renderProjectMetaGrid([
      {label:'Zeitraum', value:projectPeriod.length?projectPeriod.join(' · '):'Nicht terminiert'},
      {label:'Delivery-Score', value:flow.deliveryScore+'/100'},
      {label:'Rhythmus-Score', value:flow.rhythmScore+'/100'},
      {label:'Startvorlage', value:hasQueuedPlan?(queuedTaskCount+' Aufgaben · '+queuedEventCount+' Termine'):'Keine vorgemerkten KI-Eintraege'}
    ]);
    if(isPlanning){
      html+='<div class="project-actions-inline mt-1">';
      html+='<button class="btn btn-primary" data-action="start-project" data-id="'+escapeHtml(project.id)+'" '+(canEdit?'':'disabled')+'>Projekt starten (Meilensteine pruefen)</button>';
      html+='</div>';
    }
    html+='</div>';

    html+='<div class="project-meta-block">';
    html+='<h4>GitHub Verknuepfung</h4>';
    if(gh.url){
      html+=renderProjectMetaGrid([
        {label:'Repository', value:'<a href="'+escapeHtml(gh.url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(gh.owner+'/'+gh.repo)+'</a>', html:true},
        {label:'Commits', value:gm.totalCommits||0},
        {label:'7 Tage', value:gm.commitsLast7Days||0},
        {label:'Contributor', value:gm.contributors||0},
        {label:'Letzter Commit', value:gm.lastCommitAt?formatDateTime(gm.lastCommitAt):'Kein Commit erfasst'}
      ]);
      html+=renderProjectGitHubMatrix(project);
      if(aiState.lastGeneratedAt){
        html+=renderProjectMetaGrid([
          {label:'KI-Wissen', value:formatDateTime(aiState.lastGeneratedAt)}
        ]);
      }
    } else if(gh.source==='zip') {
      html+=renderProjectMetaGrid([
        {label:'Quelle', value:'ZIP-Upload ('+(gh.zipName||'repo.zip')+')'}
      ]);
      html+='<p class="text-muted project-meta-empty">Fuer Commit-Metriken jetzt einen GitHub-Link hinterlegen.</p>';
    } else {
      html+='<p class="text-muted project-meta-empty">Noch kein GitHub-Repository verknuepft.</p>';
    }
    html+='</div>';

    html+='<div class="project-meta-block">';
    html+='<h4>Aufgaben, Zeit, Events, Bearbeiter</h4>';
    html+=renderProjectMetaGrid([
      {label:'Tasks', value:flow.tasksTotal},
      {label:'Status', value:activityStatus},
      {label:'Due soon', value:flow.dueSoon},
      {label:'Overdue', value:flow.overdue},
      {label:'Kalender-Events', value:flow.events},
      {label:'Releases', value:flow.releases},
      {label:'Aktive Bearbeiter', value:flow.assignees.length},
      {label:'Projektteam', value:teamSummary}
    ]);
    html+='</div>';

    var activeProjectBlocker=getOpenBlockerHistoryEntry(project);
    html+='<div class="project-meta-block">';
    html+='<h4>Blocker-Status</h4>';
    if(project.blocked){
      html+='<div class="project-badges"><span class="badge badge-red">Aktiv blockiert</span></div>';
      html+=renderProjectMetaGrid([
        {label:'Seit', value:formatDateTime((activeProjectBlocker&&activeProjectBlocker.from)||project.blockedAt||project.blockedUpdatedAt)},
        {label:'Grund', value:(activeProjectBlocker&&activeProjectBlocker.reason)||project.blockedReason||'Kein Grund hinterlegt'}
      ]);
      html+='<div class="project-actions-inline mt-1">';
      html+='<button class="btn btn-secondary" data-action="resolve-project-blocker" data-id="'+escapeHtml(project.id)+'" '+((canEdit&&canResolveProjectBlocker)?'':'disabled')+'>Blocker entfernen</button>';
      html+='</div>';
    }else{
      html+='<p class="text-muted project-meta-empty">Kein aktiver Blocker.</p>';
    }
    html+='<details class="project-commit-details" data-project-state-key="project-blocker-history-'+escapeHtml(project.id)+'" style="margin-top:0.7rem;">';
    html+='<summary>Blocker-Historie</summary>';
    html+=renderBlockerHistory(project);
    html+='</details>';
    html+='</div>';

    html+='<div class="project-meta-block">';
    html+='<h4>Projektwissen</h4>';
    html+=renderProjectMetaGrid([
      {label:'Anhaenge', value:flow.attachmentCount},
      {label:'Secrets', value:flow.secretCount},
      {label:'Links', value:flow.linkCount},
      {label:'Notizen', value:flow.noteCount},
      {label:'.env Keys', value:flow.envSummary.keyCount}
    ]);
    html+='</div>';

    html+='<div class="project-meta-block">';
    html+='<h4>Meeting-Protokoll</h4>';
    html+='<div class="project-badges">';
    html+='<span class="badge '+(meetingIsClosed?'badge-red':'badge-green')+'">'+(meetingIsClosed?'Closed':'Open')+'</span>';
    html+='<span class="badge badge-blue">Eintraege: '+meeting.entries.length+'</span>';
    html+='</div>';
    html+=renderProjectMetaGrid([
      {label:'Letzte Aktivitaet', value:formatDateTime(meeting.updatedAt)},
      {label:'Offene Inhalte', value:(meeting.concept||meeting.plan||meeting.tasks)?'Vorhanden':'Keine'}
    ]);
    html+='<div class="project-actions-inline mt-1">';
    html+='<button class="btn btn-secondary" data-action="open-meeting" data-id="'+escapeHtml(project.id)+'">Weiter bearbeiten</button>';
    html+='<button class="btn btn-secondary" data-action="toggle-meeting-status" data-id="'+escapeHtml(project.id)+'" '+(canEdit?'':'disabled')+'>'+ (meetingIsClosed?'Wieder oeffnen':'Als Closed markieren') +'</button>';
    html+='</div>';
    html+='<details class="project-commit-details" data-project-state-key="project-meeting-details-'+escapeHtml(project.id)+'" style="margin-top:0.7rem;">';
    html+='<summary>Protokoll einsehen</summary>';
    if(!meeting.entries.length&&!meeting.concept&&!meeting.plan&&!meeting.tasks){
      html+='<p class="text-muted">Noch kein Meeting-Protokoll vorhanden.</p>';
    } else {
      if(meetingEntriesPreview.length){
        html+='<ul class="project-commit-list">';
        meetingEntriesPreview.forEach(function(entry){
          var prefix=entry.label?'['+entry.label+'] ':'';
          html+='<li><span class="meta">'+formatDateTime(entry.createdAt)+'</span> <span class="msg">'+escapeHtml(prefix+(entry.text||''))+'</span></li>';
        });
        html+='</ul>';
      }
      if(meeting.concept)html+='<p><strong>Konzept:</strong> '+escapeHtml(meeting.concept)+'</p>';
      if(meeting.plan)html+='<p><strong>Plan:</strong> '+escapeHtml(meeting.plan)+'</p>';
      if(meeting.tasks)html+='<p><strong>Tasks:</strong> '+escapeHtml(meeting.tasks)+'</p>';
    }
    html+='</details>';
    html+='</div>';
    html+='</div>';
    html+='</details>';

    html+='<details class="project-commit-details" data-project-state-key="project-last-commits-'+escapeHtml(project.id)+'">';
    html+='<summary>Letzte Commits anzeigen</summary>';
    if(commitPreview.length===0){
      html+='<p class="text-muted">Noch keine Commit-Daten vorhanden.</p>';
    } else {
      html+='<ul class="project-commit-list">';
      commitPreview.forEach(function(commit){
        html+='<li><span class="sha">'+escapeHtml((commit.sha||'').slice(0,7))+'</span> '
          +'<span class="msg">'+escapeHtml((commit.message||'').split('\n')[0])+'</span> '
          +'<span class="meta">'+escapeHtml(commit.author||'unknown')+' · '+formatDateTime(commit.date)+'</span></li>';
      });
      html+='</ul>';
    }
    html+='</details>';

    html+=renderInfoHub(project,flow);
    html+='</article>';
  });

  container.innerHTML=html;
}

function render(){
  var config=arguments[0]&&typeof arguments[0]==='object'?arguments[0]:{};
  renderOverview();
  renderProjectList();

  if(config.restoreState===false)return;

  var projectsPage=byId('projects');
  if(!projectsPage||!projectsPage.classList.contains('active'))return;

  window.setTimeout(function(){
    restoreProjectPageState();
  },0);
}

function getProjectCreateModal(){
  return byId('project-create-modal');
}

function getProjectImportModal(){
  return byId('project-import-modal');
}

function syncProjectsModalBodyState(){
  if(!document.body)return;
  var hasOpenModal=isProjectCreateModalOpen()||isProjectImportModalOpen();
  document.body.classList.toggle('projects-modal-open',hasOpenModal);
}

function isProjectCreateModalOpen(){
  var modal=getProjectCreateModal();
  return !!(modal&&!modal.classList.contains('hidden'));
}

function isProjectImportModalOpen(){
  var modal=getProjectImportModal();
  return !!(modal&&!modal.classList.contains('hidden'));
}

function openProjectCreateDialog(options){
  var auth=getAuthManager();
  if(auth&&typeof auth.canCreateProject==='function'&&!auth.canCreateProject()){
    notify('Nur angemeldete Mitarbeiter duerfen Projekte anlegen.','error');
    return;
  }
  var modal=getProjectCreateModal();
  if(!modal)return;
  closeProjectImportDialog();

  var config=options&&typeof options==='object'?options:{};
  if(config.reset===true)resetForm();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  syncProjectsModalBodyState();
  saveProjectPageDraftState();

  var focusId=config.focusId||'project-title';
  window.setTimeout(function(){
    var field=byId(focusId);
    if(field&&field.focus)field.focus();
  },50);
}

function closeProjectCreateDialog(){
  var modal=getProjectCreateModal();
  if(!modal)return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  syncProjectsModalBodyState();
  saveProjectPageDraftState();
}

function openProjectImportDialog(options){
  var auth=getAuthManager();
  if(auth&&typeof auth.canCreateProject==='function'&&!auth.canCreateProject()){
    notify('Nur angemeldete Mitarbeiter duerfen Projekte importieren.','error');
    return;
  }
  var modal=getProjectImportModal();
  if(!modal)return;
  closeProjectCreateDialog();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  syncProjectsModalBodyState();
  saveProjectPageDraftState();

  var config=options&&typeof options==='object'?options:{};
  var focusId=config.focusId||'github-bootstrap-url';
  window.setTimeout(function(){
    var field=byId(focusId);
    if(field&&field.focus)field.focus();
  },50);
}

function closeProjectImportDialog(){
  var modal=getProjectImportModal();
  if(!modal)return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  syncProjectsModalBodyState();
  saveProjectPageDraftState();
}

function saveProjectPageDraftState(){
  var form=byId('project-form');
  if(!form)return;

  var draft={
    project: {
      id:(byId('project-id').value||'').trim(),
      title:(byId('project-title').value||'').trim(),
      description:(byId('project-description').value||'').trim(),
      startDate:(byId('project-start').value||'').trim(),
      endDate:(byId('project-end').value||'').trim(),
      status:(byId('project-status').value||'planning').trim(),
      githubUrl:(byId('project-github-url').value||'').trim(),
      teamRows: readProjectTeamRowsFromForm()
    },
    import: {
      githubUrl:(byId('github-bootstrap-url').value||'').trim()
    },
    createModalOpen:isProjectCreateModalOpen(),
    importModalOpen:isProjectImportModalOpen()
  };

  try {
    window.localStorage.setItem(PROJECT_PAGE_DRAFT_KEY, JSON.stringify(draft));
  } catch(_err) {}
}

function saveProjectPageState(){
  var form=byId('project-form');
  var projectList=byId('project-list');
  var details=[];
  var detailEls=document.querySelectorAll('[data-project-state-key]');
  detailEls.forEach(function(detail){
    details.push({
      key:detail.getAttribute('data-project-state-key')||'',
      open:!!detail.open
    });
  });

  var snapshot={
    page: window.location.hash || readActivePage() || 'projects',
    listScrollTop: projectList ? projectList.scrollTop : 0,
    pageScrollTop: window.scrollY || document.documentElement.scrollTop || 0,
    details:details,
    form: form ? {
      id:(byId('project-id').value||'').trim(),
      title:(byId('project-title').value||'').trim(),
      description:(byId('project-description').value||'').trim(),
      startDate:(byId('project-start').value||'').trim(),
      endDate:(byId('project-end').value||'').trim(),
      status:(byId('project-status').value||'planning').trim(),
      githubUrl:(byId('project-github-url').value||'').trim(),
      teamRows: readProjectTeamRowsFromForm(),
      githubBootstrapUrl:(byId('github-bootstrap-url').value||'').trim()
    } : null,
    modals:{
      createOpen:isProjectCreateModalOpen(),
      importOpen:isProjectImportModalOpen()
    }
  };

  try {
    window.localStorage.setItem(PROJECT_PAGE_STATE_KEY, JSON.stringify(snapshot));
  } catch(_err) {}
}

function restoreProjectPageState(){
  var snapshot=readJsonFromLocalStorage(PROJECT_PAGE_STATE_KEY,null);
  if(!snapshot||typeof snapshot!=='object')return;

  if(snapshot.form && byId('project-form')){
    if(byId('project-id'))byId('project-id').value=String(snapshot.form.id||'');
    if(byId('project-title'))byId('project-title').value=String(snapshot.form.title||'');
    if(byId('project-description'))byId('project-description').value=String(snapshot.form.description||'');
    if(byId('project-start'))byId('project-start').value=String(snapshot.form.startDate||'');
    if(byId('project-end'))byId('project-end').value=String(snapshot.form.endDate||'');
    if(byId('project-status'))byId('project-status').value=String(snapshot.form.status||'planning');
    if(byId('project-github-url'))byId('project-github-url').value=String(snapshot.form.githubUrl||'');
    if(byId('github-bootstrap-url'))byId('github-bootstrap-url').value=String(snapshot.form.githubBootstrapUrl||'');

    var teamRows=Array.isArray(snapshot.form.teamRows)?snapshot.form.teamRows:[];
    renderProjectTeamRows(teamRows.length?teamRows:[{employeeId:'',role:''}]);
    updateProjectDateFieldState();
  }

  if(Array.isArray(snapshot.details)){
    snapshot.details.forEach(function(entry){
      if(!entry||!entry.key)return;
      var detail=document.querySelector('[data-project-state-key="'+String(entry.key).replace(/"/g,'\\\"')+'"]');
      if(detail){ detail.open=!!entry.open; }
    });
  }

  var projectList=byId('project-list');
  if(projectList && typeof snapshot.listScrollTop==='number'){
    window.setTimeout(function(){
      if(projectList){ projectList.scrollTop=snapshot.listScrollTop; }
    },0);
  }
  if(typeof snapshot.pageScrollTop==='number'){
    window.setTimeout(function(){
      window.scrollTo(0, snapshot.pageScrollTop);
    },0);
  }

  if(snapshot.modals&&snapshot.modals.createOpen){
    openProjectCreateDialog({reset:false});
  } else if(snapshot.modals&&snapshot.modals.importOpen){
    openProjectImportDialog({focusId:'github-bootstrap-url'});
  }
}

function restoreProjectPageDraftState(){
  var draft=readJsonFromLocalStorage(PROJECT_PAGE_DRAFT_KEY,null);
  if(!draft||typeof draft!=='object')return;

  var projectDraft=draft.project&&typeof draft.project==='object'?draft.project:{};
  var importDraft=draft.import&&typeof draft.import==='object'?draft.import:{};

  if(byId('project-id'))byId('project-id').value=String(projectDraft.id||'');
  if(byId('project-title'))byId('project-title').value=String(projectDraft.title||'');
  if(byId('project-description'))byId('project-description').value=String(projectDraft.description||'');
  if(byId('project-start'))byId('project-start').value=String(projectDraft.startDate||'');
  if(byId('project-end'))byId('project-end').value=String(projectDraft.endDate||'');
  if(byId('project-status'))byId('project-status').value=String(projectDraft.status||'planning');
  if(byId('project-github-url'))byId('project-github-url').value=String(projectDraft.githubUrl||'');
  if(byId('github-bootstrap-url'))byId('github-bootstrap-url').value=String(importDraft.githubUrl||'');

  var teamRows=Array.isArray(projectDraft.teamRows)?projectDraft.teamRows:[];
  renderProjectTeamRows(teamRows.length?teamRows:[{employeeId:'',role:''}]);

  updateProjectDateFieldState();

  if(draft.createModalOpen){
    openProjectCreateDialog({reset:false});
  } else if(draft.importModalOpen){
    openProjectImportDialog({focusId:'github-bootstrap-url'});
  }
}

function resetForm(){
  var form=byId('project-form');
  if(!form)return;
  form.reset();
  byId('project-id').value='';
  byId('project-status').value='planning';
  renderProjectTeamRows([]);
  updateProjectDateFieldState();
  saveProjectPageDraftState();
}

function updateProjectDateFieldState(){
  var projectId=(byId('project-id').value||'').trim();
  var githubUrl=(byId('project-github-url').value||'').trim();
  var hasGitHubLink=!!normalizeRepoUrl(githubUrl);
  var isCreateMode=!projectId;

  var startHint=byId('project-start-hint');
  var endInput=byId('project-end');
  var endHint=byId('project-end-hint');
  if(!endInput)return;

  var lockEndDate=isCreateMode&&hasGitHubLink;
  if(lockEndDate){
    endInput.value='';
  }
  endInput.disabled=lockEndDate;

  if(startHint){
    startHint.textContent=lockEndDate
      ?'Start wird beim Speichern automatisch aus GitHub uebernommen.'
      :'Optional. Bei GitHub-Verknuepfung wird bei Neuanlage das Repository-Startdatum uebernommen.';
  }

  if(endHint){
    endHint.textContent=lockEndDate
      ?'Ende bleibt bei GitHub-Neuanlage offen und kann spaeter gesetzt werden.'
      :'Optional. Bei GitHub-Verknuepfung bleibt Ende bei Neuanlage offen.';
  }
}

function readProjectForm(){
  var title=(byId('project-title').value||'').trim();
  if(!title)throw new Error('Projektname ist erforderlich.');

  return {
    id:(byId('project-id').value||'').trim(),
    title:title,
    description:(byId('project-description').value||'').trim(),
    startDate:(byId('project-start').value||'').trim()||null,
    endDate:(byId('project-end').value||'').trim()||null,
    status:(byId('project-status').value||'planning').trim(),
    githubUrl:(byId('project-github-url').value||'').trim(),
    teamMembers:readProjectTeamAssignmentsFromForm()
  };
}

function applyProjectToForm(project){
  byId('project-id').value=project.id||'';
  byId('project-title').value=getProjectTitle(project);
  byId('project-description').value=project.description||'';
  byId('project-start').value=project.startDate?String(project.startDate).slice(0,10):'';
  byId('project-end').value=project.endDate?String(project.endDate).slice(0,10):'';
  byId('project-status').value=project.status||'planning';
  byId('project-github-url').value=(project.github&&project.github.url)||'';
  renderProjectTeamRows(normalizeProjectTeamMembers(project).map(function(member){
    return {employeeId:member.employeeId,role:member.role||''};
  }));
  updateProjectDateFieldState();
}

function upsertProjectFromForm(){
  return Promise.resolve().then(function(){
    var auth=getAuthManager();
    var payload=readProjectForm();
    var parsed=payload.githubUrl?normalizeRepoUrl(payload.githubUrl):null;
    var project=payload.id?window.DataLayer.getProjectById(payload.id):null;

    if(project&&auth&&typeof auth.canEditProject==='function'&&!auth.canEditProject(project)){
      throw new Error('Dieses Projekt ist fuer den aktuellen Nutzer schreibgeschuetzt.');
    }
    if(!project&&auth&&typeof auth.canCreateProject==='function'&&!auth.canCreateProject()){
      throw new Error('Nur angemeldete Mitarbeiter duerfen Projekte anlegen.');
    }

    if(project){
      project.title=payload.title;
      project.description=payload.description;
      project.startDate=payload.startDate;
      project.endDate=payload.endDate;
      project.status=payload.status;
      if(typeof project.progress!=='number')project.progress=getProjectProgressValue(project);
      project.teamMembers=payload.teamMembers.map(function(member){
        return {
          id:window.DataLayer.generateId(),
          employeeId:member.employeeId,
          role:member.role,
          assignedAt:new Date().toISOString()
        };
      });
      if(parsed){
        project.github=project.github||{};
        project.github.url=parsed.url;
        project.github.owner=parsed.owner;
        project.github.repo=parsed.repo;
        project.github.source='link';
      }
      ensureProjectInfoHub(project);
      ensureProjectAiKnowledge(project);
      ensureProjectMeetingProtocol(project);
      window.DataLayer.updateProject(project);
      notify('Projekt aktualisiert.','info');
      resetForm();
      closeProjectCreateDialog();
      render();
      return;
    }

    if(parsed){
      notify('GitHub-Metadaten werden geladen...','info');
      return fetchRepoMeta(parsed.owner,parsed.repo).then(function(repo){
        var githubStartDate=repo&&repo.created_at?String(repo.created_at).slice(0,10):null;
        var newProject={
          title:payload.title,
          description:payload.description,
          startDate:githubStartDate||payload.startDate,
          endDate:null,
          status:payload.status,
          progress:progressFromStatus(payload.status),
          teamMembers:payload.teamMembers.map(function(member){
            return {
              id:window.DataLayer.generateId(),
              employeeId:member.employeeId,
              role:member.role,
              assignedAt:new Date().toISOString()
            };
          }),
          createdAt:new Date().toISOString(),
          github:{
            source:'link',
            url:parsed.url,
            owner:parsed.owner,
            repo:parsed.repo,
            linkedAt:new Date().toISOString(),
            defaultBranch:repo&&repo.default_branch?repo.default_branch:'main'
          },
          githubRepoMeta:{
            stars:repo&&repo.stargazers_count?repo.stargazers_count:0,
            forks:repo&&repo.forks_count?repo.forks_count:0,
            openIssues:repo&&repo.open_issues_count?repo.open_issues_count:0,
            language:repo&&repo.language?repo.language:'unknown',
            visibility:repo&&repo.private?'private':'public',
            htmlUrl:repo&&repo.html_url?repo.html_url:parsed.url,
            pushedAt:repo&&repo.pushed_at?repo.pushed_at:null
          },
          githubCommits:[],
          githubMetrics:null,
          infoHub:{
            attachments:[],
            notes:[],
            links:[],
            secrets:[],
            scratchpad:'',
            envText:''
          },
          meetingProtocol:{
            status:MEETING_PROTOCOL_DEFAULT_STATUS,
            closedAt:'',
            updatedAt:''
          },
          aiKnowledge:{
            preferredModel:DEFAULT_OLLAMA_MODEL,
            lastStatus:'idle',
            lastGeneratedAt:'',
            filePath:'',
            lastError:'',
            lastModel:'',
            sourceCommitSha:'',
            lastKnowledgeSize:0
          }
        };
        window.DataLayer.createProject(newProject);
        notify('Projekt angelegt.','info');
        resetForm();
        closeProjectCreateDialog();
        render();
      }).catch(function(err){
        throw new Error('GitHub-Metadaten konnten nicht geladen werden: '+err.message+buildPrivateRepoTokenHint());
      });
    }

    var newProject={
      title:payload.title,
      description:payload.description,
      startDate:payload.startDate,
      endDate:payload.endDate,
      status:payload.status,
      progress:progressFromStatus(payload.status),
      teamMembers:payload.teamMembers.map(function(member){
        return {
          id:window.DataLayer.generateId(),
          employeeId:member.employeeId,
          role:member.role,
          assignedAt:new Date().toISOString()
        };
      }),
      createdAt:new Date().toISOString(),
      github:null,
      githubCommits:[],
      githubMetrics:null,
      infoHub:{
        attachments:[],
        notes:[],
        links:[],
        secrets:[],
        scratchpad:'',
        envText:''
      },
      meetingProtocol:{
        status:MEETING_PROTOCOL_DEFAULT_STATUS,
        closedAt:'',
        updatedAt:''
      },
      aiKnowledge:{
        preferredModel:DEFAULT_OLLAMA_MODEL,
        lastStatus:'idle',
        lastGeneratedAt:'',
        filePath:'',
        lastError:'',
        lastModel:'',
        sourceCommitSha:'',
        lastKnowledgeSize:0
      }
    };
    window.DataLayer.createProject(newProject);
    notify('Projekt angelegt.','info');
    resetForm();
    closeProjectCreateDialog();
    render();
  });
}

function deleteProject(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var confirmed=confirm('Projekt "'+getProjectTitle(project)+'" wirklich loeschen?');
  if(!confirmed)return;

  window.DataLayer.deleteProject(projectId);
  notify('Projekt geloescht.','info');
  render();
}

function askProjectProgressValue(project, currentValue){
  var projectTitle=getProjectTitle(project);
  var fallbackValue=sanitizeProgressValue(currentValue, getProjectProgressValue(project));

  return new Promise(function(resolve){
    if(!document||!document.body||typeof HTMLDialogElement==='undefined'){
      var input=window.prompt('Fortschritt fuer "'+projectTitle+'" in Prozent (0-100):', String(fallbackValue));
      if(input===null){
        resolve(null);
        return;
      }
      resolve(sanitizeProgressValue(input,fallbackValue));
      return;
    }

    var dialog=document.createElement('dialog');
    dialog.className='resolution-dialog';
    dialog.style.padding='1rem';
    dialog.style.border='1px solid var(--border-color)';
    dialog.style.borderRadius='0.9rem';
    dialog.style.background='var(--bg-card)';
    dialog.style.color='var(--text-primary)';
    dialog.style.maxWidth='520px';
    dialog.style.width='min(92vw, 520px)';

    dialog.innerHTML=''
      +'<form method="dialog" style="display:grid;gap:0.75rem;">'
      +'  <h3 style="margin:0;font-size:1rem;">Projektfortschritt setzen</h3>'
      +'  <p class="text-muted" style="margin:0;">'+escapeHtml(projectTitle)+'</p>'
      +'  <label for="project-progress-range" class="text-muted">Fortschritt in Prozent</label>'
      +'  <input id="project-progress-range" type="range" min="0" max="100" step="1" value="'+fallbackValue+'">'
      +'  <input id="project-progress-number" type="number" min="0" max="100" step="1" value="'+fallbackValue+'">'
      +'  <div style="display:flex;flex-wrap:wrap;gap:0.45rem;">'
      +'    <button type="button" class="btn btn-secondary" data-progress-preset="0">0%</button>'
      +'    <button type="button" class="btn btn-secondary" data-progress-preset="25">25%</button>'
      +'    <button type="button" class="btn btn-secondary" data-progress-preset="50">50%</button>'
      +'    <button type="button" class="btn btn-secondary" data-progress-preset="75">75%</button>'
      +'    <button type="button" class="btn btn-secondary" data-progress-preset="100">100%</button>'
      +'  </div>'
      +'  <div style="display:flex;justify-content:flex-end;gap:0.5rem;">'
      +'    <button type="button" class="btn btn-secondary" data-progress-cancel>Abbrechen</button>'
      +'    <button type="button" class="btn btn-primary" data-progress-save>Speichern</button>'
      +'  </div>'
      +'</form>';

    document.body.appendChild(dialog);

    var rangeInput=dialog.querySelector('#project-progress-range');
    var numberInput=dialog.querySelector('#project-progress-number');

    function syncInputs(value){
      var normalized=sanitizeProgressValue(value,fallbackValue);
      if(rangeInput)rangeInput.value=String(normalized);
      if(numberInput)numberInput.value=String(normalized);
      return normalized;
    }

    function closeWith(value){
      try { dialog.close(); } catch(_errClose){}
      if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
      resolve(value);
    }

    if(rangeInput){
      rangeInput.addEventListener('input',function(){
        syncInputs(rangeInput.value);
      });
    }

    if(numberInput){
      numberInput.addEventListener('input',function(){
        syncInputs(numberInput.value);
      });
    }

    dialog.addEventListener('click',function(event){
      var presetBtn=event.target&&event.target.closest?event.target.closest('[data-progress-preset]'):null;
      if(presetBtn){
        syncInputs(presetBtn.getAttribute('data-progress-preset'));
        return;
      }
      var cancelBtn=event.target&&event.target.closest?event.target.closest('[data-progress-cancel]'):null;
      if(cancelBtn){
        closeWith(null);
        return;
      }
      var saveBtn=event.target&&event.target.closest?event.target.closest('[data-progress-save]'):null;
      if(saveBtn){
        closeWith(syncInputs(numberInput?numberInput.value:fallbackValue));
      }
    });

    dialog.addEventListener('cancel',function(event){
      event.preventDefault();
      closeWith(null);
    });

    dialog.showModal();
    syncInputs(fallbackValue);
    if(numberInput&&numberInput.focus)numberInput.focus();
  });
}

function setProjectProgress(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var currentValue=getProjectProgressValue(project);
  askProjectProgressValue(project,currentValue).then(function(nextValue){
    if(nextValue===null)return;
    var normalized=sanitizeProgressValue(nextValue,currentValue);
    if(project.progress===normalized){
      notify('Projektfortschritt unveraendert.','info');
      return;
    }
    project.progress=normalized;
    window.DataLayer.updateProject(project);
    notify('Projektfortschritt auf '+normalized+'% gespeichert.','info');
    render();
  });
}

function importCommitsForProject(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)throw new Error('Projekt nicht gefunden.');
  if(!project.github||!project.github.owner||!project.github.repo){
    throw new Error('Kein GitHub-Link hinterlegt.');
  }

  return fetchCommits(project.github.owner,project.github.repo).then(function(commits){
    project.githubCommits=commits;
    project.githubMetrics=calculateGitHubMetrics(commits);
    project.github.lastSyncAt=new Date().toISOString();
    window.DataLayer.updateProject(project);

    if(window.DataLayer.createNotification){
      window.DataLayer.createNotification({
        type:'info',
        title:'GitHub Sync abgeschlossen',
        message:'Projekt "'+getProjectTitle(project)+'": '+commits.length+' Commits aktualisiert.'
      });
    }

    return project;
  });
}

function openAiKnowledgeTaskDialog(projectId,options){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var aiState=ensureProjectAiKnowledge(project);
  if(!aiState.filePath){
    notify('Bitte zuerst Projektwissen erzeugen, danach koennen Aufgaben abgeleitet werden.','error');
    return;
  }

  var employees=getAssignableEmployeesForProject(project);
  var defaultAssignee=employees.length?String(employees[0].id||'').trim():'';
  var dialog=document.createElement('dialog');
  var state={loading:false,items:[],summary:''};
  dialog.className='resolution-dialog';
  dialog.innerHTML=''
    +'<form method="dialog" class="resolution-form">'
      +'<h3>Aufgaben aus KI-Projektwissen erzeugen</h3>'
      +'<p class="text-muted">Projekt: '+escapeHtml(getProjectTitle(project))+' · Wissen: '+escapeHtml(aiState.filePath||'n/a')+'</p>'
      +'<label class="form-group"><span>Fokus (optional)</span><textarea id="ai-task-focus" rows="2" placeholder="z. B. nur naechste 7 Tage, hohes Risiko zuerst, Team gleichmaessig auslasten"></textarea></label>'
      +'<div class="project-actions-inline mt-1">'
        +'<button type="button" class="btn btn-secondary" data-action="cancel">Schliessen</button>'
        +'<button type="button" class="btn btn-secondary" data-action="generate">KI-Vorschlaege erstellen</button>'
        +'<button type="button" class="btn btn-primary" data-action="create" disabled>In Startvorlage speichern</button>'
      +'</div>'
      +'<div id="ai-task-draft-result" class="mt-1"><p class="text-muted">Noch keine Vorschlaege erstellt.</p></div>'
    +'</form>';

  document.body.appendChild(dialog);

  function closeWith(){
    try{dialog.close();}catch(_errClose){}
    if(dialog.parentNode)dialog.parentNode.removeChild(dialog);
  }

  function renderItems(){
    var host=dialog.querySelector('#ai-task-draft-result');
    var createBtn=dialog.querySelector('[data-action="create"]');
    if(!host)return;

    if(!state.items.length){
      host.innerHTML='<p class="text-muted">Keine verwertbaren Aufgabenvorschlaege erhalten. Fokus anpassen und erneut versuchen.</p>';
      if(createBtn)createBtn.disabled=true;
      return;
    }

    var cards=state.items.map(function(item,idx){
      var priority=item.priority||'medium';
      var urgency=item.urgency||'normal';
      var labelsText=Array.isArray(item.labels)?item.labels.join(', '):'';
      var subtasksText=Array.isArray(item.subtasks)?item.subtasks.join('\n'):'';
      var assigneeId=item.assigneeId||defaultAssignee;
      return ''
        +'<article class="infohub-card" data-ai-task-row="'+idx+'">'
          +'<div class="project-actions-inline">'
            +'<label><input type="checkbox" data-field="include" checked> Uebernehmen</label>'
            +(item.isMain?'<span class="text-muted">Hauptvorschlag</span>':'')
          +'</div>'
          +'<label class="form-group"><span>Titel</span><input type="text" data-field="title" value="'+escapeHtml(item.title||'')+'"></label>'
          +'<label class="form-group"><span>Beschreibung</span><textarea rows="3" data-field="description">'+escapeHtml(item.description||'')+'</textarea></label>'
          +'<div class="project-form-grid">'
            +'<label class="form-group"><span>Prioritaet</span><select data-field="priority">'
              +'<option value="low" '+(priority==='low'?'selected':'')+'>low</option>'
              +'<option value="medium" '+(priority==='medium'?'selected':'')+'>medium</option>'
              +'<option value="high" '+(priority==='high'?'selected':'')+'>high</option>'
              +'<option value="blocker" '+(priority==='blocker'?'selected':'')+'>blocker</option>'
            +'</select></label>'
            +'<label class="form-group"><span>Dringlichkeit</span><select data-field="urgency">'
              +'<option value="low" '+(urgency==='low'?'selected':'')+'>low</option>'
              +'<option value="normal" '+(urgency==='normal'?'selected':'')+'>normal</option>'
              +'<option value="high" '+(urgency==='high'?'selected':'')+'>high</option>'
              +'<option value="critical" '+(urgency==='critical'?'selected':'')+'>critical</option>'
            +'</select></label>'
          +'</div>'
          +'<div class="project-form-grid">'
            +'<label class="form-group"><span>Aufwand (h)</span><input type="number" min="0" step="0.5" data-field="effortHours" value="'+escapeHtml(item.effortHours||0)+'"></label>'
            +'<label class="form-group"><span>Zuweisung</span><select data-field="assigneeId">'+buildAssigneeOptionsHtml(employees,assigneeId)+'</select></label>'
          +'</div>'
          +'<label class="form-group"><span>Labels (Komma-getrennt)</span><input type="text" data-field="labels" value="'+escapeHtml(labelsText)+'"></label>'
          +'<label class="form-group"><span>Subtasks (eine pro Zeile)</span><textarea rows="2" data-field="subtasks">'+escapeHtml(subtasksText)+'</textarea></label>'
          +'<label class="form-group"><span>Notiz</span><input type="text" data-field="note" value="'+escapeHtml(item.note||'')+'"></label>'
          +'<input type="hidden" data-field="sequenceIndex" value="'+escapeHtml(item.sequenceIndex||idx+1)+'">'
          +'<input type="hidden" data-field="dependsOnPrevious" value="'+(item.dependsOnPrevious?'1':'0')+'">'
        +'</article>';
    }).join('');

    var summaryHtml=state.summary?'<p class="text-muted">'+escapeHtml(state.summary)+'</p>':'';
    host.innerHTML=summaryHtml+cards;
    if(createBtn)createBtn.disabled=false;
  }

  function readDialogRows(){
    var rows=dialog.querySelectorAll('[data-ai-task-row]');
    var list=[];
    rows.forEach(function(row){
      var includeEl=row.querySelector('[data-field="include"]');
      if(!includeEl||!includeEl.checked)return;
      var title=String((row.querySelector('[data-field="title"]')||{}).value||'').trim();
      if(!title)return;
      var labelsInput=String((row.querySelector('[data-field="labels"]')||{}).value||'').trim();
      var labels=labelsInput?labelsInput.split(',').map(function(label){return label.trim();}).filter(function(label){return !!label;}):[];
      var subtasksText=String((row.querySelector('[data-field="subtasks"]')||{}).value||'').trim();
      var subtasks=subtasksText?subtasksText.split(/\r?\n/).map(function(line){return line.trim();}).filter(function(line){return !!line;}):[];

      list.push({
        title:title,
        description:String((row.querySelector('[data-field="description"]')||{}).value||'').trim(),
        priority:String((row.querySelector('[data-field="priority"]')||{}).value||'medium').trim(),
        urgency:String((row.querySelector('[data-field="urgency"]')||{}).value||'normal').trim(),
        effortHours:Number((row.querySelector('[data-field="effortHours"]')||{}).value||0)||0,
        assigneeId:String((row.querySelector('[data-field="assigneeId"]')||{}).value||'').trim(),
        labels:labels,
        subtasks:subtasks,
        note:String((row.querySelector('[data-field="note"]')||{}).value||'').trim(),
        sequenceIndex:Number((row.querySelector('[data-field="sequenceIndex"]')||{}).value||0)||0,
        dependsOnPrevious:String((row.querySelector('[data-field="dependsOnPrevious"]')||{}).value||'')==='1'
      });
    });

    list.sort(function(a,b){
      var aSeq=Number(a.sequenceIndex||0)||0;
      var bSeq=Number(b.sequenceIndex||0)||0;
      if(aSeq&&!bSeq)return -1;
      if(!aSeq&&bSeq)return 1;
      if(aSeq!==bSeq)return aSeq-bSeq;
      return 0;
    });

    return list;
  }

  function createTasksFromSelection(){
    var selected=readDialogRows();
    if(!selected.length){
      notify('Bitte mindestens einen Vorschlag auswaehlen.','error');
      return;
    }

    var baseProject=window.DataLayer.getProjectById(projectId);
    if(!baseProject){
      notify('Projekt wurde nicht gefunden.','error');
      return;
    }

    var draft=ensureProjectExecutionPlan(baseProject);
    var queuedCount=0;
    var sourceNote='';
    if(aiState.filePath){
      sourceNote='Aus KI-Projektwissen abgeleitet: '+aiState.filePath;
    }

    selected.forEach(function(item,idx){
      var notes=[];
      if(item.note){
        notes.push({id:window.DataLayer.generateId(),text:item.note,createdAt:new Date().toISOString()});
      }

      if(sourceNote){
        notes.push({id:window.DataLayer.generateId(),text:sourceNote,createdAt:new Date().toISOString()});
      }

      draft.queuedTasks.push({
        id:window.DataLayer.generateId(),
        source:'project-ai-knowledge-draft',
        title:item.title,
        description:item.description,
        assigneeId:item.assigneeId||null,
        priority:item.priority||'medium',
        urgency:item.urgency||'normal',
        effortHours:Number(item.effortHours||0)||0,
        labels:resolveLabelIdsByNames(item.labels),
        schedule:{mode:'none',deadline:'',fixedAt:'',rangeStart:'',rangeEnd:''},
        sequenceIndex:Number(item.sequenceIndex||idx+1)||0,
        dependsOnPrevious:!!item.dependsOnPrevious,
        chainWithPrevious:!!item.dependsOnPrevious || idx>0,
        externalDependencyTaskId:'',
        subtasks:item.subtasks.slice(),
        notes:notes,
        queuedAt:new Date().toISOString()
      });
      queuedCount++;
    });

    draft.status='queued';
    if(!draft.generatedAt)draft.generatedAt=new Date().toISOString();
    draft.updatedAt=new Date().toISOString();
    window.DataLayer.updateProject(baseProject);

    var freshProject=window.DataLayer.getProjectById(projectId);
    if(freshProject){
      var freshAiState=ensureProjectAiKnowledge(freshProject);
      freshAiState.lastTaskDraftAt=new Date().toISOString();
      freshAiState.lastTaskDraftCount=queuedCount;
      window.DataLayer.updateProject(freshProject);
    }

    notify(queuedCount+' Aufgaben in der Projekt-Startvorlage gespeichert.','info');
    render();
    closeWith();
  }

  function generateDraft(){
    if(state.loading)return;
    state.loading=true;
    var host=dialog.querySelector('#ai-task-draft-result');
    var createBtn=dialog.querySelector('[data-action="create"]');
    var generateBtn=dialog.querySelector('[data-action="generate"]');
    var focusText=String((dialog.querySelector('#ai-task-focus')||{}).value||'').trim();

    if(createBtn)createBtn.disabled=true;
    if(generateBtn)generateBtn.disabled=true;
    if(host)host.innerHTML='<p class="text-muted">KI erstellt Vorschlaege aus dem gespeicherten Projektwissen ...</p>';

    fetchKnowledgeMarkdownSnippet(aiState.filePath,6500).then(function(snippet){
      var payload={
        projectId:project.id,
        projectTitle:getProjectTitle(project),
        draftInput:buildAiKnowledgeDraftInput(project,aiState,focusText,snippet),
        meetingNotes:(ensureProjectInfoHub(project).notes||[]).map(function(note){
          return {
            text:(note.title?note.title+': ':'')+String(note.text||''),
            label:'infohub',
            createdAt:String(note.updatedAt||note.createdAt||'')
          };
        }),
        options:{
          scheduleMode:'none',
          eventType:'task',
          createSubtasks:true,
          splitIntoMultiple:true
        },
        existingData:buildProjectKnowledgeSnapshot(project),
        promptConfig:{
          model:aiState.preferredModel||DEFAULT_OLLAMA_MODEL,
          temperature:0.2,
          maxTokens:2400
        }
      };
      return postJsonWithFallback('/api/ai/meeting-task-draft',payload);
    }).then(function(body){
      var normalized=normalizeAiKnowledgeTaskDraft(body&&body.draft?body.draft:{});
      state.items=normalized.items;
      state.summary=normalized.summaryMarkdown;
      renderItems();
      if(!state.items.length){
        notify('Keine konkreten Aufgaben erkannt. Fokus bitte praezisieren und erneut versuchen.','error');
      } else {
        notify(state.items.length+' KI-Aufgabenvorschlaege bereit zur Pruefung.','info');
      }
    }).catch(function(err){
      if(host)host.innerHTML='<p class="ai-status-error">Fehler: '+escapeHtml(err&&err.message?err.message:String(err))+'</p>';
      notify('KI-Aufgabenvorschlaege fehlgeschlagen: '+(err&&err.message?err.message:String(err)),'error');
    }).finally(function(){
      state.loading=false;
      if(generateBtn)generateBtn.disabled=false;
    });
  }

  dialog.addEventListener('click',function(event){
    var target=event.target&&event.target.closest?event.target.closest('[data-action]'):null;
    if(!target)return;
    var action=target.getAttribute('data-action');
    if(action==='cancel'){
      closeWith();
      return;
    }
    if(action==='generate'){
      generateDraft();
      return;
    }
    if(action==='create'){
      createTasksFromSelection();
    }
  });

  dialog.showModal();
  if(options&&options.autoGenerate){
    generateDraft();
  }
}

function generateAiKnowledgeForProject(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)throw new Error('Projekt nicht gefunden.');
  if(!project.github||!project.github.url){
    throw new Error('Projekt ist nicht mit einem GitHub-Repository verknuepft.');
  }

  var aiState=ensureProjectAiKnowledge(project);
  var modelInput=byId('ai-model-'+projectId);
  var model=modelInput&&modelInput.value?modelInput.value.trim():aiState.preferredModel;
  if(!model)model=DEFAULT_OLLAMA_MODEL;

  aiState.preferredModel=model;
  aiState.lastStatus='running';
  aiState.lastError='';
  window.DataLayer.updateProject(project);
  render();

  refreshAiHealthStatus(false).then(function(){
    render();
  }).catch(function(){
    render();
  });

  notify('Lokale KI verarbeitet Projektwissen fuer "'+getProjectTitle(project)+'" ...','info');

  var payload={
    projectId:project.id,
    projectTitle:getProjectTitle(project),
    model:model,
    github:project.github||{},
    snapshot:buildProjectKnowledgeSnapshot(project)
  };

  return postJsonWithFallback('/api/ai/project-knowledge',payload).then(function(body){
    var freshProject=window.DataLayer.getProjectById(projectId);
    if(!freshProject)return body;

    var freshAiState=ensureProjectAiKnowledge(freshProject);
    freshAiState.preferredModel=model;
    freshAiState.lastModel=body.model||model;
    freshAiState.lastStatus='ready';
    freshAiState.lastError='';
    freshAiState.lastGeneratedAt=body.generatedAt||new Date().toISOString();
    freshAiState.filePath=body.filePath||'';
    freshAiState.lastKnowledgeSize=Number(body.bytes)||0;
    freshAiState.sourceCommitSha=(freshProject.githubCommits&&freshProject.githubCommits[0]&&freshProject.githubCommits[0].sha)||'';
    window.DataLayer.updateProject(freshProject);

    if(window.DataLayer.createNotification){
      window.DataLayer.createNotification({
        type:'success',
        title:'Projektwissen KI aktualisiert',
        message:'Projekt "'+getProjectTitle(freshProject)+'" wurde mit Modell '+freshAiState.lastModel+' verarbeitet.'
      });
    }

    refreshAiHealthStatus(true).catch(function(){});
    notify('Projektwissen KI erfolgreich erstellt.','info');
    render();
    openAiKnowledgeTaskDialog(projectId,{autoGenerate:true});
    return body;
  }).catch(function(err){
    var failedProject=window.DataLayer.getProjectById(projectId);
    if(failedProject){
      var failedAiState=ensureProjectAiKnowledge(failedProject);
      failedAiState.lastStatus='error';
      failedAiState.lastError=err.message||String(err);
      window.DataLayer.updateProject(failedProject);
    }
    refreshAiHealthStatus(true).catch(function(){});
    render();
    throw err;
  });
}

function createProjectFromGitHub(){
  var url=(byId('github-bootstrap-url').value||'').trim();
  var token=(byId('github-bootstrap-token').value||'').trim();
  if(token)setGitHubApiToken(token);
  var parsed=normalizeRepoUrl(url);
  if(!parsed){
    notify('Bitte gueltigen GitHub-Link angeben.','error');
    return;
  }

  notify('GitHub-Repository wird gelesen...','info');

  fetchRepoMeta(parsed.owner,parsed.repo).then(function(repo){
    var commitWarning='';
    return fetchCommits(parsed.owner,parsed.repo).catch(function(err){
      commitWarning=String(err&&err.message||'').trim();
      return [];
    }).then(function(commits){
    var metrics=calculateGitHubMetrics(commits);

    var project={
      title:repo.name||parsed.repo,
      description:repo.description||'Aus GitHub importiert',
      startDate:repo.created_at?String(repo.created_at).slice(0,10):null,
      endDate:null,
      status:repo.archived?'done':'planning',
      progress:repo.archived?100:0,
      teamMembers:[],
      createdAt:new Date().toISOString(),
      github:{
        source:'link',
        url:parsed.url,
        owner:parsed.owner,
        repo:parsed.repo,
        linkedAt:new Date().toISOString(),
        defaultBranch:repo.default_branch||'main'
      },
      githubRepoMeta:{
        stars:repo.stargazers_count||0,
        forks:repo.forks_count||0,
        openIssues:repo.open_issues_count||0,
        language:repo.language||'unknown',
        visibility:repo.private?'private':'public',
        htmlUrl:repo.html_url||parsed.url,
        pushedAt:repo.pushed_at||null
      },
      githubCommits:commits,
      githubMetrics:metrics,
      infoHub:{
        attachments:[],
        notes:[],
        links:[],
        secrets:[],
        scratchpad:'',
        envText:''
      },
      meetingProtocol:{
        status:MEETING_PROTOCOL_DEFAULT_STATUS,
        closedAt:'',
        updatedAt:''
      },
      aiKnowledge:{
        preferredModel:DEFAULT_OLLAMA_MODEL,
        lastStatus:'idle',
        lastGeneratedAt:'',
        filePath:'',
        lastError:'',
        lastModel:'',
        sourceCommitSha:'',
        lastKnowledgeSize:0
      }
    };

    window.DataLayer.createProject(project);
    byId('github-bootstrap-url').value='';
    if(commitWarning){
      notify('Projekt aus GitHub angelegt. Commits konnten nicht geladen werden: '+commitWarning,'info');
    } else {
      notify('Projekt aus GitHub erfolgreich angelegt.','info');
    }
    closeProjectImportDialog();
    render();
    });
  }).catch(function(err){
    notify('GitHub-Import fehlgeschlagen: '+err.message+buildPrivateRepoTokenHint(),'error');
  });
}

function createProjectFromZip(){
  var input=byId('project-zip-file');
  if(!input||!input.files||!input.files[0]){
    notify('Bitte zuerst eine ZIP-Datei auswaehlen.','error');
    return;
  }

  var file=input.files[0];
  var name=file.name.replace(/\.zip$/i,'');

  var project={
    title:name||'Repository ZIP Projekt',
    description:'Aus Repository-ZIP erstellt',
    startDate:new Date().toISOString().slice(0,10),
    endDate:null,
    status:'planning',
    progress:0,
    teamMembers:[],
    createdAt:new Date().toISOString(),
    github:{
      source:'zip',
      zipName:file.name,
      zipSize:file.size,
      zipUploadedAt:new Date().toISOString()
    },
    githubCommits:[],
    githubMetrics:null,
    infoHub:{
      attachments:[],
      notes:[],
      links:[],
      secrets:[],
      scratchpad:'',
      envText:''
    },
    meetingProtocol:{
      status:MEETING_PROTOCOL_DEFAULT_STATUS,
      closedAt:'',
      updatedAt:''
    },
    aiKnowledge:{
      preferredModel:DEFAULT_OLLAMA_MODEL,
      lastStatus:'idle',
      lastGeneratedAt:'',
      filePath:'',
      lastError:'',
      lastModel:'',
      sourceCommitSha:'',
      lastKnowledgeSize:0
    }
  };

  window.DataLayer.createProject(project);
  input.value='';
  notify('Projekt aus ZIP angelegt.','info');
  closeProjectImportDialog();
  render();
}

function addLink(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var kind=(byId('link-kind-'+projectId).value||'other').trim();
  var label=(byId('link-label-'+projectId).value||'').trim();
  var url=(byId('link-url-'+projectId).value||'').trim();

  if(!/^https?:\/\//i.test(url)){
    notify('Link muss mit http:// oder https:// beginnen.','error');
    return;
  }

  var hub=ensureProjectInfoHub(project);
  hub.links.push({
    id:window.DataLayer.generateId(),
    kind:kind,
    label:label||url,
    url:url,
    createdAt:new Date().toISOString()
  });

  window.DataLayer.updateProject(project);
  notify('Projekt-Link gespeichert.','info');
  render();
}

function deleteLink(projectId,linkId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var before=hub.links.length;
  hub.links=hub.links.filter(function(item){return item.id!==linkId;});
  if(hub.links.length===before)return;

  window.DataLayer.updateProject(project);
  notify('Link entfernt.','info');
  render();
}

function addSecret(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var category=(byId('secret-category-'+projectId).value||'secret').trim();
  var label=(byId('secret-label-'+projectId).value||'').trim();
  var value=(byId('secret-value-'+projectId).value||'').trim();

  if(!value){
    notify('Bitte Secret/Token Wert eingeben.','error');
    return;
  }

  var hub=ensureProjectInfoHub(project);
  hub.secrets.push({
    id:window.DataLayer.generateId(),
    category:category,
    label:label||'Eintrag',
    value:value,
    createdAt:new Date().toISOString()
  });

  window.DataLayer.updateProject(project);
  notify('Sensibler Eintrag gespeichert.','info');
  render();
}

function toggleSecretVisibility(projectId,secretId){
  var key=projectId+'::'+secretId;
  SECRET_VIEW_STATE[key]=!SECRET_VIEW_STATE[key];
  render();
}

function deleteSecret(projectId,secretId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var before=hub.secrets.length;
  hub.secrets=hub.secrets.filter(function(item){return item.id!==secretId;});
  if(before===hub.secrets.length)return;

  delete SECRET_VIEW_STATE[projectId+'::'+secretId];
  window.DataLayer.updateProject(project);
  notify('Sensibler Eintrag entfernt.','info');
  render();
}

function addNote(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var title=(byId('note-title-'+projectId).value||'').trim();
  var text=(byId('note-text-'+projectId).value||'').trim();
  if(!text){
    notify('Bitte Notizinhalt eingeben.','error');
    return;
  }

  var hub=ensureProjectInfoHub(project);
  hub.notes.push({
    id:window.DataLayer.generateId(),
    title:title||'Notiz',
    text:text,
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  });

  window.DataLayer.updateProject(project);
  notify('Notiz gespeichert.','info');
  render();
}

function editNote(projectId,noteId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var note=hub.notes.find(function(item){return item.id===noteId;});
  if(!note)return;

  var next=prompt('Notiz bearbeiten:',note.text||'');
  if(next===null)return;
  note.text=(next||'').trim();
  note.updatedAt=new Date().toISOString();

  window.DataLayer.updateProject(project);
  notify('Notiz aktualisiert.','info');
  render();
}

function deleteNote(projectId,noteId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var before=hub.notes.length;
  hub.notes=hub.notes.filter(function(item){return item.id!==noteId;});
  if(before===hub.notes.length)return;

  window.DataLayer.updateProject(project);
  notify('Notiz entfernt.','info');
  render();
}

function saveScratchpad(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var text=(byId('scratchpad-'+projectId).value||'');
  hub.scratchpad=text;

  window.DataLayer.updateProject(project);
  notify('Schmierzettel gespeichert.','info');
  render();
}

function saveEnvText(projectId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var text=(byId('env-text-'+projectId).value||'');
  hub.envText=text;

  window.DataLayer.updateProject(project);
  var envSummary=parseEnvSummary(text);
  notify('.env Inhalt gespeichert ('+envSummary.keyCount+' Keys).','info');
  render();
}

function addAttachments(projectId,fileList){
  var files=Array.prototype.slice.call(fileList||[]);
  if(!files.length)return;

  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var currentTotal=getAttachmentTotalSize(hub.attachments);

  var jobs=[];
  var allowedFiles=[];

  files.forEach(function(file){
    if(file.size>MAX_ATTACHMENT_SIZE){
      notify('Datei "'+file.name+'" ist zu gross (max '+formatBytes(MAX_ATTACHMENT_SIZE)+').','error');
      return;
    }
    if(currentTotal+file.size>MAX_TOTAL_ATTACHMENT_SIZE){
      notify('Anhang-Limit pro Projekt erreicht.','error');
      return;
    }
    currentTotal+=file.size;
    allowedFiles.push(file);
    jobs.push(readFileAsDataUrl(file));
  });

  if(!jobs.length)return;

  Promise.all(jobs).then(function(dataUrls){
    dataUrls.forEach(function(url,idx){
      var file=allowedFiles[idx];
      hub.attachments.push({
        id:window.DataLayer.generateId(),
        name:file.name,
        type:file.type||'application/octet-stream',
        size:file.size,
        uploadedAt:new Date().toISOString(),
        dataUrl:url
      });
    });

    window.DataLayer.updateProject(project);
    notify(allowedFiles.length+' Datei(en) angehaengt.','info');
    render();
  }).catch(function(err){
    notify('Dateiupload fehlgeschlagen: '+err.message,'error');
  });
}

function removeAttachment(projectId,attachmentId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var before=hub.attachments.length;
  hub.attachments=hub.attachments.filter(function(item){return item.id!==attachmentId;});
  if(before===hub.attachments.length)return;

  window.DataLayer.updateProject(project);
  notify('Anhang entfernt.','info');
  render();
}

function downloadAttachment(projectId,attachmentId){
  var project=window.DataLayer.getProjectById(projectId);
  if(!project)return;

  var hub=ensureProjectInfoHub(project);
  var attachment=hub.attachments.find(function(item){return item.id===attachmentId;});
  if(!attachment||!attachment.dataUrl){
    notify('Anhang nicht gefunden.','error');
    return;
  }

  var a=document.createElement('a');
  a.href=attachment.dataUrl;
  a.download=attachment.name||'attachment';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function bindForm(){
  var form=byId('project-form');
  if(form){
    form.addEventListener('submit',function(evt){
      evt.preventDefault();
      upsertProjectFromForm().catch(function(err){
        notify(err.message,'error');
      });
    });
    form.addEventListener('input',saveProjectPageDraftState);
    form.addEventListener('change',saveProjectPageDraftState);
  }

  var githubUrlInput=byId('project-github-url');
  if(githubUrlInput){
    githubUrlInput.addEventListener('input',function(){
      updateProjectDateFieldState();
      saveProjectPageDraftState();
    });
    githubUrlInput.addEventListener('blur',function(){
      updateProjectDateFieldState();
      saveProjectPageDraftState();
    });
  }

  var githubTokenInput=byId('project-github-token');
  if(githubTokenInput){
    githubTokenInput.addEventListener('input',function(){
      setGitHubApiToken(githubTokenInput.value);
    });
  }

  var githubBootstrapTokenInput=byId('github-bootstrap-token');
  if(githubBootstrapTokenInput){
    githubBootstrapTokenInput.addEventListener('input',function(){
      setGitHubApiToken(githubBootstrapTokenInput.value);
    });
  }

  var githubBootstrapUrlInput=byId('github-bootstrap-url');
  if(githubBootstrapUrlInput){
    githubBootstrapUrlInput.addEventListener('input',saveProjectPageDraftState);
    githubBootstrapUrlInput.addEventListener('change',saveProjectPageDraftState);
  }

  var teamAddBtn=byId('project-team-add-btn');
  if(teamAddBtn){
    teamAddBtn.addEventListener('click',function(){
      addProjectTeamRow();
      saveProjectPageDraftState();
    });
  }

  var teamRows=byId('project-team-rows');
  if(teamRows){
    teamRows.addEventListener('click',function(evt){
      var target=evt.target;
      if(!target||!target.dataset)return;
      if(target.dataset.action==='remove-team-row'){
        removeProjectTeamRow(target.dataset.index);
        saveProjectPageDraftState();
      }
    });
    teamRows.addEventListener('input',saveProjectPageDraftState);
    teamRows.addEventListener('change',saveProjectPageDraftState);
  }

  setGitHubApiToken(getGitHubApiToken());

  renderProjectTeamRows([]);
  updateProjectDateFieldState();
  restoreProjectPageDraftState();

  var resetBtn=byId('project-reset-btn');
  if(resetBtn){
    resetBtn.addEventListener('click',function(){
      resetForm();
      setLiveMessage('Formular zurueckgesetzt.');
    });
  }

  var githubBtn=byId('create-from-github-btn');
  if(githubBtn){
    githubBtn.addEventListener('click',createProjectFromGitHub);
  }

  var zipBtn=byId('create-from-zip-btn');
  if(zipBtn){
    zipBtn.addEventListener('click',createProjectFromZip);
  }

  var modal=byId('project-create-modal');
  if(modal){
    modal.addEventListener('click',function(evt){
      if(evt.target===modal)closeProjectCreateDialog();
    });
  }

  var closeModalBtn=byId('project-modal-close-btn');
  if(closeModalBtn){
    closeModalBtn.addEventListener('click',function(){
      closeProjectCreateDialog();
    });
  }

  var importModal=byId('project-import-modal');
  if(importModal){
    importModal.addEventListener('click',function(evt){
      if(evt.target===importModal)closeProjectImportDialog();
    });
  }

  var closeImportModalBtn=byId('project-import-modal-close-btn');
  if(closeImportModalBtn){
    closeImportModalBtn.addEventListener('click',function(){
      closeProjectImportDialog();
    });
  }

  document.addEventListener('keydown',function(evt){
    if(evt.key!=='Escape')return;
    if(isProjectCreateModalOpen()){
      closeProjectCreateDialog();
      return;
    }
    if(isProjectImportModalOpen()){
      closeProjectImportDialog();
    }
  });

  document.addEventListener('toggle',function(evt){
    var target=evt.target;
    if(!target||!target.matches)return;
    if(target.matches('.project-card-sections, .project-commit-details, .project-infohub')){
      saveProjectPageState();
    }
  },true);

  document.addEventListener('scroll',function(){
    var projectList=byId('project-list');
    if(projectList && document.getElementById('projects')&&document.getElementById('projects').classList.contains('active')){
      saveProjectPageState();
    }
  },true);

  window.addEventListener('beforeunload',saveProjectPageState);
  window.addEventListener('pagehide',saveProjectPageState);
}

function bindListActions(){
  var list=byId('project-list');
  if(!list)return;

  list.addEventListener('click',function(evt){
    var target=evt.target;
    if(!target||!target.dataset)return;

    var action=target.dataset.action;
    var projectId=target.dataset.id;
    if(!action||!projectId)return;

    var auth=getAuthManager();
    var project=window.DataLayer.getProjectById(projectId);
    var canEdit=!auth||typeof auth.canEditProject!=='function'||auth.canEditProject(project);

    if(action==='edit'){
      if(!canEdit){
        notify('Dieses Projekt kann nur gelesen werden.','error');
        return;
      }
      if(project){
        applyProjectToForm(project);
        openProjectCreateDialog({focusId:'project-title'});
        setLiveMessage('Projekt in Formular geladen: '+getProjectTitle(project));
      }
      return;
    }

    if(action==='delete'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht geloescht werden.','error');
        return;
      }
      deleteProject(projectId);
      return;
    }

    if(action==='set-progress'){
      if(!canEdit||!canAdjustProjectProgress(project)){
        notify('Nur Admin oder Ansprechpartner duerfen den Projektfortschritt setzen.','error');
        return;
      }
      setProjectProgress(projectId);
      return;
    }

    if(action==='sync'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht synchronisiert werden.','error');
        return;
      }
      importCommitsForProject(projectId).then(function(){
        notify('Commit-Daten aktualisiert.','info');
        render();
      }).catch(function(err){
        notify('Commit-Import fehlgeschlagen: '+err.message,'error');
      });
      return;
    }

    if(action==='open-meeting'){
      openMeetingForProject(projectId);
      return;
    }

    if(action==='toggle-meeting-status'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht bearbeitet werden.','error');
        return;
      }
      toggleMeetingProtocolStatus(projectId);
      return;
    }

    if(action==='start-project'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht bearbeitet werden.','error');
        return;
      }
      startProjectWithMilestones(projectId).catch(function(err){
        notify('Projektstart fehlgeschlagen: '+(err&&err.message?err.message:String(err)),'error');
      });
      return;
    }

    if(action==='resolve-project-blocker'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht bearbeitet werden.','error');
        return;
      }
      if(window.DataLayer&&typeof window.DataLayer.canResolveBlocker==='function'&&!window.DataLayer.canResolveBlocker({
        targetType:'project',
        targetId:projectId
      })){
        notify('Blocker darf nur vom Admin oder vom Ersteller des Blockers entfernt werden.','error');
        return;
      }
      askResolutionText('Warum wurde der Blocker entfernt?','Blocker geloest').then(function(resolution){
        if(resolution===null)return;
        if(window.DataLayer&&typeof window.DataLayer.resolveProjectBlock==='function'){
          var resolved=window.DataLayer.resolveProjectBlock(projectId,{
            at:new Date().toISOString(),
            resolution:(resolution||'').trim()||'Blocker geloest'
          });
          if(resolved){
            notify('Projekt-Blocker entfernt.','info');
            render();
          }else{
            notify('Blocker konnte nicht entfernt werden (Rechte oder Datenstand).','error');
          }
        }
      });
      return;
    }

    if(action==='generate-ai-knowledge'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht bearbeitet werden.','error');
        return;
      }
      generateAiKnowledgeForProject(projectId).catch(function(err){
        notify('KI-Aufbereitung fehlgeschlagen: '+err.message,'error');
      });
      return;
    }

    if(action==='generate-ai-tasks'){
      if(!canEdit){
        notify('Dieses Projekt kann nicht bearbeitet werden.','error');
        return;
      }
      openAiKnowledgeTaskDialog(projectId,{autoGenerate:false});
      return;
    }

    if(action==='check-ai-health'){
      refreshAiHealthStatus(true).then(function(state){
        render();
        if(state.backendStatus==='ok'&&state.ollamaStatus==='ok'){
          notify('KI-Backend und Ollama sind erreichbar.','info');
        } else if(state.backendStatus==='ok'){
          notify('KI-Backend erreichbar, Ollama meldet Fehler.','error');
        } else {
          notify('KI-Backend aktuell nicht erreichbar.','error');
        }
      }).catch(function(err){
        render();
        notify('Health-Check fehlgeschlagen: '+(err&&err.message?err.message:String(err)),'error');
      });
      return;
    }

    if(action==='add-link'){
      addLink(projectId);
      return;
    }

    if(action==='delete-link'){
      deleteLink(projectId,target.dataset.linkId);
      return;
    }

    if(action==='add-secret'){
      addSecret(projectId);
      return;
    }

    if(action==='toggle-secret'){
      toggleSecretVisibility(projectId,target.dataset.secretId);
      return;
    }

    if(action==='delete-secret'){
      deleteSecret(projectId,target.dataset.secretId);
      return;
    }

    if(action==='add-note'){
      addNote(projectId);
      return;
    }

    if(action==='edit-note'){
      editNote(projectId,target.dataset.noteId);
      return;
    }

    if(action==='delete-note'){
      deleteNote(projectId,target.dataset.noteId);
      return;
    }

    if(action==='save-scratchpad'){
      saveScratchpad(projectId);
      return;
    }

    if(action==='save-env'){
      saveEnvText(projectId);
      return;
    }

    if(action==='delete-attachment'){
      removeAttachment(projectId,target.dataset.attachmentId);
      return;
    }

    if(action==='download-attachment'){
      downloadAttachment(projectId,target.dataset.attachmentId);
      return;
    }
  });

  list.addEventListener('change',function(evt){
    var target=evt.target;
    if(!target||!target.dataset)return;

    if(target.dataset.action==='attachment-input'&&target.dataset.id){
      addAttachments(target.dataset.id,target.files);
      target.value='';
    }
  });
}

function init(){
  try {
    if(!window.DataLayer){
      console.warn('[Projects] DataLayer missing');
      return;
    }

    bindForm();
    bindListActions();
    render();

    refreshAiHealthStatus(false).then(function(){
      render();
    }).catch(function(){
      render();
    });
  } catch(err){
    console.error('[Projects] init failed',err);
  }
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

window[NAMESPACE]={
  render:render,
  openCreateDialog:openProjectCreateDialog,
  closeCreateDialog:closeProjectCreateDialog,
  openImportDialog:openProjectImportDialog,
  closeImportDialog:closeProjectImportDialog,
  importCommitsForProject:importCommitsForProject,
  generateAiKnowledgeForProject:generateAiKnowledgeForProject,
  createProjectFromGitHub:createProjectFromGitHub,
  createProjectFromZip:createProjectFromZip
};

})();
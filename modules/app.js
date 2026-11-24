/* ========================================
   Projekt-Dashboard — Haupt-App (Router, Theme, Init)
   ======================================== */
(function(){'use strict';

function updatePageMeta(page){
  var titleEl=document.getElementById('page-title');
  var kickerEl=document.getElementById('page-kicker');
  var link=document.querySelector('.nav-menu [data-page="'+page+'"]');
  if(!titleEl||!kickerEl)return;

  if(link){
    titleEl.textContent=link.getAttribute('data-label')||link.textContent.trim()||'Projekt-Dashboard';
    kickerEl.textContent=link.getAttribute('data-kicker')||'Arbeitsbereich';
    return;
  }

  titleEl.textContent='Projekt-Dashboard';
  kickerEl.textContent='Arbeitsbereich';
}

function getAuthManager(){
  return window.AuthManager || null;
}

function getAuthorizedPage(page){
  var auth = getAuthManager();
  if (!auth || typeof auth.canAccessPage !== 'function') return page || 'dashboard';
  var target = page || 'dashboard';
  if (auth.canAccessPage(target)) return target;
  return typeof auth.getFallbackPage === 'function' ? auth.getFallbackPage() : 'dashboard';
}

var SIDEBAR_EXPANDED_KEY='pd_sidebar_expanded';
var ACTIVE_PAGE_STORAGE_KEY='pd_active_page';
var activePageRefreshFrame=null;
var activePageRefreshTimer=null;
var activePageRefreshTarget='';
var activePageRefreshOptions=null;

function saveActivePage(page){
  try {
    if(window.localStorage){
      window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, String(page || 'dashboard'));
    }
  } catch(_err) {}
}

function readActivePage(){
  try {
    if(!window.localStorage) return '';
    return window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) || '';
  } catch(_err) {
    return '';
  }
}

function isDesktopViewport(){
  return window.innerWidth>1024;
}

function readSidebarExpandedState(){
  if(!window.localStorage)return false;
  return window.localStorage.getItem(SIDEBAR_EXPANDED_KEY)==='1';
}

function writeSidebarExpandedState(expanded){
  if(!window.localStorage)return;
  window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, expanded ? '1' : '0');
}

function syncSidebarLayout(){
  var sidebar=document.getElementById('sidebar') || document.querySelector('.sidebar');
  var main=document.getElementById('main') || document.querySelector('.main-content');
  var toggleBtn=document.getElementById('mobile-menu-btn');
  if(!sidebar||!main)return;

  var expanded=isDesktopViewport() && readSidebarExpandedState();
  sidebar.classList.toggle('is-expanded', expanded);
  main.classList.toggle('sidebar-expanded', expanded);

  if(!isDesktopViewport()){
    sidebar.classList.remove('open');
  }

  if(toggleBtn){
    var mobileOpen=sidebar.classList.contains('open');
    toggleBtn.setAttribute('aria-expanded', isDesktopViewport() ? (expanded ? 'true' : 'false') : (mobileOpen ? 'true' : 'false'));
  }
}

function toggleSidebar(){
  var sidebar=document.getElementById('sidebar') || document.querySelector('.sidebar');
  var main=document.getElementById('main') || document.querySelector('.main-content');
  var toggleBtn=document.getElementById('mobile-menu-btn');
  if(!sidebar||!main)return;

  if(!isDesktopViewport()){
    sidebar.classList.toggle('open');
    if(toggleBtn){
      toggleBtn.setAttribute('aria-expanded', sidebar.classList.contains('open') ? 'true' : 'false');
    }
    return;
  }

  var expanded=!sidebar.classList.contains('is-expanded');
  sidebar.classList.toggle('is-expanded', expanded);
  main.classList.toggle('sidebar-expanded', expanded);
  writeSidebarExpandedState(expanded);

  if(toggleBtn){
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
}

// ---- Navigation / Router ----
function navigateTo(page){
  page = getAuthorizedPage(page);

  if(!document.getElementById(page)){
    page = 'dashboard';
  }

  // Hide all pages
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  
  // Show target page
  var target=document.getElementById(page);
  if(target)target.classList.add('active');
  
  // Update nav active state
  document.querySelectorAll('.nav-menu a').forEach(function(a){a.classList.remove('active');});
  var link=document.querySelector('[data-page="'+page+'"]');
  if(link){
    link.classList.add('active');
    var group=link.closest('.nav-group details');
    if(group)group.open=true;
  }

  updatePageMeta(page);
  saveActivePage(page);

  var sidebar=document.querySelector('.sidebar');
  if(sidebar&&window.innerWidth<=1024){
    sidebar.classList.remove('open');
    var mobileMenuBtn=document.getElementById('mobile-menu-btn');
    if(mobileMenuBtn)mobileMenuBtn.setAttribute('aria-expanded','false');
  }

  if(typeof refreshActivePageModule==='function'){
    scheduleActivePageRefresh();
  }
}

function setupNavigation(){
  document.querySelectorAll('.nav-menu a').forEach(function(link){
    link.title=link.getAttribute('data-label') || link.textContent.trim();
    link.addEventListener('click',function(e){
      e.preventDefault();
      var page=this.dataset.page;
      navigateTo(page);

      // Update URL hash without scrolling
      history.pushState(null,null,'#page='+page);
      saveActivePage(page);
    });
  });
  
  function parseHashToPage(hash){
    if(!hash) return '';
    var raw = hash.charAt(0)==='#' ? hash.substring(1) : hash;
    if(raw.indexOf('page=')===0) return raw.substring(5);
    return raw;
  }

  var initialPage=parseHashToPage(location.hash) || readActivePage() || 'dashboard';
  if(document.getElementById(initialPage)){
    navigateTo(initialPage);
  } else {
    navigateTo('dashboard');
  }

  window.addEventListener('hashchange',function(){
    var pageFromHash=parseHashToPage(location.hash);
    if(pageFromHash&&document.getElementById(pageFromHash)){
      navigateTo(pageFromHash);
    } else {
      var savedPage=readActivePage();
      if(savedPage&&document.getElementById(savedPage)){
        navigateTo(savedPage);
      }
    }
  });
}

// ---- Theme Toggle ----
function setupThemeToggle(){
  var btn=document.getElementById('theme-toggle');
  if(!btn)return;
  
  function readTheme(){
    if(window.DataLayer&&window.DataLayer.getStoredValue){
      return window.DataLayer.getStoredValue('pd_theme', 'dark');
    }
    return window.localStorage ? window.localStorage.getItem('pd_theme') : null;
  }

  function writeTheme(theme){
    if(window.DataLayer&&window.DataLayer.setStoredValue){
      window.DataLayer.setStoredValue('pd_theme', theme);
      return;
    }
    if(window.localStorage){
      window.localStorage.setItem('pd_theme', theme);
    }
  }
  
  var saved=readTheme();
  if(saved !== 'light' && saved !== 'dark') {
    saved = 'dark';
    writeTheme(saved);
  }
  document.body.classList.toggle('light-mode', saved === 'light');
  
  btn.addEventListener('click',function(){
    document.body.classList.toggle('light-mode');
    writeTheme(document.body.classList.contains('light-mode')?'light':'dark');
  });
}

// ---- Export / Import ----
function updateDatabaseStatusLabel(){
  var statusEl=document.getElementById('db-status');
  if(!statusEl || !window.DataLayer || !window.DataLayer.getDatabaseStatus)return;

  var status=window.DataLayer.getDatabaseStatus();
  if(status && status.hasFile){
    statusEl.textContent='SQL-DB: ' + (status.fileName || 'Datei') + ' gespeichert';
  }else if(status && status.ready){
    statusEl.textContent='SQL-DB: bereit';
  }else{
    statusEl.textContent='SQL-DB: initialisiert';
  }
}

function updateStorageStatusLabel(status){
  var statusEl=document.getElementById('storage-status');
  if(!statusEl)return;

  var resolvedStatus=status;
  if(!resolvedStatus&&window.DataLayer){
    if(window.DataLayer.getStorageStatus){
      resolvedStatus=window.DataLayer.getStorageStatus();
    } else if(window.DataLayer.getDatabaseStatus){
      var dbStatus=window.DataLayer.getDatabaseStatus();
      resolvedStatus={
        remoteReachable:!!(dbStatus&&dbStatus.remoteKvReachable),
        remotePath:dbStatus&&dbStatus.remoteKvPath?dbStatus.remoteKvPath:'',
        fallbackActive:!(dbStatus&&dbStatus.remoteKvReachable),
        localMirror:true,
        lastCheckedAt:''
      };
    }
  }

  if(!resolvedStatus){
    statusEl.textContent='Daten: Status unbekannt';
    statusEl.classList.remove('is-ok');
    statusEl.classList.add('is-warning');
    return;
  }

  var remoteReachable=!!resolvedStatus.remoteReachable;
  var remotePath=resolvedStatus.remotePath||'/api/kv';
  var lastChecked=resolvedStatus.lastCheckedAt?new Date(resolvedStatus.lastCheckedAt):null;
  var checkedLabel=(lastChecked&&!isNaN(lastChecked.getTime()))?lastChecked.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'n/a';

  if(remoteReachable){
    statusEl.textContent='Daten: Remote-Sync aktiv';
    statusEl.classList.remove('is-warning');
    statusEl.classList.add('is-ok');
  } else {
    statusEl.textContent='Daten: Lokaler Fallback aktiv';
    statusEl.classList.remove('is-ok');
    statusEl.classList.add('is-warning');
  }

  statusEl.title='KV-Endpunkt: '+remotePath+' | Letzte Pruefung: '+checkedLabel;
}

function startStorageStatusMonitor(){
  if(!window.DataLayer)return;

  updateStorageStatusLabel();

  if(window.DataLayer.on){
    window.DataLayer.on('storageStatusChanged',function(status){
      updateStorageStatusLabel(status);
    });
  }

  function refreshNow(){
    if(window.DataLayer&&window.DataLayer.checkStorageHealth){
      window.DataLayer.checkStorageHealth().then(function(result){
        updateStorageStatusLabel(result&&result.status?result.status:null);
      }).catch(function(){
        updateStorageStatusLabel();
      });
      return;
    }
    updateStorageStatusLabel();
  }

  refreshNow();
  window.setInterval(refreshNow,15000);
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)refreshNow();
  });
}

function setupDashboardUpdate(){
  var btn=document.getElementById('db-update-btn');
  if(!btn)return;
  var overlay=null,body=null,checkBtn=null,applyBtn=null,busy=false;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmtDate(v){var d=v?new Date(v):null;return d&&!isNaN(d)?d.toLocaleString('de-DE'):'-';}
  function fmtSize(n){return typeof n==='number'?(n/1048576).toFixed(2)+' MB':'-';}
  function row(k,v){return '<tr><th style="text-align:left;padding:2px 12px 2px 0;white-space:nowrap">'+k+'</th><td>'+v+'</td></tr>';}

  function api(path,method){
    return fetch(path,{method:method||'GET',cache:'no-store',credentials:'same-origin'}).then(function(r){
      return r.json().catch(function(){return {};}).then(function(data){
        if(!r.ok&&!data.update)throw new Error(data.error||('HTTP '+r.status));
        return data;
      });
    });
  }

  function render(version,check,message){
    var v=version||{};
    var html='<table style="border-collapse:collapse;font-size:13px">'
      +row('Version',esc(v.version?'v'+v.version+(v.date?' ('+v.date+')':''):'-'))
      +row('Build',esc(v.describe||v.shortCommit||'-')+(v.dirty?' <strong>(lokale Aenderungen)</strong>':''))
      +row('Commit',esc(v.shortCommit||'-')+' &ndash; '+esc(v.commitSubject||''))
      +row('Autor / Datum',esc(v.commitAuthor||'-')+' / '+fmtDate(v.commitDate))
      +row('Branch',esc(v.currentBranch||'-')+' (Update-Quelle: '+esc(v.remote||'')+'/'+esc(v.branch||'')+')')
      +row('Repository',esc(v.remoteUrl||'-'))
      +row('Datenbank',esc(v.db||'-')+' ('+fmtSize(v.dbSizeBytes)+')')
      +row('Server gestartet',fmtDate(v.startedAt)+' &middot; Python '+esc(v.python||'-'));
    if(v.lastCheck)html+=row('Letzte Pruefung',fmtDate(v.lastCheck.checkedAt));
    if(v.lastUpdate)html+=row('Letztes Update',fmtDate(v.lastUpdate.finishedAt||v.lastUpdate.startedAt)+' &ndash; '+(v.lastUpdate.ok?'erfolgreich':'fehlgeschlagen'+(v.lastUpdate.rolledBack?' (zurueckgerollt)':''))+': '+esc(v.lastUpdate.message));
    html+='</table>';
    if(check){
      if(check.diverged)html+='<p><strong>Lokale Commits weichen vom Repository ab.</strong> Automatisches Update nicht moeglich.</p>';
      else if(check.updateAvailable)html+='<p><strong>Update verfuegbar:</strong> '+check.behind+' neue(r) Commit(s) bis '+esc(check.remoteShortCommit)+'</p><ul style="margin:0;padding-left:18px;font-size:12px">'
        +check.commits.map(function(c){return '<li>'+esc(c.sha)+' '+esc(c.subject)+' <em>('+esc(c.author)+', '+fmtDate(c.date)+')</em></li>';}).join('')+'</ul>';
      else html+='<p>Das Dashboard ist auf dem neuesten Stand.</p>';
      applyBtn.disabled=!check.updateAvailable||!!v.dirty;
    }else applyBtn.disabled=true;
    if(message)html+='<p>'+esc(message)+'</p>';
    body.innerHTML=html;
  }

  function load(check,message){
    return api('/api/system/version').then(function(v){render(v,check,message);}).catch(function(e){body.textContent='Fehler: '+e.message;});
  }

  function run(fn){
    if(busy)return;busy=true;checkBtn.disabled=applyBtn.disabled=true;body.insertAdjacentHTML('beforeend','<p>Bitte warten...</p>');
    fn().catch(function(e){body.textContent='Fehler: '+e.message;}).then(function(){busy=false;checkBtn.disabled=false;});
  }

  function waitForRestart(tries){
    api('/api/system/version').then(function(){window.location.reload();}).catch(function(){
      if(tries>0)window.setTimeout(function(){waitForRestart(tries-1);},1500);
      else body.textContent='Server antwortet nicht. Bitte Seite manuell neu laden.';
    });
  }

  function build(){
    overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML='<div role="dialog" aria-label="Dashboard-Version" style="background:var(--surface,#fff);color:var(--text,#111);max-width:720px;width:92%;max-height:85vh;overflow:auto;padding:20px;border-radius:12px">'
      +'<h3 style="margin-top:0">Dashboard-Version &amp; Update</h3><div class="update-body"></div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="update-check">Nach Updates suchen</button><button class="update-apply" disabled>Jetzt aktualisieren</button><button class="update-close">Schliessen</button></div></div>';
    body=overlay.querySelector('.update-body');
    checkBtn=overlay.querySelector('.update-check');
    applyBtn=overlay.querySelector('.update-apply');
    overlay.querySelector('.update-close').addEventListener('click',function(){overlay.style.display='none';});
    overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.style.display='none';});
    checkBtn.addEventListener('click',function(){
      run(function(){return api('/api/system/update/check','POST').then(function(d){render(d.version,d.check);});});
    });
    applyBtn.addEventListener('click',function(){
      if(!confirm('Dashboard jetzt aktualisieren? Vor dem Update wird ein Datenbank-Backup erstellt und der Server neu gestartet.'))return;
      run(function(){return api('/api/system/update/apply','POST').then(function(d){
        var u=d.update||{};
        if(u.ok&&u.commits){render(d.version,null,u.message);waitForRestart(20);}
        else render(d.version,null,u.message);
      });});
    });
    document.body.appendChild(overlay);
  }

  btn.addEventListener('click',function(){
    if(!overlay)build();
    overlay.style.display='flex';
    body.textContent='Lade Versionsinformationen...';
    applyBtn.disabled=true;
    load();
  });
}

function setupExportImport(){
  var newDbBtn=document.getElementById('db-new-btn');
  if(newDbBtn){
    newDbBtn.addEventListener('click',function(){
      try{
        window.DataLayer.newDatabaseFile().then(function(){
          updateDatabaseStatusLabel();
          alert('Neue SQL-Datenbank wurde initialisiert.');
          refreshAllModules();
        }).catch(function(err){alert('Datenbank-Fehler: '+err.message);});
      }catch(e){console.error('[DB New]',e);}
    });
  }

  var openDbBtn=document.getElementById('db-open-btn');
  if(openDbBtn){
    openDbBtn.addEventListener('click',function(){
      try{
        window.DataLayer.openDatabaseFile().then(function(){
          updateDatabaseStatusLabel();
          alert('SQL-Datenbankdatei geöffnet.');
          refreshAllModules();
        }).catch(function(err){alert('Öffnen fehlgeschlagen: '+err.message);});
      }catch(e){console.error('[DB Open]',e);}
    });
  }

  var saveDbBtn=document.getElementById('db-save-btn');
  if(saveDbBtn){
    saveDbBtn.addEventListener('click',function(){
      try{
        window.DataLayer.saveDatabaseFile().then(function(success){
          updateDatabaseStatusLabel();
          if(success){alert('SQL-Datenbankdatei gespeichert.');}else{alert('Speichern war nicht möglich.');}
        }).catch(function(err){alert('Speichern fehlgeschlagen: '+err.message);});
      }catch(e){console.error('[DB Save]',e);}
    });
  }

  var exportBtn=document.getElementById('export-btn');
  if(exportBtn){
    exportBtn.addEventListener('click',function(){
      try{window.DataLayer.exportJSON();}catch(e){console.error('[Export]',e);}
    });
  }
  
  var importBtn=document.getElementById('import-btn');
  if(importBtn){
    // Create hidden file input for import
    var fileInput=document.createElement('input');
    fileInput.type='file';fileInput.accept='.json';fileInput.style.display='none';
    document.body.appendChild(fileInput);
    
    importBtn.addEventListener('click',function(){fileInput.click();});
    fileInput.addEventListener('change',function(e){
      var file=e.target.files[0];
      if(!file)return;
      
      try{
        window.DataLayer.importJSON(file).then(function(){
          alert('Daten erfolgreich importiert!');
          // Re-render all modules
          refreshAllModules();
        }).catch(function(err){alert('Import-Fehler: '+err.message);});
      }catch(err){alert('Import-Fehler: '+err.message);}
      
      // Reset file input for reuse
      e.target.value='';
    });
  }
}

// ---- Module Refresh System ----
function refreshAllModules(options){
  var config=options&&typeof options==='object'?options:{};
  var skipProjects=!!config.skipProjects;
  try{
    if(window.DashboardManager&&window.DashboardManager.refresh)window.DashboardManager.refresh();
    if(!skipProjects&&window.ProjectsModule&&window.ProjectsModule.render)window.ProjectsModule.render();
    if(window.KanbanBoard&&window.KanbanBoard.renderAllColumns)window.KanbanBoard.renderAllColumns();
    if(window.CalendarModule&&window.CalendarModule.render)window.CalendarModule.render();
    if(window.AnalyticsModule&&window.AnalyticsModule.render)window.AnalyticsModule.render();
    if(window.EmployeesModule&&window.EmployeesModule.render)window.EmployeesModule.render();
    if(window.LabelsModule&&window.LabelsModule.render)window.LabelsModule.render();
    if(window.HealthCheckModule&&window.HealthCheckModule.render)window.HealthCheckModule.render();
    if(window.ReleasesModule&&window.ReleasesModule.render)window.ReleasesModule.render();
    if(window.StandupModule&&window.StandupModule.render)window.StandupModule.render();
    if(window.TemplatesModule&&window.TemplatesModule.render)window.TemplatesModule.render();
    if(window.SearchModule&&window.SearchModule.render)window.SearchModule.render();
    if(window.SharingModule&&window.SharingModule.render)window.SharingModule.render();
    if(window.IntegrationsModule&&window.IntegrationsModule.render)window.IntegrationsModule.render();
    if(window.DocumentationModule&&window.DocumentationModule.render)window.DocumentationModule.render();
    if(window.SprintModule&&window.SprintModule.render)window.SprintModule.render();
    if(window.QuickTaskModule&&window.QuickTaskModule.renderRecentTasks)window.QuickTaskModule.renderRecentTasks();
    if(window.TaskHistoryModule&&window.TaskHistoryModule.render)window.TaskHistoryModule.render();
    if(window.TimelineModule&&window.TimelineModule.render)window.TimelineModule.render();
    if(window.MeetingModule&&window.MeetingModule.render)window.MeetingModule.render();
    if(window.AIConfModule&&window.AIConfModule.render)window.AIConfModule.render();
    if(window.AuthManager&&window.AuthManager.refreshUi)window.AuthManager.refreshUi();
  }catch(e){console.error('[Refresh]',e);}
}

function getActivePageId(){
  var active=document.querySelector('.page.active');
  return active&&active.id?active.id:'dashboard';
}

function refreshActivePageModule(options){
  var config=options&&typeof options==='object'?options:{};
  var skipProjects=!!config.skipProjects;
  var page=getActivePageId();

  try{
    if(page==='dashboard'){
      if(window.DashboardManager&&window.DashboardManager.refresh)window.DashboardManager.refresh();
    }else if(page==='projects'){
      if(!skipProjects&&window.ProjectsModule&&window.ProjectsModule.render)window.ProjectsModule.render();
    }else if(page==='kanban'){
      if(window.KanbanBoard&&window.KanbanBoard.renderAllColumns)window.KanbanBoard.renderAllColumns();
    }else if(page==='calendar'){
      if(window.CalendarModule&&window.CalendarModule.render)window.CalendarModule.render();
    }else if(page==='analytics'){
      if(window.AnalyticsModule&&window.AnalyticsModule.render)window.AnalyticsModule.render();
    }else if(page==='employees'){
      if(window.EmployeesModule&&window.EmployeesModule.render)window.EmployeesModule.render();
    }else if(page==='labels'){
      if(window.LabelsModule&&window.LabelsModule.render)window.LabelsModule.render();
    }else if(page==='healthcheck'){
      if(window.HealthCheckModule&&window.HealthCheckModule.render)window.HealthCheckModule.render();
    }else if(page==='releases'){
      if(window.ReleasesModule&&window.ReleasesModule.render)window.ReleasesModule.render();
    }else if(page==='standup'){
      if(window.StandupModule&&window.StandupModule.render)window.StandupModule.render();
    }else if(page==='templates'){
      if(window.TemplatesModule&&window.TemplatesModule.render)window.TemplatesModule.render();
    }else if(page==='search'){
      if(window.SearchModule&&window.SearchModule.render)window.SearchModule.render();
    }else if(page==='sharing'){
      if(window.SharingModule&&window.SharingModule.render)window.SharingModule.render();
    }else if(page==='integrations'){
      if(window.IntegrationsModule&&window.IntegrationsModule.render)window.IntegrationsModule.render();
    }else if(page==='documentation'){
      if(window.DocumentationModule&&window.DocumentationModule.render)window.DocumentationModule.render();
    }else if(page==='sprint'){
      if(window.SprintModule&&window.SprintModule.render)window.SprintModule.render();
    }else if(page==='quicktask'){
      if(window.QuickTaskModule&&window.QuickTaskModule.renderRecentTasks)window.QuickTaskModule.renderRecentTasks();
    }else if(page==='ai-conf'){
      if(window.AIConfModule&&window.AIConfModule.render)window.AIConfModule.render();
    }else if(page==='tasks'){
      if(window.TaskHistoryModule&&window.TaskHistoryModule.render)window.TaskHistoryModule.render();
    }else if(page==='timeline'){
      if(window.TimelineModule&&window.TimelineModule.render)window.TimelineModule.render();
    }else if(page==='meeting'){
      if(window.MeetingModule&&window.MeetingModule.render)window.MeetingModule.render();
    }

    if(window.AuthManager&&window.AuthManager.refreshUi)window.AuthManager.refreshUi();
  }catch(e){console.error('[Refresh Active]',e);}
}

function scheduleActivePageRefresh(options){
  activePageRefreshTarget=getActivePageId();
  activePageRefreshOptions=options||null;
  if(activePageRefreshFrame!==null||activePageRefreshTimer!==null)return;
  var requestFrame=window.requestAnimationFrame||function(callback){return window.setTimeout(callback,16);};
  activePageRefreshFrame=requestFrame(function(){
    activePageRefreshFrame=null;
    activePageRefreshTimer=window.setTimeout(function(){
      activePageRefreshTimer=null;
      var target=activePageRefreshTarget;
      var refreshOptions=activePageRefreshOptions;
      activePageRefreshTarget='';
      activePageRefreshOptions=null;
      if(target!==getActivePageId())return;
      refreshActivePageModule(refreshOptions);
    },0);
  });
}

// ---- Mobile Menu Toggle (for responsive) ----
function setupMobileMenu(){
  // Check if mobile menu button exists
  var menuBtn=document.getElementById('mobile-menu-btn');
  if(menuBtn){
    menuBtn.addEventListener('click',function(){
      toggleSidebar();
    });

    syncSidebarLayout();
    window.addEventListener('resize', syncSidebarLayout);
    
    // Close sidebar on outside click (mobile)
    document.addEventListener('click',function(e){
      var sidebar=document.querySelector('.sidebar');
      if(sidebar&&sidebar.classList.contains('open')&&!sidebar.contains(e.target)&&e.target!==menuBtn){
        sidebar.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

function setupProjectControlActions(){
  var focusCreate=document.getElementById('project-focus-create');
  var focusImport=document.getElementById('project-focus-import');

  function focusPanel(panelId, firstInputId){
    navigateTo('projects');
    var panel=document.getElementById(panelId);
    if(panel&&panel.scrollIntoView){
      panel.scrollIntoView({behavior:'smooth', block:'start'});
    }
    if(firstInputId){
      setTimeout(function(){
        var field=document.getElementById(firstInputId);
        if(field&&field.focus)field.focus();
      },120);
    }
  }

  if(focusCreate){
    focusCreate.addEventListener('click',function(){
      navigateTo('projects');
      if(window.ProjectsModule&&typeof window.ProjectsModule.openCreateDialog==='function'){
        window.ProjectsModule.openCreateDialog({reset:true,focusId:'project-title'});
        return;
      }
      focusPanel('projects-create-panel','project-title');
    });
  }

  if(focusImport){
    focusImport.addEventListener('click',function(){
      navigateTo('projects');
      if(window.ProjectsModule&&typeof window.ProjectsModule.openImportDialog==='function'){
        window.ProjectsModule.openImportDialog({focusId:'github-bootstrap-url'});
        return;
      }
      focusPanel('projects-import-panel','github-bootstrap-url');
    });
  }
}

// ---- Global Error Handler ----
window.onerror=function(msg,url,line,col,error){
  console.error('[App Error]',msg,'Line:',line,'Col:',col);
  return false; // Don't suppress browser error display
};

// ---- Init ----
function init(){
  try{
    if(window.AuthManager&&window.AuthManager.init)window.AuthManager.init();
    setupNavigation();
    setupThemeToggle();
    setupExportImport();
    setupDashboardUpdate();
    writeSidebarExpandedState(true);
    setupMobileMenu();
    setupProjectControlActions();
    updatePageMeta((location.hash||'').replace(/^#page=/,'')||'dashboard');
    updateDatabaseStatusLabel();
    startStorageStatusMonitor();
    
    // Listen for data changes and refresh current page's module
    if(window.DataLayer.on){
      window.DataLayer.on('dataChanged',function(event){
        var dashboardProgressDependencies=['all','employees','projects','tasks'];
        if(event&&dashboardProgressDependencies.indexOf(event.entity)!==-1&&window.DashboardManager&&typeof window.DashboardManager.renderProjectProgress==='function'){
          window.DashboardManager.renderProjectProgress();
        }
        var employeePageDependencies=['all','employees','projects','tasks'];
        if(getActivePageId()!=='employees'||!event||employeePageDependencies.indexOf(event.entity)!==-1){
          scheduleActivePageRefresh({skipProjects:true});
        }
        updateDatabaseStatusLabel();
        updateStorageStatusLabel();
      });
    }

    window.addEventListener('authChanged', function(){
      refreshActivePageModule({skipProjects:true});
    });

    var initialRefresh=Promise.resolve(true);
    if(window.DataLayer&&window.DataLayer.ready&&typeof window.DataLayer.ready.then==='function'){
      initialRefresh=window.DataLayer.ready;
    }

    initialRefresh.then(function(){
      refreshAllModules();
      updateDatabaseStatusLabel();
      updateStorageStatusLabel();
    }).catch(function(err){
      console.warn('[App Init] DataLayer hydration failed:', err);
      refreshAllModules();
    });

    // QuickTask page init
    var qtSection=document.getElementById('quicktask');
    if(qtSection&&window.QuickTaskModule&&window.QuickTaskModule.renderRecentTasks){
      window.QuickTaskModule.renderRecentTasks();
    }

    window.addEventListener('beforeunload', function () {
      if(window.DataLayer&&window.DataLayer.saveDatabaseFile){
        window.DataLayer.saveDatabaseFile().catch(function () {});
      }
    });
  }catch(e){console.error('[App Init]',e);}
}

window.AppShell = {
  navigateTo: navigateTo,
  refreshAllModules: refreshAllModules
};

// Run on DOM ready
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

})();

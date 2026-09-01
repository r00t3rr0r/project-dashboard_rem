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
  if(link)link.classList.add('active');

  updatePageMeta(page);
  saveActivePage(page);

  var sidebar=document.querySelector('.sidebar');
  if(sidebar&&window.innerWidth<=1024){
    sidebar.classList.remove('open');
    var mobileMenuBtn=document.getElementById('mobile-menu-btn');
    if(mobileMenuBtn)mobileMenuBtn.setAttribute('aria-expanded','false');
  }

  if(typeof refreshAllModules==='function'){
    refreshAllModules();
  }
}

function setupNavigation(){
  document.querySelectorAll('.nav-menu a').forEach(function(link){
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
      return window.DataLayer.getStoredValue('pd_theme', 'light');
    }
    return window.localStorage ? window.localStorage.getItem('pd_theme') : 'light';
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
  if(saved !== 'light') {
    writeTheme('light');
    saved = 'light';
  }
  if(saved === 'light') {
    document.body.classList.add('light-mode');
  }
  
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
    setupMobileMenu();
    setupProjectControlActions();
    updatePageMeta((location.hash||'').replace(/^#page=/,'')||'dashboard');
    updateDatabaseStatusLabel();
    startStorageStatusMonitor();
    
    // Listen for data changes and refresh current page's module
    if(window.DataLayer.on){
      window.DataLayer.on('dataChanged',function(){
        refreshActivePageModule({skipProjects:true});
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

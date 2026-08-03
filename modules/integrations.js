/* ========================================
   Integrationen (Feature 10)
   ======================================== */
(function(){'use strict';

function renderIntegrations(){
  try{
    var container=document.getElementById('integration-list');
    if(!container)return;
    
    var html='<div class="integration-grid">';
    
    // GitHub/GitLab Import
    html+='<div class="stat-card" style="padding:1.5rem;">' +
      '<h3>GitHub / GitLab Sync</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:1rem;font-size:0.85rem;">Importiere Issues und PRs als Tasks.</p>' +
      '<input type="file" id="gh-import-file" accept=".json,.zip" style="display:none;">' +
      '<button class="btn btn-primary" onclick="document.getElementById(\'gh-import-file\').click()">\u{1F4C2} JSON importieren</button>' +
      '<p style="color:var(--text-muted);font-size:0.75rem;margin-top:8px;">Unterst\u00fctzt GitHub API v3 JSON Export, GitLab Issues Export</p></div>';
    
    // RSS Feed Generator
    html+='<div class="stat-card" style="padding:1.5rem;">' +
      '<h3>RSS / Release-Feed</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:1rem;font-size:0.85rem;">Generiere RSS-Feed f\u00fcr Release-Updates.</p>' +
      '<button class="btn btn-primary" onclick="generateRSS()">\u{1F4E6} Feed generieren</button></div>';
    
    // Calendar Sync
    html+='<div class="stat-card" style="padding:1.5rem;">' +
      '<h3>Kalender-Sync</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:1rem;font-size:0.85rem;">Exportiere Deadlines als iCalendar-Datei.</p>' +
      '<button class="btn btn-primary" onclick="exportICS()">\u{1F4C5} iCal exportieren</button></div>';
    
    // Webhook
    html+='<div class="stat-card" style="padding:1.5rem;">' +
      '<h3>Webhooks</h3>' +
      '<p style="color:var(--text-secondary);margin-bottom:1rem;font-size:0.85rem;">Konfiguriere Webhook-Endpunkte f\u00fcr Event-Benachrichtigungen.</p>' +
      '<input type="text" placeholder="https://example.com/webhook" style="margin-bottom:8px;width:100%;">' +
      '<button class="btn btn-primary">\u{1F527} Webhook speichern</button></div>';
    
    html+='</div>';
    container.innerHTML=html;
  }catch(e){console.error('[Integrations]',e);}
}

window.importGitHubData=function(file){
  try{
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        var data=JSON.parse(e.target.result);
        
        // Handle GitHub issues format
        if(Array.isArray(data)){
          data.forEach(function(issue){
            window.DataLayer.createTask({
              title:issue.title||'Imported Issue',
              description:(issue.body||'').substring(0,500),
              priority:(issue.labels&&issue.labels.some(function(l){return l.name==='high';}))?'high':'medium',
              status:'todo',
              createdAt:new Date(issue.created_at||new Date()).toISOString(),
              externalId:issue.id,externalSource:'github'
            });
          });
          alert('Import abgeschlossen!');
        }
      }catch(err){alert('Fehler beim Importieren: '+err.message);}
    };
    reader.readAsText(file);
  }catch(e){console.error('[GH Import]',e);}
};

window.generateRSS=function(){
  try{
    var releases=window.DataLayer.getReleases()||[];
    if(releases.length===0)return alert('Keine Releases f\u00fcr RSS-Feed.');
    
    var rss='<?xml version="1.0" encoding="UTF-8"?>\n';
    rss+='<rss version="2.0"><channel>';
    rss+='<title>Projekt-Dashboard Releases</title>';
    rss+='<description>Automatischer Release-Feed</description>';
    rss+='<language>de-de</language>';
    
    releases.slice(-10).reverse().forEach(function(r){
      rss+='<item><title>Release '+escapeHtml(r.version||'v'+Math.random().toString(36).substr(2,5))+'</title>';
      rss+='<description>'+escapeHtml(r.description||r.changelog||'')+'</description>';
      rss+='<pubDate>'+new Date(r.createdAt||Date.now()).toUTCString()+'</pubDate></item>\n';
    });
    
    rss+='</channel></rss>';
    
    var blob=new Blob([rss],{type:'application/rss+xml'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download='feed.xml';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){console.error('[RSS]',e);}
};

window.exportICS=function(){
  try{
    if(window.CalendarModule&&window.CalendarModule.exportICS)window.CalendarModule.exportICS();
  }catch(e){console.error('[ICS]',e);}
};

function escapeHtml(s){if(!s)return'';var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}

document.addEventListener('DOMContentLoaded',function(){renderIntegrations();});
window.IntegrationsModule={render:renderIntegrations};
})();

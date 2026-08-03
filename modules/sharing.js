/* ========================================
   External Sharing (Feature 9)
   ======================================== */
(function(){'use strict';

function renderSharing(){
  try{
    var container=document.getElementById('share-list');
    if(!container)return;
    
    // Generate shareable links for each project
    var projects=window.DataLayer.getProjects();
    
    if(projects.length===0){
      container.innerHTML='<p style="color:var(--text-muted);padding:2rem;text-align:center;">Keine Projekte zum Teilen.</p>';
      return;
    }
    
    var html='';
    projects.forEach(function(p){
      // Encode project data in URL hash for sharing
      var shareData=encodeURIComponent(JSON.stringify({title:p.title||p.name,status:p.status,progress:calculateProjectProgress(p.id)}));
      var shareUrl=(window.location.origin+window.location.pathname+'#share/'+btoa(shareData));
      
      html+='<div class="release-card" style="margin-bottom:8px;padding:1rem;background:var(--bg-card);border-radius:8px;">';
      html+='<div><strong>'+escapeHtml(p.title||p.name)+'</strong>';
      if(p.status)html+=' <span class="badge badge-'+({'ok':'green','warning':'yellow','blocked':'red','planning':'blue'}[p.status]||'blue')+'">'+(p.status||'')+'</span>';
      
      html+='<div style="margin-top:8px;display:flex;gap:8px;">';
      html+='<button class="btn btn-secondary" onclick="copyShareLink(\''+encodeURIComponent(shareUrl)+'\')" style="font-size:0.8rem;">\u{1F4CB} Link kopieren</button>';
      html+='<button class="btn btn-secondary" onclick="generateReleaseBulletin(\''+p.id+'\')" style="font-size:0.8rem;">\u{1F4DC} Release Bulletin</button>';
      html+='</div></div></div>';
    });
    
    container.innerHTML=html;
  }catch(e){console.error('[Sharing]',e);}
}

function calculateProjectProgress(projectId){
  var tasks=(window.DataLayer.getTasks()||[]).filter(function(t){return t.projectId===projectId;});
  if(tasks.length===0)return 0;
  return Math.round((tasks.filter(function(t){return t.status==='done';}).length/tasks.length)*100);
}

function escapeHtml(s){if(!s)return'';var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}

window.copyShareLink=function(encodedUrl){
  try{
    var url=decodeURIComponent(encodedUrl);
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){alert('Link kopiert!');}).catch(function(){prompt('Kopiere diesen Link:',url);});
    }else{
      prompt('Kopiere diesen Link:',url);
    }
  }catch(e){console.error('[Copy Link]',e);}
};

window.generateReleaseBulletin=function(projectId){
  try{
    var tasks=(window.DataLayer.getTasks()||[]).filter(function(t){return t.projectId===projectId&&t.status==='done';});
    
    if(tasks.length===0)return alert('Keine abgeschlossenen Tasks f\u00fcr Bulletin.');
    
    var bulletin='**Release Bulletin: '+(new Date().toLocaleDateString('de-DE'))+'**\n\n';
    bulletin+='**Abgeschlossene Tasks:**\n';
    tasks.forEach(function(t){bulletin+ '- '+t.title+'\n';});
    
    // Open in new window for printing/sharing
    var w=window.open('','_blank');
    if(w){
      w.document.write('<html><head><title>Release Bulletin</title>');
      w.document.write('<style>body{font-family:sans-serif;padding:2rem;}h1{color:#333;}li{margin:4px 0;}</style>');
      w.document.write('</head><body>');
      w.document.write(bulletin.replace(/\*\*/g,'').replace(/\n/g,'<br>'));
      w.document.write('<hr><button onclick="window.print()">Drucken</button>');
      w.document.write('</body></html>');
    }
  }catch(e){console.error('[Bulletin]',e);}
};

document.addEventListener('DOMContentLoaded',function(){renderSharing();});
window.SharingModule={render:renderSharing};
})();

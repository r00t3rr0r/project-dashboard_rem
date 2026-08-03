/* ========================================
   Fortschrittsverlauf & Timeline (Feature 5)
   ======================================== */
(function(){'use strict';

function renderTimeline(projectId){
  try{
    var container=document.getElementById('timeline-bars');
    if(!container)return;
    
    // Get tasks for selected project or all projects
    var allTasks=window.DataLayer.getTasks();
    var tasks=allTasks.slice();
    
    if(projectId){tasks=tasks.filter(function(t){return t.projectId===projectId;});}
    
    if(tasks.length===0){container.innerHTML='<h3>Task-Timeline</h3><p class="timeline-empty">Keine Tasks vorhanden.</p>';return;}
    
    // Sort by start date
    tasks.sort(function(a,b){
      return new Date(a.startDate||a.createdAt||0)-new Date(b.startDate||b.createdAt||0);
    });
    
    var html='<h3>Task-Timeline</h3><div class="timeline-bars-wrap">';
    
    tasks.forEach(function(task){
      var start=task.startDate||task.createdAt;
      var end=task.endDate||new Date().toISOString();
      
      if(!start)return; // Skip tasks without dates
      
      var startDate=new Date(start);
      var endDate=new Date(end);
      var durationDays=Math.max(1,Math.round((endDate-startDate)/(1000*60*60*24)));
      
      // Simple timeline bar representation
      html+='<div class="timeline-task-row">';
      html+='<span class="timeline-task-title" title="'+escapeHtml(task.title)+'">'+escapeHtml(task.title)+'</span>';
      
      // Timeline bar
      var totalBars=40;
      var filled=Math.min(totalBars,Math.max(1,durationDays));
      html+='<div class="timeline-track">';
      
      // Status color
      var barColor={'todo':'var(--accent-blue)','in-progress':'var(--accent-yellow)','review':'var(--accent-red)','done':'var(--accent-green)'}[task.status]||'var(--accent-purple)';
      html+='<div class="timeline-bar-fill" style="flex:'+filled+';background:'+barColor+';" title="'+durationDays+' Tage"></div>';
      
      // Done indicator
      if(task.status==='done'){
        html+='<span class="timeline-done-indicator material-symbols-rounded" aria-hidden="true">check_circle</span>';
      }
      
      html+='</div></div>';
    });
    
    html+='</div>';
    container.innerHTML=html;
  }catch(e){console.error('[Timeline]',e);}
}

function renderStatusHistory(projectId){
  try{
    var container=document.getElementById('sprint-periods');
    if(!container)return;
    
    var allTasks=window.DataLayer.getTasks();
    var tasks=allTasks.slice();
    
    // Collect all status change events (simulated from task history)
    var allEvents=[];
    tasks.forEach(function(task){
      allEvents.push({date:task.createdAt,taskTitle:task.title,status:'created',taskId:task.id});
      if(task.status!=='todo'&&task.status!==undefined){
        allEvents.push({date:new Date().toISOString(),taskTitle:task.title,status:task.status+' (active)',taskId:task.id});
      }
    });
    
    // Sort by date
    allEvents.sort(function(a,b){return new Date(a.date)-new Date(b.date);});
    
    if(allEvents.length===0){container.innerHTML='<h2>Sprints</h2><h3>Status-Historie</h3><p class="timeline-empty">Keine Historie vorhanden.</p>';return;}
    
    var html='<h3>Status-Historie</h3><div class="timeline-history-list">';
    allEvents.slice(-50).forEach(function(evt){ // Last 50 events max
      html+='<div class="timeline-history-item">';
      html+='<span class="timeline-history-date">'+new Date(evt.date).toLocaleDateString('de-DE')+'</span>';
      var statusColor='var(--text-primary)';
      if(evt.status==='created')statusColor='var(--accent-blue)';
      else if(String(evt.status).indexOf('in-progress')===0)statusColor='var(--accent-yellow)';
      else if(String(evt.status).indexOf('review')===0)statusColor='var(--accent-red)';
      else if(String(evt.status).indexOf('done')===0)statusColor='var(--accent-green)';
      html+='<span class="timeline-history-status" style="color:'+statusColor+'">'+escapeHtml(evt.status)+'</span>';
      html+='<span class="timeline-history-title">'+escapeHtml(evt.taskTitle)+'</span></div>';
    });
    
    html+='</div>';
    container.innerHTML='<h2>Sprints</h2>'+html;
  }catch(e){console.error('[History]',e);}
}

function escapeHtml(s){if(!s)return'';var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}

document.addEventListener('DOMContentLoaded',function(){
  renderTimeline();
  renderStatusHistory();
  window.DataLayer.on&&window.DataLayer.on('dataChanged',renderTimeline);
  window.DataLayer.on&&window.DataLayer.on('dataChanged',renderStatusHistory);
});

window.TimelineModule={
  render:function(projectId){
    renderTimeline(projectId);
    renderStatusHistory(projectId);
  }
};
})();

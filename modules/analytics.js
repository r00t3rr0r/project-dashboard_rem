(function(){'use strict';

function svgEl(tag,attrs){var el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(var k in attrs)el.setAttribute(k,attrs[k]);return el;}

function renderBurndownChart(){
  try{
    var container=document.getElementById('analytics-burndown');
    if(!container)return;
    
    var tasks=window.DataLayer.getTasks();
    if(tasks.length===0){container.innerHTML='<h3>Burndown Chart</h3><p style="color:var(--text-muted);padding:1rem;">Keine Tasks vorhanden.</p>';return;}
    
    // Simple burndown: count remaining tasks over time
    var allTasks=tasks.slice();
    var totalStart=allTasks.length;
    
    // Group by status to simulate progress
    var doneCount=allTasks.filter(function(t){return t.status==='done';}).length;
    var remaining=totalStart-doneCount;
    
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','100%');svg.setAttribute('height','250');
    svg.style.maxWidth='600px';
    
    // Axes
    var W=580,H=220;
    svg.appendChild(svgEl('rect',{x:60,y:10,width:'100%',height:H,fill:'transparent'}));
    
    // Y axis labels
    for(var i=0;i<=totalStart;i+=Math.max(1,Math.floor(totalStart/5))){
      var y=H-20-(i/totalStart)*(H-40);
      svg.appendChild(svgEl('text',{x:55,y:y+4,'text-anchor':'end',fill:'var(--text-muted)','font-size':'11'}));
      // Can't set textContent on SVG element from DOM API easily, use title instead
    }
    
    // Ideal burndown line (diagonal)
    svg.appendChild(svgEl('line',{x1:70,y1:H-20,x2:W,y2:15,stroke:'var(--accent-blue)','stroke-dasharray':'4','opacity':'0.3'}));
    
    // Actual burndown
    if(doneCount>0){
      svg.appendChild(svgEl('line',{x1:70,y1:H-20,x2:W-((remaining/totalStart)*(W-80)),y1:15+((remaining/totalStart)*(H-40)),stroke:'var(--accent-green)',strokeWidth:3}));
    }
    
    container.innerHTML='<h3>Burndown Chart</h3>';
    var svgWrap=document.createElement('div');svgWrap.style.cssText='text-align:center;padding:1rem;';
    svgWrap.appendChild(svg);container.appendChild(svgWrap);
  }catch(e){console.error('[Burndown]',e);}
}

function renderCumulativeFlow(){
  try{
    var container=document.getElementById('analytics-sprint-trend');
    if(!container)return;
    
    var tasks=window.DataLayer.getTasks();
    if(tasks.length===0){container.innerHTML='<h3>Cumulative Flow Diagram</h3><p style="color:var(--text-muted);padding:1rem;">Keine Tasks vorhanden.</p>';return;}
    
    // Count tasks per status (stacked bar)
    var statuses=['backlog','todo','in-progress','review','done'];
    var counts={};statuses.forEach(function(s){counts[s]=tasks.filter(function(t){return t.status===s;}).length;});
    
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width','100%');svg.setAttribute('height','250');svg.style.maxWidth='600px';
    
    // Stacked bar chart using rects
    var W=580,H=220;
    var totalTasks=tasks.length;
    
    if(totalTasks===0){container.innerHTML='<h3>Cumulative Flow Diagram</h3><p style="color:var(--text-muted);padding:1rem;">Keine Tasks vorhanden.</p>';return;}
    
    // Draw stacked bars for each status
    var barWidth=Math.min(80,W/statuses.length-20);
    var startX=70;
    statuses.forEach(function(status,i){
      var x=startX+i*(barWidth+15);
      var barHeight=(counts[status]/totalTasks)*H*0.8;
      
      var colors={'backlog':'#9b59b6','todo':'#4a9eff','in-progress':'#f1c40f','review':'#e74c3c','done':'#2ecc71'};
      svg.appendChild(svgEl('rect',{x:x,y:H-20-barHeight,width:barWidth,height:barHeight,fill:colors[status]||'#666',opacity:'0.8',rx:3}));
      
      // Label
      var label=document.createElementNS('http://www.w3.org/2000/svg','text');
      label.setAttribute('x',x+barWidth/2);label.setAttribute('y',H-5);label.setAttribute('fill','var(--text-muted)');label.setAttribute('font-size','10');label.setAttribute('text-anchor','middle');
      label.textContent=counts[status];svg.appendChild(label);
    });
    
    container.innerHTML='<h3>Cumulative Flow Diagram</h3>';
    var svgWrap=document.createElement('div');svgWrap.style.cssText='text-align:center;padding:1rem;';
    svgWrap.appendChild(svg);container.appendChild(svgWrap);
  }catch(e){console.error('[CFD]',e);}
}

function renderDORAMetrics(){
  try{
    var container=document.getElementById('analytics-task-types');
    if(!container)return;
    
    var tasks=window.DataLayer.getTasks();
    if(tasks.length===0){container.innerHTML='<h3>DORA Metrics</h3><p style="color:var(--text-muted);padding:1rem;">Keine Daten vorhanden.</p>';return;}
    
    // Calculate DORA metrics from task data
    var totalChanges=tasks.length;
    var deployments=Math.ceil(tasks.filter(function(t){return t.status==='done';}).length/3);// Approximate
    var changeFailures=tasks.filter(function(t){return t.labels&&t.labels.indexOf('hotfix')!==-1;}).length;
    var failureRate=totalChanges>0?Math.round((changeFailures/totalChanges)*100):0;
    
    // Lead time: average days from created to done
    var completedTasks=tasks.filter(function(t){return t.status==='done'&&t.createdAt&&t.updatedAt;});
    var avgLeadTime=completedTasks.length>0?Math.round(completedTasks.reduce(function(acc,t){return acc+((new Date(t.updatedAt)-new Date(t.createdAt))/(1000*60*60*24));},0)/completedTasks.length):0;
    
    // Recovery time (simplified: avg days for hotfixes to complete)
    var hotfixes=tasks.filter(function(t){return t.labels&&t.labels.indexOf('hotfix')!==-1&&t.status==='done';});
    var recoveryTime=hotfixes.length>0?Math.round(hotfixes.reduce(function(acc,t){return acc+((new Date(t.updatedAt)-new Date(t.createdAt))/(1000*60*60*24));},0)/hotfixes.length):0;
    
    var html='<h3>DORA Metrics</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px, 1fr));gap:1rem;padding:1rem;">';
    html+='<div class="stat-card" style="text-align:center;"><strong>Deploy Frequency</strong><br><span style="font-size:2rem;color:'+(deployments>=3?'var(--accent-green)':'var(--accent-yellow)')+';">'+deployments+'</span></div>';
    html+='<div class="stat-card" style="text-align:center;"><strong>Avg. Lead Time</strong><br><span style="font-size:2rem;color:'+(avgLeadTime<=3?'var(--accent-green)':'var(--accent-yellow)')+';">'+avgLeadTime+'d</span></div>';
    html+='<div class="stat-card" style="text-align:center;"><strong>Change Failure Rate</strong><br><span style="font-size:2rem;color:'+(failureRate<=10?'var(--accent-green)':failureRate<=30?'var(--accent-yellow)':'var(--accent-red)')+';">'+failureRate+'%</span></div>';
    html+='<div class="stat-card" style="text-align:center;"><strong>Recovery Time</strong><br><span style="font-size:2rem;color:'+(recoveryTime<=1?'var(--accent-green)':recoveryTime<=3?'var(--accent-yellow)':'var(--accent-red)')+';">'+recoveryTime+'d</span></div>';
    html+='</div>';
    
    container.innerHTML=html;
  }catch(e){console.error('[DORA]',e);}
}

function renderVelocity(){
  try{
    var container=document.getElementById('analytics-task-types');
    // Velocity is rendered after DORA in same container, check if already has content
    // If not DORA was called first (same container), append velocity section
    var existing=container.innerHTML;
    
    if(existing.includes('<h3>DORA Metrics</h3>')){
      // Add velocity below DORA
      var tasks=window.DataLayer.getTasks();
      var html='<hr style="border-color:var(--border-color);margin:1rem 0;">';
      html+='<h3>Team Velocity (Tasks pro Status)</h3><div style="display:flex;gap:1rem;padding:1rem;flex-wrap:wrap;">';
      
      ['backlog','todo','in-progress','review','done'].forEach(function(status){
        var count=tasks.filter(function(t){return t.status===status;}).length;
        html+='<div class="stat-card" style="text-align:center;min-width:80px;"><strong>'+status+'</strong><br><span style="font-size:1.5rem;">'+count+'</span></div>';
      });
      
      html+='</div>';
      container.innerHTML+=html;
    }else{
      renderDORAMetrics();
    }
  }catch(e){console.error('[Velocity]',e);}
}

function renderAnalytics(){
  try{renderBurndownChart();renderCumulativeFlow();renderDORAMetrics();}
  catch(e){console.error('[Analytics]',e);}
}

function initAnalytics(){
  renderAnalytics();
  if(window.DataLayer&&window.DataLayer.on){
    window.DataLayer.on('dataChanged',renderAnalytics);
  }
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',initAnalytics);
}else{
  initAnalytics();
}

window.AnalyticsModule={render:renderAnalytics};
})();

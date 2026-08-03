/* ========================================
   Benachrichtigungen & Updates (Feature 6)
   ======================================== */
(function(){'use strict';

function renderNotifications(){
  try{
    var container=document.getElementById('notification-list');
    if(!container)return;
    
    var notifs=window.DataLayer.getNotifications()||[];
    
    if(notifs.length===0){
      container.innerHTML='<p style="color:var(--text-muted);padding:2rem;text-align:center;">Keine Benachrichtigungen.</p>';
      return;
    }
    
    var html='';
    notifs.forEach(function(n){
      html+='<div class="notification-item '+(n.read?'':'unread')+' '+((n.type||'info').toLowerCase())+'" style="margin-bottom:8px;padding:1rem;background:var(--bg-card);border-radius:8px;">';
      
      // Parse @mentions
      var text=escapeHtml(n.message||n.body||'');
      text=text.replace(/@(\w+)/g,'<span class="mention-highlight" style="background:rgba(74,158,255,0.2);padding:1px 4px;border-radius:3px;">@$1</span>');
      
      html+='<div>'+text+'</div>';
      html+='<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;display:flex;justify-content:space-between;">';
      if(n.createdAt)html+='<span>'+new Date(n.createdAt).toLocaleString('de-DE')+'</span>';
      
      // Mark read button
      html+='<button class="btn btn-secondary" style="padding:2px 8px;font-size:0.75rem;" onclick="markNotifRead(\''+n.id+'\')">';
      if(!n.read)html+='Als gelesen markieren';else html+='✓ Gelesen';
      html+='</button></div></div>';
    });
    
    // Clear all read button
    var unreadCount=notifs.filter(function(n){return!n.read;}).length;
    if(unreadCount>0){
      html+='<button class="btn btn-secondary mt-2" onclick="markAllRead()">Alle als gelesen markieren ('+unreadCount+')</button>';
    }
    
    container.innerHTML=html;
  }catch(e){console.error('[Notifications]',e);}
}

function escapeHtml(s){if(!s)return'';var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}

window.markNotifRead=function(id){
  try{window.DataLayer.markNotificationRead(id);renderNotifications();}catch(e){console.error('[Mark Read]',e);}
};

window.markAllRead=function(){
  try{
    var notifs=window.DataLayer.getNotifications()||[];
    notifs.forEach(function(n){if(!n.read)window.DataLayer.markNotificationRead(n.id);});
    renderNotifications();
  }catch(e){console.error('[Mark All]',e);}
};

// Auto-create notification on data changes (simulated)
function createAutoNotif(type,message){
  try{
    window.DataLayer.createNotification({type:type, message:message, createdAt:new Date().toISOString(), read:false});
  }catch(e){} // Ignore if notifications storage fails
}

document.addEventListener('DOMContentLoaded',function(){renderNotifications();});
window.NotificationsModule={render:renderNotifications};
})();

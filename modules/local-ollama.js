/* ========================================
   Local Ollama Browser Client
   KI-Anfragen laufen immer auf dem Rechner des Besuchers.
   ======================================== */
(function(){'use strict';

var OLLAMA_BASES=['http://127.0.0.1:11434','http://localhost:11434'];
var DEFAULT_MODEL='hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M';
var discoveredModels=[];
var activeOperations=[];
var operationSequence=0;
var progressTimer=null;
var activityState={status:'idle',progress:0,label:'Bereit',activeCount:0,error:'',updatedAt:''};

function operationLabel(path){
  var labels={
    '/api/ai/meeting-to-concept':'Projektkonzept erstellen',
    '/api/ai/concept-to-plan':'Projektplan erstellen',
    '/api/ai/plan-to-tasks':'Aufgaben erzeugen',
    '/api/ai/meeting-task-draft':'Aufgabenentwurf erstellen',
    '/api/ai/project-milestones-draft':'Meilensteine erstellen',
    '/api/ai/project-knowledge':'Projektwissen aufbereiten'
  };
  return labels[path]||'KI-Anfrage bearbeiten';
}

function publishActivity(next){
  activityState=Object.assign({},activityState,next||{},{updatedAt:new Date().toISOString()});
  window.dispatchEvent(new CustomEvent('localOllamaStatusChanged',{detail:Object.assign({},activityState)}));
}

function stopProgressTimer(){
  if(progressTimer){clearInterval(progressTimer);progressTimer=null;}
}

function syncWorkingActivity(){
  if(!activeOperations.length){stopProgressTimer();return;}
  var current=activeOperations[activeOperations.length-1];
  publishActivity({
    status:current.stopping?'stopping':'working',
    progress:current.progress,
    label:current.label,
    activeCount:activeOperations.length,
    error:''
  });
}

function beginOperation(path,externalSignal){
  var controller=typeof AbortController!=='undefined'?new AbortController():null;
  var operation={id:++operationSequence,label:operationLabel(path),progress:8,controller:controller,stopping:false};
  if(controller&&externalSignal){
    if(externalSignal.aborted)controller.abort();
    else externalSignal.addEventListener('abort',function(){controller.abort();},{once:true});
  }
  activeOperations.push(operation);
  syncWorkingActivity();
  if(!progressTimer){
    progressTimer=setInterval(function(){
      activeOperations.forEach(function(item){
        if(!item.stopping)item.progress=Math.min(92,item.progress+(item.progress<40?2:item.progress<70?1.2:0.5));
      });
      syncWorkingActivity();
    },300);
  }
  return operation;
}

function finishOperation(operation,error){
  activeOperations=activeOperations.filter(function(item){return item.id!==operation.id;});
  if(activeOperations.length){syncWorkingActivity();return;}
  stopProgressTimer();
  var aborted=!!error&&(error.name==='AbortError'||/abort/i.test(String(error.message||'')));
  publishActivity({
    status:error?(aborted?'stopped':'error'):'complete',
    progress:error?0:100,
    label:error?(aborted?'KI-Arbeit gestoppt':'KI-Anfrage fehlgeschlagen'):'KI-Arbeit abgeschlossen',
    activeCount:0,
    error:error&&!aborted?String(error.message||error):''
  });
}

function stopAll(){
  activeOperations.forEach(function(operation){
    operation.stopping=true;
    if(operation.controller)operation.controller.abort();
  });
  if(activeOperations.length)syncWorkingActivity();
}

function globalConfig(){
  if(window.AIConfModule&&typeof window.AIConfModule.getConfiguration==='function')return window.AIConfModule.getConfiguration()||{};
  return {};
}

function isLocalBrowserHost(){
  try{
    var hostname=(window.location&&window.location.hostname)?String(window.location.hostname).toLowerCase():'';
    return hostname==='localhost'||hostname==='127.0.0.1'||hostname==='::1'||hostname==='[::1]';
  }catch(_err){
    return false;
  }
}

function isRemoteProxyMode(){
  return !!(window.location&&window.location.origin)&&!isLocalBrowserHost();
}

function modelFrom(payload){
  var config=payload&&payload.promptConfig&&typeof payload.promptConfig==='object'?payload.promptConfig:{};
  var global=globalConfig();
  var selected=config.model||payload&&payload.model||global.primaryModel||global.fallbackModel||DEFAULT_MODEL;
  return String(selected).trim()||DEFAULT_MODEL;
}

function configFrom(payload){
  var config=payload&&payload.promptConfig&&typeof payload.promptConfig==='object'?payload.promptConfig:{};
  var global=globalConfig();
  var temperature=Number(config.temperature);
  var maxTokens=Number(config.maxTokens);
  if(!isFinite(temperature))temperature=Number(global.temperature);
  if(!isFinite(maxTokens))maxTokens=Number(global.maxTokens);
  return {
    temperature:isFinite(temperature)?Math.max(0,Math.min(1,temperature)):0.3,
    maxTokens:isFinite(maxTokens)?Math.max(200,Math.min(6000,Math.round(maxTokens))):3200
  };
}

function jsonContext(payload){
  return JSON.stringify(payload||{},null,2);
}

function buildPrompt(path,payload){
  var supplied=payload&&payload.promptConfig&&String(payload.promptConfig.prompt||'').trim();
  var context='\n\nEingabedaten (JSON):\n'+jsonContext(payload);
  if(supplied)return supplied+context;

  if(path==='/api/ai/meeting-to-concept'){
    return 'Du bist ein Senior Projektstratege. Erstelle aus den Eingabedaten ein kompaktes Projektkonzept mit Zielbild, Scope, Stakeholdern, Risiken, Annahmen und naechsten Schritten. Antworte nur mit dem finalen Markdown.'+context;
  }
  if(path==='/api/ai/concept-to-plan'){
    return 'Du bist ein erfahrener Projektmanager. Erstelle aus Konzept und Meeting-Notizen einen umsetzbaren Phasenplan mit Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan. Antworte nur mit dem finalen Markdown.'+context;
  }
  if(path==='/api/ai/plan-to-tasks'){
    return 'Du bist Tech-Lead und Product Owner. Zerlege den Projektplan in technisch ausführbare Entwicklungsaufgabenschritte und formuliere jede Aufgabe als konkrete Arbeitseinheit mit klarer Aktion. Erzeuge 6 bis 20 realistische, geordnete Kanban-Aufgaben. Antworte ausschliesslich als JSON mit {"summaryMarkdown":"...","tasks":[{"title":"...","description":"...","status":"todo","priority":"medium","effortHours":4,"labels":[],"subtasks":[],"sequenceIndex":1,"dependsOnPrevious":false,"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""}}]}.'+context;
  }
  if(path==='/api/ai/meeting-task-draft'){
    return 'Du bist ein zweisprachiger Projektassistent (Deutsch/Englisch) fuer operative IT-Umsetzung. Erzeuge aus Titel, Beschreibung und Projektkontext einen realistischen Aufgabenentwurf. Nutze den Entwicklungsprozess als Leitfaden: Analyse, technisches Design, Implementierung, Tests, Review, Dokumentation/Release. Erzeuge 3 bis 8 konkrete subtasksDe/subtasksEn als Arbeitsschritte in sinnvoller Reihenfolge. Schaetze effortHours plausibel auf Basis der Anzahl der Teilaufgaben und ihrer ungefaehren Dauer; die Summe soll zu den subtasks passen und > 0 sein. Wenn Mitarbeiterdaten im Kontext enthalten sind, darf assigneeId ausschliesslich eine dort vorhandene Mitarbeiter-ID sein. Wenn sinnvoll, fuelle optionale Felder wie labels, schedule und note mit realistischen Werten. Antworte ausschliesslich als JSON mit {"summaryMarkdown":"...","task":{"titleDe":"...","titleEn":"...","descriptionDe":"...","descriptionEn":"...","priority":"medium","urgency":"normal","effortHours":3,"assigneeId":"","labels":[],"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""},"sequenceIndex":1,"dependsOnPrevious":false,"subtasksDe":[],"subtasksEn":[],"note":""},"taskSuggestions":[],"event":{"create":false,"title":"","description":"","type":"task","date":"","startTime":"","endTime":""}}. Liefere bei mehreren Arbeitspaketen 2 bis 8 taskSuggestions im gleichen Aufgabenformat und setze fuer inhaltliche Folgeaufgaben dependsOnPrevious=true.'+context;
  }
  if(path==='/api/ai/project-milestones-draft'){
    return 'Du bist Senior Delivery Manager. Erzeuge 3 bis 10 realistische Meilensteine aus den Projektdaten. Antworte ausschliesslich als JSON mit {"summaryMarkdown":"...","milestones":[{"title":"...","description":"...","date":"YYYY-MM-DD","startTime":"","endTime":"","type":"release"}]}.'+context;
  }
  if(path==='/api/ai/project-knowledge'){
    return 'Du bist ein technischer Projektanalyst. Verdichte den Projektsnapshot zu einer strukturierten Wissensbasis mit Ueberblick, Architektur, Status, Risiken, offenen Punkten und naechsten Schritten. Antworte nur mit dem finalen Markdown.'+context;
  }
  throw new Error('Nicht unterstuetzte lokale KI-Funktion: '+path);
}

function parseJson(text){
  var cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(cleaned);}catch(_err){
    var start=cleaned.indexOf('{');
    var end=cleaned.lastIndexOf('}');
    if(start!==-1&&end>start)return JSON.parse(cleaned.slice(start,end+1));
    throw new Error('Ollama hat kein gueltiges JSON geliefert.');
  }
}

function isJsonPath(path){
  return path==='/api/ai/plan-to-tasks'||path==='/api/ai/meeting-task-draft'||path==='/api/ai/project-milestones-draft';
}

function localFetch(path,options){
  function tryBase(index,lastError){
    if(index>=OLLAMA_BASES.length){
      var detail=lastError&&lastError.message?lastError.message:String(lastError||'unbekannter Fehler');
      var originHint=(window.location&&window.location.origin)?window.location.origin:'dieser Browser';
      return Promise.reject(new Error('Lokales Ollama ist nicht erreichbar. Das KI-Feature nutzt nur die Ollama-Instanz auf dem gleichen Rechner, auf dem der Browser laeuft. Ollama auf diesem Rechner starten und OLLAMA_ORIGINS fuer '+originHint+' erlauben. Wenn die App via http://178.105.213.50 geoeffnet wird, kann der Browser nicht auf die lokale localhost-Instanz eines anderen Rechners zugreifen. Dann muss die App lokal auf dem Mitarbeiter-Rechner gestartet werden. Details: '+detail));
    }
    return fetch(OLLAMA_BASES[index]+path,options).then(function(response){
      return response.json().catch(function(){return {};}).then(function(body){
        if(!response.ok)throw new Error(body&&body.error?body.error:'HTTP '+response.status);
        return {body:body,endpoint:OLLAMA_BASES[index]+path};
      });
    }).catch(function(error){return tryBase(index+1,error);});
  }
  return tryBase(0,null);
}

function health(){
  if(isRemoteProxyMode()){
    return remoteFetch('/api/ai/health','GET').then(function(result){
      return {
        endpoint:result.endpoint,
        body:result.body||{status:'error'}
      };
    });
  }
  return localFetch('/api/tags',{method:'GET'}).then(function(result){
    discoveredModels=Array.isArray(result.body.models)?result.body.models.map(function(item){return String(item&&(item.name||item.model)||'').trim();}).filter(Boolean):[];
    return {
      endpoint:result.endpoint,
      body:{status:'ok',models:Array.isArray(result.body.models)?result.body.models:[],ollamaBaseUrl:result.endpoint.replace(/\/api\/tags$/,'')}
    };
  });
}

function resolvedPayload(payload){
  var next=Object.assign({},payload||{});
  var supplied=next.promptConfig&&typeof next.promptConfig==='object'?next.promptConfig:{};
  var global=globalConfig();
  next.promptConfig=Object.assign({},global,supplied);
  return next;
}

function resolveModel(payload){
  var config=payload&&payload.promptConfig&&typeof payload.promptConfig==='object'?payload.promptConfig:{};
  var configured=String(config.model||payload&&payload.model||config.primaryModel||'').trim();
  if(configured)return Promise.resolve(configured);
  if(discoveredModels.length)return Promise.resolve(discoveredModels[0]);
  return localFetch('/api/tags',{method:'GET'}).then(function(result){
    discoveredModels=Array.isArray(result.body.models)?result.body.models.map(function(item){return String(item&&(item.name||item.model)||'').trim();}).filter(Boolean):[];
    return discoveredModels[0]||DEFAULT_MODEL;
  }).catch(function(){return DEFAULT_MODEL;});
}

function wrapResult(path,payload,text){
  var generatedAt=new Date().toISOString();
  var model=modelFrom(payload);
  if(path==='/api/ai/meeting-to-concept')return {ok:true,stage:'concept',model:model,generatedAt:generatedAt,markdown:text,markdownChunks:[text]};
  if(path==='/api/ai/concept-to-plan')return {ok:true,stage:'plan',model:model,generatedAt:generatedAt,markdown:text,markdownChunks:[text]};
  if(path==='/api/ai/project-knowledge')return {ok:true,model:model,generatedAt:generatedAt,markdown:text,filePath:'',bytes:new TextEncoder().encode(text).length};

  var parsed=parseJson(text);
  if(path==='/api/ai/plan-to-tasks')return {ok:true,stage:'tasks',model:model,generatedAt:generatedAt,markdown:parsed.summaryMarkdown||'',tasks:Array.isArray(parsed.tasks)?parsed.tasks:[]};
  if(path==='/api/ai/meeting-task-draft')return {ok:true,stage:'task-draft',model:model,generatedAt:generatedAt,markdown:parsed.summaryMarkdown||'',draft:parsed};
  if(path==='/api/ai/project-milestones-draft')return {ok:true,model:model,generatedAt:generatedAt,markdown:parsed.summaryMarkdown||'',draft:parsed};
  return parsed;
}

function remoteFetch(path,method,payload,options){
  var url=(window.location&&window.location.origin?window.location.origin:'')+String(path||'');
  var init={
    method:String(method||'GET'),
    headers:{'Content-Type':'application/json'}
  };
  if(options&&options.signal)init.signal=options.signal;
  if(method&&String(method).toUpperCase()!=='GET'&&typeof payload!=='undefined'){
    init.body=JSON.stringify(payload||{});
  }
  return fetch(url,init).then(function(response){
    return response.json().catch(function(){return {};}).then(function(body){
      if(!response.ok)throw new Error(body&&body.error?body.error:'HTTP '+response.status+' an '+url);
      return {body:body,endpoint:url};
    });
  });
}

function requestGeneration(requestBody,options){
  return localFetch('/api/generate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(requestBody),
    signal:options&&options.signal?options.signal:undefined
  });
}

function generateCore(path,payload,options){
  payload=resolvedPayload(payload);
  if(isRemoteProxyMode()){
    return remoteFetch(path,'POST',payload||{},options||{}).then(function(result){
      return result.body||{};
    });
  }

  var config=configFrom(payload||{});
  return resolveModel(payload).then(function(selectedModel){
    var requestBody={
      model:selectedModel,
      prompt:buildPrompt(path,payload||{}),
      stream:false,
      options:{temperature:config.temperature,num_predict:config.maxTokens}
    };
    if(isJsonPath(path))requestBody.format='json';
    return requestGeneration(requestBody,options||{}).then(function(result){
    try{
      return wrapResult(path,payload||{},String(result.body.response||''));
    }catch(firstError){
      if(!isJsonPath(path))throw firstError;
      var retryBody=JSON.parse(JSON.stringify(requestBody));
      retryBody.prompt+='\n\nDie vorige Ausgabe war unvollstaendig oder syntaktisch ungueltig. Erzeuge das JSON erneut, kompakt und vollstaendig. Validiere intern alle Klammern, Arrays, Kommata und Anfuehrungszeichen. Gib ausschliesslich ein einziges gueltiges JSON-Objekt aus.';
      retryBody.options.temperature=0;
      retryBody.options.num_predict=Math.min(6000,Math.max(3600,config.maxTokens*2));
      return requestGeneration(retryBody,options||{}).then(function(retryResult){
        try{
          return wrapResult(path,payload||{},String(retryResult.body.response||''));
        }catch(retryError){
          throw new Error('Ollama hat auch beim zweiten Versuch kein vollstaendiges JSON geliefert. Bitte den Entwurf erneut starten oder den Projektkontext verkleinern. Details: '+String(retryError&&retryError.message?retryError.message:retryError));
        }
      });
    }
    });
  });
}

function generate(path,payload,options){
  var suppliedOptions=options||{};
  var operation=beginOperation(path,suppliedOptions.signal);
  var trackedOptions=Object.assign({},suppliedOptions);
  if(operation.controller)trackedOptions.signal=operation.controller.signal;
  return generateCore(path,payload,trackedOptions).then(function(result){
    finishOperation(operation,null);
    return result;
  }).catch(function(error){
    finishOperation(operation,error);
    throw error;
  });
}

function request(path,method,payload,options){
  if(path==='/api/ai/health'&&method==='GET')return health();
  if(isRemoteProxyMode()){
    if(method!=='POST')return Promise.reject(new Error('Nicht unterstuetzte remote Ollama-Methode: '+method));
    return remoteFetch(path,method,payload||{},options||{}).then(function(result){
      return {endpoint:result.endpoint,body:result.body||{}};
    });
  }
  if(method!=='POST')return Promise.reject(new Error('Nicht unterstuetzte lokale Ollama-Methode: '+method));
  return generate(path,payload||{},options||{}).then(function(body){return {endpoint:OLLAMA_BASES[0]+'/api/generate',body:body};});
}

window.LocalOllama={
  bases:OLLAMA_BASES.slice(),
  request:request,
  generate:function(path,payload,options){return generate(path,payload||{},options||{});},
  health:health,
  getStatus:function(){return Object.assign({},activityState);},
  stopAll:stopAll
};

})();
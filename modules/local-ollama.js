/* ========================================
   Local Ollama Browser Client
   KI-Anfragen laufen immer auf dem Rechner des Besuchers.
   ======================================== */
(function(){'use strict';

var OLLAMA_BASES=['http://127.0.0.1:11434','http://localhost:11434','http://178.105.213.50/11434'];
var PROVIDER_KEY='pd_ai_provider';
var PROVIDERS={
  ollama:{label:'Ollama (lokal)'},
  claude:{label:'Claude',keyField:'claude',model:'claude-sonnet-4-5'},
  openai:{label:'ChatGPT',keyField:'openai',model:'gpt-4o-mini'}
};
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
    '/api/ai/dashboard-updates':'Dashboard-Neuerungen erstellen',
    '/api/ai/dashboard-analysis':'Commits lokal analysieren',
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

function configFrom(payload){
  var config=payload&&payload.promptConfig&&typeof payload.promptConfig==='object'?payload.promptConfig:{};
  var temperature=Number(config.temperature);
  var maxTokens=Number(config.maxTokens);
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
  if(path==='/api/ai/dashboard-updates'&&supplied)return supplied;
  if(supplied)return supplied+context;
  if(payload&&String(payload.draftInput||'').trim())return String(payload.draftInput).trim()+context;

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
  return path==='/api/ai/plan-to-tasks'||path==='/api/ai/meeting-task-draft'||path==='/api/ai/project-milestones-draft'||path==='/api/ai/dashboard-updates';
}

function generationModels(models){
  return (Array.isArray(models)?models:[]).filter(function(model){
    if(Array.isArray(model&&model.capabilities)&&model.capabilities.length)return model.capabilities.indexOf('completion')!==-1;
    var name=String(model&&(model.name||model.model)||model||'');
    return !!name&&!/embed|(?:^|[\/:_-])(?:bge|e5)(?:[\/:_-]|$)/i.test(name);
  });
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
  var provider=getProvider();
  if(isCloudProvider(provider))return cloudHealth(provider);
  if(isRemoteProxyMode()){
    return remoteFetch('/api/ai/health','GET').then(function(result){
      var body=Object.assign({},result.body||{status:'error'});
      body.models=generationModels(body.models);
      discoveredModels=body.models.map(function(item){return String(item&&(item.name||item.model)||item||'').trim();}).filter(Boolean);
      return {
        endpoint:result.endpoint,
        body:body
      };
    });
  }
  return localFetch('/api/tags',{method:'GET'}).then(function(result){
    var models=generationModels(result.body.models);
    discoveredModels=models.map(function(item){return String(item&&(item.name||item.model)||item||'').trim();}).filter(Boolean);
    return {
      endpoint:result.endpoint,
      body:{status:'ok',models:models,ollamaBaseUrl:result.endpoint.replace(/\/api\/tags$/,'')}
    };
  });
}

function resolvedPayload(payload){
  var next=Object.assign({},payload||{});
  var supplied=next.promptConfig&&typeof next.promptConfig==='object'?next.promptConfig:{};
  var global=globalConfig();
  next.promptConfig=Object.assign({},supplied,{
    temperature:global.temperature,
    maxTokens:global.maxTokens
  });
  return next;
}

function resolveModels(){
  return Promise.resolve(window.DataLayer&&window.DataLayer.ready).then(function(){
  var global=globalConfig();
  var routing=String(global.routing||'auto').toLowerCase();
  var primary=String(global.primaryModel||'').trim();
  var fallback=String(global.fallbackModel||'').trim();
  var configured=routing==='fixed'?[primary]:(routing==='fallback'?[primary,fallback]:[primary,fallback]);
  configured=configured.filter(function(model,index){return !!model&&configured.indexOf(model)===index;});
  if(configured.length)return Promise.resolve(configured);
  if(discoveredModels.length)return Promise.resolve([discoveredModels[0]]);
  return health().then(function(){
    if(discoveredModels.length)return [discoveredModels[0]];
    throw new Error('Kein textgenerierendes Ollama-Modell verfuegbar. Bitte unter Auswahl & Fallback ein installiertes Textmodell auswaehlen. Embedding-Modelle unterstuetzen keine Textgenerierung.');
  });
  });
}

function applyModel(payload,model){
  payload.model=model;
  payload.promptConfig=Object.assign({},payload.promptConfig||{},{model:model});
  return payload;
}

function isModelUnavailableError(error){
  return /model .+ not found|model.*nicht gefunden|unknown model|does not support generate|does not support completion/i.test(String(error&&error.message||error||''));
}

function wrapResult(path,payload,text){
  var generatedAt=new Date().toISOString();
  var model=String(payload&&payload.model||'').trim();
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

function privateLocalRequest(path,options){
  return fetch('http://127.0.0.1:11434'+path,Object.assign({redirect:'error',credentials:'omit'},options||{})).then(function(response){
    return response.json().then(function(body){
      if(!response.ok)throw new Error(body.error||'HTTP '+response.status);
      return body;
    });
  }).catch(function(error){
    if(error&&error.name==='AbortError')throw error;
    throw new Error('Lokales Ollama auf diesem Rechner ist nicht erreichbar oder hat die Anfrage abgelehnt: '+String(error&&error.message||error));
  });
}

function privateLocalModels(){
  return privateLocalRequest('/api/tags',{method:'GET'}).then(function(body){
    return generationModels(body.models).filter(function(item){
      var name=String(item&&(item.name||item.model)||item||'').trim();
      return name&&!/(?:^|:|-)cloud$/i.test(name)&&!(item&&item.remote_host)&&!(item&&item.remote_model);
    }).map(function(item){return String(item&&(item.name||item.model)||item||'').trim();});
  });
}

function privateLocalGenerate(prompt,model,options){
  if(!model)return Promise.reject(new Error('Bitte ein lokales Textmodell auswählen.'));
  if(/(?:^|:|-)cloud$/i.test(model))return Promise.reject(new Error('Cloud-Modelle sind für diese Analyse nicht erlaubt.'));
  var taggedModel=model.lastIndexOf(':')>model.lastIndexOf('/')?model:model+':latest';
  var operation=beginOperation('/api/ai/dashboard-analysis',options&&options.signal);
  return privateLocalRequest('/api/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:taggedModel+':local',prompt:prompt,stream:false,format:options&&options.schema||'json',truncate:false,
      options:{temperature:0.1,num_predict:4096,num_ctx:16384}}),
    signal:operation.controller?operation.controller.signal:undefined
  }).then(function(body){
    if(body.done_reason==='length')throw new Error('Die lokale KI-Ausgabe wurde abgeschnitten. Bitte ein geeignetes Modell wählen.');
    var result=parseJson(body.response);
    finishOperation(operation,null);
    return result;
  }).catch(function(error){finishOperation(operation,error);throw error;});
}

function currentEmployee(){
  try{
    var auth=window.AuthManager||window.AuthModule;
    return auth&&typeof auth.getCurrentUser==='function'?auth.getCurrentUser():null;
  }catch(_err){return null;}
}

function getProvider(){
  var value='ollama';
  try{value=window.localStorage.getItem(PROVIDER_KEY)||'ollama';}catch(_err){}
  return PROVIDERS[value]?value:'ollama';
}

function setProvider(provider){
  if(!PROVIDERS[provider])return;
  try{window.localStorage.setItem(PROVIDER_KEY,provider);}catch(_err){}
  window.dispatchEvent(new CustomEvent('aiProviderChanged',{detail:{provider:provider}}));
}

function isCloudProvider(provider){return !!(PROVIDERS[provider]&&PROVIDERS[provider].keyField);}

function providerKey(provider){
  var user=currentEmployee();
  var keys=user&&user.aiKeys&&typeof user.aiKeys==='object'?user.aiKeys:{};
  return String(keys[PROVIDERS[provider].keyField]||'').trim();
}

function providerSelectHtml(id){
  var current=getProvider();
  return '<label class="form-group ai-provider-select"><span>KI-Schnittstelle</span><select id="'+id+'" data-ai-provider-select>'
    +Object.keys(PROVIDERS).map(function(key){return '<option value="'+key+'"'+(key===current?' selected':'')+'>'+PROVIDERS[key].label+'</option>';}).join('')
    +'</select></label>';
}

function bindProviderSelect(root){
  Array.prototype.forEach.call((root||document).querySelectorAll('[data-ai-provider-select]'),function(select){
    select.value=getProvider();
  });
}

if(typeof document!=='undefined')document.addEventListener('change',function(event){
  var target=event.target;
  if(target&&target.hasAttribute&&target.hasAttribute('data-ai-provider-select'))setProvider(target.value);
});

if(typeof document!=='undefined'&&window.addEventListener)window.addEventListener('aiProviderChanged',function(event){
  var provider=event&&event.detail&&event.detail.provider;
  Array.prototype.forEach.call(document.querySelectorAll('[data-ai-provider-select]'),function(select){select.value=provider;});
});

function missingKeyError(provider){
  return new Error('Fuer '+PROVIDERS[provider].label+' ist im Mitarbeiterprofil kein API-Schluessel hinterlegt. Bitte unter Mitarbeiter > KI-Schluessel eintragen oder eine andere KI-Schnittstelle waehlen.');
}

function cloudComplete(provider,requestBody,options){
  var key=providerKey(provider);
  if(!key)return Promise.reject(missingKeyError(provider));
  var url,headers,body;
  if(provider==='claude'){
    url='https://api.anthropic.com/v1/messages';
    headers={'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
    body={model:requestBody.model,max_tokens:requestBody.maxTokens,temperature:requestBody.temperature,messages:[{role:'user',content:requestBody.prompt}]};
  }else{
    url='https://api.openai.com/v1/chat/completions';
    headers={'Content-Type':'application/json','Authorization':'Bearer '+key};
    body={model:requestBody.model,max_tokens:requestBody.maxTokens,temperature:requestBody.temperature,messages:[{role:'user',content:requestBody.prompt}]};
    if(requestBody.json)body.response_format={type:'json_object'};
  }
  return fetch(url,{method:'POST',headers:headers,body:JSON.stringify(body),signal:options&&options.signal?options.signal:undefined}).then(function(response){
    return response.json().catch(function(){return {};}).then(function(data){
      if(!response.ok){
        var message=data&&data.error&&(data.error.message||data.error)||'HTTP '+response.status;
        throw new Error(PROVIDERS[provider].label+': '+(typeof message==='string'?message:JSON.stringify(message)));
      }
      if(provider==='claude')return (Array.isArray(data.content)?data.content:[]).map(function(part){return part&&part.text||'';}).join('');
      return String(data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content||'');
    });
  },function(error){
    if(error&&error.name==='AbortError')throw error;
    throw new Error(PROVIDERS[provider].label+' nicht erreichbar: '+String(error&&error.message||error));
  });
}

function cloudHealth(provider){
  var model=PROVIDERS[provider].model;
  discoveredModels=[model];
  if(!providerKey(provider))return Promise.resolve({endpoint:provider,body:{status:'error',error:missingKeyError(provider).message,models:[{name:model}]}});
  return Promise.resolve({endpoint:provider,body:{status:'ok',provider:provider,models:[{name:model}]}});
}

function generateCloud(provider,path,payload,options){
  payload=resolvedPayload(payload);
  var config=configFrom(payload);
  var model=PROVIDERS[provider].model;
  applyModel(payload,model);
  var requestBody={model:model,prompt:buildPrompt(path,payload),temperature:config.temperature,maxTokens:config.maxTokens,json:isJsonPath(path)};
  return cloudComplete(provider,requestBody,options).then(function(text){
    try{return wrapResult(path,payload,text);}catch(firstError){
      if(!isJsonPath(path))throw firstError;
      var retry=Object.assign({},requestBody,{temperature:0,maxTokens:Math.min(6000,Math.max(3600,config.maxTokens*2))});
      retry.prompt+='\n\nDie vorige Ausgabe war unvollstaendig oder syntaktisch ungueltig. Gib ausschliesslich ein einziges gueltiges JSON-Objekt aus.';
      return cloudComplete(provider,retry,options).then(function(retryText){return wrapResult(path,payload,retryText);});
    }
  });
}

function generateCore(path,payload,options){
  var provider=getProvider();
  if(isCloudProvider(provider))return generateCloud(provider,path,payload,options);
  payload=resolvedPayload(payload);
  var config=configFrom(payload||{});
  return resolveModels().then(function(models){
    var selectedModel=models[0];
    applyModel(payload,selectedModel);
    if(isRemoteProxyMode()){
      return remoteFetch(path,'POST',payload||{},options||{}).then(function(result){
        return result.body||{};
      }).catch(function(error){
        if(models.length<2||!isModelUnavailableError(error))throw error;
        applyModel(payload,models[1]);
        return remoteFetch(path,'POST',payload||{},options||{}).then(function(result){return result.body||{};});
      });
    }
    var requestBody={
      model:selectedModel,
      prompt:buildPrompt(path,payload||{}),
      stream:false,
      options:{temperature:config.temperature,num_predict:config.maxTokens}
    };
    if(isJsonPath(path))requestBody.format='json';
    function generateWithModel(model){
      requestBody.model=model;
      applyModel(payload,model);
      return requestGeneration(requestBody,options||{});
    }
    return generateWithModel(selectedModel).catch(function(error){
      if(models.length<2||!isModelUnavailableError(error))throw error;
      return generateWithModel(models[1]);
    }).then(function(result){
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
  if(isCloudProvider(getProvider())){
    if(method!=='POST')return Promise.reject(new Error('Nicht unterstuetzte KI-Methode: '+method));
    return generate(path,payload||{},options||{}).then(function(body){return {endpoint:getProvider(),body:body};});
  }
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
  getProvider:getProvider,
  setProvider:setProvider,
  providers:function(){return Object.keys(PROVIDERS).map(function(key){return {id:key,label:PROVIDERS[key].label};});},
  providerSelectHtml:providerSelectHtml,
  bindProviderSelect:bindProviderSelect,
  privateLocalModels:privateLocalModels,
  privateLocalGenerate:privateLocalGenerate,
  getStatus:function(){return Object.assign({},activityState);},
  stopAll:stopAll
};

})();
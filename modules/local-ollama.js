/* ========================================
   Local Ollama Browser Client
   KI-Anfragen laufen immer auf dem Rechner des Besuchers.
   ======================================== */
(function(){'use strict';

var OLLAMA_BASES=['http://127.0.0.1:11434','http://localhost:11434'];
var DEFAULT_MODEL='hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M';

function modelFrom(payload){
  var config=payload&&payload.promptConfig&&typeof payload.promptConfig==='object'?payload.promptConfig:{};
  return String(config.model||payload&&payload.model||DEFAULT_MODEL).trim()||DEFAULT_MODEL;
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
  if(supplied)return supplied+context;

  if(path==='/api/ai/meeting-to-concept'){
    return 'Du bist ein Senior Projektstratege. Erstelle aus den Eingabedaten ein kompaktes Projektkonzept mit Zielbild, Scope, Stakeholdern, Risiken, Annahmen und naechsten Schritten. Antworte nur mit dem finalen Markdown.'+context;
  }
  if(path==='/api/ai/concept-to-plan'){
    return 'Du bist ein erfahrener Projektmanager. Erstelle aus Konzept und Meeting-Notizen einen umsetzbaren Phasenplan mit Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan. Antworte nur mit dem finalen Markdown.'+context;
  }
  if(path==='/api/ai/plan-to-tasks'){
    return 'Du bist Tech-Lead und Product Owner. Erzeuge 6 bis 20 realistische, geordnete Kanban-Aufgaben. Antworte ausschliesslich als JSON mit {"summaryMarkdown":"...","tasks":[{"title":"...","description":"...","status":"todo","priority":"medium","effortHours":4,"labels":[],"subtasks":[],"sequenceIndex":1,"dependsOnPrevious":false,"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""}}]}.'+context;
  }
  if(path==='/api/ai/meeting-task-draft'){
    return 'Du bist ein zweisprachiger Projektassistent. Erzeuge aus Benutzereingabe und Projektkontext einen realistischen Aufgabenentwurf. Antworte ausschliesslich als JSON mit {"summaryMarkdown":"...","task":{"titleDe":"...","titleEn":"...","descriptionDe":"...","descriptionEn":"...","priority":"medium","urgency":"normal","effortHours":3,"labels":[],"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""},"sequenceIndex":1,"dependsOnPrevious":false,"subtasksDe":[],"subtasksEn":[],"note":""},"taskSuggestions":[],"event":{"create":false,"title":"","description":"","type":"task","date":"","startTime":"","endTime":""}}. Liefere bei mehreren Arbeitspaketen 2 bis 8 taskSuggestions im gleichen Aufgabenformat.'+context;
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
      return Promise.reject(new Error('Lokales Ollama ist nicht erreichbar. Ollama auf diesem Rechner starten und OLLAMA_ORIGINS fuer '+window.location.origin+' erlauben. Details: '+detail));
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
  return localFetch('/api/tags',{method:'GET'}).then(function(result){
    return {
      endpoint:result.endpoint,
      body:{status:'ok',models:Array.isArray(result.body.models)?result.body.models:[],ollamaBaseUrl:result.endpoint.replace(/\/api\/tags$/,'')}
    };
  });
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

function requestGeneration(requestBody){
  return localFetch('/api/generate',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(requestBody)
  });
}

function generate(path,payload){
  var config=configFrom(payload||{});
  var requestBody={
    model:modelFrom(payload||{}),
    prompt:buildPrompt(path,payload||{}),
    stream:false,
    options:{temperature:config.temperature,num_predict:config.maxTokens}
  };
  if(isJsonPath(path))requestBody.format='json';

  return requestGeneration(requestBody).then(function(result){
    try{
      return wrapResult(path,payload||{},String(result.body.response||''));
    }catch(firstError){
      if(!isJsonPath(path))throw firstError;
      var retryBody=JSON.parse(JSON.stringify(requestBody));
      retryBody.prompt+='\n\nDie vorige Ausgabe war unvollstaendig oder syntaktisch ungueltig. Erzeuge das JSON erneut, kompakt und vollstaendig. Validiere intern alle Klammern, Arrays, Kommata und Anfuehrungszeichen. Gib ausschliesslich ein einziges gueltiges JSON-Objekt aus.';
      retryBody.options.temperature=0;
      retryBody.options.num_predict=Math.min(6000,Math.max(3600,config.maxTokens*2));
      return requestGeneration(retryBody).then(function(retryResult){
        try{
          return wrapResult(path,payload||{},String(retryResult.body.response||''));
        }catch(retryError){
          throw new Error('Ollama hat auch beim zweiten Versuch kein vollstaendiges JSON geliefert. Bitte den Entwurf erneut starten oder den Projektkontext verkleinern. Details: '+String(retryError&&retryError.message?retryError.message:retryError));
        }
      });
    }
  });
}

function request(path,method,payload){
  if(path==='/api/ai/health'&&method==='GET')return health();
  if(method!=='POST')return Promise.reject(new Error('Nicht unterstuetzte lokale Ollama-Methode: '+method));
  return generate(path,payload||{}).then(function(body){return {endpoint:OLLAMA_BASES[0]+'/api/generate',body:body};});
}

window.LocalOllama={
  bases:OLLAMA_BASES.slice(),
  request:request,
  generate:function(path,payload){return generate(path,payload||{});},
  health:health
};

})();
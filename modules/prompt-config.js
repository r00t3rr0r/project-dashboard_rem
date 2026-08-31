/* ========================================
   Prompt Config Module
   Konfigurierbares Prompt-Modal mit Presets
   ======================================== */
(function(){'use strict';

var NAMESPACE='PromptConfig';
var STORAGE_KEY='prompt_presets';

var STAGE_KEYS={concept:'concept',plan:'plan',tasks:'tasks'};

function conceptOutputHint(){
  return 'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. Plane aus Sicht eines IT-Mitarbeiters und formuliere so, dass Stufe 2 direkt daraus einen Startplan bauen kann. '; 
}

function technicalTaskOutputHint(){
  return 'Zerlege den Projektplan in technisch ausfuehrbare Entwicklungsaufgabenschritte. Formuliere jede Aufgabe als klaren, umsetzbaren Task mit konkreter Aktion und eindeutigem Ergebnis. Keine Epics, kein Brainstorming, keine allgemeinen Arbeitspakete ohne Implementierungsbezug. Nutze beide Strukturmoeglichkeiten: Jede Aufgabe braucht immer 2-8 subtasks und es soll mindestens eine Aufgabenkette mit dependsOnPrevious entstehen. Halte die Hauptaufgabenanzahl uebersichtlich und verlagere Details in subtasks. Jede Aufgabe braucht einen realistischen Aufwand und eine zeitliche Einordnung (deadline/fixed/range/asap wenn ableitbar). '; 
}

function planOutputHint(){
  return 'Liefere nur die finale Antwort. Keine Analyse, keine Vorrede, kein Meta-Text. Liefere einen Startplan fuer die ersten 10 Arbeitstage sowie Aufwand- und Zeitraum-Einschaetzungen je Phase aus IT-Perspektive. '; 
}

function tasksJsonSchemaHint(){
  return '{\n'
    +'  "summaryMarkdown": "...",\n'
    +'  "tasks": [\n'
    +'    {"title":"...","description":"...","status":"todo","priority":"medium","effortHours":4,"labels":[],"subtasks":[],"sequenceIndex":1,"dependsOnPrevious":false,"schedule":{"mode":"none","deadline":"","fixedAt":"","rangeStart":"","rangeEnd":""}}\n'
    +'  ]\n'
    +'}';
}

var DEFAULT_PRESETS={
  creative:{
    key:'creative',
    name:'Kreativ & Visionaer',
    description:'Neue Perspektiven mit klaren Ergebnissen je KI-Stufe.',
    temperature:0.8,
    maxTokens:1600,
    model:'',
    outputFormat:'Markdown',
    template:'',
    templates:{
      concept:'Du bist ein kreativer Projektberater mit Umsetzungsfokus.\\n\\nStufe: 1 (Konzept)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle ein frisches, aber realistisch umsetzbares Projektkonzept mit Zielbild, Scope, Stakeholdern, Chancen, Risiken, Annahmen und naechsten Schritten. '+conceptOutputHint(),
      plan:'Du bist ein kreativer Delivery-Planer.\\n\\nStufe: 2 (Projektplan)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle einen klaren Projektplan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan. Das Konzept ist die Primaerquelle. '+planOutputHint(),
      tasks:'Du bist ein kreativer Product Owner mit Delivery-Fokus.\\n\\nStufe: 3 (Tasks)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErzeuge 6-20 importierbare, logisch geordnete Aufgabenpakete fuer ein Kanban-Board. Gib ausschliesslich gueltiges JSON in folgendem Schema aus (ohne Markdown, ohne Erklaerung):\\n'+tasksJsonSchemaHint()+'\\nRegeln: sequenceIndex fortlaufend ab 1, dependsOnPrevious fuer echte Folgeschritte, status aus {backlog,todo,in-progress,review,done}, priority aus {low,medium,high,blocker}. '+technicalTaskOutputHint()
    }
  },
  technical:{
    key:'technical',
    name:'Praezise & Technisch',
    description:'Architektur, Datenqualitaet und robuste Umsetzbarkeit je KI-Stufe.',
    temperature:0.3,
    maxTokens:1800,
    model:'',
    outputFormat:'JSON',
    template:'',
    templates:{
      concept:'Du bist ein technischer Lead.\\n\\nStufe: 1 (Konzept)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle ein tragfaehiges technisches Projektkonzept mit Zielbild, Scope, Architektur-Skizze, Schnittstellen, Risiken, Annahmen und naechsten Schritten. '+conceptOutputHint(),
      plan:'Du bist technischer Delivery-Manager.\\n\\nStufe: 2 (Projektplan)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nLiefere einen detaillierten Umsetzungsplan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und einem 6-Wochen-Aktionsplan. Das Konzept ist die Primaerquelle. '+planOutputHint(),
      tasks:'Du bist Tech-Lead und Product Owner.\\n\\nStufe: 3 (Tasks)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErzeuge 6-20 importierbare Kanban-Aufgaben. Gib ausschliesslich gueltiges JSON im folgenden Schema aus (ohne Markdown, ohne Erklaerung):\\n'+tasksJsonSchemaHint()+'\\nRegeln: summaryMarkdown max 5 Stichpunkte, sequenceIndex fortlaufend ab 1, dependsOnPrevious nur bei inhaltlicher Abfolge, realistische effortHours und Labels. '+technicalTaskOutputHint()
    }
  },
  manager:{
    key:'manager',
    name:'Projektmanager',
    description:'Strukturierte Steuerung von Konzept bis Aufgabenuebernahme.',
    temperature:0.4,
    maxTokens:1600,
    model:'',
    outputFormat:'Markdown',
    template:'',
    templates:{
      concept:'Du bist ein erfahrener Projektmanager.\\n\\nStufe: 1 (Konzept)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle ein belastbares Projektkonzept mit Zielbild, Scope, Stakeholdern, Risiken, Annahmen und den naechsten priorisierten Schritten. '+conceptOutputHint(),
      plan:'Du bist ein erfahrener Projektmanager mit Delivery-Verantwortung.\\n\\nStufe: 2 (Projektplan)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nLiefere einen umsetzbaren Projektplan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und KPI inkl. 6-Wochen-Aktionsplan. '+planOutputHint(),
      tasks:'Du bist Projektmanager und Product Owner fuer die operative Planung.\\n\\nStufe: 3 (Tasks)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nLeite 6-20 umsetzbare Arbeitspakete fuer das Kanban-Board ab. Gib ausschliesslich gueltiges JSON im Schema aus:\\n'+tasksJsonSchemaHint()+'\\nRegeln: sequenceIndex fortlaufend ab 1, Abhaengigkeiten ueber dependsOnPrevious markieren, status/priority Werte strikt einhalten. '+technicalTaskOutputHint()
    }
  },
  summary:{
    key:'summary',
    description:'Kompakte, stufenspezifische Verdichtung fuer schnelle Entscheidungen.',
    temperature:0.2,
    maxTokens:900,
    model:'',
    outputFormat:'Markdown',
    template:'',
    templates:{
      concept:'Du bist Analyst mit Fokus auf Klarheit.\\n\\nStufe: 1 (Konzept)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nVerdichte zu einem kompakten Konzept mit Zielbild, Scope, Stakeholdern, Risiken, Annahmen und naechsten Schritten. '+conceptOutputHint(),
      plan:'Du bist Analyst fuer Projektsteuerung.\\n\\nStufe: 2 (Projektplan)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle einen kompakten, aber vollstaendigen Plan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und 6-Wochen-Aktionsplan. '+planOutputHint(),
      tasks:'Du bist Analyst fuer operative Aufgabenplanung.\\n\\nStufe: 3 (Tasks)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nLeite 6-20 priorisierte, importierbare Tasks ab. Gib ausschliesslich gueltiges JSON im Schema aus:\\n'+tasksJsonSchemaHint()+'\\n'+technicalTaskOutputHint()
    }
  },
  userstory:{
    key:'userstory',
    name:'User Story',
    description:'User-Stories entlang der drei KI-Stufen mit klaren Akzeptanzkriterien.',
    temperature:0.5,
    maxTokens:1700,
    model:'',
    outputFormat:'JSON',
    template:'',
    templates:{
      concept:'Du bist Product Owner.\\n\\nStufe: 1 (Konzept)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErzeuge ein Konzept aus Nutzerperspektive mit Zielbild, Scope, Stakeholdern, Risiken, Annahmen und naechsten Schritten. '+conceptOutputHint(),
      plan:'Du bist Product Owner fuer Delivery und Priorisierung.\\n\\nStufe: 2 (Projektplan)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nErstelle einen priorisierten Projektplan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen, Risiken und 6-Wochen-Fokus. '+planOutputHint(),
      tasks:'Du bist Product Owner und zerlegst den Plan in umsetzbare Arbeitspakete.\\n\\nStufe: 3 (Tasks)\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nGib ausschliesslich gueltiges JSON im Schema aus:\\n'+tasksJsonSchemaHint()+'\\nRegeln: fokus auf Nutzerwert, Akzeptanzkriterien in description integrieren, sequenceIndex fortlaufend und Abhaengigkeiten korrekt setzen. '+technicalTaskOutputHint()
    }
  },
  custom:{
    key:'custom',
    name:'Custom',
    description:'Eigene Einstellungen fuer diesen Workflow.',
    temperature:0.5,
    maxTokens:1400,
    model:'',
    outputFormat:'Markdown',
    template:'Projekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nZielausgabe: {{outputFormat}}.',
    templates:{
      concept:'Projekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nZiel: Konzept (Stufe 1) erstellen.',
      plan:'Projekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\nAusgabeformat: {{outputFormat}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nZiel: Projektplan (Stufe 2) erstellen.',
      tasks:'Projekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nStufe 1 - Konzept:\\n{{conceptMarkdown}}\\n\\nStufe 2 - Projektplan:\\n{{planMarkdown}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Projektdaten (JSON):\\n{{existingData}}\\n\\nZiel: Aufgaben (Stufe 3) als gueltiges JSON erzeugen.'
    }
  }
};

function escapeHtml(value){
  if(value===null||value===undefined)return '';
  var div=document.createElement('div');
  div.appendChild(document.createTextNode(String(value)));
  return div.innerHTML;
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function mergePreset(base,override){
  var merged=Object.assign({},base,override||{});
  var baseTemplates=base&&base.templates&&typeof base.templates==='object'?base.templates:{};
  var overrideTemplates=override&&override.templates&&typeof override.templates==='object'?override.templates:{};
  merged.templates=Object.assign({},baseTemplates,overrideTemplates);
  return merged;
}

function resolveTemplateForStage(preset,stageKey,fallbackPreset){
  var key=stageKey||STAGE_KEYS.concept;
  var selected=preset&&preset.templates&&preset.templates[key];
  if(selected)return String(selected);
  if(preset&&preset.template)return String(preset.template);
  var fallbackStage=fallbackPreset&&fallbackPreset.templates&&fallbackPreset.templates[key];
  if(fallbackStage)return String(fallbackStage);
  return String((fallbackPreset&&fallbackPreset.template)||'');
}

function templateHasToken(text,token){
  return String(text||'').indexOf('{{'+token+'}}')!==-1;
}

function ensureRuntimeTokens(template,stageKey){
  var out=String(template||'').trim();
  if(!out)out='Projekt: {{projectTitle}}\nPreset: {{preset}}\nSprache: {{language}}';

  if(!templateHasToken(out,'projectTitle'))out+='\nProjekt: {{projectTitle}}';
  if(!templateHasToken(out,'preset'))out+='\nPreset: {{preset}}';
  if(!templateHasToken(out,'language'))out+='\nSprache: {{language}}';
  if(!templateHasToken(out,'meetingNotes'))out+='\n\nMeeting-Notizen:\n{{meetingNotes}}';

  if((stageKey===STAGE_KEYS.plan||stageKey===STAGE_KEYS.tasks)&&!templateHasToken(out,'conceptMarkdown')){
    out+='\n\nStufe 1 - Konzept:\n{{conceptMarkdown}}';
  }
  if(stageKey===STAGE_KEYS.tasks&&!templateHasToken(out,'planMarkdown')){
    out+='\n\nStufe 2 - Projektplan:\n{{planMarkdown}}';
  }
  if(!templateHasToken(out,'existingData'))out+='\n\nBestehende Projektdaten (JSON):\n{{existingData}}';
  return out;
}

function readPresets(){
  var merged=clone(DEFAULT_PRESETS);
  try{
    var raw=window.localStorage.getItem(STORAGE_KEY);
    if(!raw)return merged;
    var parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object')return merged;
    Object.keys(merged).forEach(function(key){
      if(parsed[key]&&typeof parsed[key]==='object'){
        merged[key]=mergePreset(merged[key],parsed[key]);
      }
    });
  }catch(_err){}
  return merged;
}

function savePresets(presets){
  try{
    window.localStorage.setItem(STORAGE_KEY,JSON.stringify(presets));
  }catch(_err){}
}

function replaceTemplate(template,vars){
  var out=String(template||'');
  Object.keys(vars).forEach(function(key){
    var token='{{'+key+'}}';
    out=out.split(token).join(String(vars[key]||''));
  });
  return out;
}

function normalizeNumber(value,fallback,min,max){
  var n=Number(value);
  if(isNaN(n))n=fallback;
  if(typeof min==='number'&&n<min)n=min;
  if(typeof max==='number'&&n>max)n=max;
  return n;
}

function open(options){
  options=options||{};
  var stageKey=String(options.stageKey||STAGE_KEYS.concept);
  var presets=readPresets();
  var selectedKey=presets[options.presetKey]?options.presetKey:'manager';
  var models=Array.isArray(options.models)?options.models.slice():[];
  var languageDefault=(options.language||'DE').toUpperCase();
  var existingDataText=typeof options.existingData==='string'
    ?options.existingData
    :JSON.stringify(options.existingData||{},null,2);
  var vars={
    projectTitle:options.projectTitle||'Unbenanntes Projekt',
    meetingNotes:options.meetingNotes||'- (keine Notizen)',
    conceptMarkdown:options.conceptMarkdown||'- (nicht vorhanden)',
    planMarkdown:options.planMarkdown||'- (nicht vorhanden)',
    existingData:existingDataText||'{}',
    preset:presets[selectedKey].name,
    outputFormat:presets[selectedKey].outputFormat||'Markdown',
    language:languageDefault
  };

  var overlay=document.getElementById('modal-overlay');
  var content=document.getElementById('modal-content');
  if(!overlay||!content){
    return Promise.reject(new Error('Modal-Container nicht gefunden.'));
  }

  var savedContent=content.innerHTML;
  var wasHidden=overlay.classList.contains('hidden');

  return new Promise(function(resolve){
    function render(presetKey){
      selectedKey=presetKey;
      var preset=presets[selectedKey];
      vars.preset=preset.name;
      vars.outputFormat=preset.outputFormat||'Markdown';

      var presetButtons=Object.keys(presets).map(function(key){
        var active=key===selectedKey?' is-active':'';
        return '<button type="button" class="prompt-preset-btn'+active+'" data-preset="'+escapeHtml(key)+'">'+escapeHtml(presets[key].name)+'</button>';
      }).join('');

      var modelOptions=['<option value="">-- Modell automatisch --</option>'];
      if(preset.model){
        modelOptions.push('<option value="'+escapeHtml(preset.model)+'" selected>'+escapeHtml(preset.model)+'</option>');
      }
      models.forEach(function(model){
        if(!model)return;
        if(model===preset.model)return;
        modelOptions.push('<option value="'+escapeHtml(model)+'">'+escapeHtml(model)+'</option>');
      });

      var promptTemplate=resolveTemplateForStage(preset,stageKey,DEFAULT_PRESETS[selectedKey]);
      var normalizedTemplate=ensureRuntimeTokens(promptTemplate,stageKey);
      content.innerHTML=''
        +'<div class="prompt-config-modal">'
          +'<h2>Prompt-Adapter: '+escapeHtml(options.stageTitle||'KI-Aufarbeitung')+'</h2>'
          +'<p class="modal-hint">Preset waehlen, Parameter justieren und Prompt-Vorlage bearbeiten. Platzhalter wie {{meetingNotes}}, {{conceptMarkdown}}, {{planMarkdown}} und {{existingData}} werden bei Uebernehmen mit aktuellen Inhalten ersetzt.</p>'
          +'<div class="prompt-preset-grid">'+presetButtons+'</div>'
          +'<div class="prompt-config-grid">'
            +'<label class="form-group"><span>Temperatur</span><input id="prompt-temperature" type="number" min="0" max="1" step="0.1" value="'+escapeHtml(String(preset.temperature))+'"></label>'
            +'<label class="form-group"><span>Max Tokens</span><input id="prompt-max-tokens" type="number" min="200" max="6000" step="100" value="'+escapeHtml(String(preset.maxTokens))+'"></label>'
            +'<label class="form-group"><span>Modell</span><select id="prompt-model">'+modelOptions.join('')+'</select></label>'
            +'<label class="form-group"><span>Ausgabeformat</span><select id="prompt-output-format">'
              +'<option value="Markdown"'+(preset.outputFormat==='Markdown'?' selected':'')+'>Markdown</option>'
              +'<option value="JSON"'+(preset.outputFormat==='JSON'?' selected':'')+'>JSON</option>'
              +'<option value="Tabelle"'+(preset.outputFormat==='Tabelle'?' selected':'')+'>Tabelle</option>'
            +'</select></label>'
            +'<label class="form-group"><span>Sprache</span><select id="prompt-language">'
              +'<option value="DE"'+(languageDefault==='DE'?' selected':'')+'>Deutsch</option>'
              +'<option value="EN"'+(languageDefault==='EN'?' selected':'')+'>English</option>'
            +'</select></label>'
          +'</div>'
          +'<label class="form-group prompt-template-field"><span>Prompt-Vorlage (editierbar)</span><textarea id="prompt-template" rows="16">'+escapeHtml(normalizedTemplate)+'</textarea></label>'
          +'<div class="modal-actions">'
            +'<button type="button" class="btn btn-secondary" id="prompt-cancel">Abbrechen</button>'
            +'<button type="button" class="btn btn-secondary" id="prompt-save-preset">Preset speichern</button>'
            +'<button type="button" class="btn btn-primary" id="prompt-confirm">Uebernehmen</button>'
          +'</div>'
        +'</div>';

      content.querySelectorAll('[data-preset]').forEach(function(btn){
        btn.addEventListener('click',function(){
          render(this.getAttribute('data-preset'));
        });
      });

      var outputSelect=document.getElementById('prompt-output-format');
      outputSelect.addEventListener('change',function(){
        vars.outputFormat=this.value;
      });

      document.getElementById('prompt-cancel').addEventListener('click',function(){
        cleanup(null);
      });

      document.getElementById('prompt-save-preset').addEventListener('click',function(){
        var current=presets[selectedKey];
        var editedTemplate=ensureRuntimeTokens(document.getElementById('prompt-template').value,stageKey);
        var nextTemplates=Object.assign({},current.templates||{});
        nextTemplates[stageKey]=editedTemplate;
        current.temperature=normalizeNumber(document.getElementById('prompt-temperature').value,current.temperature,0,1);
        current.maxTokens=normalizeNumber(document.getElementById('prompt-max-tokens').value,current.maxTokens,200,6000);
        current.model=document.getElementById('prompt-model').value.trim();
        current.outputFormat=document.getElementById('prompt-output-format').value;
        current.templates=nextTemplates;
        presets[selectedKey]=current;
        savePresets(presets);
      });

      document.getElementById('prompt-confirm').addEventListener('click',function(){
        var language=document.getElementById('prompt-language').value;
        var outputFormat=document.getElementById('prompt-output-format').value;
        var templateInput=document.getElementById('prompt-template').value;
        vars.language=language;
        vars.outputFormat=outputFormat;
        vars.preset=presets[selectedKey].name;

        var normalizedTemplate=ensureRuntimeTokens(templateInput,stageKey);
        var compiledPrompt=replaceTemplate(normalizedTemplate,vars);
        var result={
          presetKey:selectedKey,
          presetName:presets[selectedKey].name,
          temperature:normalizeNumber(document.getElementById('prompt-temperature').value,presets[selectedKey].temperature,0,1),
          maxTokens:Math.round(normalizeNumber(document.getElementById('prompt-max-tokens').value,presets[selectedKey].maxTokens,200,6000)),
          model:document.getElementById('prompt-model').value.trim(),
          outputFormat:outputFormat,
          language:language,
          prompt:compiledPrompt,
          promptTemplate:normalizedTemplate
        };

        var updatedTemplates=Object.assign({},presets[selectedKey].templates||{});
        updatedTemplates[stageKey]=normalizedTemplate;
        presets[selectedKey]=Object.assign({},presets[selectedKey],{
          temperature:result.temperature,
          maxTokens:result.maxTokens,
          model:result.model,
          outputFormat:result.outputFormat,
          templates:updatedTemplates
        });
        savePresets(presets);

        cleanup(result);
      });
    }

    function cleanup(result){
      if(wasHidden)overlay.classList.add('hidden');
      content.innerHTML=savedContent;
      resolve(result);
    }

    overlay.classList.remove('hidden');
    render(selectedKey);
  });
}

window[NAMESPACE]={
  open:open,
  readPresets:readPresets,
  savePresets:savePresets,
  defaults:clone(DEFAULT_PRESETS)
};

})();

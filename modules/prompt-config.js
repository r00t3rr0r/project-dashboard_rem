/* ========================================
   Prompt Config Module
   Konfigurierbares Prompt-Modal mit Presets
   ======================================== */
(function(){'use strict';

var NAMESPACE='PromptConfig';
var STORAGE_KEY='prompt_presets';

var DEFAULT_PRESETS={
  creative:{
    key:'creative',
    name:'Kreativ & Visionaer',
    description:'Freie Ideen und neue Perspektiven fuer Konzeptarbeit.',
    temperature:0.8,
    maxTokens:1600,
    model:'',
    outputFormat:'Markdown',
    template:'Du bist ein kreativer Projektberater.\\n\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Daten:\\n{{existingData}}\\n\\nErstelle ein kompaktes, inspirierendes Projektkonzept mit Ziel, Scope, Stakeholdern, Chancen, Risiken und 5 mutigen Ideen. Ausgabeformat: {{outputFormat}}.'
  },
  technical:{
    key:'technical',
    name:'Praezise & Technisch',
    description:'Fokus auf Architektur, Schnittstellen und Umsetzbarkeit.',
    temperature:0.3,
    maxTokens:1800,
    model:'',
    outputFormat:'Markdown',
    template:'Du bist ein technischer Lead.\\n\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Daten:\\n{{existingData}}\\n\\nErstelle eine technische Spezifikation mit Architekturvorschlag, Komponenten, Risiken, offenen Punkten und konkreten naechsten Schritten. Ausgabeformat: {{outputFormat}}.'
  },
  manager:{
    key:'manager',
    name:'Projektmanager',
    description:'Strukturierte Plaene, Phasen und Verantwortlichkeiten.',
    temperature:0.4,
    maxTokens:1600,
    model:'',
    outputFormat:'Markdown',
    template:'Du bist ein erfahrener Projektmanager.\\n\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Daten:\\n{{existingData}}\\n\\nLiefere einen umsetzbaren Projektplan mit Phasen, Meilensteinen, Abhaengigkeiten, Ressourcen und KPI. Ausgabeformat: {{outputFormat}}.'
  },
  summary:{
    key:'summary',
    name:'Zusammenfassung',
    description:'Kompakte Extraktion der Kernaussagen.',
    temperature:0.2,
    maxTokens:900,
    model:'',
    outputFormat:'Markdown',
    template:'Du bist ein Analyst.\\n\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nVerdichte die Notizen in Kernaussagen, Entscheidungen, offene Fragen und To-dos. Ausgabeformat: {{outputFormat}}.'
  },
  userstory:{
    key:'userstory',
    name:'User Story',
    description:'User Stories, Akzeptanzkriterien und Edge Cases.',
    temperature:0.5,
    maxTokens:1700,
    model:'',
    outputFormat:'JSON',
    template:'Du bist Product Owner.\\n\\nProjekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nErzeuge priorisierte User Stories mit Akzeptanzkriterien und Edge Cases. Ausgabeformat: {{outputFormat}}.'
  },
  custom:{
    key:'custom',
    name:'Custom',
    description:'Eigene Einstellungen fuer diesen Workflow.',
    temperature:0.5,
    maxTokens:1400,
    model:'',
    outputFormat:'Markdown',
    template:'Projekt: {{projectTitle}}\\nPreset: {{preset}}\\nSprache: {{language}}\\n\\nMeeting-Notizen:\\n{{meetingNotes}}\\n\\nBestehende Daten:\\n{{existingData}}\\n\\nZielausgabe: {{outputFormat}}.'
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

function readPresets(){
  var merged=clone(DEFAULT_PRESETS);
  try{
    var raw=window.localStorage.getItem(STORAGE_KEY);
    if(!raw)return merged;
    var parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object')return merged;
    Object.keys(merged).forEach(function(key){
      if(parsed[key]&&typeof parsed[key]==='object'){
        merged[key]=Object.assign({},merged[key],parsed[key]);
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
  var presets=readPresets();
  var selectedKey=presets[options.presetKey]?options.presetKey:'manager';
  var models=Array.isArray(options.models)?options.models.slice():[];
  var languageDefault=(options.language||'DE').toUpperCase();
  var vars={
    projectTitle:options.projectTitle||'Unbenanntes Projekt',
    meetingNotes:options.meetingNotes||'- (keine Notizen)',
    existingData:options.existingData||'{}',
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

      var promptText=replaceTemplate(preset.template,vars);
      content.innerHTML=''
        +'<div class="prompt-config-modal">'
          +'<h2>Prompt-Adapter: '+escapeHtml(options.stageTitle||'KI-Aufarbeitung')+'</h2>'
          +'<p class="modal-hint">Preset waehlen, Parameter justieren und Prompt vor dem Senden anpassen.</p>'
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
          +'<label class="form-group prompt-template-field"><span>Prompt-Vorlage (editierbar)</span><textarea id="prompt-template" rows="16">'+escapeHtml(promptText)+'</textarea></label>'
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
        current.temperature=normalizeNumber(document.getElementById('prompt-temperature').value,current.temperature,0,1);
        current.maxTokens=normalizeNumber(document.getElementById('prompt-max-tokens').value,current.maxTokens,200,6000);
        current.model=document.getElementById('prompt-model').value.trim();
        current.outputFormat=document.getElementById('prompt-output-format').value;
        current.template=document.getElementById('prompt-template').value;
        presets[selectedKey]=current;
        savePresets(presets);
      });

      document.getElementById('prompt-confirm').addEventListener('click',function(){
        var result={
          presetKey:selectedKey,
          presetName:presets[selectedKey].name,
          temperature:normalizeNumber(document.getElementById('prompt-temperature').value,presets[selectedKey].temperature,0,1),
          maxTokens:Math.round(normalizeNumber(document.getElementById('prompt-max-tokens').value,presets[selectedKey].maxTokens,200,6000)),
          model:document.getElementById('prompt-model').value.trim(),
          outputFormat:document.getElementById('prompt-output-format').value,
          language:document.getElementById('prompt-language').value,
          prompt:document.getElementById('prompt-template').value,
          promptTemplate:presets[selectedKey].template
        };

        presets[selectedKey]=Object.assign({},presets[selectedKey],{
          temperature:result.temperature,
          maxTokens:result.maxTokens,
          model:result.model,
          outputFormat:result.outputFormat,
          template:result.prompt
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

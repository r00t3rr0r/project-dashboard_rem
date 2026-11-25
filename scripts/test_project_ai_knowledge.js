const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(provider, tree) {
  const project = {id:'p1', name:'Demo', github:{url:'https://github.com/acme/demo'}};
  const saved = [];
  const requests = [];
  const dialogs = [];
  const notifications = [];
  let interval;
  const elements = {
    'knowledge-progress-p1':{textContent:''},
    'knowledge-preview-p1':{textContent:''}
  };
  const window = {
    location:{origin:'http://localhost'},
    AuthManager:{getMode:()=> 'admin'},
    DataLayer:{getProjectById:()=>project, updateProject(){}},
    LocalOllama:{
      getProvider:()=>provider,
      generate:async(path, payload, options)=>{
        requests.push({path,payload,options});
        return {markdown:'Dokumentierter Abschnitt '+requests.length,model:provider+'-model'};
      }
    },
    testOverrides:{
      render(){}, refreshAiHealthStatus:()=>Promise.resolve(), notify:(message)=>notifications.push(message), openAiKnowledgeTaskDialog(){},
      buildProjectKnowledgeSnapshot:()=>({project:{title:'Demo'}}),
      fetchRepoMeta:async()=>({default_branch:'main'}),
      fetchGitHubJson:async(url)=>url.includes('/commits/')?{sha:'commit-123',commit:{tree:{sha:'tree-123'}}}:tree,
      postBackendJson:async(url,payload)=>{saved.push({url,payload}); return {filePath:'data/project-knowledge/p1.md',bytes:123};}
    }
  };
  function element(){
    const listeners={},children={};
    return {innerHTML:'',textContent:'',open:false,disabled:false,hidden:false,listeners,
      setAttribute(){},addEventListener:(name,fn)=>{listeners[name]=fn;},
      appendChild(text){this.innerHTML=String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');},
      querySelector(selector){return children[selector]||(children[selector]=element());},
      showModal(){this.open=true;},close(){this.open=false;listeners.close?.();},remove(){this.removed=true;}
    };
  }
  const document = {readyState:'loading',addEventListener(){},getElementById:id=>elements[id]||null,
    createElement:()=>element(),createTextNode:text=>text,body:{appendChild:node=>dialogs.push(node)}};
  const source = fs.readFileSync(path.join(__dirname,'../modules/projects.js'),'utf8').replace(
    'window[NAMESPACE]={',
    `render=window.testOverrides.render; refreshAiHealthStatus=window.testOverrides.refreshAiHealthStatus;
     notify=window.testOverrides.notify; openAiKnowledgeTaskDialog=window.testOverrides.openAiKnowledgeTaskDialog;
     buildProjectKnowledgeSnapshot=function(){return window.testOverrides.buildProjectKnowledgeSnapshot.apply(null,arguments);};
     fetchRepoMeta=window.testOverrides.fetchRepoMeta;
     fetchGitHubJson=function(){return window.testOverrides.fetchGitHubJson.apply(null,arguments);};
     postBackendJson=function(){return window.testOverrides.postBackendJson.apply(null,arguments);};
     window.testRuns=KNOWLEDGE_RUNS;
     window.testSections=buildKnowledgeSections; window.testPrompt=knowledgePrompt;
     window.testBuildKnowledgeContinuationPrompt=buildKnowledgeContinuationPrompt;
     window.testOpenProjectKnowledgeEditor=openProjectKnowledgeEditor;
     window[NAMESPACE]={`
  );
  vm.runInNewContext(source,{window,document,URL,Date,console,TextEncoder,AbortController,
    setInterval:fn=>{interval=fn;return 1;},clearInterval(){}});
  return {window,project,saved,requests,elements,dialogs,notifications,tick:()=>interval()};
}

for (const provider of ['ollama','claude','openai']) {
  test(provider+': erstellt und speichert alle Strukturabschnitte', async()=>{
    const tree = {tree:Array.from({length:101},(_,i)=>({path:'src/file'+i+'.js',type:'blob'})),truncated:false};
    const h = harness(provider,tree);
    await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
    assert(h.requests.length>3);
    assert(h.requests.every(request=>request.options.provider===provider));
    assert.equal(h.saved[0].url,'/api/project-knowledge');
    assert.match(h.saved[0].payload.markdown,/src\/file100\.js/);
    assert.match(h.saved[0].payload.markdown,/Dateiinhalte.*nicht gelesen/);
    assert.equal(h.project.aiKnowledge.filePath,'data/project-knowledge/p1.md');
    assert.equal(h.project.aiKnowledge.sourceCommitSha,'commit-123');
    assert.equal(h.project.aiKnowledge.lastModel,provider+'-model');
    assert.equal(h.dialogs[0].querySelector('[data-run-close]').disabled,false);
    assert.match(h.dialogs[0].querySelector('[data-run-log]').textContent,/erfolgreich gespeichert/);
  });
}

test('ein unvollstaendiger GitHub-Dateibaum wird nicht als vollstaendig gespeichert',async()=>{
  const h=harness('openai',{tree:[],truncated:true});
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/unvollstaendigen Repository-Dateibaum/);
  assert.equal(h.saved.length,0);
  assert.equal(h.project.aiKnowledge.lastStatus,'error');
});

test('gekuerzter rekursiver Dateibaum wird verzeichnisweise vollstaendig nachgeladen',async()=>{
  const h=harness('ollama',{tree:[],truncated:true});
  h.window.testOverrides.fetchGitHubJson=async(url)=>{
    if(url.includes('/commits/'))return {sha:'commit-123',commit:{tree:{sha:'root'}}};
    if(url.includes('?recursive=1'))return {tree:[],truncated:true};
    if(url.endsWith('/root'))return {tree:[{path:'src',type:'tree',sha:'sub'}]};
    return {tree:[{path:'index.js',type:'blob'}]};
  };
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  assert.match(h.saved[0].payload.markdown,/src\/index\.js/);
});

test('Fortschritt und vorhandene Abschnitte bleiben waehrend langer KI-Anfragen sichtbar',async()=>{
  const h=harness('ollama',{tree:[{path:'app.js',type:'blob'}]});
  let finish;
  h.window.LocalOllama.generate=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  await new Promise(resolve=>setImmediate(resolve));
  h.window.testRuns.p1.startedAt=Date.now()-31000;
  h.tick();
  assert.match(h.elements['knowledge-progress-p1'].textContent,/Abschnitt 1 von 2.*31 Sekunden/);
  finish({markdown:'Erster Abschnitt',model:'test'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.elements['knowledge-preview-p1'].textContent,/Erster Abschnitt/);
  finish({markdown:'Zweiter Abschnitt',model:'test'});
  await pending;
});

test('grosser Kontext mit Unicode wird ohne Datenverlust innerhalb des Kontextbudgets zerlegt',async()=>{
  const h=harness('openai',{tree:[]});
  const long='Text 🧑‍💻 ä漢字 '.repeat(1200);
  const data={description:long,tasks:Array.from({length:25},(_,i)=>({id:i,title:'Aufgabe '+i}))};
  const sections=h.window.testSections(data,[]);
  assert(sections.length>10);
  const records=sections.flatMap(section=>section.data);
  assert.equal(records.filter(record=>record.path.join('.')==='description').map(record=>record.text).join(''),JSON.stringify(long));
  assert.equal(records.filter(record=>record.path[0]==='tasks').length,50);
  for(const section of sections){
    const bytes=new TextEncoder().encode(h.window.testPrompt(section)).length;
    assert(bytes+4096+1024<=8192,bytes);
    assert(section.data.length<=16);
  }
});

for(const code of ['AI_OUTPUT_TRUNCATED','AI_CONTEXT_LIMIT']){
  test(code+': teilt nur den fehlgeschlagenen Chunk und speichert keine Teilantwort',async()=>{
    const h=harness('openai',{tree:[{path:'app.js',type:'blob'}]});
    h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({a:'eins',b:'zwei',c:'drei',d:'vier'});
    let calls=0;
    h.window.LocalOllama.generate=async()=>{
      if(++calls===1)throw Object.assign(new Error('Limit'),{code});
      return {markdown:'Erfolg '+calls,model:'test'};
    };
    await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
    assert.equal(calls,4);
    assert.match(h.dialogs[0].querySelector('[data-run-log]').textContent,/halbiert/);
    assert.match(h.saved[0].payload.markdown,/Erfolg 2/);
    assert.match(h.saved[0].payload.markdown,/Erfolg 3/);
    assert.doesNotMatch(h.saved[0].payload.markdown,/Limit/);
  });
}

test('wiederholte Kuerzung endet begrenzt mit sichtbarem Fehler ohne Speicherung',async()=>{
  const h=harness('claude',{tree:[]});
  h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({description:'x'.repeat(5000)});
  let calls=0;
  h.window.LocalOllama.generate=async()=>{calls++;throw Object.assign(new Error('abgeschnitten'),{code:'AI_OUTPUT_TRUNCATED'});};
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/abgeschnitten/);
  assert(calls<=5);
  assert.equal(h.saved.length,0);
  assert.match(h.dialogs[0].querySelector('[data-run-log]').textContent,/Fehler: abgeschnitten/);
  assert.equal(h.dialogs[0].querySelector('[data-run-close]').disabled,false);
});

test('Abbrechen im Popup beendet die Anfrage und speichert keine Datei',async()=>{
  const h=harness('ollama',{tree:[]});
  let signal;
  h.window.LocalOllama.generate=async(path,payload,options)=>{
    signal=options.signal;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Abbruch'),{name:'AbortError'}))));
  };
  const pending=h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  await new Promise(resolve=>setImmediate(resolve));
  const dialog=h.dialogs[0];
  assert(dialog.open);
  assert.equal(dialog.querySelector('[data-run-close]').disabled,true);
  dialog.querySelector('[data-run-stop]').listeners.click();
  await assert.rejects(pending,/abgebrochen/);
  assert(signal.aborted);
  assert.equal(h.project.aiKnowledge.lastStatus,'stopped');
  assert.equal(h.saved.length,0);
});

test('ein Fehler beim Speichern laesst die bisherige Wissensdatei bestehen',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.aiKnowledge={filePath:'data/project-knowledge/old.md'};
  h.window.testOverrides.postBackendJson=async()=>{throw new Error('Speicherfehler');};
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Speicherfehler/);
  assert.equal(h.project.aiKnowledge.filePath,'data/project-knowledge/old.md');
  assert.equal(h.project.aiKnowledge.lastStatus,'error');
});

test('Projektwissen ist in der KI-Aufbereitung auf Admins beschraenkt',()=>{
  const h=harness('ollama',{tree:[]});
  h.window.AuthManager.getMode=()=> 'employee';
  assert.throws(()=>h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Nur Administratoren/);
  assert.equal(h.requests.length,0);
  assert.equal(h.saved.length,0);
});

test('KI-Ergaenzungen beruecksichtigen den Bereich und begrenzen Unicode-Wissen ohne Kontextueberlauf',()=>{
  const h=harness('ollama',{tree:[]});
  const existing=('Anfang 🧑‍💻 '.repeat(1000))+'Ende des Projektwissens';
  const result=h.window.testBuildKnowledgeContinuationPrompt(
    h.project,'Fehleranalyse','Reproduktionsschritte und Hypothesen','Fehler seit dem Release',existing
  );
  assert.equal(result.truncated,true);
  assert.match(result.prompt,/Fehleranalyse/);
  assert.match(result.prompt,/Reproduktionsschritte und Hypothesen/);
  assert.match(result.prompt,/Fehler seit dem Release/);
  assert.match(result.prompt,/gekuerzt/);
  assert.match(result.prompt,/Ende des Projektwissens/);
  assert(Buffer.byteLength(result.prompt,'utf8')+2048+1024<=8192);
});

test('Admin-Editor fuegt einen pruefbaren Entwurf ein und speichert erst nach Klick',async()=>{
  const h=harness('ollama',{tree:[]});
  h.window.testOpenProjectKnowledgeEditor('p1');
  const dialog=h.dialogs[0];
  const area=dialog.querySelector('[data-knowledge-area]');
  const markdown=dialog.querySelector('[data-knowledge-markdown]');
  area.value='errors';
  markdown.value='# Bisheriges Wissen';
  const click=(action)=>dialog.listeners.click({
    target:{closest:()=>({getAttribute:()=>action})}
  });
  click('generate');
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(markdown.value,/## KI-Ergaenzung: Fehleranalyse/);
  assert.match(markdown.value,/Dokumentierter Abschnitt/);
  assert.equal(h.saved.length,0);
  click('save');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.saved[0].url,'/api/project-knowledge');
  assert.match(h.saved[0].payload.markdown,/KI-Ergaenzung: Fehleranalyse/);
  assert.equal(h.project.aiKnowledge.filePath,'data/project-knowledge/p1.md');
});

test('Der Wissenseditor bleibt Nicht-Admins verborgen',()=>{
  const h=harness('ollama',{tree:[]});
  h.window.AuthManager.getMode=()=> 'employee';
  h.window.testOpenProjectKnowledgeEditor('p1');
  assert.equal(h.dialogs.length,0);
  assert.match(h.notifications[0],/Nur Administratoren/);
});

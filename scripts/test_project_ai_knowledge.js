const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(provider, tree) {
  const project = {id:'p1', name:'Demo', github:{url:'https://github.com/acme/demo'}};
  const saved = [];
  const drafts = [];
  const requests = [];
  const dialogs = [];
  const notifications = [];
  const githubRequests = [];
  let storedKnowledge = '';
  let storedDraft = {scope:'',items:{}};
  let interval;
  const elements = {
    'knowledge-progress-p1':{textContent:''},
    'knowledge-preview-p1':{textContent:''}
  };
  const window = {
    location:{origin:'http://localhost'},
    addEventListener(){},
    AuthManager:{getMode:()=> 'admin'},
    DataLayer:{getProjectById:()=>project, updateProject(){}},
    LocalOllama:{
      getProvider:()=>provider,
      resolveModels:async()=>[provider+'-model'],
      generate:async(path, payload, options)=>{
        requests.push({path,payload,options});
        return {markdown:'Dokumentierter Abschnitt '+requests.length,model:provider+'-model'};
      }
    },
    testOverrides:{
      render(){}, refreshAiHealthStatus:()=>Promise.resolve(), notify:(message)=>notifications.push(message), openAiKnowledgeTaskDialog(){},
      buildProjectKnowledgeSnapshot:()=>({project:{title:'Demo'},github:{recentCommits:project.githubCommits||[]}}),
      fetchRepoMeta:async()=>({default_branch:'main'}),
      fetchGitHubJson:async(url)=>url.includes('/commits/')?{sha:'commit-123',commit:{tree:{sha:'tree-123'}}}:tree,
      readKnowledge:async()=>({ok:true,text:async()=>storedKnowledge}),
      postBackendJson:async(url,payload)=>{
        if(url==='/api/project-knowledge/draft'){
          drafts.push(payload);
          if(payload.clear)storedDraft={scope:'',items:{}};
          else storedDraft={scope:payload.scope,items:Object.assign({},
            !payload.replace&&payload.scope===storedDraft.scope?storedDraft.items:{},payload.items)};
          return {ok:true};
        }
        storedKnowledge=payload.markdown;
        saved.push({url,payload}); return {filePath:'data/project-knowledge/p1.md',bytes:123};}
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
  const sandbox={window,document,URL,URLSearchParams,Date,console,TextEncoder,AbortController,
    fetch:(url,options)=>{
      if(url.startsWith('/api/project-knowledge/draft')){
        const scope=new URL(url,'http://localhost').searchParams.get('scope');
        return Promise.resolve({ok:true,json:async()=>({items:scope===storedDraft.scope?storedDraft.items:{}})});
      }
      if(url.startsWith('/api/ai/project-knowledge?'))return window.testOverrides.readKnowledge();
      githubRequests.push({url,options});
      return window.testOverrides.githubFetch(url,options);
    },
    setInterval:fn=>{interval=fn;return 1;},clearInterval(){}};
  window.testOverrides.githubFetch=async url=>({ok:true,json:async()=>url.startsWith('/api/github/branches')?[{name:'main'}]:[]});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/ai-conf.js'),'utf8'),sandbox);
  vm.runInNewContext(source,sandbox);
  return {window,project,saved,drafts,requests,githubRequests,elements,dialogs,notifications,
    setKnowledge:value=>{storedKnowledge=value;},tick:()=>interval()};
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

test('vorhandenes Wissen bleibt erhalten und der automatische Bereich wird bei erneuter Aktualisierung ersetzt',async()=>{
  const h=harness('ollama',{tree:[{path:'app.js',type:'blob'}]});
  h.project.aiKnowledge={filePath:'data/project-knowledge/p1.md'};
  h.setKnowledge('# Bisheriges Wissen\n\n## Manuell\n\nWichtige Entscheidung 🧑‍💻\n');
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const first=h.saved[0].payload.markdown;
  assert(first.startsWith('# Bisheriges Wissen\n\n## Manuell\n\nWichtige Entscheidung 🧑‍💻'));
  assert.match(first,/projektwissen-automatisch:/);
  const firstCalls=h.requests.length;
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const second=h.saved[1].payload.markdown;
  assert(second.startsWith('# Bisheriges Wissen\n\n## Manuell\n\nWichtige Entscheidung 🧑‍💻'));
  assert.equal((second.match(/<!-- projektwissen-automatisch:/g)||[]).length,1);
  assert.equal((second.match(/Vollstaendiger Repository-Dateibaum/g)||[]).length,1);
  assert.equal(h.requests.length,firstCalls);
  assert.equal(h.drafts.at(-1).replace,true);
});

test('nur geaenderte Abschnitte werden nach einem neuen Commit erneut verarbeitet',async()=>{
  const h=harness('ollama',{tree:[{path:'app.js',type:'blob'}]});
  let title='Erster Stand',sha='one';
  h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({project:{title},github:{}});
  h.window.testOverrides.fetchGitHubJson=async url=>url.includes('/commits/')
    ?{sha,commit:{tree:{sha:'tree-123'}}}:{tree:[{path:'app.js',type:'blob'}]};
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const firstCalls=h.requests.length;
  assert.equal(firstCalls,2);
  title='Neuer Stand';
  sha='two';
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  assert.equal(h.requests.length,firstCalls+1);
  assert.match(h.saved[1].payload.markdown,/Dokumentierter Abschnitt 3/);
  assert.match(h.saved[1].payload.markdown,/Dokumentierter Abschnitt 2/);
  assert.equal(Object.keys(h.drafts.at(-1).items).length,2);
});

test('ein anderes Cloud-Modell verwendet keine Abschnitte des vorherigen Modells',async()=>{
  const h=harness('openai',{tree:[]});
  let model='modell-eins';
  h.window.LocalOllama.resolveModels=async()=>[model];
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const count=h.requests.length;
  model='modell-zwei';
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  assert.equal(h.requests.length,count*2);
});

test('manuelle Bearbeitung im automatischen Bereich bleibt bei der Aktualisierung erhalten',async()=>{
  const h=harness('ollama',{tree:[]});
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  h.setKnowledge(h.saved[0].payload.markdown.replace('Dokumentierter Abschnitt 1','Manuell ergaenzte Entscheidung'));
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const markdown=h.saved[1].payload.markdown;
  assert.match(markdown,/Manuell ergaenzte Entscheidung/);
  assert.equal((markdown.match(/<!-- projektwissen-automatisch:/g)||[]).length,1);
});

test('Lese- und zwischenzeitliche Bearbeitungsfehler verhindern das Ueberschreiben',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.aiKnowledge={filePath:'data/project-knowledge/p1.md'};
  h.window.testOverrides.readKnowledge=async()=>({ok:false,status:500,json:async()=>({error:'Lesefehler'})});
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/konnte nicht geladen werden/);
  assert.equal(h.saved.length,0);
  let reads=0;
  h.window.testOverrides.readKnowledge=async()=>({ok:true,text:async()=>++reads===1?'Original':'Zwischenzeitlich bearbeitet'});
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/zwischenzeitlich geaendert/);
  assert.equal(h.saved.length,0);
});

test('fehlende Wissensdatei meldet die Ursache und wird nicht ueberschrieben',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.aiKnowledge={filePath:'/data/project-knowledge/missing.md'};
  h.window.testOverrides.readKnowledge=async()=>({ok:false,status:404,json:async()=>({
    error:'Die hinterlegte Wissensdatei wurde auf dem Server nicht gefunden. Bitte aus einer Sicherung wiederherstellen.'
  })});
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Sicherung wiederherstellen/);
  assert.equal(h.saved.length,0);
  assert.equal(h.project.aiKnowledge.filePath,'/data/project-knowledge/missing.md');
  assert.doesNotMatch(h.dialogs[0].querySelector('[data-run-log]').textContent,/Der Fortschritt ist auf dem Server gespeichert/);
});

test('beschaedigte Markierungen verhindern das Ueberschreiben',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.aiKnowledge={filePath:'data/project-knowledge/p1.md'};
  h.setKnowledge('# Wissen\n<!-- projektwissen-automatisch:kaputt -->\nManuelle Inhalte');
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Markierungen/);
  assert.equal(h.saved.length,0);
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

test('Projektwissen laedt nur aktuelle main-Commits ueber alle Seiten statt gespeicherter Commits',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.githubCommits=[{sha:'stale',message:'Veralteter Commit'}];
  const commit=(id,date)=>({sha:'sha-'+id,commit:{message:'Commit '+id,committer:{date},author:{name:'Dev'}}});
  h.window.testOverrides.githubFetch=async url=>{
    const parsed=new URL(url,'http://localhost');
    if(parsed.pathname==='/api/github/branches')return {ok:true,json:async()=>[{name:'main'},{name:'feature/a+b'}]};
    const branch=parsed.searchParams.get('sha'),page=parsed.searchParams.get('page');
    const items=branch==='main'
      ?(page==='1'?Array.from({length:100},(_,i)=>commit(i,'2026-01-01T00:00:00Z')):[commit('later-page','2026-02-01T00:00:00Z')])
      :[commit('feature','2026-03-01T00:00:00Z'),commit(0,'2026-01-01T00:00:00Z')];
    return {ok:true,json:async()=>items};
  };
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  const records=h.requests.flatMap(request=>JSON.parse(request.payload.knowledgePrompt.split('\n\n').pop()));
  const commits=records.filter(record=>record.path[0]==='github'&&record.path[1]==='recentCommits');
  assert.equal(commits.filter(record=>record.path[3]==='sha').length,25);
  assert.equal(commits.find(record=>record.path[2]==='0'&&record.path[3]==='sha').text,'"sha-later-page"');
  assert(!JSON.stringify(records).includes('sha-feature'));
  assert(!JSON.stringify(records).includes('Veralteter Commit'));
  assert.equal(h.project.githubCommits[0].sha,'stale');
  assert(h.githubRequests.some(request=>request.url.includes('sha=main')&&request.url.includes('page=2')));
  assert(h.githubRequests.every(request=>{
    const parsed=new URL(request.url,'http://localhost');
    return parsed.pathname==='/api/github/commits'&&parsed.searchParams.get('sha')==='main';
  }));
});

test('fehlender main-Branch bricht die Erstellung ohne Fallback ab',async()=>{
  const h=harness('ollama',{tree:[]});
  h.window.testOverrides.githubFetch=async()=>({ok:false,status:404,json:async()=>({message:'Not Found'})});
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/404/);
  assert.equal(h.githubRequests.length,1);
  assert.equal(new URL(h.githubRequests[0].url,'http://localhost').searchParams.get('sha'),'main');
  assert.equal(h.requests.length,0);
  assert.equal(h.saved.length,0);
});

test('fehlgeschlagener Commit-Abruf verhindert die Erzeugung und Speicherung',async()=>{
  const h=harness('ollama',{tree:[]});
  h.window.testOverrides.githubFetch=async url=>{
    const parsed=new URL(url,'http://localhost');
    if(parsed.pathname==='/api/github/branches')return {ok:true,json:async()=>[{name:'main'}]};
    if(parsed.searchParams.get('page')==='1')return {ok:true,json:async()=>Array.from({length:100},(_,i)=>({
      sha:'sha-'+i,commit:{committer:{date:'2026-01-01T00:00:00Z'}}
    }))};
    return {ok:false,status:403,json:async()=>({message:'Rate limit'})};
  };
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Rate limit/);
  assert.equal(h.requests.length,0);
  assert.equal(h.saved.length,0);
  assert.equal(h.project.aiKnowledge.lastStatus,'error');
});

test('Projektwissen nutzt beim Commit-Abruf den Token-Fallback von AI Conf',async()=>{
  const h=harness('ollama',{tree:[]});
  h.window.AuthManager.getCurrentUser=()=>({github:{privateAccessToken:'invalid'}});
  h.window.DataLayer.getStoredValue=()=> 'central';
  h.window.testOverrides.githubFetch=async(url,options)=>{
    if(options.headers['X-GitHub-Token']==='invalid')return {ok:false,status:401,json:async()=>({message:'Bad credentials'})};
    return {ok:true,json:async()=>url.startsWith('/api/github/branches')?[{name:'main'}]:[]};
  };
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  assert.equal(h.githubRequests[0].options.headers['X-GitHub-Token'],'invalid');
  assert.equal(h.githubRequests[1].options.headers['X-GitHub-Token'],'central');
  assert.equal(h.saved.length,1);
});

test('Fortschritt und vorhandene Abschnitte bleiben waehrend langer KI-Anfragen sichtbar',async()=>{
  const h=harness('ollama',{tree:[{path:'app.js',type:'blob'}]});
  let finish,progress;
  h.window.LocalOllama.generate=(path,payload,options)=>new Promise(resolve=>{finish=resolve;progress=options.onProgress;});
  const pending=h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  await new Promise(resolve=>setImmediate(resolve));
  const preview=h.dialogs[0].querySelector('[data-run-preview]');
  const body=h.dialogs[0].querySelector('.knowledge-generation-body');
  body.scrollHeight=600;
  preview.scrollHeight=400;
  h.elements['knowledge-preview-p1'].scrollHeight=200;
  h.window.testRuns.p1.startedAt=Date.now()-31000;
  h.tick();
  assert.match(h.elements['knowledge-progress-p1'].textContent,/Abschnitt 1 von 2.*31 Sekunden/);
  progress('Live <code>');
  assert.match(preview.textContent,/Live <code>/);
  assert.equal(preview.scrollTop,400);
  assert.equal(h.saved.length,0);
  finish({markdown:'Erster Abschnitt <code>',model:'test'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.elements['knowledge-preview-p1'].textContent,/Erster Abschnitt/);
  assert.match(preview.textContent,/Erster Abschnitt <code>/);
  assert.equal(preview.scrollTop,400);
  assert.equal(body.scrollTop,600);
  assert.equal(h.elements['knowledge-preview-p1'].scrollTop,200);
  preview.scrollTop=10;
  body.scrollTop=20;
  h.elements['knowledge-preview-p1'].scrollTop=5;
  h.tick();
  assert.equal(preview.scrollTop,10);
  assert.equal(body.scrollTop,20);
  assert.equal(h.elements['knowledge-preview-p1'].scrollTop,5);
  preview.scrollHeight=800;
  body.scrollHeight=900;
  finish({markdown:'Zweiter Abschnitt',model:'test'});
  await pending;
  assert.equal(preview.textContent,h.saved[0].payload.markdown);
  assert.match(preview.textContent,/Erster Abschnitt <code>[\s\S]*Zweiter Abschnitt/);
  assert.equal(preview.scrollTop,800);
  assert.equal(body.scrollTop,900);
});

test('abgeschnittene Live-Ausgabe wird vor der Wiederholung entfernt und nicht gespeichert',async()=>{
  const h=harness('ollama',{tree:[]});
  h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({github:{},description:'x'.repeat(500)});
  let calls=0;
  h.window.LocalOllama.generate=async(path,payload,options)=>{
    if(++calls===1){
      options.onProgress('Unvollstaendige Ausgabe');
      assert.match(h.dialogs[0].querySelector('[data-run-preview]').textContent,/Unvollstaendige Ausgabe/);
      throw Object.assign(new Error('abgeschnitten'),{code:'AI_OUTPUT_TRUNCATED'});
    }
    assert.doesNotMatch(h.dialogs[0].querySelector('[data-run-preview]').textContent,/Unvollstaendige Ausgabe/);
    return {markdown:'Vollstaendig',model:'test'};
  };
  await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
  assert.doesNotMatch(h.saved[0].payload.markdown,/Unvollstaendige Ausgabe/);
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
    h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({github:{},a:'eins',b:'zwei',c:'drei',d:'vier'});
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
  h.window.testOverrides.buildProjectKnowledgeSnapshot=()=>({github:{},description:'x'.repeat(5000)});
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

test('fertige Abschnitte werden bei KI-Ausfall auf dem Server zwischengespeichert',async()=>{
  const tree={tree:Array.from({length:101},(_,i)=>({path:'src/file'+i+'.js',type:'blob'})),truncated:false};
  const h=harness('ollama',tree);
  const generate=h.window.LocalOllama.generate;
  let calls=0;
  h.window.LocalOllama.generate=async(...args)=>{
    if(++calls===3)throw new Error('KI nicht erreichbar');
    return generate(...args);
  };
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/KI nicht erreichbar/);
  assert.equal(h.drafts.length,2);
  assert.equal(h.drafts[0].scope,'ollama|'+JSON.stringify([h.project.aiKnowledge.preferredModel])+'|https://github.com/acme/demo');
  assert.equal(h.saved.length,0);
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

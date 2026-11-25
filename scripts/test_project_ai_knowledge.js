const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(provider, tree) {
  const project = {id:'p1', name:'Demo', github:{url:'https://github.com/acme/demo'}};
  const saved = [];
  const requests = [];
  let interval;
  const elements = {
    'knowledge-progress-p1':{textContent:''},
    'knowledge-preview-p1':{textContent:''}
  };
  const window = {
    location:{origin:'http://localhost'},
    DataLayer:{getProjectById:()=>project, updateProject(){}},
    LocalOllama:{
      getProvider:()=>provider,
      generate:async(path, payload, options)=>{
        requests.push({path,payload,options});
        return {markdown:'Dokumentierter Abschnitt '+requests.length,model:provider+'-model'};
      }
    },
    testOverrides:{
      render(){}, refreshAiHealthStatus:()=>Promise.resolve(), notify(){}, openAiKnowledgeTaskDialog(){},
      buildProjectKnowledgeSnapshot:()=>({project:{title:'Demo'}}),
      fetchRepoMeta:async()=>({default_branch:'main'}),
      fetchGitHubJson:async(url)=>url.includes('/commits/')?{sha:'commit-123',commit:{tree:{sha:'tree-123'}}}:tree,
      postBackendJson:async(url,payload)=>{saved.push({url,payload}); return {filePath:'data/project-knowledge/p1.md',bytes:123};}
    }
  };
  const document = {readyState:'loading',addEventListener(){},getElementById:id=>elements[id]||null};
  const source = fs.readFileSync(path.join(__dirname,'../modules/projects.js'),'utf8').replace(
    'window[NAMESPACE]={',
    `render=window.testOverrides.render; refreshAiHealthStatus=window.testOverrides.refreshAiHealthStatus;
     notify=window.testOverrides.notify; openAiKnowledgeTaskDialog=window.testOverrides.openAiKnowledgeTaskDialog;
     buildProjectKnowledgeSnapshot=window.testOverrides.buildProjectKnowledgeSnapshot;
     fetchRepoMeta=window.testOverrides.fetchRepoMeta;
     fetchGitHubJson=function(){return window.testOverrides.fetchGitHubJson.apply(null,arguments);};
     postBackendJson=function(){return window.testOverrides.postBackendJson.apply(null,arguments);};
     window.testRuns=KNOWLEDGE_RUNS;
     window[NAMESPACE]={`
  );
  vm.runInNewContext(source,{window,document,URL,Date,console,
    setInterval:fn=>{interval=fn;return 1;},clearInterval(){}});
  return {window,project,saved,requests,elements,tick:()=>interval()};
}

for (const provider of ['ollama','claude','openai']) {
  test(provider+': erstellt und speichert alle Strukturabschnitte', async()=>{
    const tree = {tree:Array.from({length:101},(_,i)=>({path:'src/file'+i+'.js',type:'blob'})),truncated:false};
    const h = harness(provider,tree);
    await h.window.ProjectsModule.generateAiKnowledgeForProject('p1');
    assert.equal(h.requests.length,3);
    assert(h.requests.every(request=>request.options.provider===provider));
    assert.equal(h.saved[0].url,'/api/project-knowledge');
    assert.match(h.saved[0].payload.markdown,/src\/file100\.js/);
    assert.match(h.saved[0].payload.markdown,/Dateiinhalte.*nicht gelesen/);
    assert.equal(h.project.aiKnowledge.filePath,'data/project-knowledge/p1.md');
    assert.equal(h.project.aiKnowledge.sourceCommitSha,'commit-123');
    assert.equal(h.project.aiKnowledge.lastModel,provider+'-model');
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

test('ein Fehler beim Speichern laesst die bisherige Wissensdatei bestehen',async()=>{
  const h=harness('ollama',{tree:[]});
  h.project.aiKnowledge={filePath:'data/project-knowledge/old.md'};
  h.window.testOverrides.postBackendJson=async()=>{throw new Error('Speicherfehler');};
  await assert.rejects(h.window.ProjectsModule.generateAiKnowledgeForProject('p1'),/Speicherfehler/);
  assert.equal(h.project.aiKnowledge.filePath,'data/project-knowledge/old.md');
  assert.equal(h.project.aiKnowledge.lastStatus,'error');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness() {
  const project={id:'p1',title:'Projekt',github:{owner:'acme',repo:'app',defaultBranch:'main'}};
  const tasks=[],requests=[];
  const window={
    localStorage:{},
    DataLayer:{
      getTasks:()=>tasks,
      isTaskLinkedToProject:(task,projectId)=>
        (Array.isArray(task.projectIds)&&task.projectIds.includes(projectId))||task.projectId===projectId
    },
    AuthManager:{getCurrentUser:()=>({github:{privateAccessToken:'test-token'}})},
    addEventListener(){}
  };
  const document={addEventListener(){}};
  const sandbox={window,document,console,URLSearchParams,Set};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/task-response.js'),'utf8'),sandbox);
  const aiSource=fs.readFileSync(path.join(__dirname,'../modules/ai-conf.js'),'utf8');
  vm.runInNewContext(aiSource,sandbox);
  const quickSource=fs.readFileSync(path.join(__dirname,'../modules/quicktask.js'),'utf8').replace(
    'window.QuickTaskModule={',
    'window.testQuickTask={fetchQuickTaskGitHubCommits,translateGitHubCommits,formatGitHubCommitDraft,groupGitHubCommitDrafts,getGitHubCommitDocumentationTaskId,findGitHubCommitEmployee}; window.QuickTaskModule={'
  );
  vm.runInNewContext(quickSource,sandbox);
  return {project,tasks,requests,window,sandbox,api:window.testQuickTask};
}

function commit(index) {
  return {
    sha:String(index).padStart(40,'0'),
    html_url:'https://github.com/acme/app/commit/'+index,
    commit:{message:'Giriş hatasını düzelt\n\nAyrıntılar',author:{name:'Alice',date:'2000-01-01T00:00:00Z'},committer:{date:'2020-01-01T00:00:00Z'}}
  };
}
function githubResponse(url,items){
  return {ok:true,json:async()=>url.startsWith('/api/github/branches')?[{name:'main'}]:items};
}

test('loads the entire history past five pages and preserves the complete message',async()=>{
  const h=harness();
  h.sandbox.fetch=async(url,options)=>{
    if(url.startsWith('/api/github/branches'))return githubResponse(url,[]);
    h.requests.push({url,options});
    const page=Number(new URL(url,'http://localhost').searchParams.get('page'));
    return {ok:true,json:async()=>page<=6?Array.from({length:100},(_,i)=>commit((page-1)*100+i)):[commit(600),commit(0)]};
  };
  const commits=await h.api.fetchQuickTaskGitHubCommits(h.project);
  assert.equal(commits.length,601);
  assert.equal(h.requests.length,7);
  const queries=h.requests.map(request=>new URL(request.url,'http://localhost').searchParams);
  assert(queries.every(query=>!query.has('since')&&query.get('until')===queries[0].get('until')));
  assert.equal(h.requests[0].options.headers['X-GitHub-Token'],'test-token');
  assert.equal(commits[0].date,'2020-01-01T00:00:00Z');
  assert.equal(commits[0].message,'Giriş hatasını düzelt\n\nAyrıntılar');
});

test('loads and deduplicates commits from all branches in QuickTask',async()=>{
  const h=harness(),shared=commit(1),feature=commit(2);
  h.sandbox.fetch=async(url)=>{
    const parsed=new URL(url,'http://localhost');
    if(parsed.pathname==='/api/github/branches')return {ok:true,json:async()=>[{name:'main'},{name:'feature/login'}]};
    return {ok:true,json:async()=>parsed.searchParams.get('sha')==='main'?[shared]:[shared,feature]};
  };
  const commits=await h.api.fetchQuickTaskGitHubCommits(h.project);
  assert.equal(commits.length,2);
  assert.equal(commits[0].branches.join(','),'main,feature/login');
  assert.equal(commits[1].branches.join(','),'feature/login');
});

test('recognizes documented commits only for the selected project and repository',()=>{
  const h=harness();
  h.tasks.push(
    {id:'quick',projectId:'p1',sourceCommitShas:['a']},
    {id:'import',projectId:'p1',githubCommitImport:{repository:'ACME/APP',shas:['b']}},
    {id:'other-project',projectId:'p2',sourceCommitShas:['c']},
    {id:'other-repo',projectId:'p1',githubCommitImport:{repository:'acme/other',shas:['d']}}
  );
  assert.equal(h.api.getGitHubCommitDocumentationTaskId('a',h.project),'quick');
  assert.equal(h.api.getGitHubCommitDocumentationTaskId('b',h.project),'import');
  assert.equal(h.api.getGitHubCommitDocumentationTaskId('c',h.project),'');
  assert.equal(h.api.getGitHubCommitDocumentationTaskId('d',h.project),'');
});

test('only an unambiguous exact GitHub login is suggested for an author',()=>{
  const {api}=harness();
  const employees=[
    {id:'a',name:'Alice',github:{username:'Alice'}},
    {id:'b',name:'Alice',github:{profileUrl:'https://github.com/bob'}}
  ];
  assert.equal(api.findGitHubCommitEmployee({authorLogin:'ALICE'},employees),'a');
  assert.equal(api.findGitHubCommitEmployee({authorLogin:'bob'},employees),'b');
  assert.equal(api.findGitHubCommitEmployee({author:'Alice'},employees),'');
  assert.equal(api.findGitHubCommitEmployee({authorLogin:'unknown'},employees),'');
  assert.equal(api.findGitHubCommitEmployee({authorLogin:'alice'},employees.concat({id:'c',github:{username:'alice'}})),'');
});

test('unlinked commit authors match unambiguous aliases including the employee name',()=>{
  const {api}=harness();
  const employees=[
    {id:'a',name:'Dieter',github:{username:'account',aliases:['Dieter','account','Dieter Senf']}},
    {id:'b',name:'Bob',github:{username:'bob',aliases:['Bob','bob']}}
  ];
  assert.equal(api.findGitHubCommitEmployee({author:' DIETER SENF '},employees),'a');
  assert.equal(api.findGitHubCommitEmployee({author:' DIETER '},employees),'a');
  assert.equal(api.findGitHubCommitEmployee({author:'Bob'},employees),'b');
  assert.equal(api.findGitHubCommitEmployee({author:'account'},employees),'');
  assert.equal(api.findGitHubCommitEmployee({author:'Dieter Senf',authorLogin:'unknown'},employees),'');
  assert.equal(api.findGitHubCommitEmployee({author:'Dieter Senf',authorLogin:'bob'},employees),'b');
  const duplicate=employees.concat({id:'c',name:'Carol',github:{aliases:['Dieter Senf']}});
  assert.equal(api.findGitHubCommitEmployee({author:'Dieter Senf'},duplicate),'');
  const duplicateName=employees.concat({id:'c',name:'Dieter',github:{aliases:['Dieter']}});
  assert.equal(api.findGitHubCommitEmployee({author:'Dieter'},duplicateName),'');
});

test('translates Turkish messages in both languages and keeps original text in the draft',async()=>{
  const h=harness(),batches=[];
  h.window.LocalOllama={generate:async(path,payload)=>{
    const entries=JSON.parse(payload.draftInput);
    batches.push(entries.length);
    assert.match(payload.promptConfig.prompt,/including Turkish/);
    assert.match(payload.promptConfig.prompt,/Giriş hatasını düzelt/);
    return {draft:{taskSuggestions:entries.map(entry=>({
      note:entry.sha,titleDe:'Anmeldung korrigiert',titleEn:'Fixed login',
      descriptionDe:'Anmeldung korrigiert\n\nDetails',descriptionEn:'Fixed login\n\nDetails'
    })).reverse()}};
  }};
  const commits=Array.from({length:9},(_,i)=>({sha:commit(i).sha,message:commit(i).commit.message,author:'Alice'}));
  const translated=await h.api.translateGitHubCommits(commits,h.project);
  assert.deepEqual(batches,[4,4,1]);
  const draft=h.api.formatGitHubCommitDraft(translated);
  assert.match(draft.description,/DE: Anmeldung korrigiert\nAnmeldung korrigiert\n\nDetails/);
  assert.match(draft.description,/EN: Fixed login\nFixed login\n\nDetails/);
  assert.match(draft.description,/Original: Giriş hatasını düzelt\n\nAyrıntılar/);
  assert.match(draft.subtasks[0],/DE: Anmeldung korrigiert \| EN: Fixed login/);
  assert.equal(draft.subtasks.length,9);
});

test('fallback titles reflect distinct translated commit titles, including when there are more than two',()=>{
  const h=harness();
  const make=(i,date,title)=>({
    sha:commit(i).sha,date,author:'Alice',message:'Original',title,titleEn:'English',
    descriptionDe:'Deutsch',descriptionEn:'English'
  });
  const groups=h.api.groupGitHubCommitDrafts([
    make(1,'2020-01-01T10:00:00Z','Anmeldung verbessert'),
    make(2,'2020-01-01T11:00:00Z','Fehler korrigiert'),
    make(3,'2020-01-01T12:00:00Z','Anmeldung verbessert'),
    make(4,'2020-01-01T13:00:00Z','Dokumentation ergänzt'),
    make(5,'2020-01-02T10:00:00Z','Kalender aktualisiert')
  ],'main');
  assert.equal(groups.length,1);
  assert.equal(groups[0].draft.title,'Anmeldung verbessert · Fehler korrigiert (+2 weitere Commit-Titel)');
  assert.throws(()=>h.api.formatGitHubCommitDraft([{title:'  '}]),/fehlen deutsche Commit-Titel/);
  const long=h.api.formatGitHubCommitDraft([{title:'Langer Titel '.repeat(20)}]).title;
  assert(long.length<=60);
  assert(long.endsWith('…'));
});

test('rejects missing or unidentifiable translations instead of assigning the wrong language',async()=>{
  const h=harness();
  h.window.LocalOllama={generate:async()=>({draft:{taskSuggestions:[{note:'wrong',titleDe:'Titel',titleEn:'Title',descriptionDe:'Text',descriptionEn:'Text'}]}})};
  await assert.rejects(h.api.translateGitHubCommits([{sha:'abc',message:'Türkçe'}],h.project),/fehlt oder ist nicht eindeutig/);
  h.window.LocalOllama=null;
  await assert.rejects(h.api.translateGitHubCommits([{sha:'abc',message:'Türkçe'}],h.project),/nicht verfuegbar/);
});

test('surfaces GitHub errors and malformed responses',async()=>{
  const h=harness();
  h.sandbox.fetch=async()=>({ok:false,status:403,json:async()=>({error:'Rate limit'})});
  await assert.rejects(h.api.fetchQuickTaskGitHubCommits(h.project),/Rate limit/);
  h.sandbox.fetch=async()=>({ok:true,status:200,json:async()=>({})});
  await assert.rejects(h.api.fetchQuickTaskGitHubCommits(h.project),/keine gueltige Branch-Liste/);
});

function modalHarness() {
  const h=harness(),elements={},created=[],labels=[];
  function element(id) {
    if(!elements[id])elements[id]={
      value:'',selectedOptions:[],options:[],disabled:false,checked:true,style:{},
      classList:{add(){},remove(){},toggle(){}},
      listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
      setAttribute(){},removeAttribute(){},querySelectorAll(){return [];},
      click(){if(this.listeners.click)this.listeners.click({target:this});}
    };
    return elements[id];
  }
  h.sandbox.document.getElementById=element;
  h.sandbox.document.createTextNode=value=>value;
  h.sandbox.document.createElement=()=>({appendChild(value){this.innerHTML=String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}});
  h.sandbox.setTimeout=()=>{};
  h.sandbox.alert=message=>{throw new Error(message);};
  Object.assign(h.window.DataLayer,{
    getProjects:()=>[h.project],getEmployees:()=>[{id:'alice',name:'Alice',github:{username:'alice'}},{id:'bob',name:'Bob',github:{username:'bob'}}],getLabels:()=>labels,
    createLabel:label=>{label.id='label-'+label.name;labels.push(label);return label;},
    waitForLabelSave:()=>Promise.resolve(true),
    generateId:()=>Math.random().toString(),createTask:task=>{created.push(task);h.tasks.push(task);task.id='task'+created.length;return task;},
    createTasks:tasks=>tasks.map(task=>h.window.DataLayer.createTask(task)),
    updateTask:task=>{const index=h.tasks.findIndex(item=>item.id===task.id);if(index<0)return false;h.tasks[index]=task;return true;},
    waitForTaskAndCalendarSave:()=>Promise.resolve(true)
  });
  h.window.AuthManager.getMode=()=> 'admin';
  h.window.closeModal=()=>{};
  h.window.LocalOllama={generate:async(path,payload)=>({draft:{taskSuggestions:JSON.parse(payload.draftInput).map(entry=>({
    note:entry.sha,titleDe:'Anmeldung korrigiert',titleEn:'Fixed login',
    descriptionDe:'Deutsche Nachricht',descriptionEn:'English message'
  }))}})};
  h.window.AIConfModule.renderCommitSelection=(host,commits,translate)=>{
    host.innerHTML='Commits vor der Uebersetzung auswaehlen';
    host.selectCommits=selected=>translate(selected||commits,()=>{});
  };
  return {h,element,created,labels};
}

test('new tasks save the selected answer requirement',async()=>{
  const {h,element,created}=modalHarness();
  h.window.QuickTaskModule.open({});
  element('qtm-title').value='Entscheidung';
  element('qtm-response-type').value='choice';
  element('qtm-response-prompt').value='Welche Variante?';
  element('qtm-response-options').value='A\nB';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(created[0].responseRequirement.type,'choice');
  assert.equal(created[0].responseRequirement.prompt,'Welche Variante?');
  assert.equal(created[0].responseRequirement.options.join(','),'A,B');
});

test('AI Conf topics create separate completed tasks with their own summaries, commits and assignees',async()=>{
  const {h,element,created}=modalHarness();
  const entry=(id,employee)=>({
    sha:String(id).repeat(40),date:'2020-01-01T10:00:00Z',author:employee,authorLogin:employee,
    message:'Original '+id,title:'Titel '+id,titleEn:'Title '+id,descriptionDe:'Beschreibung',descriptionEn:'Description',
    branches:['main','feature/shared'],url:'https://github.com/acme/app/commit/'+id
  });
  const a=entry(1,'alice'),b=entry(2,'bob'),c=entry(3,'alice');
  h.tasks.push({id:'existing',projectId:'p1',title:'Bestehende Branch-Aufgabe',githubCommitImport:{repository:'acme/app',taskBranches:['feature/shared'],shas:[],commits:[]}});
  h.window.QuickTaskModule.open({task:{projectId:'p1',status:'done'},taskMetadata:{githubCommitImport:{until:'2020-01-02T00:00:00Z'}},githubCommitGroups:[
    {title:'Anmeldung',titleEn:'Login',descriptionDe:'Anmeldung verbessert',descriptionEn:'Improved login',commits:[a,c]},
    {title:'Kalender',titleEn:'Calendar',descriptionDe:'Kalender verbessert',descriptionEn:'Improved calendar',commits:[b]}
  ]});
  element('qtm-project').value='p1';
  element('qtm-topic-title-1').value='Kalender korrigiert';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,2);
  assert.equal(h.tasks[0].title,'Bestehende Branch-Aufgabe');
  assert.equal(created[0].title,'Anmeldung');
  assert.equal(created[1].title,'Kalender korrigiert');
  assert.match(created[0].description,/Anmeldung verbessert/);
  assert.match(created[1].description,/Kalender verbessert/);
  assert.equal(created[0].subtasks.length,2);
  assert.equal(created[1].subtasks.length,1);
  assert(created.every(task=>task.status==='done'&&task.progress===100&&task.subtasks.every(subtask=>subtask.completed)));
  assert.equal(created[0].githubCommitImport.shas.join(','),[a.sha,c.sha].join(','));
  assert.equal(created[1].githubCommitImport.shas.join(','),b.sha);
  assert.equal(created[1].subtasks[0].assigneeId,'bob');
  assert.equal(created[1].attachments.length,1);
  assert.equal(created[0].githubCommitImport.taskBranches.length,0);
  assert.equal(created[1].githubCommitImport.until,'2020-01-02T00:00:00Z');
});

test('AI Conf saves editable labels separately per topic, reuses names and creates missing labels once',async()=>{
  const {h,element,created,labels}=modalHarness();
  labels.push({id:'existing-ux',name:'ux',color:'#abcdef'});
  const commit=id=>({sha:String(id).repeat(40),date:'2020-01-01T10:00:00Z',author:'Alice',authorLogin:'alice',message:'Original',title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description'});
  const group=(c,labelNames)=>({title:'Thema',titleEn:'Topic',descriptionDe:'Arbeit',descriptionEn:'Work',labelNames,commits:[c]});
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommitGroups:[group(commit(1),['Frontend','UX']),group(commit(2),['Backend','Frontend'])]});
  element('qtm-project').value='p1';
  assert.match(element('qtm-labels').innerHTML,/new-label:Frontend" selected/);
  assert.match(element('qtm-labels').innerHTML,/existing-ux" selected/);
  assert.match(element('qtm-github-daily-drafts').innerHTML,/new-label:Backend" selected/);
  element('qtm-labels').selectedOptions=[{value:'new-label:Frontend'},{value:'existing-ux'}];
  element('qtm-topic-labels-1').selectedOptions=[{value:'new-label:Backend'},{value:'new-label:Frontend'}];
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,2);
  assert.equal(created[0].labels.join(','),'label-Frontend,existing-ux');
  assert.equal(created[1].labels.join(','),'label-Backend,label-Frontend');
  assert.equal(labels.filter(label=>label.name==='Frontend').length,1);
  const storage=new Map();
  const dataWindow={localStorage:{
    getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key),clear:()=>storage.clear(),key:index=>Array.from(storage.keys())[index]??null
  }};
  const source=fs.readFileSync(path.join(__dirname,'../data.js'),'utf8')
    .replace('window.DataLayer.ready = runStartupHydration();','window.DataLayer.rehydrate = hydrateCollections; window.DataLayer.ready = Promise.resolve();')
    .replace(/runStartupHydration\(\)\.finally\(function \(\) \{\s*startRemoteSyncLoop\(\);\s*startRemoteKvStream\(\);\s*\}\);/,'')
    .replace("return fetchRemoteKv('POST', { key: key, value: value }).then(function (result) {","return Promise.resolve({ok:true}).then(function (result) {");
  vm.runInNewContext(source,{window:dataWindow,console,URL,Promise});
  const data=dataWindow.DataLayer;
  for(const label of labels){data.createLabel({...label});assert.equal(await data.waitForLabelSave(),true);}
  data.createTasks(created);
  assert.equal(await data.waitForTaskAndCalendarSave(),true);
  data.tasks.length=0;data.labels.length=0;data.calendarEvents.length=0;data.rehydrate();
  assert.equal(data.getTaskById(created[0].id).labels.join(','),'label-Frontend,existing-ux');
  assert.equal(data.getLabelById('label-Backend').name,'Backend');
  assert.equal(data.getCalendarEvents().length,2);
});

test('AI Conf does not create tasks when label persistence fails',async()=>{
  const {h,element,created}=modalHarness();
  h.window.DataLayer.waitForLabelSave=()=>Promise.resolve(false);
  const commit={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',author:'Alice',authorLogin:'alice',message:'Original',title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description'};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommitGroups:[{title:'Thema',titleEn:'Topic',descriptionDe:'Arbeit',descriptionEn:'Work',labelNames:['Frontend'],commits:[commit]}]});
  element('qtm-project').value='p1';
  element('qtm-labels').selectedOptions=[{value:'new-label:Frontend'}];
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.match(element('qtm-upload-status').textContent,/Labels konnten nicht dauerhaft gespeichert/);
});

test('AI Conf rejects a missing commit subtask in any topic before creating tasks',async()=>{
  const {h,element,created}=modalHarness();
  const commit=id=>({sha:String(id).repeat(40),date:'2020-01-01T10:00:00Z',author:'Alice',authorLogin:'alice',message:'Original',title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description'});
  const group=c=>({title:'Thema',titleEn:'Topic',descriptionDe:'Arbeit',descriptionEn:'Work',commits:[c]});
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommitGroups:[group(commit(1)),group(commit(2))]});
  element('qtm-project').value='p1';
  element('qtm-topic-subtasks-1').value='Manuell ohne SHA';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.match(element('qtm-github-daily-status').textContent,/SHA genau einer eigenen Teilaufgabe/);
});

test('feature branch commits across days and imports extend one task without changing its status or title',async()=>{
  const {h,element,created}=modalHarness();
  const entry=(id,date,employeeId)=>({
    sha:String(id).repeat(40),date,author:employeeId,employeeId,message:'Original',title:'Titel '+id,titleEn:'Title',
    descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['main','feature/login','feature/other']
  });
  const first=entry(1,'2020-01-01T10:00:00Z','alice');
  const second=entry(2,'2020-01-02T10:00:00Z','bob');
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[first,second]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+first.sha).value='alice';
  element('qtm-github-assignee-'+second.sha).value='bob';
  assert.equal(element('qtm-title').value,'feature/login');
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(h.tasks[0].githubCommitImport.taskBranch,'feature/login');
  assert.equal(h.tasks[0].githubCommitImport.commits.length,2);
  assert.equal(h.tasks[0].status,'done');
  assert.equal(h.tasks[0].assigneeIds.join(','),'alice,bob');
  h.tasks[0].status='in-progress';
  h.tasks[0].progress=40;
  h.tasks[0].title='Manuell geaendert';
  const third=entry(3,'2020-01-03T10:00:00Z','alice');
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[third]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+third.sha).value='alice';
  assert.match(element('qtm-github-daily-drafts').innerHTML,/Bestehende Aufgabe/);
  assert.equal(element('qtm-title').value,'Manuell geaendert');
  assert.equal(element('qtm-title').readOnly,true);
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(h.tasks[0].title,'Manuell geaendert');
  assert.equal(h.tasks[0].status,'in-progress');
  assert.equal(h.tasks[0].progress,40);
  assert.equal(h.tasks[0].githubCommitImport.commits.length,3);
  assert.equal(h.tasks[0].subtasks.length,3);
  assert.equal(h.tasks[0].subtasks[2].sourceCommitSha,third.sha);
  assert.equal(h.api.getGitHubCommitDocumentationTaskId(third.sha,h.project),h.tasks[0].id);
  const storage=new Map();
  const dataWindow={localStorage:{
    getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key),clear:()=>storage.clear(),key:index=>Array.from(storage.keys())[index]??null
  }};
  const source=fs.readFileSync(path.join(__dirname,'../data.js'),'utf8')
    .replace('window.DataLayer.ready = runStartupHydration();','window.DataLayer.rehydrate = hydrateCollections; window.DataLayer.ready = Promise.resolve();')
    .replace(/runStartupHydration\(\)\.finally\(function \(\) \{\s*startRemoteSyncLoop\(\);\s*startRemoteKvStream\(\);\s*\}\);/,'')
    .replace("return fetchRemoteKv('POST', { key: key, value: value }).then(function (result) {","return Promise.resolve({ok:true}).then(function (result) {");
  vm.runInNewContext(source,{window:dataWindow,console,URL,Promise});
  const data=dataWindow.DataLayer;
  data.createTask(created[0]);
  assert(data.updateTask(h.tasks[0]));
  assert.equal(await data.waitForTaskAndCalendarSave(),true);
  assert.equal(data.getCalendarEvents().length,3);
  assert(data.getCalendarEvents().every(event=>event.taskId===h.tasks[0].id));
  data.tasks.length=0;data.calendarEvents.length=0;data.rehydrate();
  assert.equal(data.getTaskById(h.tasks[0].id).githubCommitImport.commits.length,3);
  assert.equal(data.getCalendarEvents().length,3);
});

test('one task contains commits from different branches and later imports reuse it',async()=>{
  const {h,element,created}=modalHarness();
  const entry=(id,branches,employeeId)=>({sha:String(id).repeat(40),date:`2020-01-0${id}T10:00:00Z`,employeeId,
    author:employeeId,message:'Original',title:'Titel '+id,titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches});
  const entries=[entry(1,['main','feature/a'],'alice'),entry(2,['main','feature/b'],'bob'),entry(3,['main'],'alice')];
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:entries});
  element('qtm-project').value='p1';
  entries.forEach(item=>{element('qtm-github-assignee-'+item.sha).value=item.employeeId;});
  assert.equal(element('qtm-title').value,'feature/a');
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(h.tasks[0].subtasks.length,3);
  assert.equal(h.tasks[0].githubCommitImport.taskBranches.join(','),'feature/a,feature/b,main');
  for(const item of [entry(4,['feature/b'],'bob'),entry(5,['main'],'alice')]){
    h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
    element('qtm-project').value='p1';
    element('qtm-github-assignee-'+item.sha).value=item.employeeId;
    element('qt-submit').click();
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(created.length,1);
  assert.equal(h.tasks[0].githubCommitImport.commits.length,5);
  assert.equal(h.tasks[0].subtasks.length,5);
});

test('conflicting branch tasks require a target and retain other tasks branch associations',async()=>{
  const {h,element,created}=modalHarness();
  h.tasks.push(
    {id:'a',projectId:'p1',title:'Aufgabe A',status:'done',githubCommitImport:{repository:'acme/app',taskBranch:'feature/a',shas:[],commits:[]}},
    {id:'b',projectId:'p1',title:'Aufgabe B',status:'todo',githubCommitImport:{repository:'acme/app',taskBranch:'feature/b',shas:[],commits:[]}}
  );
  const entry=(id,branch)=>({sha:String(id).repeat(40),date:`2020-01-0${id}T10:00:00Z`,employeeId:'alice',
    author:'Alice',message:'Original',title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:[branch]});
  const entries=[entry(1,'feature/a'),entry(2,'feature/b'),entry(3,'feature/c')];
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:entries});
  element('qtm-project').value='p1';
  entries.forEach(item=>{element('qtm-github-assignee-'+item.sha).value='alice';});
  element('qt-submit').click();
  assert.match(element('qtm-github-daily-status').textContent,/Zielaufgabe auswaehlen/);
  const select=element('qtm-github-target');
  select.value='b';
  select.listeners.change.call(select);
  assert.equal(element('qtm-title').value,'Aufgabe B');
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.equal(h.tasks[0].githubCommitImport.commits.length,0);
  assert.equal(h.tasks[1].githubCommitImport.commits.length,3);
  assert.equal(h.tasks[1].githubCommitImport.taskBranches.join(','),'feature/b,feature/c');
  assert.equal(h.tasks[1].status,'todo');
});

test('import stops if matching branch tasks change after the preview',async()=>{
  const {h,element,created}=modalHarness();
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'alice',author:'Alice',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['feature/a']};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+item.sha).value='alice';
  h.tasks.push({id:'new',projectId:'p1',title:'Neu',githubCommitImport:{repository:'acme/app',taskBranch:'feature/a',shas:[],commits:[]}});
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.equal(h.tasks[0].githubCommitImport.commits.length,0);
  assert.match(element('qtm-upload-status').textContent,/haben sich geaendert/);
});

test('multiple feature branches use the first and expose all branch names as a tooltip',async()=>{
  const {h,element,created}=modalHarness();
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'alice',author:'Alice',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['main','feature/b','feature/a']};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+item.sha).value='alice';
  assert.equal(element('qtm-title').value,'feature/b');
  const html=element('qtm-github-daily-drafts').innerHTML;
  assert.match(html,/<summary title="main\nfeature\/b\nfeature\/a">3 Branches<\/summary>/);
  assert.doesNotMatch(html,/qtm-github-branch-/);
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created[0].githubCommitImport.taskBranch,'feature/b');
});

test('changing the commit assignee preserves edited task fields',()=>{
  const {h,element}=modalHarness();
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'alice',author:'Alice',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['main','feature/a','feature/b']};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  const title=element('qtm-title');
  title.value='Eigener Titel';
  const select=element('qtm-github-assignee-'+item.sha);
  select.value='bob';
  assert.equal(title.value,'Eigener Titel');
  assert.equal(select.value,'bob');
});

test('an existing branch task must be editable before it can be extended',async()=>{
  const {h,element,created}=modalHarness();
  h.tasks.push({id:'existing',projectId:'p1',title:'feature/a',githubCommitImport:{repository:'acme/app',taskBranch:'feature/a',shas:[],commits:[]}});
  h.window.AuthManager.canEditTask=()=>false;
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'alice',author:'Alice',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['feature/a']};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+item.sha).value='alice';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.equal(h.tasks[0].githubCommitImport.commits.length,0);
  assert.match(element('qtm-upload-status').textContent,/darf nicht bearbeitet/);
});

test('employees cannot add another employee’s commit when extending a branch task',async()=>{
  const {h,element}=modalHarness();
  h.tasks.push({id:'existing',projectId:'p1',title:'feature/a',assigneeId:'alice',assigneeIds:['alice'],
    githubCommitImport:{repository:'acme/app',taskBranch:'feature/a',shas:[],commits:[]}});
  h.window.AuthManager.getMode=()=> 'employee';
  h.window.AuthManager.getCurrentUser=()=>({id:'alice'});
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'bob',author:'Bob',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['feature/a']};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  element('qtm-github-assignee-'+item.sha).value='bob';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.tasks[0].githubCommitImport.commits.length,0);
  assert.match(element('qtm-upload-status').textContent,/nur sich selbst zuordnen/);
});

test('missing default branch is fetched and failures block the import',async()=>{
  const {h,element,created}=modalHarness();
  delete h.project.github.defaultBranch;
  const item={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',employeeId:'alice',author:'Alice',message:'Original',
    title:'Titel',titleEn:'Title',descriptionDe:'Beschreibung',descriptionEn:'Description',branches:['trunk','feature/a']};
  h.sandbox.fetch=async()=>({ok:true,json:async()=>({default_branch:'trunk'})});
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('qtm-title').value,'feature/a');
  h.sandbox.fetch=async()=>({ok:false,status:403,json:async()=>({message:'Rate limit'})});
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[item]});
  element('qtm-project').value='p1';
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('qtm-ai-status').textContent,/Rate limit/);
  element('qt-submit').click();
  assert.equal(created.length,0);
  assert.match(element('qtm-ai-status').textContent,/nicht bereit/);
});

test('only selected commits become task metadata after applying the preview',async()=>{
  const {h,element,created}=modalHarness();
  h.sandbox.fetch=async(url)=>githubResponse(url,[commit(1),commit(2)]);
  h.window.QuickTaskModule.open();
  element('qtm-project').value='p1';
  element('qtm-github-commits').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(element('qtm-github-commit-review').innerHTML,/vor der Uebersetzung/);
  await element('qtm-github-commit-review').selectCommits();
  assert.match(element('qtm-github-commit-review').innerHTML,/EN: Fixed login/);
  element('qtm-github-commit-review').querySelectorAll=()=>[{getAttribute:()=>commit(1).sha}];
  element('qtm-github-create').click();
  element('qtm-github-assignee-'+commit(1).sha).value='alice';
  assert.match(element('qtm-desc').value,/Original: Giriş hatasını düzelt/);
  assert.equal(element('qtm-title').value,'Anmeldung korrigiert');
  assert.match(element('qtm-desc').value,/EN: Fixed login\nEnglish message/);
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(created[0].title,'Anmeldung korrigiert');
  assert.equal(created[0].sourceCommitShas.join(','),commit(1).sha);
  assert.match(created[0].subtasks[0].title,/DE: Anmeldung korrigiert \| EN: Fixed login/);
});

test('QuickTask translates only commits confirmed in the preselection',async()=>{
  const {h,element}=modalHarness(),batches=[];
  h.sandbox.fetch=async(url)=>githubResponse(url,[commit(1),commit(2)]);
  h.window.LocalOllama.generate=async(path,payload)=>{
    const entries=JSON.parse(payload.draftInput);
    batches.push(...entries.map(entry=>entry.sha));
    return {draft:{taskSuggestions:entries.map(entry=>({note:entry.sha,titleDe:'Titel',titleEn:'Title',descriptionDe:'Text',descriptionEn:'Text'}))}};
  };
  h.window.QuickTaskModule.open();
  element('qtm-project').value='p1';
  element('qtm-github-commits').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(batches.length,0);
  const selected={sha:commit(2).sha,date:'2020-01-01T00:00:00Z',message:'Original',author:'Alice'};
  await element('qtm-github-commit-review').selectCommits([selected]);
  assert.deepEqual(batches,[selected.sha]);
  assert.equal(element('qtm-github-commit-review')._commits.length,1);
});

test('creates one completed task across employees and days with linked chronological calendar entries',async()=>{
  const previousTz=process.env.TZ;
  process.env.TZ='Europe/Berlin';
  try {
    const {h,element,created}=modalHarness();
    const items=[commit(1),commit(2),commit(3),commit(4)];
    items[0].commit.committer.date='2020-01-01T22:30:00Z';
    items[1].commit.committer.date='2020-01-01T23:30:00Z';
    items[2].commit.committer.date='2020-01-02T08:30:00Z';
    items[3].commit.committer.date='2020-01-03T08:30:00Z';
    h.sandbox.fetch=async(url)=>githubResponse(url,items);
    h.window.QuickTaskModule.open();
    element('qtm-project').value='p1';
    element('qtm-github-commits').click();
    await new Promise(resolve=>setImmediate(resolve));
    await element('qtm-github-commit-review').selectCommits();
    element('qtm-github-commit-review').querySelectorAll=()=>items.slice(0,3).map(item=>({getAttribute:()=>item.sha}));
    element('qtm-github-create').click();
    const assign=(sha,employeeId)=>{
      const select=element('qtm-github-assignee-'+sha);
      select.value=employeeId;
      if(select.listeners.change)select.listeners.change({target:select});
    };
    assign(items[0].sha,'alice');
    assign(items[1].sha,'alice');
    assign(items[2].sha,'bob');
    assert.equal(element('qtm-title').value,'Anmeldung korrigiert');
    element('qt-submit').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(created.length,1);
    assert.equal(created[0].githubCommitImport.multiDayCommits,true);
    assert.equal(created[0].sourceCommitShas.join(','),items.slice(0,3).map(item=>item.sha).join(','));
    assert.equal(created[0].assigneeIds.join(','),'alice,bob');
    assert.equal(created[0].subtasks[2].assigneeId,'bob');
    assert.equal(created[0].subtasks[2].sourceCommitSha,items[2].sha);
    assert(created.every(task=>task.status==='done'&&task.subtasks.every(subtask=>subtask.completed)));
    assert(created.every(task=>Date.parse(task.createdAt)>Date.parse('2020-01-03')));

    const storage=new Map();
    const dataWindow={localStorage:{
      getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key),clear:()=>storage.clear(),key:index=>Array.from(storage.keys())[index]??null
    }};
    let dataSource=fs.readFileSync(path.join(__dirname,'../data.js'),'utf8')
      .replace('function setStorageValue(key, value) {','function setStorageValue(key, value) { window.writeCounts[key]=(window.writeCounts[key]||0)+1;')
      .replace('window.DataLayer.ready = runStartupHydration();','window.DataLayer.rehydrate = hydrateCollections; window.DataLayer.ready = Promise.resolve();')
      .replace(/runStartupHydration\(\)\.finally\(function \(\) \{\s*startRemoteSyncLoop\(\);\s*startRemoteKvStream\(\);\s*\}\);/,'')
      .replace("return fetchRemoteKv('POST', { key: key, value: value }).then(function (result) {","return Promise.resolve({ok:true}).then(function (result) {");
    dataWindow.writeCounts={};
    vm.runInNewContext(dataSource,{window:dataWindow,console,URL,Promise});
    const data=dataWindow.DataLayer;
    data.createTasks(created);
    assert.equal(dataWindow.writeCounts.pd_tasks,1);
    assert.equal(dataWindow.writeCounts.pd_calendar_events,1);
    assert.equal(await data.waitForTaskAndCalendarSave(),true);
    let events=data.getCalendarEvents();
    assert.equal(events.length,3);
    assert.equal(events[0].date,'2020-01-01');
    assert.equal(events[0].startTime,'23:30');
    assert.equal(events[1].date,'2020-01-02');
    assert.equal(events[1].startTime,'00:30');
    assert.equal(events[2].startTime,'09:30');
    assert.equal(events[1].commitEmployeeId,'alice');
    assert.equal(events[2].commitEmployeeId,'bob');
    assert(events.every(event=>event.taskId===created[0].id));
    const calendarWindow={DataLayer:data};
    const calendarSource=fs.readFileSync(path.join(__dirname,'../modules/calendar.js'),'utf8')
      .replace('window.CalendarModule = {','window.testActivities = buildTaskActivityEntries; window.testFilters={eventMatchesEmployeeFilter,taskMatchesEmployeeFilter,getEventParticipants}; window.CalendarModule = {');
    vm.runInNewContext(calendarSource,{window:calendarWindow,document:{addEventListener(){}},console});
    const activities=calendarWindow.testActivities();
    assert.equal(activities.length,2);
    assert.equal(activities[0].date,'2020-01-01');
    assert.equal(activities[1].date,'2020-01-02');
    assert(activities.every(activity=>activity.type==='github-commit'&&activity.dayProgressGain===0));
    assert.equal(activities[1].assigneeIds.join(','),'alice,bob');
    assert(calendarWindow.testFilters.taskMatchesEmployeeFilter(created[0],'bob'));
    assert(calendarWindow.testFilters.eventMatchesEmployeeFilter(events[2],'bob'));
    assert(!calendarWindow.testFilters.eventMatchesEmployeeFilter(events[2],'alice'));
    assert(!calendarWindow.testFilters.eventMatchesEmployeeFilter(events[2],'__unassigned__'));
    assert(calendarWindow.testFilters.eventMatchesEmployeeFilter({source:'github-commit'},'__unassigned__'));
    assert.equal(calendarWindow.testFilters.getEventParticipants(events[2]).length,0);
    const updated=data.getTaskById(created[0].id);
    updated.title='Spaeter bearbeitet';
    data.updateTask(updated);
    const updatedActivities=calendarWindow.testActivities();
    assert(updatedActivities.some(activity=>activity.date==='2020-01-01'&&activity.type==='github-commit'));
    assert(updatedActivities.some(activity=>activity.date!=='2020-01-01'&&activity.type==='updated'));
    const updatedSecond=data.getTaskById(created[0].id);
    updatedSecond.githubCommitImport.commits[2].employeeId='alice';
    data.updateTask(updatedSecond);
    assert.equal(data.getCalendarEvents()[2].commitEmployeeId,'alice');
    data.tasks.length=0;data.calendarEvents.length=0;data.rehydrate();
    events=data.getCalendarEvents();
    assert.equal(events.length,3);
    assert.equal(events[2].commitEmployeeId,'alice');
    data.deleteTask(created[0].id);
    assert.equal(data.getCalendarEvents().length,0);
  } finally {
    if(previousTz===undefined)delete process.env.TZ;
    else process.env.TZ=previousTz;
  }
});

test('requires a manual selection for commits without a linked author',async()=>{
  const {h,element,created}=modalHarness();
  const item=commit(1);
  h.sandbox.fetch=async(url)=>githubResponse(url,[item]);
  h.window.QuickTaskModule.open();
  element('qtm-project').value='p1';
  element('qtm-github-commits').click();
  await new Promise(resolve=>setImmediate(resolve));
  await element('qtm-github-commit-review').selectCommits();
  element('qtm-github-commit-review').querySelectorAll=()=>[{getAttribute:()=>item.sha}];
  element('qtm-github-create').click();
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.match(element('qtm-github-daily-status').textContent,/jedem Commit einen Mitarbeiter/);
  element('qtm-github-assignee-'+item.sha).value='bob';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created[0].assigneeId,'bob');
  assert.equal(created[0].githubCommitImport.commits[0].employeeId,'bob');
  assert.equal(created[0].subtasks[0].assigneeId,'bob');
});

test('AI Conf prefill suggests the linked employee in the commit selector',()=>{
  const {h,element}=modalHarness();
  const entry={sha:'a'.repeat(40),date:'2020-01-01T10:00:00Z',calendarDate:'2020-01-01',calendarTime:'10:00',
    author:'Other display name',authorLogin:'ALICE',title:'Titel',titleEn:'Title',
    descriptionDe:'Beschreibung',descriptionEn:'Description',message:'Original'};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[entry]});
  const html=element('qtm-github-daily-drafts').innerHTML;
  assert.match(html,/value="alice" selected>Alice/);
  assert.match(html,/Andere|Other display name/);
  assert.equal(element('qtm-ai-assign').disabled,true);
});

test('prefill suggests a configured commit author alias without a GitHub login',()=>{
  const {h,element}=modalHarness();
  h.window.DataLayer.getEmployees=()=>[{id:'alice',name:'Alice',github:{username:'alice',aliases:['Alice Example']}}];
  const entry={sha:'b'.repeat(40),date:'2020-01-01T10:00:00Z',calendarDate:'2020-01-01',calendarTime:'10:00',
    author:'Alice Example',authorLogin:'',title:'Titel',titleEn:'Title',
    descriptionDe:'Beschreibung',descriptionEn:'Description',message:'Original'};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[entry]});
  assert.match(element('qtm-github-daily-drafts').innerHTML,/value="alice" selected>Alice/);
});

test('prefill suggests the employee when the author alias equals their name',()=>{
  const {h,element}=modalHarness();
  h.window.DataLayer.getEmployees=()=>[{id:'mustafa',name:'Mustafa',github:{username:'mustafaakgl',aliases:['Mustafa','mustafaakgl']}}];
  const entry={sha:'c'.repeat(40),date:'2020-01-01T10:00:00Z',calendarDate:'2020-01-01',calendarTime:'10:00',
    author:'Mustafa',authorLogin:'',title:'Titel',titleEn:'Title',
    descriptionDe:'Beschreibung',descriptionEn:'Description',message:'Original'};
  h.window.QuickTaskModule.open({task:{projectId:'p1'},githubCommits:[entry]});
  assert.match(element('qtm-github-daily-drafts').innerHTML,/value="mustafa" selected>Mustafa/);
});

test('AI Conf prefill creates one editable draft and rejects a missing commit subtask',async()=>{
  const {h,element,created}=modalHarness();
  const entries=[commit(1),commit(2)].map((item,index)=>({
    sha:item.sha,date:`2020-01-0${index+1}T12:00:00Z`,author:'Alice',message:item.commit.message,
    title:'Anmeldung korrigiert',titleEn:'Fixed login',descriptionDe:'Deutsche Nachricht',descriptionEn:'English message',
    url:item.html_url
  }));
  h.window.QuickTaskModule.open({task:{projectId:'p1',status:'done'},githubCommits:entries});
  element('qtm-project').value='p1';
  assert.equal(element('qtm-title').value,'Anmeldung korrigiert');
  element('qtm-subtasks').value='Commit '+entries[0].sha+'\nEintrag ohne SHA';
  element('qtm-github-assignee-'+entries[0].sha).value='alice';
  element('qtm-github-assignee-'+entries[1].sha).value='bob';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,0);
  assert.match(element('qtm-ai-status').textContent,/SHA/);
  element('qtm-subtasks').value='Commit '+entries[0].sha+'\nCommit '+entries[1].sha;
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(created[0].githubCommitImport.commits[1].sha,entries[1].sha);
});

test('reports persistence failure without closing the task editor',async()=>{
  const {h,element}=modalHarness();
  const item=commit(1);
  h.window.DataLayer.waitForTaskAndCalendarSave=()=>Promise.resolve(false);
  let closed=false;
  h.window.closeModal=()=>{closed=true;};
  h.sandbox.fetch=async(url)=>githubResponse(url,[item]);
  h.window.QuickTaskModule.open();
  element('qtm-project').value='p1';
  element('qtm-github-commits').click();
  await new Promise(resolve=>setImmediate(resolve));
  await element('qtm-github-commit-review').selectCommits();
  element('qtm-github-commit-review').querySelectorAll=()=>[{getAttribute:()=>item.sha}];
  element('qtm-github-create').click();
  element('qtm-github-assignee-'+item.sha).value='alice';
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,false);
  assert.match(element('qtm-upload-status').textContent,/nicht dauerhaft gespeichert/);
});

test('creates general tasks and supports linking a task to multiple projects',async()=>{
  const {h,element,created}=modalHarness();
  const secondProject={id:'p2',title:'Zweites Projekt'};
  h.window.DataLayer.getProjects=()=>[h.project,secondProject];

  h.window.QuickTaskModule.open();
  element('qtm-title').value='Allgemeine Aufgabe';
  assert.equal(typeof element('qt-submit').listeners.click,'function');
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.deepEqual(Array.from(created[0].projectIds),[]);
  assert.equal(created[0].projectId,null);

  h.window.QuickTaskModule.open();
  element('qtm-title').value='Projektuebergreifende Aufgabe';
  element('qtm-project').selectedOptions=[{value:'p1'},{value:'p2'}];
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(Array.from(created[1].projectIds),['p1','p2']);
  assert.equal(created[1].projectId,'p1');
});

test('falls back to the central token and then unauthenticated when a GitHub token is rejected',async()=>{
  const h=harness();
  h.window.DataLayer.getStoredValue=(key,fallback)=>key==='pd_github_central_token_v1'?'central-token':fallback;
  h.sandbox.fetch=async(url,options)=>{
    h.requests.push({url,options});
    const token=(options.headers||{})['X-GitHub-Token']||'';
    if(token==='central-token')return githubResponse(url,[commit(1)]);
    return {ok:false,status:401,json:async()=>({error:'GitHub-Authentifizierung fehlgeschlagen. Bitte Token pruefen.'})};
  };
  const commits=await h.api.fetchQuickTaskGitHubCommits(h.project);
  assert.equal(commits.length,1);
  assert.equal(h.requests.length,3);
  assert.equal(h.requests[0].options.headers['X-GitHub-Token'],'test-token');
  assert.equal(h.requests[1].options.headers['X-GitHub-Token'],'central-token');
});

test('retries without token for public repositories when all tokens are rejected',async()=>{
  const h=harness();
  h.sandbox.fetch=async(url,options)=>{
    h.requests.push({url,options});
    const token=(options.headers||{})['X-GitHub-Token']||'';
    if(token)return {ok:false,status:401,json:async()=>({error:'GitHub-Authentifizierung fehlgeschlagen. Bitte Token pruefen.'})};
    return githubResponse(url,[commit(1)]);
  };
  const commits=await h.api.fetchQuickTaskGitHubCommits(h.project);
  assert.equal(commits.length,1);
  assert.equal(h.requests.length,3);
  assert.equal(h.requests[1].options.headers['X-GitHub-Token'],undefined);
});

test('reports a clear error when the dashboard session is missing',async()=>{
  const h=harness();
  h.sandbox.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Anmeldung erforderlich.',authRequired:true})});
  await assert.rejects(h.api.fetchQuickTaskGitHubCommits(h.project),/Anmeldung erforderlich/);
});

test('known GitHub logins are assigned to subtasks within one task',async()=>{
  const {h,element,created}=modalHarness();
  const items=[commit(1),commit(2),commit(3)];
  items[0].author={login:'alice'};
  items[1].author={login:'bob'};
  items[2].author={login:'alice'};
  items[0].commit.committer.date='2020-06-01T10:00:00Z';
  items[1].commit.committer.date='2020-06-01T12:00:00Z';
  items[2].commit.committer.date='2020-06-01T14:00:00Z';
  h.sandbox.fetch=async(url)=>githubResponse(url,items);
  h.window.QuickTaskModule.open();
  element('qtm-project').value='p1';
  element('qtm-github-commits').click();
  await new Promise(resolve=>setImmediate(resolve));
  await element('qtm-github-commit-review').selectCommits();
  element('qtm-github-commit-review').querySelectorAll=()=>items.map(item=>({getAttribute:()=>item.sha}));
  element('qtm-github-create').click();
  assert.equal(element('qtm-github-assignee-'+items[1].sha).value,'bob');
  element('qt-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(created.length,1);
  assert.equal(created[0].assigneeIds.join(','),'alice,bob');
  assert.equal(created[0].sourceCommitShas.join(','),items.map(item=>item.sha).join(','));
  assert.equal(created[0].subtasks[1].assigneeId,'bob');
  assert(created.every(task=>task.status==='done'));
});

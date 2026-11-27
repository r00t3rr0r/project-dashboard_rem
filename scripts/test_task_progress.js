const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function makeDataLayer() {
  const storage = new Map();
  const localStorage = {
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key),
    clear:()=>storage.clear(),
    key:index=>Array.from(storage.keys())[index]??null
  };
  const window = {localStorage};
  let source = fs.readFileSync(path.join(__dirname,'../data.js'),'utf8');
  source = source.replace('window.DataLayer.ready = runStartupHydration();',
    'window.DataLayer.rehydrate = hydrateCollections; window.DataLayer.ready = Promise.resolve();');
  source = source.replace(/runStartupHydration\(\)\.finally\(function \(\) \{\s*startRemoteSyncLoop\(\);\s*startRemoteKvStream\(\);\s*\}\);/, '');
  source = source.replace("return fetchRemoteKv('POST', { key: key, value: value }).then(function (result) {",
    "return Promise.resolve({ok:true}).then(function (result) {");
  vm.runInNewContext(source,{window,console,URL,Promise});
  return window.DataLayer;
}

function makeDashboard(data, DateCtor) {
  const container = {
    dataset:{},
    innerHTML:'',
    expandedSubtaskTaskIds:[],
    expandedCommitTaskIds:[],
    addEventListener(){},
    classList:{toggle(){}}
  };
  container.querySelectorAll = selector=>(selector.includes('commits-more')?container.expandedCommitTaskIds:container.expandedSubtaskTaskIds).map(taskId=>({
    getAttribute:()=>taskId
  }));
  const teamLoadContainer = {innerHTML:'',expandedSubtaskTaskIds:[]};
  teamLoadContainer.querySelectorAll = ()=>teamLoadContainer.expandedSubtaskTaskIds.map(taskId=>({
    getAttribute:()=>taskId
  }));
  const document = {
    addEventListener(){},
    getElementById:id=>id==='chart-progress-bar'?container:(id==='chart-team-load'?teamLoadContainer:null),
    createTextNode:value=>value,
    createElement:()=>({
      appendChild(value) {
        this.innerHTML=value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }
    })
  };
  const window = {DataLayer:data};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dashboard.js'),'utf8'),
    {window,document,console,Date:DateCtor||Date,encodeURIComponent});
  return {dashboard:window.DashboardManager,container,teamLoadContainer};
}

test('subtask changes determine persisted progress and task history without changing status',()=>{
  const data = makeDataLayer();
  const task = data.createTask({
    id:'task',title:'Aufgabe',status:'in-progress',progress:91,
    subtasks:[{title:'Eins',completed:true},{title:'Zwei'},{title:'Drei'}]
  });
  assert.equal(task.progress,33);
  assert.equal(task.history[0].progress,33);

  task.subtasks[1].completed = true;
  assert.equal(data.updateTask(task),true);
  assert.equal(task.progress,67);
  assert.equal(task.history.at(-1).type,'progress');
  assert.equal(task.history.at(-1).progress,67);
  assert.equal(task.status,'in-progress');
  assert.equal(JSON.parse(data.getStoredValue('pd_tasks','[]'))[0].progress,67);
  task.progress = 12;
  data.updateTask(task);
  assert.equal(task.progress,67);

  task.subtasks[0].completed = false;
  data.updateTask(task);
  assert.equal(task.progress,33);
  task.subtasks.push({title:'Vier',completed:true});
  data.updateTask(task);
  assert.equal(task.progress,50);
  task.subtasks = task.subtasks.filter(item=>item.completed);
  data.updateTask(task);
  assert.equal(task.progress,100);
  assert.equal(task.status,'in-progress');

  task.subtasks = [];
  task.progress = 42;
  data.updateTask(task);
  assert.equal(task.progress,42);
});

test('existing tasks are recalculated on hydration and manual tasks remain unchanged',()=>{
  const data = makeDataLayer();
  data.setStoredValue('pd_tasks',JSON.stringify([
    {id:'old',title:'Alt',status:'done',progress:100,subtasks:[{title:'Offen'},{title:'Fertig',completed:true}]},
    {id:'manual',title:'Manuell',progress:37,subtasks:[]}
  ]));
  data.rehydrate();
  assert.equal(data.getTaskById('old').progress,50);
  assert.equal(data.getTaskById('old').status,'done');
  assert.equal(data.getTaskById('manual').progress,37);
});

test('tasks support no project and deduplicated links to multiple projects',()=>{
  const data = makeDataLayer();
  const legacy = data.createTask({id:'legacy',title:'Alt',projectId:'one'});
  const linked = data.createTask({id:'linked',title:'Verknuepft',projectIds:['two','three','two']});
  const general = data.createTask({id:'general',title:'Allgemein'});

  assert.deepEqual(Array.from(legacy.projectIds),['one']);
  assert.equal(legacy.projectId,'one');
  assert.deepEqual(Array.from(linked.projectIds),['two','three']);
  assert.equal(linked.projectId,'two');
  assert.deepEqual(Array.from(general.projectIds),[]);
  assert.equal(general.projectId,null);
  assert.deepEqual(Array.from(data.getTasksFiltered({projectId:'three'}),task=>task.id),['linked']);
  assert.equal(data.isTaskLinkedToProject(linked,'two'),true);
  assert.equal(data.isTaskLinkedToProject(linked,'three'),true);
  assert.equal(data.isTaskLinkedToProject(general,'three'),false);
});

test('project progress uses the shared current-and-next subtask display and refreshes after task updates',()=>{
  const data = makeDataLayer();
  data.createProject({id:'project',title:'Projekt'});
  const task = data.createTask({
    id:'task',title:'Aufgabe',projectId:'project',status:'in-progress',
    subtasks:[{title:'<Erster>'},{title:'Zweiter'},{title:'Dritter'},{title:'Vierter'}]
  });
  data.createTask({id:'free',title:'Ohne Zuordnung',status:'in-progress',subtasks:[{title:'Freier Schritt'}]});
  const {dashboard,container} = makeDashboard(data);
  data.on('dataChanged',event=>{
    if (event.entity==='tasks') dashboard.renderProjectProgress();
  });
  dashboard.renderProjectProgress();
  assert.match(container.innerHTML,/Ohne Projekt/);
  assert.match(container.innerHTML,/dashboard-subtasks/);
  assert.match(container.innerHTML,/Aktuell:<\/span><span class="dashboard-subtask-title">&lt;Erster&gt;/);
  assert.match(container.innerHTML,/Als Nächstes:<\/span><span class="dashboard-subtask-title">Zweiter/);
  assert.match(container.innerHTML,/\+2 weitere Teilaufgaben anzeigen/);
  assert.match(container.innerHTML,/Teilaufgaben 0\/4/);

  container.expandedSubtaskTaskIds = ['task'];
  task.subtasks[0].completed = true;
  data.updateTask(task);
  assert.match(container.innerHTML,/Teilaufgaben 1\/4/);
  assert.match(container.innerHTML,/Aktuell:<\/span><span class="dashboard-subtask-title">Zweiter/);
  assert.match(container.innerHTML,/Als Nächstes:<\/span><span class="dashboard-subtask-title">Dritter/);
  assert.match(container.innerHTML,/<details class="dashboard-subtasks-more" data-task-id="task" open>/);
  assert.match(container.innerHTML,/Danach:<\/span><span class="dashboard-subtask-title">Vierter/);
  assert.match(container.innerHTML,/Gesamtfortschritt 25%/);
  task.subtasks.forEach(item=>{item.completed=true;});
  data.updateTask(task);
  assert.match(container.innerHTML,/Gesamtfortschritt 100%/);
  assert.match(container.innerHTML,/Alle Teilaufgaben erledigt/);
  task.subtasks[0].completed = false;
  data.updateTask(task);
  assert.match(container.innerHTML,/Teilaufgaben 3\/4/);
  assert.match(container.innerHTML,/Aktuell:<\/span><span class="dashboard-subtask-title">&lt;Erster&gt;/);
  assert.doesNotMatch(container.innerHTML,/Als Nächstes:/);
});

test('project progress identifies task commits and preserves expanded commit lists',()=>{
  const data = makeDataLayer();
  data.createProject({id:'project',title:'Projekt'});
  const task = data.createTask({
    id:'task',title:'Aufgabe',projectId:'project',status:'in-progress',
    githubCommitImport:{commits:[
      {sha:'111111111',title:'Ältester',date:'2020-01-01T10:00:00Z',calendarDate:'2020-01-01',calendarTime:'10:00'},
      {sha:'222222222',title:'Mittlerer',date:'2020-01-02T10:00:00Z',calendarDate:'2020-01-02',calendarTime:'10:00'},
      {sha:'333333333',title:'<Neuester>',date:'2020-01-03T10:00:00Z',calendarDate:'2020-01-03',calendarTime:'10:00'}
    ]}
  });
  const {dashboard,container} = makeDashboard(data);
  dashboard.renderProjectProgress();
  assert.match(container.innerHTML,/folder<\/span>Projekt/);
  assert.match(container.innerHTML,/task_alt<\/span>Aufgabe/);
  assert.match(container.innerHTML,/Zugeordnete Commits · 3/);
  assert.match(container.innerHTML,/data-open-done-task="task" data-focus-sha="333333333"/);
  assert.match(container.innerHTML,/&lt;Neuester&gt;/);
  assert.ok(container.innerHTML.indexOf('&lt;Neuester&gt;') < container.innerHTML.indexOf('Mittlerer'));
  assert.match(container.innerHTML,/<details class="project-progress-commits-more" data-task-id="task">/);

  container.expandedCommitTaskIds = ['task'];
  dashboard.renderProjectProgress();
  assert.match(container.innerHTML,/<details class="project-progress-commits-more" data-task-id="task" open>/);
  task.timeTracking = {isPaused:true};
  task.githubCommitImport.commits = [];
  dashboard.renderProjectProgress();
  assert.doesNotMatch(container.innerHTML,/project-progress-commits/);
  assert.match(container.innerHTML,/class="project-progress-task-activity">In Arbeit/);
  assert.doesNotMatch(container.innerHTML,/project-progress-task-activity is-tracking/);
});

test('project progress groups cross-project tasks once and identifies their projects',()=>{
  const data = makeDataLayer();
  data.createProject({id:'first',title:'Projekt <Alpha>'});
  data.createProject({id:'second',title:'Projekt Beta'});
  const shared = data.createTask({
    id:'shared',title:'Gemeinsame Arbeit',projectIds:['first','second'],status:'in-progress',
    subtasks:[{title:'Aktueller Schritt'},{title:'Nächster Schritt'}]
  });
  const otherShared = data.createTask({id:'other',title:'Weitere gemeinsame Arbeit',projectIds:['second','missing'],status:'in-progress'});
  data.createTask({id:'single',title:'Einzelprojekt',projectId:'first',status:'in-progress'});
  data.createTask({id:'free',title:'Administration',status:'in-progress'});
  data.createTask({id:'done-shared',title:'Abgeschlossen',projectIds:['first','second'],status:'done'});
  const {dashboard,container} = makeDashboard(data);
  data.on('dataChanged',event=>{
    if (event.entity==='tasks') dashboard.renderProjectProgress();
  });

  for (const collapsed of ['true','false']) {
    container.dataset.progressCollapsed=collapsed;
    dashboard.renderProjectProgress();
    const articles=container.innerHTML.match(/<article class="project-progress-item[^"]*">[\s\S]*?<\/article>/g);
    const group=articles.find(article=>article.includes('project-progress-cross-project'));
    assert.ok(group);
    assert.match(group,/Projektübergreifende Aufgaben/);
    assert.equal((group.match(/class="project-progress-task-title"/g)||[]).length,2);
    assert.match(group,/Gemeinsame Arbeit/);
    assert.match(group,/Projekt &lt;Alpha&gt;/);
    assert.match(group,/Projekt Beta/);
    assert.match(group,/Projekt nicht verfügbar/);
    assert.match(group,/Aktueller Schritt/);
    assert.doesNotMatch(group,/Abgeschlossen|Einzelprojekt|Administration/);
    assert.equal(articles.filter(article=>article.includes('Gemeinsame Arbeit')).length,1);
    assert.ok(articles.some(article=>article.includes('Einzelprojekt')&&!article.includes('project-progress-cross-project')));
    assert.ok(articles.some(article=>article.includes('Ohne Projekt')&&article.includes('Administration')));
  }

  shared.projectIds=['first'];
  shared.projectId='first';
  data.updateTask(shared);
  otherShared.status='done';
  data.updateTask(otherShared);
  assert.doesNotMatch(container.innerHTML,/project-progress-cross-project|Projektübergreifende Aufgaben/);
  assert.match(container.innerHTML,/Gemeinsame Arbeit/);
  assert.doesNotMatch(container.innerHTML,/Weitere gemeinsame Arbeit/);
});

test('project progress reads tracked minutes using the local calendar date',()=>{
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    class FixedDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : ['2026-03-29T23:30:00Z']));
      }
    }

    const data = makeDataLayer();
    data.createTask({
      id:'local-day',title:'Lokaler Tag',status:'in-progress',
      timeTracking:{minutesByDate:{'2026-03-30':423}}
    });
    const {dashboard,container} = makeDashboard(data,FixedDate);
    dashboard.renderProjectProgress();
    assert.match(container.innerHTML,/In Arbeit · 423 min heute/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('team load shows the current and next subtask and lets users expand the remaining list',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex'}];
  data.createTask({
    id:'active',title:'Aktive Aufgabe',status:'in-progress',assigneeId:'employee',employeeName:'Alex',
    subtasks:[
      {title:'Erster Schritt',completed:true},
      {title:'Aktueller Schritt'},
      {title:'Nächster Schritt'},
      {title:'Danach Schritt'},
      {title:'Letzter Schritt'}
    ]
  });
  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  const html = teamLoadContainer.innerHTML;
  assert.match(html,/Aktuell:<\/span><span class="dashboard-subtask-title">Aktueller Schritt/);
  assert.match(html,/Als Nächstes:<\/span><span class="dashboard-subtask-title">Nächster Schritt/);
  assert.match(html,/class="dashboard-subtasks-more"/);
  assert.match(html,/\+2 weitere Teilaufgaben anzeigen/);
  assert.match(html,/Danach:<\/span><span class="dashboard-subtask-title">Danach Schritt/);
  assert.match(html,/Danach:<\/span><span class="dashboard-subtask-title">Letzter Schritt/);
  assert.ok(html.indexOf('Nächster Schritt') < html.indexOf('Danach Schritt'));

  teamLoadContainer.expandedSubtaskTaskIds = ['active'];
  dashboard.renderTeamLoad();
  assert.match(teamLoadContainer.innerHTML,/<details class="dashboard-subtasks-more" data-task-id="active" open>/);
});

test('team load lists subtasks completed today under "Heute erledigt"',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex'}];
  data.createProject({id:'project',title:'Projekt & Team'});
  data.createTask({
    id:'active',title:'Aktive Aufgabe',projectId:'project',status:'in-progress',assigneeId:'employee',employeeName:'Alex',
    subtasks:[
      {title:'Heute fertig',completed:true,completedAt:new Date().toISOString()},
      {title:'Gestern fertig',completed:true,completedAt:new Date(Date.now()-86400000).toISOString()},
      {title:'Offen'}
    ]
  });
  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  const html = teamLoadContainer.innerHTML;
  assert.match(html,/Heute erledigt<\/span><span class="team-load-section-count is-done">1</);
  assert.match(html,/team-load-done-item is-progress/);
  assert.match(html,/<span class="team-load-done-project" title="Projekt &amp; Team"><span>Projekt &amp; Team<\/span><\/span><ul class="team-load-done-project-list"><li class="team-load-done-item is-progress">/);
  assert.match(html,/<button type="button" class="team-load-done-title team-load-done-open" data-open-done-task="active" title="Aktive Aufgabe"/);
  assert.match(html,/<span class="team-load-done-progress">Teilaufgaben 2\/3<\/span>/);
  assert.match(html,/data-open-done-task="active" data-focus-subtask="[^"]+" title="Heute fertig"/);
  assert.doesNotMatch(html,/Gestern fertig/);
});

test('team load groups all completed tasks under one project heading',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex'}];
  data.createProject({id:'project',title:'Gemeinsames Projekt'});
  const completedAt = new Date().toISOString();
  ['Erste Aufgabe','Zweite Aufgabe'].forEach((title,index)=>{
    data.createTask({
      id:'task-'+index,title,projectId:'project',status:'in-progress',assigneeId:'employee',employeeName:'Alex',
      subtasks:[{title:'Schritt '+index,completed:true,completedAt}]
    });
  });
  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  const html = teamLoadContainer.innerHTML;
  assert.equal((html.match(/class="team-load-done-project" title="Gemeinsames Projekt"/g)||[]).length,1);
  assert.match(html,/team-load-done-project-list"><li class="team-load-done-item is-progress">[\s\S]*Erste Aufgabe[\s\S]*<li class="team-load-done-item is-progress">[\s\S]*Zweite Aufgabe/);
});

test('team load displays task labels with their colors and a legend-color fallback',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex'}];
  data.getLabels = ()=>[
    {id:'bug',name:'Fehler & Fix',color:'#ef4444'},
    {id:'feature',name:'Feature'}
  ];
  const task = data.createTask({
    id:'labeled',title:'Beschriftete Aufgabe',status:'in-progress',assigneeId:'employee',
    labels:['bug','feature']
  });
  task.status = 'done';
  data.updateTask(task);

  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  assert.match(teamLoadContainer.innerHTML,/class="team-load-done-labels" aria-label="Aufgabenlabels"/);
  assert.match(teamLoadContainer.innerHTML,/style="--task-label-color:#ef4444" title="Fehler &amp; Fix">Fehler &amp; Fix<\/span>/);
  assert.match(teamLoadContainer.innerHTML,/style="--task-label-color:var\(--accent-red\)" title="Feature">Feature<\/span>/);
});

test('team load documents today\'s GitHub commits as development steps, including undocumented ones',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex',github:{username:'alex',aliases:['Alex Beispiel']}}];
  const today = new Date().toISOString();
  const old = new Date(Date.now()-40*86400000).toISOString();
  data.createProject({id:'project',title:'Projekt',githubCommits:[
    {sha:'aaaaaaa1',message:'feat: dokumentiert',author:'Alex Beispiel',date:today},
    {sha:'bbbbbbb2',message:'fix: noch ohne Aufgabe\n\nDetails',author:'Alex Beispiel',date:today,url:'https://github.com/o/r/commit/bbbbbbb2'},
    {sha:'ccccccc3',message:'chore: alt',author:'Alex Beispiel',date:old},
    {sha:'ddddddd4',message:'feat: fremd',author:'Jemand',date:today}
  ]});
  data.createTask({id:'doc',title:'Tagesdoku',projectId:'project',status:'done',assigneeId:'employee',
    githubCommitImport:{commits:[{sha:'aaaaaaa1',title:'Dokumentierter Schritt',date:today,employeeId:'employee',url:'https://github.com/o/r/commit/aaaaaaa1'}]},
    subtasks:[{title:'DE: Dokumentierter Schritt | EN: Documented | Commit: aaaaaaa1',completed:true,sourceCommitSha:'aaaaaaa1'}]});
  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  const html = teamLoadContainer.innerHTML;
  assert.match(html,/1 Aufgabe · 2 Commits/);
  assert.match(html,/data-open-done-task="doc" title="Tagesdoku"/);
  assert.match(html,/<span class="team-load-done-project" title="Projekt"><span>Projekt<\/span><\/span><ul class="team-load-done-project-list">/);
  assert.match(html,/href="https:\/\/github.com\/o\/r\/commit\/aaaaaaa1"[^>]*>aaaaaaa</);
  assert.match(html,/data-open-done-task="doc" data-focus-sha="aaaaaaa1" title="Dokumentierter Schritt"/);
  assert.match(html,/<span class="team-load-done-title" title="Commits ohne Aufgabe">Commits ohne Aufgabe<\/span>/);
  assert.match(html,/data-open-done-commit="bbbbbbb2" data-project-id="project" title="fix: noch ohne Aufgabe"/);
  assert.equal((html.match(/class="team-load-done-project" title="Projekt"/g)||[]).length,1);
  assert.equal((html.match(/Dokumentierter Schritt"/g)||[]).length,1);
  assert.doesNotMatch(html,/chore: alt|feat: fremd|feat: dokumentiert/);
});

test('team load finds tasks completed today via status history and GitHub commit dates',()=>{
  const data = makeDataLayer();
  data.getEmployees = ()=>[{id:'employee',name:'Alex'},{id:'other',name:'Bea'}];
  const nowIso = new Date().toISOString();
  const oldIso = new Date(Date.now()-40*86400000).toISOString();
  const manual = data.createTask({id:'manual',title:'Manuell fertig',status:'in-progress',assigneeIds:['other','employee']});
  manual.status = 'done';
  data.updateTask(manual);
  data.createTask({id:'commit-today',title:'Commit heute',status:'done',assigneeId:'employee',
    githubCommitImport:{commits:[{sha:'a1',date:nowIso,employeeId:'employee'}]},
    subtasks:[{title:'Commit a1',completed:true,assigneeId:'employee',sourceCommitSha:'a1'}]});
  data.createTask({id:'commit-old',title:'Commit alt',status:'done',assigneeId:'employee',
    githubCommitImport:{commits:[{sha:'b2',date:oldIso,employeeId:'employee'}]},
    subtasks:[{title:'Commit b2',completed:true,assigneeId:'employee',sourceCommitSha:'b2'}]});
  const {dashboard,teamLoadContainer} = makeDashboard(data);
  dashboard.renderTeamLoad();

  const alexCard = teamLoadContainer.innerHTML.split('<article').find(card=>card.includes('>Alex'));
  assert.match(alexCard,/Heute erledigt<\/span><span class="team-load-section-count is-done">2</);
  assert.match(alexCard,/title="Manuell fertig"/);
  assert.match(alexCard,/title="Commit heute"/);
  assert.doesNotMatch(alexCard,/Commit alt|Commit a1|Commit b2/);
});

test('updating a task stamps completedAt only for newly completed subtasks',()=>{
  const data = makeDataLayer();
  const task = data.createTask({id:'task',title:'Aufgabe',status:'in-progress',
    subtasks:[{title:'Alt erledigt',completed:true},{title:'Neu'}]});
  task.subtasks[1].completed = true;
  data.updateTask(task);
  assert.equal(task.subtasks[0].completedAt,'');
  assert.ok(task.subtasks[1].completedAt);
  task.subtasks[1].completed = false;
  data.updateTask(task);
  assert.equal(task.subtasks[1].completedAt,'');
});

test('project progress shows only tasks in progress, regardless of subtasks or recent activity',()=>{
  const data = makeDataLayer();
  data.createProject({id:'project',title:'Projekt'});
  const active = data.createTask({id:'active',title:'Aktive Aufgabe',projectId:'project',status:'in-progress'});
  const done = data.createTask({id:'done',title:'Erledigte Commits',projectId:'project',status:'done',subtasks:[{title:'Commit',completed:true}]});
  data.createTask({id:'todo',title:'Offene Aufgabe',projectId:'project',status:'todo',subtasks:[{title:'Schritt'}]});
  data.createTask({id:'free-done',title:'Erledigt ohne Projekt',status:'done',subtasks:[{title:'Commit',completed:true}]});
  const {dashboard,container} = makeDashboard(data);
  data.on('dataChanged',event=>{
    if (event.entity==='tasks') dashboard.renderProjectProgress();
  });
  data.updateTask(done);
  assert.match(container.innerHTML,/Aktive Aufgabe/);
  assert.doesNotMatch(container.innerHTML,/Erledigte Commits|Offene Aufgabe|Erledigt ohne Projekt|Ohne Projekt/);
  active.status = 'done';
  data.updateTask(active);
  assert.match(container.innerHTML,/Keine Aufgaben in Bearbeitung/);
  done.status = 'in-progress';
  data.updateTask(done);
  assert.match(container.innerHTML,/Erledigte Commits/);
  assert.match(container.innerHTML,/Alle Teilaufgaben erledigt/);
});

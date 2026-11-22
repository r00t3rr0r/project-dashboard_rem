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

function makeDashboard(data) {
  const container = {
    dataset:{},
    innerHTML:'',
    expandedSubtaskTaskIds:[],
    addEventListener(){},
    classList:{toggle(){}}
  };
  container.querySelectorAll = ()=>container.expandedSubtaskTaskIds.map(taskId=>({
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
    {window,document,console,Date,encodeURIComponent});
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
  data.createTask({
    id:'active',title:'Aktive Aufgabe',status:'in-progress',assigneeId:'employee',employeeName:'Alex',
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
  assert.match(html,/team-load-done-item is-subtask/);
  assert.match(html,/team-load-done-title" title="Heute fertig"/);
  assert.match(html,/Teilaufgabe · Aktive Aufgabe/);
  assert.doesNotMatch(html,/Gestern fertig/);
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness() {
  function element() {
    return {
      children:[],dataset:{},style:{setProperty(){}},innerHTML:'',textContent:'',
      appendChild(child){this.children.push(child);},
      setAttribute(){},addEventListener(){},classList:{add(){},toggle(){}},
      insertAdjacentHTML(position,html){this.innerHTML+=html;}
    };
  }
  const list=element();
  const document={
    addEventListener(){},
    createElement:element,
    getElementById:id=>id==='calendar-events-list'?list:null
  };
  const projects=[{id:'p1',title:'Projekt <Atlas>'},{id:'p2',name:'Projekt Beta'}];
  const window={DataLayer:{getProjects:()=>projects,getEmployees:()=>[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}]}};
  const source=fs.readFileSync(path.join(__dirname,'../modules/calendar.js'),'utf8').replace(
    'window.CalendarModule = {',
    'window.testCalendar = {createDayActivityChip,renderActivityList}; window.CalendarModule = {'
  );
  vm.runInNewContext(source,{window,document,console,requestAnimationFrame(){}});
  return {api:window.testCalendar,list};
}

function activity(projectId) {
  return {taskTitle:'Aufgabe',projectId,date:'2020-01-02',updatedAt:'2020-01-02T10:00:00Z',progress:30,type:'updated'};
}

test('calendar activity chips show the project and distinguish missing assignments',()=>{
  const {api}=harness();
  function badge(id) { return api.createDayActivityChip(activity(id)).children[0]; }
  assert.equal(badge('p1').children[1].textContent,'Projekt: Projekt <Atlas>');
  assert.equal(badge('p1').title,'Projekt: Projekt <Atlas>');
  assert.equal(badge('p2').children[1].textContent,'Projekt: Projekt Beta');
  assert.equal(badge(null).children[1].textContent,'Ohne Projekt');
  assert.equal(badge('deleted').children[1].textContent,'Projekt: Unbekanntes Projekt');
});

function graphBodies(list) {
  const wrap=list.children.find(child=>child.className==='calendar-gitgraph-wrap');
  return wrap.children[1].children.map(row=>row.children[1]).filter(body=>body.innerHTML.includes('calendar-gitgraph-badge'));
}

test('graph rows display the project independently and escape project names',()=>{
  const {api,list}=harness();
  api.renderActivityList(new Date(2020,0,1),[activity('p1'),activity(null)]);
  const bodies=graphBodies(list);
  assert.equal(bodies.length,2);
  assert.match(bodies[0].innerHTML,/Projekt &lt;Atlas&gt;/);
  assert.doesNotMatch(bodies[0].innerHTML,/Projekt <Atlas>/);
});

test('commit activity displays every assigned employee',()=>{
  const {api,list}=harness();
  const entry={...activity('p1'),type:'github-commit',assigneeId:'alice',assigneeIds:['alice','bob']};
  assert.match(api.createDayActivityChip(entry).children[2].textContent,/Alice, Bob/);
  api.renderActivityList(new Date(2020,0,1),[entry]);
  assert.match(graphBodies(list)[0].innerHTML,/Alice, Bob/);
});

test('unchanged workflow data reuses the cached graph node',()=>{
  const {api,list}=harness();
  const entries=[activity('p1')];
  api.renderActivityList(new Date(2020,0,1),entries);
  const first=list.children.find(child=>child.className==='calendar-gitgraph-wrap');
  list.children=[];
  api.renderActivityList(new Date(2020,0,1),entries);
  assert.equal(list.children.find(child=>child.className==='calendar-gitgraph-wrap'),first);
  list.children=[];
  api.renderActivityList(new Date(2020,0,1),[activity('p2')]);
  assert.notEqual(list.children.find(child=>child.className==='calendar-gitgraph-wrap'),first);
});

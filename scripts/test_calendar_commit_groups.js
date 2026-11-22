const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(events, tasks) {
  function element() {
    let html='';
    return {
      children:[],dataset:{},style:{setProperty(){}},textContent:'',handlers:{},
      classList:{add(){},remove(){},toggle(){}},
      get innerHTML(){return html;},
      set innerHTML(value){html=value;this.children=[];},
      appendChild(child){this.children.push(child);},
      addEventListener(name,fn){this.handlers[name]=fn;},
      setAttribute(){},removeAttribute(){},insertAdjacentHTML(){},click(){}
    };
  }
  const grid=element(),list=element(),legend=element(),downloads=[];
  const document={
    addEventListener(){},createElement:element,body:{appendChild(){},removeChild(){}},
    getElementById:id=>id==='calendar-grid'?grid:id==='calendar-events-list'?list:id==='calendar-type-legend'?legend:null
  };
  const window={opened:[],DataLayer:{
    getCalendarEvents:()=>events,getTasks:()=>tasks,
    getEmployees:()=>[{id:'alice',name:'Alice'},{id:'bob',name:'Bob'}],
    getProjects:()=>[{id:'p1',name:'Atlas'},{id:'p2',name:'Beta'}]
  }};
  const source=fs.readFileSync(path.join(__dirname,'../modules/calendar.js'),'utf8').replace(
    'window.CalendarModule = {',
    'openEventDetailsModal=function(id){window.opened.push(id);}; window.testCalendar={groupCommitEvents,createCommitGroup,renderEventList,renderCalendar,eventMatchesEmployeeFilter,setEmployee:function(id){selectedEmployeeId=id;},hideTaskType:function(){disabledTypeSet.add("task");}}; window.CalendarModule = {'
  );
  const URL={createObjectURL:blob=>{downloads.push(blob.content);return 'blob:test';},revokeObjectURL(){}};
  const Blob=class {constructor(parts){this.content=parts.join('');}};
  vm.runInNewContext(source,{window,document,console,URL,Blob,alert(){},requestAnimationFrame(){}});
  return {api:window.testCalendar,grid,list,legend,window,downloads};
}

function fixtures() {
  const commits=Array.from({length:5},(_,i)=>({
    sha:String(i+1).repeat(40),date:`2020-01-02T10:00:0${i}Z`
  }));
  const events=commits.map((commit,i)=>({
    id:'task-t1-github-commit-'+commit.sha,taskId:'t1',projectId:'p1',source:'github-commit',
    type:'task',date:'2020-01-02',startTime:'10:00',title:'GitHub-Commit: Change '+(i+1),
    commitEmployeeId:i%2?'bob':'alice'
  }));
  events.push({id:'other',projectId:'p2',source:'github-commit',type:'task',date:'2020-01-03',startTime:'09:00',title:'Beta'});
  events.push({id:'meeting',type:'meeting',date:'2020-01-02',title:'Meeting'});
  return {events,tasks:[{id:'t1',githubCommitImport:{commits}}]};
}

test('project groups show the three latest commits and expand the rest without losing detail links',()=>{
  const {events,tasks}=fixtures();
  const {api,window}=harness(events,tasks);
  const groups=api.groupCommitEvents(events);
  assert.equal(groups.length,3);
  assert.equal(groups[0].events.length,5);
  assert.equal(groups[1].projectId,'p2');
  assert.equal(groups[2].id,'meeting');
  const card=api.createCommitGroup(groups[0],false);
  assert.equal(card.children[0].children[0].className,'calendar-activity-project');
  assert.equal(card.children[0].children[0].children[0].textContent,'folder');
  assert.equal(card.children[0].children[0].children[1].textContent,'Projekt: Atlas');
  assert.equal(card.children[0].children[1].textContent,'5 Commits');
  assert.deepEqual(card.children.slice(1,4).map(button=>button.children[0].textContent),['Change 5','Change 4','Change 3']);
  const details=card.children[4];
  assert.equal(details.children[0].textContent,'2 weitere Commits anzeigen');
  assert.deepEqual(details.children.slice(1).map(button=>button.children[0].textContent),['Change 2','Change 1']);
  assert.match(card.children[1].children[1].textContent,/02\.01\.2020 · 10:00 · Alice/);
  card.children[1].handlers.click({stopPropagation(){}});
  assert.equal(window.opened[0],events[4].id);
  let stopped=false;
  card.handlers.dblclick({stopPropagation(){stopped=true;}});
  assert(stopped);
});

test('appointment view and export hide commit documentation but retain scheduled and manual events',()=>{
  const {events,tasks}=fixtures();
  ['deadline','fixed','range-start','range-end','asap'].forEach(suffix=>events.push({
    id:'task-t1-'+suffix,source:'task',taskId:'t1',type:'task',date:'2020-01-02',title:'Termin '+suffix
  }));
  events.push({id:'manual',type:'task',date:'2020-01-02',title:'Manueller Termin'});
  const {api,list,grid,legend,window,downloads}=harness(events,tasks);
  api.renderCalendar(new Date(2020,0,1));
  assert.equal(list.children.filter(child=>child.className==='calendar-commit-group').length,0);
  assert.equal(list.children.filter(child=>child.className==='calendar-event-card').length,7);
  const dayCells=grid.children.filter(child=>child.children.some(item=>item.className==='calendar-event-list'));
  const day2=dayCells[1].children.find(child=>child.className==='calendar-event-list');
  const day3=dayCells[2].children.find(child=>child.className==='calendar-event-list');
  assert.equal(day2.children.filter(child=>child.className==='calendar-commit-group calendar-commit-group--compact').length,0);
  assert(day2.children.some(child=>child.className==='calendar-event-chip'));
  assert.equal(day3.children.length,0);
  assert.match(legend.children.find(child=>child.innerHTML.includes('<span>Task</span>')).innerHTML,/<span class="calendar-legend-count">6<\/span>/);
  window.CalendarModule.exportICS();
  assert.equal((downloads[0].match(/BEGIN:VEVENT/g)||[]).length,7);
  assert.doesNotMatch(downloads[0],/github-commit/);
  assert.match(downloads[0],/SUMMARY:Termin deadline/);
});

test('multi-day employee status appears on each day and in the next month with employee filtering',()=>{
  const event={id:'leave',type:'holiday',employeeStatus:true,date:'2020-01-30',endDate:'2020-02-02',allDay:true,title:'Urlaub',attendeeIds:['alice']};
  const {api,grid,list,legend}=harness([event],[]);
  api.setEmployee('alice');
  api.renderCalendar(new Date(2020,1,1));
  const days=grid.children.filter(child=>child.children.some(item=>item.className==='calendar-event-list'));
  assert.equal(days[0].children.find(child=>child.className==='calendar-event-list').children.length,1);
  assert.equal(days[1].children.find(child=>child.className==='calendar-event-list').children.length,1);
  assert.equal(days[2].children.find(child=>child.className==='calendar-event-list').children.length,0);
  assert.equal(list.children.filter(child=>child.className==='calendar-event-card').length,1);
  assert.match(legend.children.find(child=>child.innerHTML.includes('<span>Urlaub</span>')).innerHTML,/<span class="calendar-legend-count">1<\/span>/);
  api.setEmployee('bob');
  api.renderCalendar(new Date(2020,1,1));
  assert.equal(list.children.filter(child=>child.className==='calendar-event-card').length,0);
});

test('group counts follow the employee filter and keep missing projects separate',()=>{
  const {events,tasks}=fixtures();
  events.push({id:'unassigned',source:'github-commit',type:'task',date:'2020-01-02'});
  const {api}=harness(events,tasks);
  const filtered=events.filter(event=>api.eventMatchesEmployeeFilter(event,'alice'));
  const groups=api.groupCommitEvents(filtered);
  assert.equal(groups[0].events.length,3);
  assert.equal(api.groupCommitEvents(events).find(group=>group.commitGroup&&!group.projectId).events.length,1);
  assert.equal(api.createCommitGroup(api.groupCommitEvents(events).find(group=>group.commitGroup&&!group.projectId),true).children[0].children[0].children[1].textContent,'Ohne Projekt');
});

test('workflow groups commits per project and day without hiding other activity or employee filtering',()=>{
  const {events,tasks}=fixtures();
  Object.assign(tasks[0],{title:'Tagesaufgabe',projectId:'p1',assigneeId:'alice',assigneeIds:['alice','bob'],
    status:'done',progress:100,history:[{type:'updated',at:'2020-01-02T11:00:00Z',progress:100}],
  });
  tasks[0].githubCommitImport.dailyTaskDate='2020-01-02';
  tasks[0].githubCommitImport.commits.forEach(commit=>{commit.calendarDate='2020-01-02';commit.calendarTime='10:00';});
  const {api,list,grid,window}=harness(events,tasks);
  window.CalendarModule.setMode('activity');
  api.renderCalendar(new Date(2020,0,1));
  const groups=list.children.filter(child=>child.className==='calendar-commit-group');
  assert.equal(groups.length,2);
  const atlas=groups.find(group=>group.children[0].children[0].children[1].textContent==='Projekt: Atlas');
  assert.equal(atlas.children[0].children[1].textContent,'5 Commits');
  assert.equal(atlas.children[4].children[0].textContent,'2 weitere Commits anzeigen');
  assert(list.children.some(child=>child.className==='calendar-event-card calendar-activity-card'));
  const dayCells=grid.children.filter(child=>child.children.some(item=>item.className==='calendar-event-list'));
  const day2=dayCells[1].children.find(child=>child.className==='calendar-event-list');
  assert(day2.children.some(child=>child.className==='calendar-commit-group calendar-commit-group--compact'));
  api.setEmployee('bob');
  api.renderCalendar(new Date(2020,0,1));
  const filtered=list.children.filter(child=>child.className==='calendar-commit-group');
  assert.equal(filtered.length,1);
  assert.equal(filtered[0].children[0].children[1].textContent,'2 Commits');
  assert.equal(filtered[0].children[1].children[1].textContent.includes('Bob'),true);
});

test('calendar applies employee and event type filters before grouping',()=>{
  const {events,tasks}=fixtures();
  const {api,list}=harness(events,tasks);
  api.setEmployee('alice');
  api.hideTaskType();
  api.setEmployee('bob');
  api.renderCalendar(new Date(2020,0,1));
  assert.equal(list.children.filter(child=>child.className==='calendar-commit-group').length,0);
  const workflow=harness(events,tasks);
  workflow.window.CalendarModule.setMode('activity');
  workflow.api.setEmployee('alice');
  workflow.api.hideTaskType();
  workflow.api.renderCalendar(new Date(2020,0,1));
  const group=workflow.list.children.find(child=>child.className==='calendar-commit-group');
  assert.equal(group.children[0].children[1].textContent,'3 Commits');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(task) {
  const elements = {};
  const alerts = [];
  const events = [];
  let current = task;
  const element = id => elements[id] ||= {
    value:'', files:[], textContent:'', disabled:false, listeners:{},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click(); }
  };
  const data = {
    getTaskById:()=>current,
    updateTask:value=>{current=value; return true;},
    updateTaskResponse:(id,response)=>{if(id!==current.id)return false; current={...current,response}; return true;},
    getCalendarEventById:id=>events.find(event=>event.id===id),
    createCalendarEvent:event=>{event.id='event-1'; events.push(event); return event;},
    updateCalendarEvent:event=>{events[events.findIndex(item=>item.id===event.id)]=event; return true;},
    deleteCalendarEvent:id=>{events.splice(events.findIndex(item=>item.id===id),1); return true;},
    waitForTaskAndCalendarSave:()=>Promise.resolve(true)
  };
  const window = {DataLayer:data, AuthManager:{
    getMode:()=> 'admin', canEditTask:()=>true, canCreateCalendarEvent:()=>true,
    getCurrentUser:()=>({id:'person'})
  }};
  const sandbox = {window, document:{getElementById:element}, alert:message=>alerts.push(message), console, Promise};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/task-response.js'),'utf8'),sandbox);
  return {window, sandbox, element, alerts, events, data, task:()=>current};
}

test('requires a valid answer of the requested type',()=>{
  const h=harness({});
  const valid=h.window.TaskResponse.hasValidAnswer;
  assert.equal(valid({}),true);
  assert.equal(valid({responseRequirement:{type:'text'},response:{type:'text',value:'  '}}),false);
  assert.equal(valid({responseRequirement:{type:'choice',options:['Ja','Nein']},response:{type:'choice',value:'Vielleicht'}}),false);
  assert.equal(valid({responseRequirement:{type:'file'},response:{type:'file',attachment:{url:'https://example.test'}}}),false);
  assert.equal(valid({responseRequirement:{type:'file'},response:{type:'file',attachment:{url:'/api/task-attachments/'+'a'.repeat(32)}}}),true);
  assert.equal(valid({responseRequirement:{type:'appointment'},response:{type:'appointment',date:'2026-11-27',startTime:'10:00',endTime:'09:00',calendarEventId:'event'}}),false);
});

test('editor validates the prompt and unique choice options',()=>{
  const h=harness({});
  h.element('x-response-type').value='choice';
  h.element('x-response-prompt').value='  Welche Antwort? ';
  h.element('x-response-options').value='Ja\nJa';
  assert.throws(()=>h.window.TaskResponse.readEditor('x'),/unterschiedliche/);
  h.element('x-response-options').value=' Ja \nNein';
  const config=h.window.TaskResponse.readEditor('x');
  assert.equal(config.prompt,'Welche Antwort?');
  assert.equal(config.options.join(','),'Ja,Nein');
  h.element('x-response-prompt').value=' ';
  assert.throws(()=>h.window.TaskResponse.readEditor('x'),/beschreiben/);
});

test('text and file answers are saved on the task and escaped for display',async()=>{
  const h=harness({id:'task',responseRequirement:{type:'text',prompt:'<Frage>'}});
  let refreshes=0;
  h.window.TaskResponse.bindDetail('task',()=>Promise.reject(new Error('unexpected')),()=>refreshes++);
  h.element('task-response-value').value='  <Antwort> ';
  h.element('task-response-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.task().response.value,'<Antwort>');
  assert.equal(h.task().response.employeeId,'person');
  assert.equal(refreshes,1);
  const html=h.window.TaskResponse.detailHtml(h.task(),true);
  assert.match(html,/&lt;Frage&gt;/);
  assert.match(html,/&lt;Antwort&gt;/);
  h.task().responseRequirement={type:'file',prompt:'Bitte Datei'};
  h.element('task-response-file').files=[{name:'a.txt'}];
  h.window.TaskResponse.bindDetail('task',()=>Promise.resolve({name:'a.txt',url:'/api/task-attachments/'+'b'.repeat(32)}),()=>refreshes++);
  h.element('task-response-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.window.TaskResponse.hasValidAnswer(h.task()),true);
  assert.equal(h.task().response.attachment.name,'a.txt');
});

test('appointment creates and then updates one team calendar meeting',async()=>{
  const h=harness({id:'task',title:'Besprechung',projectId:'project',assigneeIds:['a','b'],responseRequirement:{type:'appointment',prompt:'Termin vereinbaren'}});
  h.window.TaskResponse.bindDetail('task',()=>{},()=>{});
  h.element('task-response-date').value='2026-11-27';
  h.element('task-response-start').value='10:00';
  h.element('task-response-end').value='09:00';
  h.element('task-response-submit').click();
  assert.equal(h.events.length,0);
  assert.match(h.alerts[0],/Endzeit/);
  h.element('task-response-end').value='11:00';
  h.element('task-response-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].type,'meeting');
  assert.equal(h.events[0].attendeeIds.join(','),'a,b');
  assert.equal(h.task().response.calendarEventId,'event-1');
  h.element('task-response-end').value='12:00';
  h.element('task-response-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].endTime,'12:00');
});

test('failed task save rolls back a created appointment and shows the error',async()=>{
  const h=harness({id:'task',title:'Termin',assigneeIds:[],responseRequirement:{type:'appointment',prompt:'Termin'}});
  h.data.updateTaskResponse=()=>false;
  h.window.TaskResponse.bindDetail('task',()=>{},()=>assert.fail('must not refresh'));
  h.element('task-response-date').value='2026-11-27';
  h.element('task-response-start').value='10:00';
  h.element('task-response-end').value='11:00';
  h.element('task-response-submit').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.length,0);
  assert.match(h.element('task-response-feedback').textContent,/nicht gespeichert/);
  assert.equal(h.element('task-response-submit').disabled,false);
});

test('rejects invalid choices and calendar answers without calendar permission',()=>{
  const h=harness({id:'task',responseRequirement:{type:'choice',prompt:'Wählen',options:['Ja','Nein']}});
  h.window.TaskResponse.bindDetail('task',()=>{},()=>{});
  h.element('task-response-value').value='Vielleicht';
  h.element('task-response-submit').click();
  assert.match(h.alerts[0],/gültige Antwort/);
  assert.equal(h.task().response,undefined);
  h.task().responseRequirement={type:'appointment',prompt:'Termin'};
  h.window.AuthManager.canCreateCalendarEvent=()=>false;
  h.element('task-response-date').value='2026-11-27';
  h.element('task-response-start').value='10:00';
  h.element('task-response-end').value='11:00';
  h.element('task-response-submit').click();
  assert.match(h.alerts[1],/Berechtigung/);
  assert.equal(h.events.length,0);
});

test('does not save a file answer if the requirement changes during upload',async()=>{
  const h=harness({id:'task',responseRequirement:{type:'file',prompt:'Datei'}});
  let finishUpload;
  h.window.TaskResponse.bindDetail('task',()=>new Promise(resolve=>{finishUpload=resolve;}),()=>assert.fail('must not refresh'));
  h.element('task-response-file').files=[{name:'a.txt'}];
  h.element('task-response-submit').click();
  h.task().responseRequirement={type:'text',prompt:'Text'};
  finishUpload({name:'a.txt',url:'/api/task-attachments/'+'b'.repeat(32)});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.task().response,undefined);
  assert.match(h.element('task-response-feedback').textContent,/geändert/);
});

test('kanban completion refuses missing answers before mutating a task',()=>{
  const h=harness({});
  h.sandbox.document.readyState='loading';
  h.sandbox.document.addEventListener=()=>{};
  let source=fs.readFileSync(path.join(__dirname,'../modules/kanban.js'),'utf8');
  source=source.replace('window.KanbanBoard = {','window.testTransition = applyTaskStatusTransition; window.KanbanBoard = {');
  vm.runInNewContext(source,h.sandbox);
  const task={id:'task',status:'todo',responseRequirement:{type:'text',prompt:'Antwort'}};
  assert.equal(h.window.testTransition(task,'done'),false);
  assert.equal(task.status,'todo');
  assert.match(h.alerts[0],/Antwort/);
});

test('review approval refuses a task without its required answer',()=>{
  const task={id:'task',status:'review',responseRequirement:{type:'text',prompt:'Antwort'}};
  const h=harness(task);
  h.sandbox.document.readyState='loading';
  h.sandbox.document.addEventListener=()=>{};
  let source=fs.readFileSync(path.join(__dirname,'../modules/task-history.js'),'utf8');
  source=source.replace('window.TaskHistoryModule = {','window.testApprove = approveReview; window.TaskHistoryModule = {');
  vm.runInNewContext(source,h.sandbox);
  h.window.testApprove('task','');
  assert.equal(h.task().status,'review');
  assert.match(h.alerts[0],/Antwort/);
});

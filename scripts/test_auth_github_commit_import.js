const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(mode, allowed=true, projects=[], tasks=[]) {
  const alerts=[], batches=[], responses=[];
  const data={
    createTasks:tasks=>{batches.push(tasks);return tasks;},
    getTaskById:id=>tasks.find(task=>task.id===id)||null,
    updateTaskResponse:(id,response)=>{responses.push({id,response});return true;},
    getProjectById:id=>id==='p1'?{id:'p1'}:null,
    getProjects:()=>projects,
    getTasks:()=>tasks
  };
  const window={DataLayer:data,alert:message=>alerts.push(message)};
  const source=fs.readFileSync(path.join(__dirname,'../modules/auth.js'),'utf8').replace(
    'window.AuthManager = {',
    `getMode=function(){return ${JSON.stringify(mode)};};
     getCurrentUser=function(){return {id:'alice'};};
     canAccessPage=function(){return ${allowed};};
     window.testWrapDataLayer=wrapDataLayer;
     window.AuthManager = {`
  );
  vm.runInNewContext(source,{window,document:{readyState:'loading',addEventListener(){}},console});
  window.testWrapDataLayer();
  return {data,alerts,batches,responses,manager:window.AuthManager};
}

test('answering preserves task assignments and records the authenticated author',()=>{
  const tasks=[{id:'one',assigneeId:'bob',assigneeIds:['bob','alice']}];
  const h=harness('employee',true,[],tasks);
  assert.equal(h.data.updateTaskResponse('one',{type:'text',value:'Antwort',employeeId:'bob'}),true);
  assert.equal(h.responses[0].response.employeeId,'alice');
  assert.equal(tasks[0].assigneeId,'bob');
  const guest=harness('guest',true,[],tasks);
  assert.equal(guest.data.updateTaskResponse('one',{type:'text',value:'Antwort'}),false);
  assert.equal(guest.responses.length,0);
});

function task(employeeId='alice') {
  return {projectId:'p1',assigneeIds:['alice','bob'],
    githubCommitImport:{commits:[{employeeId}]},subtasks:[{assigneeId:employeeId}]};
}

test('batch creation permits admin and denies guests and employees without page access',()=>{
  const admin=harness('admin');
  assert.equal(admin.data.createTasks([task('bob')]).length,1);
  for(const [mode,allowed] of [['guest',true],['employee',false]]) {
    const h=harness(mode,allowed);
    assert.equal(h.data.createTasks([task()]),false);
    assert.equal(h.batches.length,0);
    assert.equal(h.alerts.length,1);
  }
});

test('employee batch creation checks every project and commit before saving',()=>{
  const h=harness('employee');
  assert.equal(h.data.createTasks([task(),{...task(),projectId:'missing'}]),false);
  assert.equal(h.data.createTasks([task(),task('bob')]),false);
  assert.equal(h.data.createTasks([{...task(),subtasks:[{assigneeId:'bob'}]}]),false);
  assert.equal(h.batches.length,0);
  assert.equal(h.alerts.length,3);
  const saved=h.data.createTasks([task()]);
  assert.equal(saved[0].assigneeId,'alice');
  assert.equal(saved[0].assigneeIds.join(','),'alice');
  assert.equal(saved[0].githubCommitImport.commits[0].employeeId,'alice');
});

test('employee projects include created, team-assigned, and task-assigned projects only',()=>{
  const projects=[
    {id:'created',createdByEmployeeId:'alice'},
    {id:'team',teamMembers:[{employeeId:'alice'}]},
    {id:'task-assigned'},
    {id:'other',createdByEmployeeId:'bob',teamMembers:[{employeeId:'bob'}]}
  ];
  const h=harness('employee',true,projects,[{id:'t1',projectId:'task-assigned',assigneeId:'alice'}]);

  assert.deepEqual(Array.from(h.manager.getProjectsForEmployee('alice'),project=>project.id),['created','team','task-assigned']);
  assert.deepEqual(Array.from(h.manager.getProjectsForEmployee('bob'),project=>project.id),['other']);
  assert.deepEqual(Array.from(h.manager.getProjectsForEmployee(''),project=>project.id),[]);
});

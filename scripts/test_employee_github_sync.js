const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function makeHarness(projects, fetch) {
  const employees = [{
    id: 'alice',
    name: 'Alice',
    github: {username: 'alice'}
  }];
  const storage = new Map();
  const localStorage = {
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value))
  };
  const notifications = [];
  const window = {
    DataLayer: {
      getEmployees:()=>employees,
      createEmployee:employee=>{employees.push(employee);return employee;},
      updateEmployee:employee=>{
        const index = employees.findIndex(item=>item.id===employee.id);
        if (index < 0) return false;
        employees[index] = employee;
        return true;
      },
      getProjects:()=>projects,
      getTasks:()=>[],
      createNotification:notification=>notifications.push(notification)
    },
    AuthManager:{
      canManageEmployeeActivities:()=>true,
      getProjectsForEmployee:employeeId=>projects.filter(project=>
        String(project.createdByEmployeeId||'')===String(employeeId)||
        (Array.isArray(project.teamMembers)&&project.teamMembers.some(member=>String(member.employeeId||'')===String(employeeId)))
      )
    }
  };
  let source = fs.readFileSync(path.join(__dirname,'../modules/employees.js'),'utf8');
  source = source.replaceAll("renderEmployeeList('employee-list');", '');
  vm.runInNewContext(source,{
    window,
    document:{readyState:'loading',addEventListener(){},getElementById:()=>null},
    localStorage,
    fetch,
    console,
    Promise,
    Date,
    URL
  });
  return {api:window.EmployeeManager,employees,notifications,storage};
}

function project(owner,repo,title) {
  return {id:repo,title,teamMembers:[{employeeId:'alice'}],github:{owner,repo}};
}

function response(status,body,message='') {
  return {
    ok:status>=200&&status<300,
    status,
    headers:{get:()=>''},
    json:async()=>message?{message}:body
  };
}

function commit(sha) {
  return {
    sha,
    html_url:'https://github.com/acme/app/commit/'+sha,
    commit:{
      message:'Fix sync',
      author:{name:'Alice',email:'alice@example.com',date:new Date().toISOString()}
    },
    author:{login:'alice',html_url:'https://github.com/alice'}
  };
}

test('partial GitHub sync identifies the failed repository and keeps successful activity',async()=>{
  const h = makeHarness(
    [project('acme','app','App'),project('acme','private','Private')],
    async url=>url.includes('/private/commits')
      ? response(404,{},'Not Found')
      : response(200,[commit('abc123')])
  );

  const activity = await h.api.syncGitHubActivity('alice');

  assert.equal(activity.totalCommits,1);
  assert.match(activity.syncError,/Private \(acme\/private\)/);
  assert.match(activity.syncError,/nicht gefunden oder fuer diesen Token nicht zugaenglich \(404\)/);
  assert.equal(h.employees[0].github.syncStatus,'partial');
  assert.equal(h.notifications.length,1);
  assert.match(h.notifications[0].message,/acme\/private/);
});

test('a total GitHub failure reports repository names and does not erase the last cache',async()=>{
  const h = makeHarness(
    [project('acme','app','App'),project('acme','private','Private')],
    async()=>response(404,{},'Not Found')
  );
  const cacheKey = 'EmployeeManager_github_activity_cache_v1';
  const priorActivity = {
    employeeId:'alice',
    username:'alice',
    fetchedAt:new Date().toISOString(),
    totalCommits:1,
    syncError:'',
    countsByDay:{},
    projectActivity:[],
    recentCommits:[commit('previous')]
  };
  h.storage.set(cacheKey,JSON.stringify({alice:priorActivity}));

  await assert.rejects(h.api.syncGitHubActivity('alice'),error=>{
    assert.match(error.message,/App \(acme\/app\)/);
    assert.match(error.message,/Private \(acme\/private\)/);
    assert.match(error.message,/404/);
    return true;
  });

  assert.deepEqual(JSON.parse(h.storage.get(cacheKey)).alice,priorActivity);
  assert.equal(h.employees[0].github.syncStatus,'error');
  assert.match(h.employees[0].github.syncError,/acme\/private/);
});

test('GitHub commit pagination continues beyond three full pages',async()=>{
  let pageRequests = 0;
  const h = makeHarness([project('acme','app','App')],async url=>{
    const page = Number(new URL(url).searchParams.get('page'));
    pageRequests++;
    return response(200,page<5?Array.from({length:100},(_,index)=>commit(page+'-'+index)):[commit('last')]);
  });

  const activity = await h.api.syncGitHubActivity('alice');

  assert.equal(pageRequests,5);
  assert.equal(activity.totalCommits,401);
});

test('sync is limited to the employee projects and the selected project ids',async()=>{
  const ownProject = project('acme','own','Own project');
  const anotherOwnProject = project('acme','another','Another own project');
  const otherProject = project('acme','other','Other project');
  otherProject.teamMembers = [{employeeId:'bob'}];
  const requestedUrls = [];
  const h = makeHarness([ownProject,anotherOwnProject,otherProject],async url=>{
    requestedUrls.push(new URL(url).pathname);
    return response(200,[]);
  });

  await h.api.syncGitHubActivity('alice',['own','other']);

  assert.deepEqual(requestedUrls,['/repos/acme/own/commits']);
});

test('GitHub rate-limit errors explain the cause and next step',async()=>{
  const h = makeHarness([project('acme','app','App')],async()=>response(403,{},'API rate limit exceeded'));

  await assert.rejects(h.api.syncGitHubActivity('alice'),/GitHub API Rate Limit erreicht \(403\).*PAT hinterlegen/);
  assert.equal(h.employees[0].github.syncStatus,'error');
});

test('sync without linked repositories reports the missing setup',async()=>{
  const h = makeHarness([],async()=>assert.fail('GitHub API should not be called'));

  await assert.rejects(h.api.syncGitHubActivity('alice'),/Keine zugeordneten Dashboard-Projekte/);
  assert.equal(h.employees[0].github.syncStatus,'error');
});

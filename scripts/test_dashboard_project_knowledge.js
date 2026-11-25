const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(project, canView) {
  const document = {
    readyState:'loading', addEventListener(){}, getElementById(){return null;},
    createTextNode(value){return value;},
    createElement(){return {innerHTML:'', appendChild(text){
      this.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }};}
  };
  const messages = [];
  const window = {
    location:{origin:'http://localhost'},
    DataLayer:{getProjectById:()=>project},
    AuthManager:{canViewProject:()=>canView},
    QuickTaskModule:{showToast:(message)=>messages.push(message)}
  };
  const source = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8').replace(
    'function renderDashboardKnowledge(project){',
    'window.knowledgeTest={renderDashboardKnowledge,openDashboardKnowledgeDialog};\nfunction renderDashboardKnowledge(project){'
  );
  vm.runInNewContext(source, {window, document, console, URL, Date});
  return {api:window.knowledgeTest, messages};
}

test('knowledge is escaped, links are validated and sensitive values are initially absent', () => {
  const project = {id:'p1', infoHub:{
    attachments:[{id:'a',name:'<file>',size:12}],
    secrets:[{id:'s',label:'Token',value:'private-value'}],
    notes:[{title:'<title>',text:'first\nsecond'}],
    links:[{label:'Docs',url:'https://example.com/docs#section'},{label:'Bad',url:'javascript:alert(1)'}],
    scratchpad:'<scratch>', envText:'PASSWORD=private-env'
  }};
  const html = harness(project, true).api.renderDashboardKnowledge(project);
  assert.match(html, /&lt;file&gt;/);
  assert.match(html, /&lt;title&gt;/);
  assert.match(html, /first\nsecond/);
  assert.match(html, /https:\/\/example.com\/docs#section/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Ungültige URL/);
  assert.match(html, /&lt;scratch&gt;/);
  assert.doesNotMatch(html, /private-value|private-env/);
  assert.match(html, /data-knowledge-download="0"/);
  assert.match(html, /data-knowledge-secret="0" aria-pressed="false"/);
  assert.match(html, /data-knowledge-env aria-pressed="false"/);
});

test('empty sections are explained and unauthorized access is denied', () => {
  const project = {id:'p1'};
  const {api,messages} = harness(project, false);
  const html = api.renderDashboardKnowledge(project);
  for (const text of ['Keine Anhänge vorhanden.', 'Keine Secrets vorhanden.', 'Keine Notizen vorhanden.', 'Keine Links vorhanden.']) {
    assert.ok(html.includes(text), text);
  }
  api.openDashboardKnowledgeDialog('p1');
  assert.match(messages[0], /nicht verfügbar/);
});

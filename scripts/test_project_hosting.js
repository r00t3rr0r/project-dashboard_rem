const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness() {
  const document = {
    readyState:'loading', addEventListener(){}, getElementById(){return null;},
    createTextNode(value){return value;},
    createElement(){return {innerHTML:'', appendChild(text){
      this.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }};}
  };
  const window = {location:{origin:'http://localhost'}, DataLayer:{}};
  const context = vm.createContext({window, document, console, URL, Date});
  const source = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8').replace(
    'function renderProjectHeadResources(project,flow,canEdit){',
    'window.hostingTest={renderHostingStatus,renderHostingExpiry,renderProjectHeadResources,safeHostingUrl,setChecks:function(value){HOSTING_CHECKS=value;}};\nfunction renderProjectHeadResources(project,flow,canEdit){'
  );
  vm.runInContext(source, context);
  return window.hostingTest;
}

test('hosting status ignores results for an old URL and warns when results are stale', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://new.example/'}};
  api.setChecks({p1:[{url:'https://old.example/', status:'up', checkedAt:new Date().toISOString()}]});
  assert.match(api.renderHostingStatus(project), /Noch nicht geprüft/);
  api.setChecks({p1:[{url:project.hosting.url, status:'up', checkedAt:new Date(Date.now()-13*60000).toISOString()}]});
  assert.match(api.renderHostingStatus(project), /hosting-status is-warning">Prüfung veraltet/);
});

test('redirects and errors never appear as an available live project', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/'}};
  api.setChecks({p1:[{url:project.hosting.url, status:'redirect', checkedAt:new Date().toISOString(), httpStatus:302, responseMs:10}]});
  assert.match(api.renderHostingStatus(project), /hosting-status is-warning">Weiterleitung ungeprüft/);
  assert.doesNotMatch(api.renderHostingStatus(project), /Erreichbar/);
  assert.equal(api.safeHostingUrl('javascript:alert(1)'), '');
  assert.equal(api.safeHostingUrl('https://user:pass@example.com/'), '');
});

test('expiry colors distinguish impending and expired dates', () => {
  const api = harness();
  const today = new Date();
  const localDate = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const yesterday = new Date(today);
  const tomorrow = new Date(today);
  yesterday.setDate(yesterday.getDate()-1);
  tomorrow.setDate(tomorrow.getDate()+1);
  assert.match(api.renderHostingExpiry('Domain', localDate(tomorrow)), /hosting-expiry-warning is-warning/);
  assert.match(api.renderHostingExpiry('Domain', localDate(yesterday)), /hosting-expiry-warning is-down/);
  assert.match(api.renderHostingExpiry('Domain', localDate(yesterday)), /abgelaufen/);
});

test('knowledge and hosting actions are displayed and expiry dates warn', () => {
  const api = harness();
  const html = api.renderProjectHeadResources({
    id:'p1', aiKnowledge:{filePath:'data/project-knowledge/p1.md',lastGeneratedAt:'2030-01-01'},
    hosting:{url:'https://example.com/',domainExpiry:'2000-01-01'}
  }, {attachmentCount:1,secretCount:2,noteCount:3,linkCount:4}, true);
  assert.match(html, /Wissensdatei öffnen/);
  assert.match(html, /1 Anhänge · 2 Secrets · 3 Notizen · 4 Links/);
  assert.match(html, /abgelaufen/);
  assert.match(html, /Hosting speichern/);
});

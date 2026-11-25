const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(mode='admin') {
  const nodes = {};
  const document = {
    readyState:'loading', addEventListener(){}, getElementById(){return null;},
    querySelectorAll(selector){return nodes[selector] || [];},
    createTextNode(value){return value;},
    createElement(){return {innerHTML:'', appendChild(text){
      this.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }};}
  };
  const window = {location:{origin:'http://localhost'},AuthManager:{getMode:()=>mode},DataLayer:{updateProject(){}},QuickTaskModule:{showToast(){}}};
  const context = vm.createContext({window, document, console, URL, Date, fetch:(...args)=>window.testFetch(...args)});
  const source = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8').replace(
    'function renderProjectHeadResources(project,flow,canEdit){',
    'window.hostingTest={renderHostingStatus,renderHostingExpiry,renderProjectHeadResources,renderHostingServerSummary,renderHostingCertificateSummary,renderAutomaticCertificateExpiry,refreshHostingChecks,safeHostingUrl,saveHosting,renderHostingScreenshot,updateHostingScreenshot,ensureHostingScreenshot,screenshotQueue:function(){return HOSTING_SCREENSHOT_QUEUE;},setChecks:function(value){HOSTING_CHECKS=value;},setError:function(value){HOSTING_CHECKS_ERROR=value;},setScreenshot:function(id,value){HOSTING_SCREENSHOTS[id]=value;}};\nfunction renderProjectHeadResources(project,flow,canEdit){'
  ).replace(
    "notify('Hosting-Daten gespeichert. Die automatische Prüfung erfolgt innerhalb von fünf Minuten.','info');\n  render();",
    "notify('Hosting-Daten gespeichert. Die automatische Prüfung erfolgt innerhalb von fünf Minuten.','info');"
  );
  vm.runInContext(source, context);
  window.hostingTest.configureRefresh = (project, response, targets) => {
    window.DataLayer.getProjectById = () => project;
    window.testFetch = () => Promise.resolve({ok:true,json:()=>Promise.resolve(response)});
    Object.assign(nodes, targets);
  };
  window.hostingTest.setFetch = value => { window.testFetch = value; };
  window.hostingTest.setNodes = (selector, value) => { nodes[selector] = value; };
  return window.hostingTest;
}

test('screenshot updates keep the dashboard read-only and its preview viewable', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/'}};
  api.setScreenshot(project.id, {url:project.hosting.url,createdAt:'2030-01-01T00:00:00Z'});
  const attributes = {'data-action':'view-hosting-screenshot','data-id':'p1'};
  const button = {
    setAttribute(name,value){attributes[name]=value;},
    removeAttribute(name){delete attributes[name];}
  };
  const node = dashboard => ({
    innerHTML:'',
    getAttribute:()=>project.id,
    closest:()=>dashboard,
    querySelector:()=>button
  });
  const dashboard=node(true), projects=node(false);
  api.setNodes('[data-hosting-screenshot]', [dashboard, projects]);
  api.updateHostingScreenshot(project);
  assert.match(dashboard.innerHTML, /Screenshot vergrößern/);
  assert.doesNotMatch(dashboard.innerHTML, /Screenshot aktualisieren/);
  assert.equal(attributes['data-dashboard-hosting-screenshot'], 'p1');
  assert.equal(attributes['data-action'], undefined);
  assert.match(projects.innerHTML, /Screenshot aktualisieren/);
});

test('screenshots are created once, refreshed manually and hidden after a URL change', async () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/'}};
  const calls = [];
  api.setFetch((url, options) => {
    calls.push([url, options]);
    if (options.method === 'POST') return Promise.resolve({ok:true,json:async()=>({createdAt:'2030-01-01T00:00:00Z'})});
    return Promise.resolve({status:404});
  });
  api.ensureHostingScreenshot(project, true, false);
  await api.screenshotQueue();
  assert.equal(calls.length, 2);
  assert.match(api.renderHostingScreenshot(project, true), /Screenshot vergrößern/);
  api.ensureHostingScreenshot(project, true, false);
  await api.screenshotQueue();
  assert.equal(calls.length, 2);
  api.ensureHostingScreenshot(project, true, true);
  await api.screenshotQueue();
  assert.equal(calls.length, 3);
  project.hosting.url='https://other.example/';
  assert.doesNotMatch(api.renderHostingScreenshot(project, true), /Screenshot vergrößern/);
});

test('screenshot errors are visible and viewers do not initiate creation', async () => {
  const api = harness();
  const project = {id:'p2', hosting:{url:'https://example.com/'}};
  let calls = 0;
  api.setFetch(() => { calls++; return Promise.resolve({status:404}); });
  api.ensureHostingScreenshot(project, false, false);
  await api.screenshotQueue();
  assert.equal(calls, 1);
  assert.match(api.renderHostingScreenshot(project, false), /Noch kein Screenshot vorhanden/);
  assert.doesNotMatch(api.renderHostingScreenshot(project, false), /Screenshot erstellen/);
  api.setFetch(() => Promise.resolve({ok:false,json:async()=>({error:'Docker nicht erreichbar'})}));
  api.ensureHostingScreenshot(project, true, true);
  await api.screenshotQueue();
  assert.match(api.renderHostingScreenshot(project, true), /Docker nicht erreichbar/);
  assert.match(api.renderHostingScreenshot(project, true), /Screenshot erstellen/);
});

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

test('knowledge and hosting data are grouped and editable', () => {
  const api = harness();
  const html = api.renderProjectHeadResources({
    id:'p1', aiKnowledge:{filePath:'data/project-knowledge/p1.md',lastGeneratedAt:'2030-01-01'},
    hosting:{url:'https://example.com/',domainExpiry:'2000-01-01',nameServers:'ns1.example.com',paidUntil:'2000-01-01',billingInterval:'jährlich'}
  }, {attachmentCount:1,secretCount:2,noteCount:3,linkCount:4}, true);
  assert.match(html, /Wissensdatei öffnen/);
  assert.match(html, /1 Anhänge · 2 Secrets · 3 Notizen · 4 Links/);
  assert.match(html, /abgelaufen/);
  assert.match(html, /Hosting speichern/);
  for (const label of ['Hosting & Server', 'Domain & DNS', 'SSL / TLS', 'Vertrag & Abrechnung', 'Nameserver', 'Bezahlt bis', 'Nächste Rechnung']) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /ns1\.example\.com/);
  assert.match(html, /jährlich/);
  assert.match(html, /data-hosting-field="dnsRecords"/);
  assert.match(html, /data-hosting-field="autoRenew"/);
});

test('AI project knowledge is hidden from non-admin project cards', () => {
  const api = harness('employee');
  const html = api.renderProjectHeadResources({
    id:'p1', aiKnowledge:{filePath:'data/project-knowledge/p1.md'},
    hosting:{url:'https://example.com/'}
  }, {attachmentCount:0,secretCount:0,noteCount:0,linkCount:0}, false);
  assert.doesNotMatch(html, /Wissensdatei öffnen/);
  assert.match(html, /Hosting &amp; Live-Status/);
});

test('automatic DNS and verified TLS details are shown separately from manual information', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/'}};
  api.setChecks({p1:[{
    url:project.hosting.url, status:'up', checkedAt:new Date().toISOString(), httpStatus:200, responseMs:10,
    dns:{host:'example.com', addresses:['8.8.8.8','8.8.4.4']},
    certificate:{issuer:'CA <test>', subject:'example.com', notAfter:'2030-04-01T00:00:00+00:00', tlsVersion:'TLSv1.3'}
  }]});
  const html = api.renderHostingStatus(project);
  assert.match(html, /8\.8\.8\.8, 8\.8\.4\.4/);
  assert.match(html, /CA &lt;test&gt;/);
  assert.match(html, /TLSv1\.3/);
  assert.match(html, /SSL läuft ab/);
  api.setChecks({p1:[{url:project.hosting.url, status:'down', checkedAt:new Date().toISOString(), error:'TLS fehlgeschlagen'}]});
  assert.match(api.renderHostingStatus(project), /SSL \/ TLS · geprüft<\/span><strong>Nicht verfügbar/);
});

test('server and SSL summaries show automatic values without replacing manual data', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/',server:'internal-host',certificateExpiry:'2031-02-01'}};
  assert.match(api.renderHostingServerSummary(project), /Noch nicht geprüft/);
  assert.match(api.renderHostingCertificateSummary(project), /Noch nicht geprüft/);
  const expires = new Date(Date.now()+10*86400000).toISOString();
  api.setChecks({p1:[{url:project.hosting.url, checkedAt:new Date().toISOString(),
    dns:{addresses:['8.8.8.8','8.8.4.4']},certificate:{notAfter:expires}}]});
  const server = api.renderHostingServerSummary(project);
  const ssl = api.renderHostingCertificateSummary(project);
  assert.match(server, /8\.8\.8\.8, 8\.8\.4\.4/);
  assert.match(server, /internal-host/);
  assert.match(server, /Proxys oder CDN/);
  assert.match(ssl, /SSL-Ablauf \(automatisch\)/);
  assert.match(ssl, /läuft bald ab/);
  assert.match(ssl, /SSL-Ablauf \(manuell\)/);
  api.setChecks({p1:[{url:project.hosting.url, checkedAt:new Date(Date.now()-13*60000).toISOString(), dns:{addresses:['8.8.8.8']}}]});
  assert.match(api.renderHostingServerSummary(project), /Prüfung veraltet/);
  assert.match(api.renderHostingCertificateSummary(project), /Nicht verfügbar/);
  project.hosting.url='https://other.example/';
  assert.match(api.renderHostingServerSummary(project), /Noch nicht geprüft/);
  api.setError('offline');
  assert.match(api.renderHostingCertificateSummary(project), /Überwachung nicht verfügbar/);
});

test('automatic certificate expiry uses the exact timestamp', () => {
  const api = harness();
  assert.match(api.renderAutomaticCertificateExpiry(new Date(Date.now()-60000).toISOString()), /abgelaufen/);
  assert.match(api.renderAutomaticCertificateExpiry(new Date(Date.now()+60000).toISOString()), /läuft bald ab/);
  assert.equal(api.renderAutomaticCertificateExpiry('invalid'), 'Nicht verfügbar');
});

test('dashboard hosting separates monitoring, server and certificate without repeating values', () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/',server:'8.8.8.8',provider:'Hetzner',certificateExpiry:'2031-02-01'}};
  const checkedAt = new Date().toISOString();
  api.setChecks({p1:[{
    url:project.hosting.url,status:'up',checkedAt,httpStatus:200,responseMs:12,
    dns:{host:'example.com',addresses:['8.8.8.8']},
    certificate:{issuer:'Test CA',subject:'example.com',tlsVersion:'TLSv1.3',notAfter:'2030-04-01T00:00:00Z'}
  }]});
  const status = api.renderHostingStatus(project, true);
  const server = api.renderHostingServerSummary(project, true);
  const certificate = api.renderHostingCertificateSummary(project, true);
  assert.match(status, /Erreichbar/);
  assert.doesNotMatch(status, /8\.8\.8\.8|Test CA|Prüfverlauf/);
  assert.equal((server.match(/8\.8\.8\.8/g) || []).length, 1);
  assert.match(server, /DNS\) \/ Server \(manuell/);
  assert.match(server, /example\.com/);
  assert.doesNotMatch(server, /DNS-Prüfung/);
  assert.match(certificate, /Test CA/);
  assert.match(certificate, /TLSv1\.3/);
  assert.doesNotMatch(certificate, /example\.com|SSL-Ablauf \(manuell\)|<dt>Prüfung/);
  api.setChecks({p1:[{url:project.hosting.url,checkedAt,dns:{host:'example.com',addresses:['8.8.8.8','8.8.4.4']}}]});
  const multiple = api.renderHostingServerSummary(project, true);
  assert.equal((multiple.match(/8\.8\.8\.8/g) || []).length, 1);
  assert.match(multiple, /8\.8\.8\.8 \(Server manuell\), 8\.8\.4\.4/);
  project.hosting.server = 'internal-host';
  assert.match(api.renderHostingServerSummary(project, true), /internal-host/);
});

test('dashboard polling retains its compact layout and the projects view retains details', async () => {
  const api = harness();
  const project = {id:'p1',hosting:{url:'https://example.com/',server:'8.8.8.8'}};
  const node = dashboard => ({innerHTML:'',getAttribute:()=>project.id,closest:()=>dashboard});
  const dashboardStatus = node(true), projectStatus = node(false), dashboardServer = node(true), dashboardCertificate = node(true);
  api.configureRefresh(project, {checks:{p1:[{
    url:project.hosting.url,status:'up',checkedAt:new Date().toISOString(),httpStatus:200,responseMs:12,
    dns:{host:'example.com',addresses:['8.8.8.8']},certificate:{issuer:'Test CA'}
  }]}}, {
    '[data-hosting-status]':[dashboardStatus,projectStatus],
    '[data-hosting-server-summary]':[dashboardServer],
    '[data-hosting-certificate-summary]':[dashboardCertificate]
  });
  await api.refreshHostingChecks();
  assert.doesNotMatch(dashboardStatus.innerHTML, /8\.8\.8\.8|Test CA/);
  assert.match(projectStatus.innerHTML, /8\.8\.8\.8/);
  assert.equal((dashboardServer.innerHTML.match(/8\.8\.8\.8/g) || []).length, 1);
  assert.match(dashboardCertificate.innerHTML, /Test CA/);
});

test('polling refreshes IP and certificate summaries without rerendering the editor', async () => {
  const api = harness();
  const project = {id:'p1', hosting:{url:'https://example.com/'}};
  const node = () => ({innerHTML:'', getAttribute:()=>project.id, closest:()=>false});
  const status = node(), server = node(), certificate = node();
  api.configureRefresh(project, {checks:{p1:[{
    url:project.hosting.url,status:'up',checkedAt:new Date().toISOString(),httpStatus:200,responseMs:12,
    dns:{addresses:['8.8.8.8']},certificate:{notAfter:new Date(Date.now()+86400000).toISOString()}
  }]}}, {
    '[data-hosting-status]':[status],
    '[data-hosting-server-summary]':[server],
    '[data-hosting-certificate-summary]':[certificate]
  });
  await api.refreshHostingChecks();
  assert.match(status.innerHTML, /Erreichbar/);
  assert.match(server.innerHTML, /8\.8\.8\.8/);
  assert.match(certificate.innerHTML, /SSL-Ablauf \(automatisch\)/);
  assert.match(certificate.innerHTML, /läuft bald ab/);
});

test('saving hosting details preserves existing fields and rejects invalid amounts', () => {
  const api = harness();
  const project = {hosting:{legacy:'keep', url:'https://example.com/'}};
  const field = (name, value, valid = true) => ({
    value, getAttribute:()=>name, checkValidity:()=>valid, reportValidity(){}
  });
  api.saveHosting(project, {querySelectorAll:()=>[
    field('url','https://example.com/'), field('adminUrl',''),
    field('dnsProvider','DNS'), field('paidUntil','2030-01-01'), field('billingAmount','25.00')
  ]});
  assert.equal(project.hosting.legacy, 'keep');
  assert.equal(project.hosting.dnsProvider, 'DNS');
  assert.equal(project.hosting.paidUntil, '2030-01-01');
  api.saveHosting(project, {querySelectorAll:()=>[field('billingAmount','-1',false)]});
  assert.equal(project.hosting.billingAmount, '25.00');
});

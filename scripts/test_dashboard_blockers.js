const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function makeDashboard(tasks, projects) {
  let now = Date.parse('2026-11-26T12:00:00Z');
  class Clock extends Date {
    static now() { return now; }
  }
  const host = {
    innerHTML: '',
    classList: {add() {}, remove() {}},
    timers: [],
    querySelectorAll(selector) {
      assert.equal(selector, '[data-blocker-start]');
      return this.timers;
    }
  };
  const document = {
    addEventListener() {},
    getElementById(id) { return id === 'dashboard' ? {} : id === 'dashboard-blocker-zone' ? host : null; },
    createTextNode(value) { return value; },
    createElement() {
      return {appendChild(value) {
        this.innerHTML = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }};
    }
  };
  const window = {DataLayer: {
    getTasks: () => tasks,
    getProjects: () => projects,
    canResolveBlocker: () => true
  }};
  let source = fs.readFileSync(path.join(__dirname, '../modules/dashboard.js'), 'utf8');
  source = source.replace('// --- Public API ---', 'window.blockerTest = {renderDashboardBlockers, updateBlockerFilter, updateBlockerTimers, formatBlockerDuration};\n  // --- Public API ---');
  vm.runInNewContext(source, {window, document, console, Date: Clock});
  return {api: window.blockerTest, host, setNow: value => { now = Date.parse(value); }};
}

test('blocker cards distinguish fields, escape content and preserve multiline reasons', () => {
  const h = makeDashboard([
    {id: 'task', title: '<Aufgabe>', projectId: 'p', blocked: true, blockedAt: '2026-11-25T10:00:00Z',
      blockedReason: 'Erste Zeile\nZweite Zeile', blockerTaskId: 'blocker'},
    {id: 'blocker', title: 'Freigabe', isBlocker: true}
  ], [{id: 'p', name: 'Projekt A'}]);
  h.api.renderDashboardBlockers();
  assert.match(h.host.innerHTML, /&lt;Aufgabe&gt;/);
  assert.match(h.host.innerHTML, /blocker-detail-reason"><dt>Grund<\/dt><dd>Erste Zeile\nZweite Zeile/);
  assert.match(h.host.innerHTML, /blocker-detail-project"><dt>Projekt<\/dt><dd>Projekt A/);
  assert.match(h.host.innerHTML, /blocker-detail-blocker"><dt>Blocker<\/dt><dd>Freigabe/);
  assert.match(h.host.innerHTML, /data-blocker-start="2026-11-25T10:00:00Z">1 Tag 02:00:00/);
  assert.match(h.host.innerHTML, /data-resolve-blocker="task::task"/);
});

test('active durations tick without rerendering and invalid or future dates are explicit', () => {
  const h = makeDashboard([], []);
  const timer = {textContent: '', getAttribute: () => '2026-11-26T11:59:58Z'};
  h.host.timers = [timer];
  h.api.updateBlockerTimers(h.host);
  assert.equal(timer.textContent, '00:00:02');
  h.setNow('2026-11-26T12:00:01Z');
  h.api.updateBlockerTimers(h.host);
  assert.equal(timer.textContent, '00:00:03');
  assert.equal(h.api.formatBlockerDuration('invalid'), 'Nicht verfügbar');
  assert.equal(h.api.formatBlockerDuration('2026-11-27T00:00:00Z'), 'Nicht verfügbar');
  assert.equal(h.api.formatBlockerDuration('2026-11-26T00:00:00Z', 'invalid'), 'Nicht verfügbar');
});

test('resolved history has a fixed duration and no live ticker or resolve action', () => {
  const h = makeDashboard([{
    id: 'task', title: 'Aufgabe', blockerHistory: [
      {from: '2026-11-25T10:00:00Z', until: '2026-11-25T11:05:06Z', reason: 'Warten', resolution: 'Erledigt', blockerTitle: 'Ehemaliger Blocker'},
      {from: '2026-11-26T11:00:00Z', reason: 'Offen'}
    ]
  }], []);
  h.api.updateBlockerFilter('scope', 'all');
  assert.match(h.host.innerHTML, /Dauer<\/span>\s*<span class="blocker-card-duration">01:05:06/);
  assert.match(h.host.innerHTML, /blocker-detail-resolution"><dt>Auflösung<\/dt><dd>Erledigt/);
  assert.match(h.host.innerHTML, /blocker-detail-blocker"><dt>Blocker<\/dt><dd>Ehemaliger Blocker/);
  assert.equal((h.host.innerHTML.match(/data-blocker-start=/g) || []).length, 1);
  assert.equal((h.host.innerHTML.match(/data-resolve-blocker=/g) || []).length, 1);
});

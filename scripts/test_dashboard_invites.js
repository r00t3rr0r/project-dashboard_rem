const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(initialEvents = []) {
  const classes = new Set(['hidden']);
  const host = {
    innerHTML: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
  const events = initialEvents.slice();
  const employees = [{id: 'alice', name: 'Alice'}, {id: 'bob', name: 'Bob'}];
  const document = {
    addEventListener() {},
    getElementById(id) { return id === 'dashboard-invites' ? host : null; },
    createElement() {
      return {
        innerHTML: '',
        appendChild(node) {
          this.innerHTML = String(node.textContent)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
      };
    },
    createTextNode(text) { return {textContent: text}; }
  };
  let currentUser = {id: 'alice', name: 'Alice'};
  const window = {
    AuthManager: {getCurrentUser: () => currentUser},
    DataLayer: {getCalendarEvents: () => events, getEmployees: () => employees},
    CalendarModule: {
      applyInviteUrgency(target, pending) { target.classList.toggle('has-pending', !!pending.length); }
    },
    setInterval() {}
  };
  const source = fs.readFileSync(path.join(__dirname, '../modules/dashboard.js'), 'utf8').replace(
    'window.DashboardManager = {',
    'window.testDashboardInvites = {renderDashboardInvites}; window.DashboardManager = {'
  );
  vm.runInNewContext(source, {window, document, console});
  return {
    api: window.testDashboardInvites, host, events,
    setCurrentUser(user) { currentUser = user; }
  };
}

test('dashboard shows invite type and all participant responses, then removes answered invites', () => {
  const h = harness([{
    id: 'invite-1', type: 'videoconference', title: 'Projektstart', date: '2099-01-30',
    attendeeIds: ['alice', 'bob'], responses: {bob: {status: 'declined'}}
  }]);

  h.api.renderDashboardInvites();
  assert.match(h.host.innerHTML, /Videokonferenz/);
  assert.match(h.host.innerHTML, /data-invite-open="invite-1"/);
  assert.match(h.host.innerHTML, /Alice[\s\S]*Ausstehend/);
  assert.match(h.host.innerHTML, /Bob[\s\S]*Abgesagt/);
  assert.doesNotMatch(h.host.innerHTML, /Deine Antworten/);

  h.events[0].responses.alice = {status: 'accepted'};
  h.api.renderDashboardInvites();
  assert.equal(h.host.innerHTML, '');
  assert.equal(h.host.classList.contains('hidden'), true);
});

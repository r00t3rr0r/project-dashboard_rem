const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(initialEvents = []) {
  const events = initialEvents.slice();
  const alerts = [];
  const fields = {};
  const employees = [{id: 'alice', name: 'Alice'}, {id: 'bob', name: 'Bob'}];
  const checkboxes = [];
  const list = {
    children: [], innerHTML: '',
    appendChild(child) { this.children.push(child); }
  };
  fields['calendar-events-list'] = list;
  fields['evt-attendee-list'] = {querySelectorAll: () => checkboxes};
  const inviteClasses = new Set(['hidden']);
  const invitePanel = {
    innerHTML: '',
    style: {setProperty() {}, removeProperty() {}},
    classList: {
      add(name) { inviteClasses.add(name); },
      remove(name) { inviteClasses.delete(name); },
      toggle(name, force) {
        if (force === undefined ? !inviteClasses.has(name) : force) inviteClasses.add(name);
        else inviteClasses.delete(name);
      },
      contains(name) { return inviteClasses.has(name); }
    }
  };
  fields['calendar-pending-invites'] = invitePanel;
  const document = {
    addEventListener() {},
    getElementById: id => fields[id] || null,
    createElement() {
      return {
        children: [], dataset: {}, style: {}, classList: {add() {}},
        appendChild(child) { this.children.push(child); },
        addEventListener() {}, setAttribute() {}, removeAttribute() {}, click() {}
      };
    },
    body: {appendChild() {}, removeChild() {}}
  };
  const data = {
    getCalendarEvents: () => events,
    getCalendarEventById: id => events.find(event => event.id === id),
    getEmployees: () => employees,
    getProjects: () => [],
    createCalendarEvent(event) { event.id = 'new'; events.push(event); return event; },
    updateCalendarEvent(event) {
      const index = events.findIndex(item => item.id === event.id);
      if (index < 0) return false;
      events[index] = event;
      return true;
    }
  };
  let exported = '';
  let currentUser = {id: 'alice', name: 'Alice'};
  const window = {DataLayer: data, AuthManager: {getCurrentUser: () => currentUser}};
  const source = fs.readFileSync(path.join(__dirname, '../modules/calendar.js'), 'utf8').replace(
    'window.CalendarModule = {',
    'window.testCalendar = {eventOverlaps, isEmployeeStatus, buildEventEditorHtml, buildEventDetailsHtml, setupEventEditor, renderEventList, createDayEventChip, buildCalendarInviteRow, renderPendingInvites}; window.CalendarModule = {'
  );
  const URL = {createObjectURL(blob) { exported = blob.parts.join(''); return 'blob:test'; }, revokeObjectURL() {}};
  const Blob = class { constructor(parts) { this.parts = parts; } };
  vm.runInNewContext(source, {window, document, console, URL, Blob, alert: message => alerts.push(message), requestAnimationFrame() {}});
  function form(values = {}) {
    const defaults = {
      'evt-title': 'Urlaub', 'evt-date': '2026-01-30', 'evt-end-date': '2026-02-02',
      'evt-start-time': '', 'evt-end-time': '', 'evt-type': 'holiday', 'evt-location': '',
      'evt-description': '', 'evt-project': '', 'evt-id': '', 'evt-created-at': ''
    };
    for (const [id, value] of Object.entries({...defaults, ...values})) fields[id] = {value};
    fields['evt-all-day'] = {checked: true};
    checkboxes.splice(0, checkboxes.length, {value: 'alice', checked: true});
  }
  return {
    api: window.testCalendar, window, events, alerts, fields, checkboxes, list, invitePanel,
    form, exported: () => exported
  };
}

test('employee status saves without invitations and appears across month boundaries', () => {
  const h = harness();
  h.form();
  h.window.saveCalendarEvent();
  const event = h.events[0];
  assert.equal(event.employeeStatus, true);
  assert.equal(event.endDate, '2026-02-02');
  assert.equal(h.api.eventOverlaps(event, '2026-02-01', '2026-02-28'), true);
  assert.equal(h.api.eventOverlaps(event, '2026-02-03', '2026-02-28'), false);
  assert.equal(h.api.createDayEventChip(event).children[1].textContent, 'Alice');
  h.api.renderEventList(new Date(2026, 1, 1), h.events);
  assert.equal(h.list.children.length, 2);
  assert.match(h.list.children[1].innerHTML, /30\.01\.2026 – 02\.02\.2026/);
  assert.doesNotMatch(h.list.children[1].innerHTML, /calendar-event-card-rsvp/);
  assert.doesNotMatch(h.api.buildEventDetailsHtml(event), /Meine Teilnahme|Erinnerung senden/);
  assert.match(h.api.buildEventDetailsHtml(event), /Alice/);
});

test('validates dates, all-day ranges and employee assignment before saving', () => {
  const h = harness();
  h.form({'evt-date': ''});
  h.window.saveCalendarEvent();
  h.form({'evt-end-date': '2026-01-29'});
  h.window.saveCalendarEvent();
  h.form();
  h.fields['evt-all-day'].checked = false;
  h.window.saveCalendarEvent();
  h.form();
  h.checkboxes[0].checked = false;
  h.window.saveCalendarEvent();
  assert.equal(h.events.length, 0);
  assert.equal(h.alerts.length, 4);
});

test('sick entries omit medical details; editing preserves unrelated event metadata', () => {
  const h = harness([{id: 'old', type: 'meeting', title: 'Meeting', source: 'manual', createdAt: '2025-01-01', attendeeIds: ['alice']}]);
  h.form({'evt-id': 'old', 'evt-type': 'sick', 'evt-title': 'Diagnosis', 'evt-description': 'Private', 'evt-location': 'Private', 'evt-project': 'p'});
  h.window.saveCalendarEvent();
  assert.equal(h.events[0].title, 'Krankmeldung');
  assert.equal(h.events[0].description, '');
  assert.equal(h.events[0].location, '');
  assert.equal(h.events[0].projectId, null);
  assert.equal(h.events[0].source, 'manual');
  assert.match(h.api.buildEventEditorHtml(h.events[0]), /evt-sick-notice/);
});

test('legacy holiday invitations remain invitations and survive editing', () => {
  const event = {id: 'old', type: 'holiday', title: 'Feier', date: '2026-01-30', attendeeIds: ['alice'], responses: {alice: {status: 'accepted'}}};
  const h = harness([event]);
  assert.equal(h.api.isEmployeeStatus(event), false);
  h.form({'evt-id': 'old'});
  h.window.saveCalendarEvent();
  assert.equal(h.events[0].employeeStatus, false);
  assert.equal(h.events[0].responses.alice.status, 'accepted');
});

test('switching between appointments and status entries does not retain invitation responses', () => {
  const h = harness([{id: 'old', type: 'meeting', title: 'Meeting', date: '2026-01-30', attendeeIds: ['alice'], responses: {alice: {status: 'accepted'}}}]);
  h.form({'evt-id': 'old', 'evt-type': 'home-office'});
  h.window.saveCalendarEvent();
  assert.equal(h.events[0].responses.alice, undefined);
  h.form({'evt-id': 'old', 'evt-type': 'meeting'});
  h.window.saveCalendarEvent();
  assert.equal(h.events[0].responses.alice, undefined);
  assert.equal(h.api.isEmployeeStatus(h.events[0]), false);
});

test('pending invitation shows event type and participant responses, then disappears after answering', () => {
  const event = {
    id: 'invite-1', type: 'videoconference', title: 'Projektstart', date: '2099-01-30',
    attendeeIds: ['alice', 'bob'],
    responses: {bob: {status: 'tentative'}}
  };
  const h = harness([event]);
  h.api.renderPendingInvites();
  assert.match(h.invitePanel.innerHTML, /Videokonferenz/);
  assert.match(h.invitePanel.innerHTML, /data-invite-open="invite-1"/);
  assert.match(h.invitePanel.innerHTML, /Alice[\s\S]*Ausstehend/);
  assert.match(h.invitePanel.innerHTML, /Bob[\s\S]*Vielleicht/);
  assert.doesNotMatch(h.invitePanel.innerHTML, /Deine Antworten/);

  event.responses.alice = {status: 'accepted'};
  h.api.renderPendingInvites();
  assert.equal(h.invitePanel.innerHTML, '');
  assert.equal(h.invitePanel.classList.contains('hidden'), true);
});

test('status editor defaults to all day and hides medical detail fields for sickness', () => {
  const h = harness();
  h.form({'evt-type': 'meeting'});
  const handlers = {};
  const hidden = {};
  for (const id of ['evt-attendee-label', 'evt-attendee-hint', 'evt-sick-notice', 'evt-description-group', 'evt-location-group', 'evt-project-group', 'evt-attendees-project-team']) {
    h.fields[id] = {classList: {toggle(name, value) { hidden[id] = value; }}};
  }
  for (const id of ['evt-type', 'evt-all-day']) {
    h.fields[id].addEventListener = (name, callback) => { handlers[id] = callback; };
  }
  h.api.setupEventEditor(null);
  h.fields['evt-type'].value = 'sick';
  handlers['evt-type']();
  assert.equal(h.fields['evt-title'].value, 'Krankmeldung');
  assert.equal(h.fields['evt-title'].readOnly, true);
  assert.equal(h.fields['evt-all-day'].checked, true);
  assert.equal(h.fields['evt-start-time'].disabled, true);
  assert.equal(hidden['evt-description-group'], true);
  assert.equal(hidden['evt-sick-notice'], false);
  assert.match(h.fields['evt-attendee-hint'].textContent, /ohne Einladung/);
  h.fields['evt-type'].value = 'meeting';
  handlers['evt-type']();
  assert.equal(h.fields['evt-title'].readOnly, false);
  assert.equal(hidden['evt-description-group'], false);
});

test('iCal uses exclusive end date and includes employee names for status entries', () => {
  const h = harness([{id: '1', type: 'home-office', title: 'Homeoffice', date: '2026-12-30', endDate: '2027-01-02', allDay: true, attendeeIds: ['alice', 'bob']}]);
  h.window.CalendarModule.exportICS();
  assert.match(h.exported(), /DTSTART;VALUE=DATE:20261230\r\nDTEND;VALUE=DATE:20270103/);
  assert.match(h.exported(), /DESCRIPTION:Mitarbeiter: Alice\\, Bob/);
  assert.doesNotMatch(h.exported(), /ATTENDEE/);
});

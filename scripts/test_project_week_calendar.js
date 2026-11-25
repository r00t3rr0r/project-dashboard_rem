const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const now = new Date(2030, 0, 2, 12);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  static now() { return now.getTime(); }
}

function harness(events) {
  const document = {
    readyState:'loading', addEventListener(){}, getElementById(){return null;},
    createTextNode(value){return value;},
    createElement(){
      return {
        innerHTML:'',
        appendChild(text){
          this.innerHTML = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        }
      };
    }
  };
  const window = {
    location:{origin:'http://localhost'},
    DataLayer:{getCalendarEvents:()=>events}
  };
  const context = vm.createContext({window, document, console, Date:FixedDate});
  const calendar = fs.readFileSync(path.join(__dirname, '../modules/calendar.js'), 'utf8');
  const projects = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8').replace(
    'function renderProjectCardHeadTimeline(project){',
    'window.testTimeline={buildProjectTimelinePreview,renderProjectTimelineWeekCalendar,renderProjectCardHeadTimeline};\nfunction renderProjectCardHeadTimeline(project){'
  );
  vm.runInContext(calendar, context);
  vm.runInContext(projects, context);
  return window.testTimeline;
}

function dateOffset(days) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7 + days);
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

function event(date, title, type, source) {
  return {projectId:'p1', date, title, type, source};
}

test('each day limits agenda and popover to five entries with separate expandable remainder', () => {
  const today = Array.from({length:7}, (_, i) => event(dateOffset(2), 'Heute '+i, 'meeting'));
  const tomorrow = Array.from({length:6}, (_, i) => event(dateOffset(3), 'Morgen '+i, 'task'));
  const api = harness([...today, ...tomorrow]);
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview({id:'p1'}, 3));
  const agenda = html.split('<ul class="project-head-timeline-week-agenda">')[1];
  assert.match(agenda, /\+2 weitere Termine \(Mi\)/);
  assert.match(agenda, /\+1 weiterer Termin \(Do\)/);
  assert.equal((agenda.match(/<details>/g) || []).length, 2);
  assert.equal((agenda.split('<details>')[0].match(/week-agenda-item/g) || []).length, 5);
  assert.match(agenda, /Heute 5/);
  assert.match(agenda, /Morgen 5/);
  const todayPopover = html.slice(html.indexOf('<ul class="project-head-timeline-week-day-popover-list">')).split('</details>')[0];
  assert.equal((todayPopover.split('<details>')[0].match(/week-day-popover-item/g) || []).length, 5);
  assert.match(todayPopover, /Heute 6/);
  assert.match(html, /<details class="project-head-timeline-week-day has-entry is-today"><summary/);
});

test('five entries need no expansion and event types use team calendar colors', () => {
  const entries = [
    event(dateOffset(2), 'Meeting', 'meeting'),
    event(dateOffset(2), 'Deadline', 'deadline'),
    event(dateOffset(2), 'Task <Titel>', 'task'),
    event(dateOffset(2), 'Release', 'release'),
    event(dateOffset(2), 'Unbekannt', 'unknown')
  ];
  const api = harness(entries);
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview({id:'p1'}, 3));
  assert.doesNotMatch(html, /<details>/);
  for (const color of ['blue', 'red', 'yellow', 'green']) {
    assert.match(html, new RegExp('border-left:3px solid var\\(--accent-' + color + '\\)'));
  }
  assert.match(html, /border-left:3px solid var\(--text-muted\)/);
  assert.match(html, /Task &lt;Titel&gt;/);
});

test('draft milestones use the release color and an empty week stays empty', () => {
  const api = harness([]);
  const empty = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview({id:'p1'}, 3));
  assert.match(empty, /Keine Termine in dieser Woche/);
  const project = {id:'p1', executionPlanDraft:{milestoneDraft:{items:[{date:dateOffset(2), title:'Meilenstein'}]}}};
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview(project, 3));
  assert.match(html, /border-left:3px solid var\(--accent-green\)/);
});

test('past day entries are selectable but excluded from the upcoming timeline and agenda', () => {
  const api = harness([
    event(dateOffset(1), 'Vergangener Termin', 'meeting'),
    event(dateOffset(1), 'Vergangene Aufgabe', 'task', 'task'),
    event(dateOffset(1), 'Vergangener Commit', 'task', 'github-commit'),
    event(dateOffset(2), 'Heutige Aufgabe', 'task', 'task'),
    event(dateOffset(3), 'Zukünftiger Termin', 'meeting'),
    event(dateOffset(2), 'Heutiger Commit', 'task', 'github-commit'),
    event(dateOffset(4), 'Zukünftiger Commit', 'task', 'github-commit')
  ]);
  const html = api.renderProjectCardHeadTimeline({id:'p1'});
  const agenda = html.split('<ul class="project-head-timeline-week-agenda">')[1];
  const preview = html.split('<div class="project-head-timeline-week">')[0];
  assert.match(html, /Heutige Aufgabe/);
  assert.match(html, /Zukünftiger Termin/);
  assert.doesNotMatch(html, /Heutiger Commit|Zukünftiger Commit/);
  assert.doesNotMatch(preview + agenda, /Vergangener Termin|Vergangene Aufgabe|Vergangener Commit/);
  assert.match(html, /<details class="project-head-timeline-week-day has-entry is-past"><summary aria-label="Di 01\. 3 Termine">/);
  assert.match(html, /Vergangener Termin/);
  assert.match(html, /Vergangene Aufgabe/);
  assert.match(html, /Vergangener Commit/);
  assert.match(html, /<details class="project-head-timeline-week-day has-entry is-today"><summary aria-label="Mi 02\. 1 Termin">/);
});

test('past empty days are selectable and past overflow remains expandable', () => {
  const entries = Array.from({length:7}, (_, i) => event(dateOffset(1), 'Alter Termin '+i, 'meeting'));
  const api = harness(entries);
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview({id:'p1'}, 3));
  assert.match(html, /<details class="project-head-timeline-week-day is-past"><summary aria-label="Mo 31\. Keine Termine">/);
  assert.match(html, /\+2 weitere Termine \(Di\)/);
  const agenda = html.split('<ul class="project-head-timeline-week-agenda">')[1];
  assert.match(agenda, /Keine Termine in dieser Woche/);
  assert.doesNotMatch(agenda, /Alter Termin/);
});

test('only past entries leave the current week empty instead of displaying a past week', () => {
  const api = harness([event(dateOffset(-7), 'Alter Termin', 'meeting')]);
  const html = api.renderProjectCardHeadTimeline({id:'p1'});
  assert.doesNotMatch(html, /Alter Termin|Zuletzt geplant/);
  assert.match(html, /31\.12\. - 06\.01\./);
  assert.match(html, /Keine Termine in dieser Woche/);
});

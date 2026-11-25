const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

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
  const context = vm.createContext({window, document, console});
  const calendar = fs.readFileSync(path.join(__dirname, '../modules/calendar.js'), 'utf8');
  const projects = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8').replace(
    'function renderProjectCardHeadTimeline(project){',
    'window.testTimeline={buildProjectTimelinePreview,renderProjectTimelineWeekCalendar};\nfunction renderProjectCardHeadTimeline(project){'
  );
  vm.runInContext(calendar, context);
  vm.runInContext(projects, context);
  return window.testTimeline;
}

function dateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7 + days);
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

function event(date, title, type, source) {
  return {projectId:'p1', date, title, type, source};
}

test('each day limits agenda and popover to five entries with separate expandable remainder', () => {
  const monday = Array.from({length:7}, (_, i) => event(dateOffset(0), 'Montag '+i, 'meeting'));
  const tuesday = Array.from({length:6}, (_, i) => event(dateOffset(1), 'Dienstag '+i, 'task'));
  const api = harness([...monday, ...tuesday]);
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview({id:'p1'}, 3));
  const agenda = html.split('<ul class="project-head-timeline-week-agenda">')[1];
  assert.match(agenda, /\+2 weitere Termine \(Mo\)/);
  assert.match(agenda, /\+1 weiterer Termin \(Di\)/);
  assert.equal((html.match(/<details>/g) || []).length, 4);
  assert.equal((agenda.split('<details>')[0].match(/week-agenda-item/g) || []).length, 5);
  assert.match(agenda, /Montag 5/);
  assert.match(agenda, /Dienstag 5/);
  const mondayPopover = html.slice(html.indexOf('<ul class="project-head-timeline-week-day-popover-list">')).split('</details>')[0];
  assert.equal((mondayPopover.split('<details>')[0].match(/week-day-popover-item/g) || []).length, 5);
  assert.match(mondayPopover, /Montag 6/);
});

test('five entries need no expansion and event types use team calendar colors', () => {
  const entries = [
    event(dateOffset(0), 'Meeting', 'meeting'),
    event(dateOffset(0), 'Deadline', 'deadline'),
    event(dateOffset(0), 'Task <Titel>', 'task'),
    event(dateOffset(0), 'Commit', 'other', 'github-commit'),
    event(dateOffset(0), 'Unbekannt', 'unknown')
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
  const project = {id:'p1', executionPlanDraft:{milestoneDraft:{items:[{date:dateOffset(0), title:'Meilenstein'}]}}};
  const html = api.renderProjectTimelineWeekCalendar(api.buildProjectTimelinePreview(project, 3));
  assert.match(html, /border-left:3px solid var\(--accent-green\)/);
});

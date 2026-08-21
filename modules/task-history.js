/* ========================================
   Aufgabenhistorie
   Verlauf, Filter und Reaktivierung
   ======================================== */
(function () {
  'use strict';

  var state = {
    range: '30',
    dateFrom: '',
    dateTo: '',
    labelId: '',
    status: ''
  };
  var isWired = false;

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(value === null || value === undefined ? '' : value)));
    return div.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function formatDateTime(value) {
    if (!value) return 'Nicht erfasst';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'Nicht erfasst';
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function toLocalDateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function getStatusLabel(status) {
    var labels = {
      backlog: 'Backlog',
      todo: 'Zu erledigen',
      'in-progress': 'In Arbeit',
      review: 'Review',
      done: 'Erledigt'
    };
    return labels[status] || status || 'Unbekannt';
  }

  function getEventLabel(type) {
    var labels = {
      created: 'Aufgabe erstellt',
      updated: 'Aufgabe bearbeitet',
      completed: 'Aufgabe fertiggestellt',
      started: 'Bearbeitung begonnen',
      'status-change': 'Status geaendert',
      progress: 'Fortschritt aktualisiert',
      reassigned: 'Bearbeiter geaendert'
    };
    return labels[type] || 'Aufgabe bearbeitet';
  }

  function indexById(items) {
    var result = {};
    (items || []).forEach(function (item) {
      if (item && item.id !== null && item.id !== undefined) result[String(item.id)] = item;
    });
    return result;
  }

  function getName(map, id, fallback) {
    var item = map[String(id || '')];
    return item && item.name ? item.name : fallback;
  }

  function getTaskEvents(task) {
    var events = Array.isArray(task.history) ? task.history.slice() : [];
    if (!events.length) {
      events.push({
        type: 'created',
        at: task.createdAt || task.updatedAt || '',
        status: task.status || 'todo',
        progress: Number(task.progress) || 0,
        assigneeId: task.assigneeId || '',
        actorId: ''
      });
    }
    return events.sort(function (left, right) {
      return String(right.at || '').localeCompare(String(left.at || ''));
    });
  }

  function isEventInRange(event) {
    var timestamp = new Date(event.at || '').getTime();
    if (isNaN(timestamp)) return !state.dateFrom && !state.dateTo;
    if (state.dateFrom && timestamp < new Date(state.dateFrom + 'T00:00:00').getTime()) return false;
    if (state.dateTo && timestamp > new Date(state.dateTo + 'T23:59:59.999').getTime()) return false;
    return true;
  }

  function taskHasLabel(task, labelId, labelsById) {
    if (!labelId) return true;
    return (task.labels || []).some(function (value) {
      if (String(value) === String(labelId)) return true;
      var label = labelsById[String(labelId)];
      return !!(label && String(value).toLowerCase() === String(label.name || '').toLowerCase());
    });
  }

  function setRange(range) {
    state.range = range;
    if (range === 'custom') return;
    if (range === 'all') {
      state.dateFrom = '';
      state.dateTo = '';
      return;
    }
    var end = new Date();
    var start = new Date();
    start.setDate(start.getDate() - Math.max(0, Number(range) - 1));
    state.dateFrom = toLocalDateKey(start);
    state.dateTo = toLocalDateKey(end);
  }

  function renderMetric(value, label) {
    return '<article class="task-history-metric"><strong class="task-history-metric-value">' +
      escapeHtml(value) + '</strong><span class="task-history-metric-label">' + escapeHtml(label) + '</span></article>';
  }

  function renderLabelOptions(labels) {
    return '<option value="">Alle Labels</option>' + labels.map(function (label) {
      return '<option value="' + escapeAttr(label.id) + '"' + (String(state.labelId) === String(label.id) ? ' selected' : '') + '>' +
        escapeHtml(label.name || 'Unbenannt') + '</option>';
    }).join('');
  }

  function renderFilters(labels, resultCount) {
    return '<div class="task-history-filters">' +
      '<div class="task-history-filter"><label for="task-history-range">Zeitraum</label><select id="task-history-range">' +
        '<option value="7"' + (state.range === '7' ? ' selected' : '') + '>Letzte 7 Tage</option>' +
        '<option value="30"' + (state.range === '30' ? ' selected' : '') + '>Letzte 30 Tage</option>' +
        '<option value="90"' + (state.range === '90' ? ' selected' : '') + '>Letzte 90 Tage</option>' +
        '<option value="all"' + (state.range === 'all' ? ' selected' : '') + '>Gesamter Zeitraum</option>' +
        '<option value="custom"' + (state.range === 'custom' ? ' selected' : '') + '>Benutzerdefiniert</option>' +
      '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-from">Von</label><input id="task-history-from" type="date" value="' + escapeAttr(state.dateFrom) + '"></div>' +
      '<div class="task-history-filter"><label for="task-history-to">Bis</label><input id="task-history-to" type="date" value="' + escapeAttr(state.dateTo) + '"></div>' +
      '<div class="task-history-filter"><label for="task-history-label">Label</label><select id="task-history-label">' + renderLabelOptions(labels) + '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-status">Aktueller Status</label><select id="task-history-status">' +
        '<option value="">Alle Status</option>' +
        '<option value="open"' + (state.status === 'open' ? ' selected' : '') + '>Noch zu erledigen</option>' +
        '<option value="in-progress"' + (state.status === 'in-progress' ? ' selected' : '') + '>In Arbeit</option>' +
        '<option value="done"' + (state.status === 'done' ? ' selected' : '') + '>Erledigt</option>' +
      '</select><span class="task-history-result-count">' + resultCount + ' Aufgaben gefunden</span></div>' +
    '</div>';
  }

  function renderTaskLabels(task, labelsById) {
    return (task.labels || []).map(function (value) {
      var label = labelsById[String(value)];
      var name = label && label.name ? label.name : value;
      var color = label && /^#[0-9a-f]{6}$/i.test(label.color || '') ? label.color : '#5ea2ff';
      return '<span class="task-history-label" style="--task-label-color:' + color + '">' + escapeHtml(name) + '</span>';
    }).join('');
  }

  function renderEvent(event, employeesById) {
    var assignee = getName(employeesById, event.assigneeId, 'Nicht zugewiesen');
    var actor = getName(employeesById, event.actorId, event.actorId ? 'Unbekannter Benutzer' : assignee);
    return '<div class="task-history-event">' +
      '<div><strong>' + escapeHtml(getEventLabel(event.type)) + '</strong><span>' + escapeHtml(formatDateTime(event.at)) + '</span></div>' +
      '<div><strong>' + escapeHtml(actor) + '</strong><span>Bearbeitet durch</span></div>' +
      '<div><strong>' + escapeHtml(getStatusLabel(event.status)) + ' · ' + (Number(event.progress) || 0) + '%</strong><span>Zugewiesen an ' + escapeHtml(assignee) + '</span></div>' +
    '</div>';
  }

  function renderTaskCard(entry, context) {
    var task = entry.task;
    var completion = getTaskEvents(task).find(function (event) { return event.type === 'completed' || event.status === 'done'; });
    var completedBy = completion
      ? getName(context.employeesById, completion.actorId, getName(context.employeesById, completion.assigneeId, 'Nicht erfasst'))
      : 'Noch offen';
    var projectName = getName(context.projectsById, task.projectId, 'Allgemeine Aufgabe');
    var assignee = getName(context.employeesById, task.assigneeId, 'Nicht zugewiesen');
    var isDone = task.status === 'done';

    return '<details class="task-history-card">' +
      '<summary>' +
        '<div class="task-history-title"><strong>' + escapeHtml(task.title || 'Unbenannte Aufgabe') + '</strong><small>' + escapeHtml(projectName) + '</small>' +
          '<div class="task-history-labels">' + renderTaskLabels(task, context.labelsById) + '</div></div>' +
        '<div class="task-history-fact"><strong>' + escapeHtml(assignee) + '</strong><span>Aktuell zugewiesen</span></div>' +
        '<div class="task-history-fact"><strong>' + escapeHtml(completion ? formatDateTime(completion.at) : 'Noch offen') + '</strong><span>Fertiggestellt · ' + escapeHtml(completedBy) + '</span></div>' +
        '<div><span class="task-history-status' + (isDone ? ' is-done' : '') + '">' + escapeHtml(getStatusLabel(task.status)) + '</span></div>' +
        '<div class="task-history-actions">' + (isDone ? '<button type="button" class="btn btn-secondary task-history-reactivate" data-task-id="' + escapeAttr(task.id) + '"><span class="material-symbols-rounded" aria-hidden="true">replay</span><span>Wieder oeffnen</span></button>' : '') + '</div>' +
      '</summary>' +
      '<div class="task-history-timeline">' + entry.events.map(function (event) { return renderEvent(event, context.employeesById); }).join('') + '</div>' +
    '</details>';
  }

  function matchesStatus(task) {
    if (!state.status) return true;
    if (state.status === 'open') return task.status !== 'done' && task.status !== 'in-progress';
    return task.status === state.status;
  }

  function render() {
    var root = document.getElementById('task-history-root');
    if (!root || !window.DataLayer) return;

    if (state.range !== 'custom' && !state.dateFrom && !state.dateTo) setRange(state.range);

    var tasks = window.DataLayer.getTasks ? window.DataLayer.getTasks().slice() : [];
    var employees = window.DataLayer.getEmployees ? window.DataLayer.getEmployees() : [];
    var projects = window.DataLayer.getProjects ? window.DataLayer.getProjects() : [];
    var labels = window.DataLayer.getLabels ? window.DataLayer.getLabels().slice() : [];
    var context = {
      employeesById: indexById(employees),
      projectsById: indexById(projects),
      labelsById: indexById(labels)
    };

    var entries = tasks.filter(function (task) {
      return matchesStatus(task) && taskHasLabel(task, state.labelId, context.labelsById);
    }).map(function (task) {
      return { task: task, events: getTaskEvents(task).filter(isEventInRange) };
    }).filter(function (entry) {
      return entry.events.length > 0;
    }).sort(function (left, right) {
      return String(right.events[0].at || '').localeCompare(String(left.events[0].at || ''));
    });

    var doneCount = tasks.filter(function (task) { return task.status === 'done'; }).length;
    var activeCount = tasks.filter(function (task) { return task.status === 'in-progress'; }).length;
    var eventCount = entries.reduce(function (sum, entry) { return sum + entry.events.length; }, 0);

    root.innerHTML = '<div class="task-history-summary">' +
      renderMetric(tasks.length, 'Aufgaben gesamt') +
      renderMetric(doneCount, 'Erledigt') +
      renderMetric(activeCount, 'In Bearbeitung') +
      renderMetric(eventCount, 'Ereignisse im Zeitraum') +
    '</div>' + renderFilters(labels, entries.length) +
    (entries.length
      ? '<div class="task-history-list">' + entries.map(function (entry) { return renderTaskCard(entry, context); }).join('') + '</div>'
      : '<div class="task-history-empty"><strong>Keine Aufgaben gefunden</strong><p>Fuer die gewaehlten Filter gibt es keine Verlaufsereignisse.</p></div>');

    wireControls(root);
  }

  function wireControls(root) {
    var range = document.getElementById('task-history-range');
    var from = document.getElementById('task-history-from');
    var to = document.getElementById('task-history-to');
    var label = document.getElementById('task-history-label');
    var status = document.getElementById('task-history-status');

    if (range) range.addEventListener('change', function () { setRange(this.value); render(); });
    if (from) from.addEventListener('change', function () { state.range = 'custom'; state.dateFrom = this.value; render(); });
    if (to) to.addEventListener('change', function () { state.range = 'custom'; state.dateTo = this.value; render(); });
    if (label) label.addEventListener('change', function () { state.labelId = this.value; render(); });
    if (status) status.addEventListener('change', function () { state.status = this.value; render(); });

    root.querySelectorAll('.task-history-reactivate').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        reactivateTask(this.getAttribute('data-task-id'));
      });
    });
  }

  function reactivateTask(taskId) {
    if (!window.DataLayer || !window.DataLayer.getTaskById || !window.DataLayer.updateTask) return;
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || task.status !== 'done') return;
    if (!window.confirm('Aufgabe wieder zu den noch zu erledigenden Aufgaben hinzufuegen?')) return;

    var next = JSON.parse(JSON.stringify(task));
    next.status = 'todo';
    next.progress = 0;
    window.DataLayer.updateTask(next);
    render();
  }

  function init() {
    if (isWired) return;
    isWired = true;
    setRange(state.range);
    render();
  }

  window.TaskHistoryModule = {
    init: init,
    render: render,
    reactivateTask: reactivateTask
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
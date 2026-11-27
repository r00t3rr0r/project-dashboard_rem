/* ========================================
   Aufgaben – Historie, Review & Nachverfolgung
   Vollständige Aufgabeninformationen, Verlauf,
   Review-Freigabe und Wiedereröffnung
   ======================================== */
(function () {
  'use strict';

  var state = {
    view: 'all',            // all | review | done
    range: '30',
    dateFrom: '',
    dateTo: '',
    labelId: '',
    status: '',
    projectId: '',
    assigneeId: '',
    search: '',
    expanded: {},
    pendingAction: null     // { taskId, type: 'approve' | 'return' | 'reopen' }
  };
  var isWired = false;

  /* ---------- Helpers ---------- */

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

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatDuration(fromValue, toValue) {
    var from = new Date(fromValue || '').getTime();
    var to = new Date(toValue || '').getTime();
    if (isNaN(from) || isNaN(to) || to < from) return '';
    var minutes = Math.round((to - from) / 60000);
    if (minutes < 1) return 'unter 1 Min.';
    var days = Math.floor(minutes / 1440);
    var hours = Math.floor((minutes % 1440) / 60);
    var mins = minutes % 60;
    var parts = [];
    if (days) parts.push(days + ' Tag' + (days === 1 ? '' : 'e'));
    if (hours) parts.push(hours + ' Std.');
    if (!days && mins) parts.push(mins + ' Min.');
    return parts.join(' ') || 'unter 1 Min.';
  }

  function formatMinutes(totalMinutes) {
    var minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
    var hours = Math.floor(minutes / 60);
    var mins = minutes % 60;
    if (!hours) return mins + ' Min.';
    return hours + ' Std. ' + (mins ? mins + ' Min.' : '').trim();
  }

  function toLocalDateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  var STATUS_META = {
    backlog: { label: 'Backlog', css: 'is-backlog' },
    todo: { label: 'Zu erledigen', css: 'is-todo' },
    'in-progress': { label: 'In Arbeit', css: 'is-progress' },
    review: { label: 'In Review', css: 'is-review' },
    done: { label: 'Erledigt', css: 'is-done' }
  };

  function getStatusLabel(status) {
    var meta = STATUS_META[status];
    return meta ? meta.label : (status || 'Unbekannt');
  }

  function getStatusCss(status) {
    var meta = STATUS_META[status];
    return meta ? meta.css : '';
  }

  function getPriorityLabel(priority) {
    var labels = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
    return labels[priority] || priority || 'Mittel';
  }

  function getUrgencyLabel(urgency) {
    var labels = { low: 'Gering', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' };
    return labels[urgency] || urgency || 'Normal';
  }

  function getEventLabel(event) {
    if (event.type === 'status-change' && event.status === 'review') return 'Zur Prüfung eingereicht';
    var labels = {
      created: 'Aufgabe erstellt',
      updated: 'Aufgabe bearbeitet',
      completed: 'Aufgabe fertiggestellt',
      started: 'Bearbeitung begonnen',
      'status-change': 'Status geändert',
      progress: 'Fortschritt aktualisiert',
      reassigned: 'Bearbeiter geändert'
    };
    return labels[event.type] || 'Aufgabe bearbeitet';
  }

  function getEventIcon(event) {
    if (event.type === 'status-change' && event.status === 'review') return 'rate_review';
    var icons = {
      created: 'add_circle',
      updated: 'edit',
      completed: 'task_alt',
      started: 'play_circle',
      'status-change': 'swap_horiz',
      progress: 'trending_up',
      reassigned: 'person'
    };
    return icons[event.type] || 'edit';
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

  function getAssigneeNames(task, employeesById) {
    var ids = Array.isArray(task.assigneeIds) && task.assigneeIds.length
      ? task.assigneeIds
      : (task.assigneeId ? [task.assigneeId] : []);
    var names = ids.map(function (id) { return getName(employeesById, id, 'Unbekannt'); });
    return names.length ? names.join(', ') : 'Nicht zugewiesen';
  }

  /* ---------- Events / Verlauf ---------- */

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

  function findCompletionEvent(events) {
    // events absteigend sortiert -> erstes Vorkommen = letzter Abschluss
    return events.find(function (event) { return event.type === 'completed' || event.status === 'done'; }) || null;
  }

  function findFirstStartEvent(events) {
    var started = null;
    events.forEach(function (event) {
      if (event.type === 'started') started = event; // absteigend: letzter Treffer = erster Start
    });
    return started;
  }

  function findReviewEvent(events) {
    return events.find(function (event) { return event.status === 'review'; }) || null;
  }

  /* ---------- Filter ---------- */

  function taskHasLabel(task, labelId, labelsById) {
    if (!labelId) return true;
    return (task.labels || []).some(function (value) {
      if (String(value) === String(labelId)) return true;
      var label = labelsById[String(labelId)];
      return !!(label && String(value).toLowerCase() === String(label.name || '').toLowerCase());
    });
  }

  function matchesView(task) {
    if (state.view === 'review') return task.status === 'review';
    if (state.view === 'done') return task.status === 'done';
    return true;
  }

  function matchesStatus(task) {
    if (state.view !== 'all' || !state.status) return true;
    if (state.status === 'open') return task.status !== 'done';
    return task.status === state.status;
  }

  function matchesProject(task) {
    if (!state.projectId) return true;
    if (state.projectId === 'none') return !(Array.isArray(task.projectIds) ? task.projectIds.length : task.projectId);
    return window.DataLayer.isTaskLinkedToProject(task, state.projectId);
  }

  function matchesAssignee(task) {
    if (!state.assigneeId) return true;
    var ids = (Array.isArray(task.assigneeIds) ? task.assigneeIds : [])
      .concat(task.assigneeId ? [task.assigneeId] : []);
    return ids.some(function (id) { return String(id) === String(state.assigneeId); });
  }

  function matchesSearch(task, context) {
    var query = state.search.trim().toLowerCase();
    if (!query) return true;
    var haystack = [
      task.title || '',
      task.description || '',
      (Array.isArray(task.projectIds) ? task.projectIds : (task.projectId ? [task.projectId] : [])).map(function (id) { return getName(context.projectsById, id, ''); }).filter(Boolean).join(', '),
      getAssigneeNames(task, context.employeesById)
    ];
    (task.labels || []).forEach(function (value) {
      var label = context.labelsById[String(value)];
      haystack.push(label && label.name ? label.name : String(value));
    });
    return haystack.join(' ').toLowerCase().indexOf(query) !== -1;
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

  /* ---------- Rendering: Kopfbereich ---------- */

  function renderMetric(value, label, action, active, css) {
    return '<article class="task-history-metric' + (action ? ' is-clickable' : '') + (active ? ' is-active' : '') + (css ? ' ' + css : '') + '"' +
      (action ? ' data-metric-action="' + escapeAttr(action) + '" role="button" tabindex="0"' : '') + '>' +
      '<strong class="task-history-metric-value">' + escapeHtml(value) + '</strong>' +
      '<span class="task-history-metric-label">' + escapeHtml(label) + '</span></article>';
  }

  function renderViewTabs(counts) {
    function tab(view, icon, label, count) {
      return '<button type="button" class="btn kanban-view-btn task-history-tab' + (state.view === view ? ' is-active' : '') + '" aria-pressed="' + (state.view === view) + '" data-view="' + view + '">' +
        '<span class="material-symbols-rounded" aria-hidden="true">' + icon + '</span>' +
        '<span>' + escapeHtml(label) + '</span>' +
        '<span class="task-history-tab-count">' + count + '</span></button>';
    }
    return '<div class="kanban-view-switch task-history-tabs" role="group" aria-label="Aufgabenansicht">' +
      tab('all', 'list_alt', 'Alle Aufgaben', counts.all) +
      tab('review', 'rate_review', 'Zu prüfen (Review)', counts.review) +
      tab('done', 'task_alt', 'Erledigt', counts.done) +
    '</div>';
  }

  function renderSelectOptions(items, selectedId, emptyLabel, extra) {
    var html = '<option value="">' + escapeHtml(emptyLabel) + '</option>';
    (extra || []).forEach(function (option) {
      html += '<option value="' + escapeAttr(option.value) + '"' + (String(selectedId) === String(option.value) ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>';
    });
    (items || []).forEach(function (item) {
      html += '<option value="' + escapeAttr(item.id) + '"' + (String(selectedId) === String(item.id) ? ' selected' : '') + '>' +
        escapeHtml(item.name || item.title || 'Unbenannt') + '</option>';
    });
    return html;
  }

  function renderFilters(context, resultCount) {
    var statusDisabled = state.view !== 'all';
    return '<div class="task-history-filters">' +
      '<div class="task-history-filter"><label for="task-history-search">Suche</label><input id="task-history-search" type="search" placeholder="Titel, Projekt, Person, Label…" value="' + escapeAttr(state.search) + '"></div>' +
      '<div class="task-history-filter"><label for="task-history-range">Zeitraum</label><select id="task-history-range">' +
        '<option value="7"' + (state.range === '7' ? ' selected' : '') + '>Letzte 7 Tage</option>' +
        '<option value="30"' + (state.range === '30' ? ' selected' : '') + '>Letzte 30 Tage</option>' +
        '<option value="90"' + (state.range === '90' ? ' selected' : '') + '>Letzte 90 Tage</option>' +
        '<option value="all"' + (state.range === 'all' ? ' selected' : '') + '>Gesamter Zeitraum</option>' +
        '<option value="custom"' + (state.range === 'custom' ? ' selected' : '') + '>Benutzerdefiniert</option>' +
      '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-from">Von</label><input id="task-history-from" type="date" value="' + escapeAttr(state.dateFrom) + '"></div>' +
      '<div class="task-history-filter"><label for="task-history-to">Bis</label><input id="task-history-to" type="date" value="' + escapeAttr(state.dateTo) + '"></div>' +
      '<div class="task-history-filter"><label for="task-history-project">Projekt</label><select id="task-history-project">' +
        renderSelectOptions(context.projects, state.projectId, 'Alle Projekte', [{ value: 'none', label: 'Ohne Projekt' }]) + '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-assignee">Mitarbeiter</label><select id="task-history-assignee">' +
        renderSelectOptions(context.employees, state.assigneeId, 'Alle Mitarbeiter') + '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-label">Label</label><select id="task-history-label">' +
        renderSelectOptions(context.labels, state.labelId, 'Alle Labels') + '</select></div>' +
      '<div class="task-history-filter"><label for="task-history-status">Status</label><select id="task-history-status"' + (statusDisabled ? ' disabled title="Im gewählten Tab ist der Status vorgegeben"' : '') + '>' +
        '<option value="">Alle Status</option>' +
        '<option value="open"' + (state.status === 'open' ? ' selected' : '') + '>Offen (nicht erledigt)</option>' +
        '<option value="backlog"' + (state.status === 'backlog' ? ' selected' : '') + '>Backlog</option>' +
        '<option value="todo"' + (state.status === 'todo' ? ' selected' : '') + '>Zu erledigen</option>' +
        '<option value="in-progress"' + (state.status === 'in-progress' ? ' selected' : '') + '>In Arbeit</option>' +
        '<option value="review"' + (state.status === 'review' ? ' selected' : '') + '>In Review</option>' +
        '<option value="done"' + (state.status === 'done' ? ' selected' : '') + '>Erledigt</option>' +
      '</select></div>' +
      '<div class="task-history-filter task-history-filter--meta"><span class="task-history-result-count">' + resultCount + ' Aufgabe' + (resultCount === 1 ? '' : 'n') + ' gefunden</span>' +
      '<button type="button" class="btn btn-secondary task-history-reset" id="task-history-reset"><span class="material-symbols-rounded" aria-hidden="true">filter_alt_off</span><span>Filter zurücksetzen</span></button></div>' +
    '</div>';
  }

  /* ---------- Rendering: Aufgabenkarte ---------- */

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
    var statusCss = getStatusCss(event.status);
    return '<div class="task-history-event' + (event.status === 'review' ? ' is-review-event' : '') + (event.type === 'completed' ? ' is-done-event' : '') + '">' +
      '<div class="task-history-event-what"><strong><span class="material-symbols-rounded" aria-hidden="true">' + getEventIcon(event) + '</span>' + escapeHtml(getEventLabel(event)) + '</strong><span>' + escapeHtml(formatDateTime(event.at)) + '</span></div>' +
      '<div><strong>' + escapeHtml(actor) + '</strong><span>Bearbeitet durch</span></div>' +
      '<div><strong><span class="task-history-status task-history-status--inline ' + statusCss + '">' + escapeHtml(getStatusLabel(event.status)) + '</span> · ' + (Number(event.progress) || 0) + '%</strong><span>Zugewiesen an ' + escapeHtml(assignee) + '</span></div>' +
    '</div>';
  }

  function renderDetailField(label, valueHtml) {
    return '<div class="task-history-detail-field"><span>' + escapeHtml(label) + '</span><strong>' + valueHtml + '</strong></div>';
  }

  function renderScheduleValue(task) {
    var schedule = task.schedule || {};
    if (schedule.deadline) return 'Deadline: ' + escapeHtml(formatDateTime(schedule.deadline));
    if (schedule.fixedAt) return 'Fester Termin: ' + escapeHtml(formatDateTime(schedule.fixedAt));
    if (schedule.rangeStart || schedule.rangeEnd) {
      return 'Zeitraum: ' + escapeHtml(formatDate(schedule.rangeStart) || 'offen') + ' – ' + escapeHtml(formatDate(schedule.rangeEnd) || 'offen');
    }
    if (schedule.mode === 'asap') return 'So bald wie möglich';
    return '<span class="task-history-muted">Kein Termin hinterlegt</span>';
  }

  function renderDetailList(items, emptyLabel) {
    if (!items.length) return '<p class="task-history-muted">' + escapeHtml(emptyLabel) + '</p>';
    return '<ul class="task-history-detail-list">' + items.join('') + '</ul>';
  }

  function renderTaskDetails(task, context) {
    var description = String(task.description || '').trim();
    var progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    var tracking = task.timeTracking || {};
    var subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    var completedSubtasks = subtasks.filter(function (item) { return item.completed; }).length;

    var subtaskItems = subtasks.map(function (item) {
      return '<li class="' + (item.completed ? 'is-complete' : '') + '"><span class="material-symbols-rounded" aria-hidden="true">' +
        (item.completed ? 'check_circle' : 'radio_button_unchecked') + '</span><span>' + escapeHtml(item.title || 'Teilaufgabe') +
        (item.assigneeId ? ' · ' + escapeHtml(getName(context.employeesById, item.assigneeId, 'Unbekannter Mitarbeiter')) : '') + '</span></li>';
    });

    var noteItems = (Array.isArray(task.notes) ? task.notes : []).map(function (note) {
      return '<li><span class="material-symbols-rounded" aria-hidden="true">sticky_note_2</span><span>' + escapeHtml(note.text || '') +
        (note.createdAt ? '<small>' + escapeHtml(formatDateTime(note.createdAt)) + '</small>' : '') + '</span></li>';
    });

    var attachmentItems = (Array.isArray(task.attachments) ? task.attachments : []).map(function (attachment) {
      var href = attachment.dataUrl || attachment.url || '';
      var name = attachment.name || attachment.url || 'Anhang';
      var link = href
        ? '<a href="' + escapeAttr(href) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>'
        : escapeHtml(name);
      return '<li><span class="material-symbols-rounded" aria-hidden="true">attach_file</span><span>' + link + '</span></li>';
    });

    var dependencyItems = (Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds : []).map(function (id) {
      var dependency = window.DataLayer.getTaskById ? window.DataLayer.getTaskById(id) : null;
      return '<li><span class="material-symbols-rounded" aria-hidden="true">account_tree</span><span>' +
        escapeHtml(dependency && dependency.title ? dependency.title : id) +
        (dependency ? '<small>' + escapeHtml(getStatusLabel(dependency.status)) + '</small>' : '') + '</span></li>';
    });

    var blockerItems = (Array.isArray(task.blockerHistory) ? task.blockerHistory : []).map(function (entry) {
      var period = formatDateTime(entry.from) + ' bis ' + (entry.until ? formatDateTime(entry.until) : 'offen');
      var reason = entry.reason || 'Kein Grund hinterlegt';
      if (entry.resolution) reason += ' · Auflösung: ' + entry.resolution;
      return '<li><span class="material-symbols-rounded" aria-hidden="true">block</span><span>' + escapeHtml(period) + '<small>' + escapeHtml(reason) + '</small></span></li>';
    });

    return '<div class="task-history-details">' +
      '<section class="task-history-detail-section task-history-detail-section--wide"><h4>Beschreibung</h4>' +
        '<div class="task-history-description">' + (description ? escapeHtml(description).replace(/\n/g, '<br>') : '<span class="task-history-muted">Keine Beschreibung hinterlegt.</span>') + '</div></section>' +
      '<section class="task-history-detail-section task-history-detail-section--wide"><h4>Eckdaten</h4><div class="task-history-detail-grid">' +
        renderDetailField('Priorität', escapeHtml(getPriorityLabel(task.priority))) +
        renderDetailField('Dringlichkeit', escapeHtml(getUrgencyLabel(task.urgency))) +
        renderDetailField('Termin', renderScheduleValue(task)) +
        renderDetailField('Geplanter Aufwand', task.effortHours ? escapeHtml(task.effortHours + ' Std.') : '<span class="task-history-muted">Nicht erfasst</span>') +
        renderDetailField('Zeit erfasst', escapeHtml(formatMinutes(tracking.totalMinutes))) +
        renderDetailField('Erstellt', escapeHtml(formatDateTime(task.createdAt))) +
        renderDetailField('Zuletzt geändert', escapeHtml(formatDateTime(task.updatedAt))) +
        renderDetailField('Fortschritt', '<span class="task-history-progress"><i style="width:' + progress + '%"></i></span>' + progress + '%') +
      '</div></section>' +
      '<section class="task-history-detail-section"><h4>Teilaufgaben <span class="task-history-detail-count">' + completedSubtasks + '/' + subtasks.length + '</span></h4>' +
        renderDetailList(subtaskItems, 'Keine Teilaufgaben vorhanden.') + '</section>' +
      '<section class="task-history-detail-section"><h4>Notizen</h4>' + renderDetailList(noteItems, 'Keine Notizen vorhanden.') + '</section>' +
      '<section class="task-history-detail-section"><h4>Dateien / Links</h4>' + renderDetailList(attachmentItems, 'Keine Anhänge vorhanden.') + '</section>' +
      '<section class="task-history-detail-section"><h4>Abhängigkeiten</h4>' + renderDetailList(dependencyItems, 'Keine Abhängigkeiten hinterlegt.') + '</section>' +
      (blockerItems.length ? '<section class="task-history-detail-section"><h4>Blocker-Historie</h4>' + renderDetailList(blockerItems, '') + '</section>' : '') +
    '</div>';
  }

  var ACTION_META = {
    approve: {
      title: 'Prüfung abschließen und Aufgabe freigeben?',
      hint: 'Die Aufgabe wird als erledigt markiert (Fortschritt 100 %).',
      placeholder: 'Optionaler Prüfkommentar (wird als Notiz gespeichert)…',
      confirmLabel: 'Freigeben & abschließen',
      confirmIcon: 'check_circle'
    },
    'return': {
      title: 'Aufgabe zur Nacharbeit zurückgeben',
      hint: 'Die Aufgabe wandert zurück in die Spalte "In Arbeit".',
      placeholder: 'Was muss nachgearbeitet werden? (Rückmeldung an die Bearbeiter)…',
      confirmLabel: 'Zur Nacharbeit zurückgeben',
      confirmIcon: 'undo'
    },
    reopen: {
      title: 'Erledigte Aufgabe wieder öffnen?',
      hint: 'Die Aufgabe wird wieder zu den zu erledigenden Aufgaben hinzugefügt.',
      placeholder: 'Optionaler Grund für die Wiedereröffnung (wird als Notiz gespeichert)…',
      confirmLabel: 'Wieder öffnen',
      confirmIcon: 'replay'
    }
  };

  function renderActionPanel(task) {
    var pending = state.pendingAction;
    if (!pending || String(pending.taskId) !== String(task.id)) return '';
    var meta = ACTION_META[pending.type];
    if (!meta) return '';
    return '<div class="task-history-action-panel">' +
      '<strong>' + escapeHtml(meta.title) + '</strong>' +
      '<span>' + escapeHtml(meta.hint) + '</span>' +
      '<textarea class="task-history-action-comment" rows="2" placeholder="' + escapeAttr(meta.placeholder) + '"></textarea>' +
      '<div class="task-history-action-panel-buttons">' +
        '<button type="button" class="btn btn-primary task-history-action-confirm" data-task-id="' + escapeAttr(task.id) + '"><span class="material-symbols-rounded" aria-hidden="true">' + meta.confirmIcon + '</span><span>' + escapeHtml(meta.confirmLabel) + '</span></button>' +
        '<button type="button" class="btn btn-secondary task-history-action-cancel"><span>Abbrechen</span></button>' +
      '</div></div>';
  }

  function renderReviewBanner(task, context, events) {
    if (task.status !== 'review') return '';
    var reviewEvent = findReviewEvent(events);
    var submitter = reviewEvent ? getName(context.employeesById, reviewEvent.actorId || reviewEvent.assigneeId, 'Unbekannt') : 'Unbekannt';
    var since = reviewEvent ? formatDateTime(reviewEvent.at) : 'Nicht erfasst';
    return '<div class="task-history-review-banner">' +
      '<div class="task-history-review-banner-info"><span class="material-symbols-rounded" aria-hidden="true">rate_review</span>' +
        '<div><strong>Diese Aufgabe wartet auf Prüfung</strong><span>Eingereicht von ' + escapeHtml(submitter) + ' · ' + escapeHtml(since) + '</span></div></div>' +
      '<div class="task-history-review-banner-actions">' +
        '<button type="button" class="btn btn-primary task-history-approve" data-task-id="' + escapeAttr(task.id) + '"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span><span>Freigeben &amp; abschließen</span></button>' +
        '<button type="button" class="btn btn-secondary task-history-return" data-task-id="' + escapeAttr(task.id) + '"><span class="material-symbols-rounded" aria-hidden="true">undo</span><span>Zur Nacharbeit</span></button>' +
      '</div></div>';
  }

  function renderSummaryActions(task) {
    var buttons = [];
    if (task.status === 'review') {
      buttons.push('<button type="button" class="btn btn-primary task-history-approve" data-task-id="' + escapeAttr(task.id) + '" title="Prüfung bestanden – Aufgabe abschließen"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span><span>Freigeben</span></button>');
      buttons.push('<button type="button" class="btn btn-secondary task-history-return" data-task-id="' + escapeAttr(task.id) + '" title="Mit Kommentar zur Nacharbeit zurückgeben"><span class="material-symbols-rounded" aria-hidden="true">undo</span><span>Nacharbeit</span></button>');
    }
    if (task.status === 'done') {
      buttons.push('<button type="button" class="btn btn-secondary task-history-reactivate" data-task-id="' + escapeAttr(task.id) + '" title="Aufgabe wieder öffnen"><span class="material-symbols-rounded" aria-hidden="true">replay</span><span>Wieder öffnen</span></button>');
    }
    buttons.push('<button type="button" class="task-history-icon-btn task-history-open-kanban" data-task-id="' + escapeAttr(task.id) + '" data-project-id="' + escapeAttr(state.projectId && state.projectId !== 'none' ? state.projectId : (task.projectId || '')) + '" title="Im Kanban-Board öffnen und bearbeiten"><span class="material-symbols-rounded" aria-hidden="true">view_kanban</span></button>');
    return buttons.join('');
  }

  function renderTaskCard(entry, context) {
    var task = entry.task;
    var events = entry.allEvents;
    var completion = task.status === 'done' ? findCompletionEvent(events) : null;
    var firstStart = findFirstStartEvent(events);
    var completedBy = completion
      ? getName(context.employeesById, completion.actorId, getName(context.employeesById, completion.assigneeId, 'Nicht erfasst'))
      : '';
    var projectIds = Array.isArray(task.projectIds) ? task.projectIds : (task.projectId ? [task.projectId] : []);
    var projectName = projectIds.length ? projectIds.map(function (id) { return getName(context.projectsById, id, ''); }).filter(Boolean).join(', ') : 'Allgemeine Aufgabe';
    var assignees = getAssigneeNames(task, context.employeesById);
    var progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    var isExpanded = !!state.expanded[String(task.id)];

    var workStart = firstStart ? firstStart.at : task.createdAt;
    var periodValue;
    var periodHint;
    if (completion) {
      periodValue = formatDate(workStart) + ' – ' + formatDate(completion.at);
      var duration = formatDuration(workStart, completion.at);
      periodHint = 'Bearbeitungsdauer' + (duration ? ' · ' + duration : '');
    } else {
      periodValue = firstStart ? 'Seit ' + formatDate(firstStart.at) : 'Noch nicht begonnen';
      periodHint = 'Bearbeitungszeitraum';
    }

    return '<details class="task-history-card' + (task.status === 'review' ? ' is-review-card' : '') + '" data-task-id="' + escapeAttr(task.id) + '"' + (isExpanded ? ' open' : '') + '>' +
      '<summary>' +
        '<div class="task-history-title"><strong>' + escapeHtml(task.title || 'Unbenannte Aufgabe') + '</strong><small>' + escapeHtml(projectName) + '</small>' +
          '<div class="task-history-labels">' + renderTaskLabels(task, context.labelsById) + '</div></div>' +
        '<div class="task-history-fact"><strong>' + escapeHtml(assignees) + '</strong><span>Zugewiesen</span></div>' +
        '<div class="task-history-fact"><strong>' + (completion ? escapeHtml(formatDateTime(completion.at)) : 'Noch offen') + '</strong><span>' + (completion ? 'Fertiggestellt von ' + escapeHtml(completedBy) : 'Fertigstellung') + '</span></div>' +
        '<div class="task-history-fact"><strong>' + escapeHtml(periodValue) + '</strong><span>' + escapeHtml(periodHint) + '</span></div>' +
        '<div class="task-history-state"><span class="task-history-status ' + getStatusCss(task.status) + '">' + escapeHtml(getStatusLabel(task.status)) + '</span>' +
          '<span class="task-history-progress task-history-progress--summary" title="Fortschritt: ' + progress + '%"><i style="width:' + progress + '%"></i></span></div>' +
        '<div class="task-history-actions">' + renderSummaryActions(task) + '</div>' +
        '<span class="task-history-chevron" aria-hidden="true"></span>' +
      '</summary>' +
      '<div class="task-history-body">' +
        renderActionPanel(task) +
        renderReviewBanner(task, context, events) +
        renderTaskDetails(task, context) +
        '<section class="task-history-detail-section task-history-detail-section--wide"><h4>Verlauf <span class="task-history-detail-count">' + events.length + ' Ereignis' + (events.length === 1 ? '' : 'se') + '</span></h4>' +
          '<div class="task-history-timeline">' + events.map(function (event) { return renderEvent(event, context.employeesById); }).join('') + '</div></section>' +
      '</div>' +
    '</details>';
  }

  /* ---------- Hauptrendering ---------- */

  function render() {
    var root = document.getElementById('task-history-root');
    if (!root || !window.DataLayer) return;

    if (state.range !== 'custom' && !state.dateFrom && !state.dateTo) setRange(state.range);

    var tasks = window.DataLayer.getTasks ? window.DataLayer.getTasks().slice() : [];
    var employees = window.DataLayer.getEmployees ? window.DataLayer.getEmployees() : [];
    var projects = window.DataLayer.getProjects ? window.DataLayer.getProjects() : [];
    var labels = window.DataLayer.getLabels ? window.DataLayer.getLabels().slice() : [];
    var context = {
      employees: employees,
      projects: projects,
      labels: labels,
      employeesById: indexById(employees),
      projectsById: indexById(projects),
      labelsById: indexById(labels)
    };

    var baseEntries = tasks.filter(function (task) {
      return matchesProject(task) && matchesAssignee(task) &&
        taskHasLabel(task, state.labelId, context.labelsById) && matchesSearch(task, context);
    }).map(function (task) {
      var allEvents = getTaskEvents(task);
      return { task: task, allEvents: allEvents, eventsInRange: allEvents.filter(isEventInRange) };
    });

    var counts = {
      all: baseEntries.length,
      review: baseEntries.filter(function (entry) { return entry.task.status === 'review'; }).length,
      done: baseEntries.filter(function (entry) { return entry.task.status === 'done'; }).length
    };

    var entries = baseEntries.filter(function (entry) {
      if (!matchesView(entry.task) || !matchesStatus(entry.task)) return false;
      // Review-Warteschlange immer vollständig anzeigen – unabhängig vom Zeitraum
      if (state.view === 'review') return true;
      return entry.eventsInRange.length > 0;
    }).sort(function (left, right) {
      return String(right.allEvents[0] && right.allEvents[0].at || '').localeCompare(String(left.allEvents[0] && left.allEvents[0].at || ''));
    });

    var doneCount = tasks.filter(function (task) { return task.status === 'done'; }).length;
    var reviewCount = tasks.filter(function (task) { return task.status === 'review'; }).length;
    var activeCount = tasks.filter(function (task) { return task.status === 'in-progress'; }).length;
    var openCount = tasks.filter(function (task) { return task.status === 'backlog' || task.status === 'todo'; }).length;
    var eventCount = entries.reduce(function (sum, entry) { return sum + entry.eventsInRange.length; }, 0);

    root.innerHTML = '<div class="task-history-summary">' +
      renderMetric(tasks.length, 'Aufgaben gesamt', 'all', state.view === 'all' && !state.status) +
      renderMetric(reviewCount, 'Zu prüfen', 'review', state.view === 'review', 'is-review-metric') +
      renderMetric(doneCount, 'Erledigt', 'done', state.view === 'done', 'is-done-metric') +
      renderMetric(activeCount, 'In Bearbeitung', 'in-progress', state.view === 'all' && state.status === 'in-progress') +
      renderMetric(openCount, 'Offen', 'open', state.view === 'all' && state.status === 'open') +
      renderMetric(eventCount, 'Ereignisse im Zeitraum') +
    '</div>' +
    renderViewTabs(counts) +
    renderFilters(context, entries.length) +
    (entries.length
      ? '<div class="task-history-list">' + entries.map(function (entry) { return renderTaskCard(entry, context); }).join('') + '</div>'
      : '<div class="task-history-empty"><strong>' + (state.view === 'review' ? 'Keine Aufgaben zu prüfen' : 'Keine Aufgaben gefunden') + '</strong><p>' +
        (state.view === 'review' ? 'Aktuell befindet sich keine Aufgabe in der Review-Spalte.' : 'Für die gewählten Filter gibt es keine Aufgaben bzw. Verlaufsereignisse.') + '</p></div>');

    wireControls(root);
  }

  /* ---------- Interaktionen ---------- */

  function wireControls(root) {
    var range = document.getElementById('task-history-range');
    var from = document.getElementById('task-history-from');
    var to = document.getElementById('task-history-to');
    var label = document.getElementById('task-history-label');
    var status = document.getElementById('task-history-status');
    var project = document.getElementById('task-history-project');
    var assignee = document.getElementById('task-history-assignee');
    var search = document.getElementById('task-history-search');
    var reset = document.getElementById('task-history-reset');

    if (range) range.addEventListener('change', function () { setRange(this.value); render(); });
    if (from) from.addEventListener('change', function () { state.range = 'custom'; state.dateFrom = this.value; render(); });
    if (to) to.addEventListener('change', function () { state.range = 'custom'; state.dateTo = this.value; render(); });
    if (label) label.addEventListener('change', function () { state.labelId = this.value; render(); });
    if (status) status.addEventListener('change', function () { state.status = this.value; render(); });
    if (project) project.addEventListener('change', function () { state.projectId = this.value; render(); });
    if (assignee) assignee.addEventListener('change', function () { state.assigneeId = this.value; render(); });
    if (search) {
      search.addEventListener('input', function () {
        state.search = this.value;
        window.clearTimeout(search._debounce);
        search._debounce = window.setTimeout(function () {
          var active = document.activeElement === search;
          var pos = search.selectionStart;
          render();
          if (active) {
            var fresh = document.getElementById('task-history-search');
            if (fresh) {
              fresh.focus();
              try { fresh.setSelectionRange(pos, pos); } catch (err) { /* type=search erlaubt das immer */ }
            }
          }
        }, 220);
      });
    }
    if (reset) {
      reset.addEventListener('click', function () {
        state.view = 'all';
        state.labelId = '';
        state.status = '';
        state.projectId = '';
        state.assigneeId = '';
        state.search = '';
        setRange('30');
        render();
      });
    }

    root.querySelectorAll('.task-history-tab').forEach(function (button) {
      button.addEventListener('click', function () {
        var view = this.getAttribute('data-view');
        state.view = view;
        state.status = '';
        render();
        root.querySelector('.task-history-tab.is-active').focus({ preventScroll: true });
      });
    });

    root.querySelectorAll('[data-metric-action]').forEach(function (metric) {
      function activate() {
        var action = metric.getAttribute('data-metric-action');
        if (action === 'all') { state.view = 'all'; state.status = ''; }
        else if (action === 'review') { state.view = 'review'; state.status = ''; }
        else if (action === 'done') { state.view = 'done'; state.status = ''; }
        else { state.view = 'all'; state.status = action; }
        render();
      }
      metric.addEventListener('click', activate);
      metric.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
      });
    });

    root.querySelectorAll('.task-history-card').forEach(function (card) {
      card.addEventListener('toggle', function () {
        var id = String(card.getAttribute('data-task-id') || '');
        if (card.open) state.expanded[id] = true;
        else {
          delete state.expanded[id];
          if (state.pendingAction && String(state.pendingAction.taskId) === id) state.pendingAction = null;
        }
      });
    });

    function wireAction(selector, handler) {
      root.querySelectorAll(selector).forEach(function (button) {
        button.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          handler(button);
        });
      });
    }

    wireAction('.task-history-reactivate', function (button) { startAction(button.getAttribute('data-task-id'), 'reopen'); });
    wireAction('.task-history-approve', function (button) { startAction(button.getAttribute('data-task-id'), 'approve'); });
    wireAction('.task-history-return', function (button) { startAction(button.getAttribute('data-task-id'), 'return'); });
    wireAction('.task-history-open-kanban', function (button) { openInKanban(button.getAttribute('data-task-id'), button.getAttribute('data-project-id')); });
    wireAction('.task-history-action-cancel', function () { state.pendingAction = null; render(); });
    wireAction('.task-history-action-confirm', function (button) {
      var panel = button.closest('.task-history-action-panel');
      var textarea = panel ? panel.querySelector('.task-history-action-comment') : null;
      confirmPendingAction(button.getAttribute('data-task-id'), textarea ? textarea.value : '');
    });

    var pendingComment = root.querySelector('.task-history-action-comment');
    if (pendingComment) pendingComment.focus();
  }

  /* ---------- Aktionen ---------- */

  function startAction(taskId, type) {
    state.pendingAction = { taskId: String(taskId), type: type };
    state.expanded[String(taskId)] = true;
    render();
  }

  function confirmPendingAction(taskId, comment) {
    var pending = state.pendingAction;
    if (!pending || String(pending.taskId) !== String(taskId)) return;
    state.pendingAction = null;
    if (pending.type === 'approve') approveReview(taskId, comment);
    else if (pending.type === 'return') returnToWork(taskId, comment);
    else if (pending.type === 'reopen') reactivateTask(taskId, comment);
  }

  function appendReviewNote(task, text) {
    if (!text) return;
    if (!Array.isArray(task.notes)) task.notes = [];
    task.notes.push({ text: text, createdAt: new Date().toISOString() });
  }

  function approveReview(taskId, comment) {
    if (!window.DataLayer || !window.DataLayer.getTaskById || !window.DataLayer.updateTask) return;
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || task.status !== 'review') return;
    if (!window.TaskResponse.hasValidAnswer(task)) {
      alert('Bitte zuerst die erforderliche Antwort in der Aufgabe abgeben.');
      return;
    }

    var next = JSON.parse(JSON.stringify(task));
    next.status = 'done';
    next.progress = 100;
    if (comment && comment.trim()) appendReviewNote(next, '[Review freigegeben] ' + comment.trim());
    window.DataLayer.updateTask(next);
    state.expanded[String(taskId)] = true;
    render();
  }

  function returnToWork(taskId, comment) {
    if (!window.DataLayer || !window.DataLayer.getTaskById || !window.DataLayer.updateTask) return;
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || task.status !== 'review') return;

    var next = JSON.parse(JSON.stringify(task));
    next.status = 'in-progress';
    if (comment && comment.trim()) appendReviewNote(next, '[Review-Rückmeldung] ' + comment.trim());
    window.DataLayer.updateTask(next);
    state.expanded[String(taskId)] = true;
    render();
  }

  function reactivateTask(taskId, comment) {
    if (!window.DataLayer || !window.DataLayer.getTaskById || !window.DataLayer.updateTask) return;
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || task.status !== 'done') return;

    var next = JSON.parse(JSON.stringify(task));
    next.status = 'todo';
    next.progress = 0;
    if (comment && comment.trim()) appendReviewNote(next, '[Wieder geöffnet] ' + comment.trim());
    window.DataLayer.updateTask(next);
    state.expanded[String(taskId)] = true;
    render();
  }

  function openInKanban(taskId, projectId) {
    if (window.AppShell && typeof window.AppShell.navigateTo === 'function') {
      window.AppShell.navigateTo('kanban');
      try { history.pushState(null, null, '#page=kanban'); } catch (err) { /* iframe o. ä. */ }
    }
    if (window.KanbanBoard && typeof window.KanbanBoard.focusTask === 'function') {
      window.setTimeout(function () {
        window.KanbanBoard.focusTask(taskId, projectId || undefined);
      }, 80);
    }
  }

  /* ---------- Init ---------- */

  function init() {
    if (isWired) return;
    isWired = true;
    setRange(state.range);
    render();
    if (window.DataLayer && typeof window.DataLayer.on === 'function') {
      window.DataLayer.on('dataChanged', function () {
        var page = document.getElementById('tasks');
        if (page && page.classList.contains('active')) render();
      });
    }
  }

  window.TaskHistoryModule = {
    init: init,
    render: render,
    reactivateTask: reactivateTask,
    approveReview: approveReview,
    returnToWork: returnToWork
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

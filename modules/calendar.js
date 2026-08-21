/* ========================================
   Team-Kalender (Feature 11)
   ======================================== */
(function () {
  'use strict';

  var UNASSIGNED_FILTER_VALUE = '__unassigned__';
  var CALENDAR_MODE_EVENTS = 'events';
  var CALENDAR_MODE_ACTIVITY = 'activity';
  var currentViewDate = new Date();
  var selectedEmployeeId = '';
  var currentCalendarMode = CALENDAR_MODE_EVENTS;
  var expandedDaySet = new Set();
  var expandAllOverflowDays = false;

  function getAuthManager() {
    return window.AuthManager || null;
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getFirstDayOfMonth(year, month) {
    return (new Date(year, month, 1).getDay() + 6) % 7;
  }

  function getISODate(date) {
    if (!date) return '';
    var d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getDisplayDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function getDisplayTime(value) {
    if (!value) return '';
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function getMonthLabel(date) {
    var monthNames = ['Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    return monthNames[date.getMonth()] + ' ' + date.getFullYear();
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clampProgress(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function getEventTypeMeta(type) {
    var map = {
      meeting: { label: 'Meeting', color: 'var(--accent-blue)' },
      deadline: { label: 'Deadline', color: 'var(--accent-red)' },
      release: { label: 'Release', color: 'var(--accent-green)' },
      holiday: { label: 'Urlaub', color: 'var(--accent-purple)' },
      task: { label: 'Task', color: 'var(--accent-yellow)' }
    };
    return map[type] || { label: 'Termin', color: 'var(--accent-blue)' };
  }

  function getActivityTypeMeta(type) {
    var map = {
      created: { label: 'Neu', color: 'var(--accent-blue)' },
      started: { label: 'Start', color: 'var(--accent-yellow)' },
      progress: { label: 'Fortschritt', color: 'var(--accent-blue)' },
      completed: { label: 'Erledigt', color: 'var(--accent-green)' },
      reassigned: { label: 'Zuweisung', color: 'var(--accent-purple)' },
      'status-change': { label: 'Status', color: 'var(--accent-blue)' },
      updated: { label: 'Update', color: 'var(--accent-yellow)' }
    };
    return map[type] || map.updated;
  }

  function getCalendarEvents() {
    if (window.DataLayer && window.DataLayer.getCalendarEvents) {
      return window.DataLayer.getCalendarEvents() || [];
    }
    return [];
  }

  function getTasks() {
    if (window.DataLayer && window.DataLayer.getTasks) {
      return window.DataLayer.getTasks() || [];
    }
    return [];
  }

  function sortEvents(a, b) {
    var aDate = String(a.date || a.startDate || '').trim();
    var bDate = String(b.date || b.startDate || '').trim();
    var aTime = String(a.startTime || '').trim();
    var bTime = String(b.startTime || '').trim();
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return String(a.title || '').localeCompare(String(b.title || ''));
  }

  function getEventParticipants(event) {
    var attendeeIds = [];
    if (Array.isArray(event.attendeeIds)) attendeeIds = event.attendeeIds.slice();
    else if (Array.isArray(event.attendees)) attendeeIds = event.attendees.slice();
    if (!attendeeIds.length && event.attendeeId) attendeeIds = [event.attendeeId];

    var seen = Object.create(null);
    return attendeeIds
      .map(function (id) { return String(id || '').trim(); })
      .filter(function (id) {
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
  }

  function getEmployees() {
    if (window.DataLayer && window.DataLayer.getEmployees) {
      return window.DataLayer.getEmployees() || [];
    }
    return [];
  }

  function getEmployeeName(id) {
    if (!id) return '';
    var employees = getEmployees();
    var match = employees.find(function (emp) { return String(emp.id) === String(id); });
    return match ? (match.name || match.title || String(id)) : String(id);
  }

  function getEmployeeWorkplace(id) {
    if (!id) return '';
    var employees = getEmployees();
    var match = employees.find(function (emp) { return String(emp.id) === String(id); });
    return match ? String(match.workplace || '').trim() : '';
  }

  function getProjectLabel(id) {
    if (!id) return '';
    var projects = window.DataLayer && window.DataLayer.getProjects ? window.DataLayer.getProjects() : [];
    var match = projects.find(function (project) { return String(project.id) === String(id); });
    return match ? (match.title || match.name || String(id)) : String(id);
  }

  function getDateKeyFromValue(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return getISODate(value);
    return getISODate(value);
  }

  function getSortableTimestamp(value) {
    var parsed = Date.parse(value || '');
    return isNaN(parsed) ? -1 : parsed;
  }

  function isDateInMonth(dateKey, viewDate) {
    return !!dateKey && dateKey.indexOf(viewDate.getFullYear() + '-' + String(viewDate.getMonth() + 1).padStart(2, '0')) === 0;
  }

  function eventMatchesEmployeeFilter(event, employeeId) {
    if (!employeeId) return true;
    if (employeeId === UNASSIGNED_FILTER_VALUE) {
      return getEventParticipants(event).length === 0;
    }
    return getEventParticipants(event).indexOf(String(employeeId)) !== -1;
  }

  function taskMatchesEmployeeFilter(task, employeeId) {
    if (!employeeId) return true;
    var assigneeId = String(task && task.assigneeId || '').trim();
    if (employeeId === UNASSIGNED_FILTER_VALUE) return !assigneeId;
    return assigneeId === String(employeeId);
  }

  function getSelectedEmployeeName() {
    if (!selectedEmployeeId) return '';
    if (selectedEmployeeId === UNASSIGNED_FILTER_VALUE) return 'Ohne Mitarbeiter';
    return getEmployeeName(selectedEmployeeId);
  }

  function getTaskStatusLabel(status) {
    var labels = {
      backlog: 'Backlog',
      todo: 'Offen',
      'in-progress': 'In Bearbeitung',
      review: 'Review',
      done: 'Erledigt'
    };
    return labels[status] || (status || 'Unbekannt');
  }

  function filterEventsByEmployee(events) {
    if (!selectedEmployeeId) return events;
    return events.filter(function (evt) {
      return eventMatchesEmployeeFilter(evt, selectedEmployeeId);
    });
  }

  function getTaskHistoryEntries(task) {
    if (!task) return [];

    var history = Array.isArray(task.history) ? task.history.slice() : [];
    if (!history.length) {
      var createdAt = task.createdAt || '';
      var updatedAt = task.updatedAt || createdAt;
      if (createdAt) {
        history.push({
          type: 'created',
          at: createdAt,
          status: task.status || 'todo',
          progress: clampProgress(task.progress),
          assigneeId: task.assigneeId || ''
        });
      }
      if (updatedAt && updatedAt !== createdAt) {
        history.push({
          type: task.status === 'done' ? 'completed' : 'updated',
          at: updatedAt,
          status: task.status || 'todo',
          progress: clampProgress(task.progress),
          assigneeId: task.assigneeId || ''
        });
      }
    }

    return history
      .map(function (entry, index) {
        return {
          id: entry.id || (String(task.id || 'task') + '-hist-' + index),
          type: entry.type || 'updated',
          at: entry.at || '',
          status: entry.status || task.status || 'todo',
          progress: clampProgress(typeof entry.progress === 'number' ? entry.progress : task.progress),
          assigneeId: entry.assigneeId || task.assigneeId || ''
        };
      })
      .filter(function (entry) {
        return !!getDateKeyFromValue(entry.at);
      })
      .sort(function (a, b) {
        return String(a.at || '').localeCompare(String(b.at || ''));
      });
  }

  function buildTaskActivityEntries() {
    var latestByTaskDay = Object.create(null);
    var sequence = 0;

    getTasks().forEach(function (task) {
      if (!taskMatchesEmployeeFilter(task, selectedEmployeeId)) return;
      var previousProgress = 0;
      var dayStartProgressByDate = Object.create(null);

      getTaskHistoryEntries(task).forEach(function (entry, index) {
        var dateKey = getDateKeyFromValue(entry.at);
        if (!dateKey) return;
        var entryProgress = clampProgress(entry.progress);
        if (dayStartProgressByDate[dateKey] === undefined) {
          dayStartProgressByDate[dateKey] = previousProgress;
        }
        var dayProgressGain = Math.max(0, entryProgress - dayStartProgressByDate[dateKey]);
        var dayGainSharePercent = entryProgress > 0
          ? Math.min(100, Math.round((dayProgressGain / entryProgress) * 100))
          : 0;

        var activity = {
          id: String(task.id || 'task') + '-activity-' + index + '-' + dateKey,
          taskId: task.id,
          taskTitle: task.title || 'Aufgabe',
          date: dateKey,
          type: entry.type || 'updated',
          status: entry.status || task.status || 'todo',
          progress: entryProgress,
          dayStartProgress: dayStartProgressByDate[dateKey],
          dayProgressGain: dayProgressGain,
          dayGainSharePercent: dayGainSharePercent,
          assigneeId: entry.assigneeId || task.assigneeId || '',
          projectId: task.projectId || null,
          updatedAt: entry.at || '',
          _timestamp: getSortableTimestamp(entry.at),
          _sequence: sequence++
        };

        var taskKey = String(task.id || (task.title || 'Aufgabe'));
        var groupKey = dateKey + '::' + taskKey;
        var existing = latestByTaskDay[groupKey];
        if (!existing || activity._timestamp > existing._timestamp || (activity._timestamp === existing._timestamp && activity._sequence > existing._sequence)) {
          latestByTaskDay[groupKey] = activity;
        }

        previousProgress = entryProgress;
      });
    });

    var entries = Object.keys(latestByTaskDay).map(function (key) {
      return latestByTaskDay[key];
    });

    entries.sort(function (a, b) {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a._timestamp !== b._timestamp) return a._timestamp - b._timestamp;
      if (a.updatedAt !== b.updatedAt) return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
      return String(a.taskTitle || '').localeCompare(String(b.taskTitle || ''));
    });

    entries.forEach(function (entry) {
      delete entry._timestamp;
      delete entry._sequence;
    });

    return entries;
  }

  function populateEmployeeFilterOptions() {
    var select = document.getElementById('cal-employee-filter');
    if (!select) return;

    var before = selectedEmployeeId || select.value || '';
    var employees = getEmployees();
    var options = ['<option value="">Alle Mitarbeiter</option>', '<option value="' + UNASSIGNED_FILTER_VALUE + '">Ohne Mitarbeiter</option>'];

    employees.forEach(function (emp) {
      options.push('<option value="' + escapeHtml(emp.id) + '">' + escapeHtml(emp.name || emp.title || emp.id) + '</option>');
    });

    select.innerHTML = options.join('');
    if (before === UNASSIGNED_FILTER_VALUE) {
      select.value = UNASSIGNED_FILTER_VALUE;
    } else if (before && employees.some(function (emp) { return String(emp.id) === String(before); })) {
      select.value = String(before);
    }

    selectedEmployeeId = select.value || '';
  }

  function updateChipTooltip(chip, titleNode, fullTitle) {
    if (!chip || !titleNode || !fullTitle) return;
    var isOverflowing = titleNode.scrollWidth > titleNode.clientWidth;
    if (isOverflowing) {
      chip.dataset.tooltip = fullTitle;
      chip.setAttribute('title', fullTitle);
    } else {
      chip.removeAttribute('data-tooltip');
      chip.removeAttribute('title');
    }
  }

  function createDayEventChip(evt) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'calendar-event-chip';
    chip.dataset.id = evt.id;
    chip.dataset.type = evt.type || 'meeting';

    var titleEl = document.createElement('strong');
    titleEl.className = 'calendar-event-chip-title';
    titleEl.textContent = evt.title || 'Termin';

    var metaEl = document.createElement('span');
    metaEl.className = 'calendar-event-chip-meta';
    metaEl.textContent = (evt.startTime ? evt.startTime : '') + (evt.endTime ? (' - ' + evt.endTime) : '');

    chip.appendChild(titleEl);
    chip.appendChild(metaEl);

    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      openEventDetailsModal(evt.id);
    });

    requestAnimationFrame(function () {
      updateChipTooltip(chip, titleEl, evt.title || 'Termin');
    });

    return chip;
  }

  function createDayActivityChip(activity) {
    var chip = document.createElement('div');
    var meta = getActivityTypeMeta(activity.type);
    var assigneeName = activity.assigneeId ? getEmployeeName(activity.assigneeId) : 'Nicht zugewiesen';
    var workplace = activity.assigneeId ? getEmployeeWorkplace(activity.assigneeId) : '';
    var metaParts = [meta.label, assigneeName];
    if (workplace) metaParts.push(workplace);
    metaParts.push(activity.progress + '%');
    var totalProgress = clampProgress(activity.progress);
    var dayStart = clampProgress(activity.dayStartProgress);
    var dayGain = Math.max(0, totalProgress - dayStart);

    chip.className = 'calendar-event-chip calendar-activity-chip';
    chip.dataset.type = activity.type || 'updated';

    var titleEl = document.createElement('strong');
    titleEl.className = 'calendar-event-chip-title';
    titleEl.textContent = activity.taskTitle || 'Aufgabe';

    var metaEl = document.createElement('span');
    metaEl.className = 'calendar-event-chip-meta';
    metaEl.textContent = metaParts.join(' • ');
    metaEl.style.color = meta.color;

    var gainEl = document.createElement('span');
    gainEl.className = 'calendar-event-chip-gain';
    gainEl.innerHTML = '<span>Gesamt ' + escapeHtml(String(totalProgress)) + '%</span><span class="calendar-progress-today">Plus +' + escapeHtml(String(dayGain)) + '%</span>';

    var growthBar = document.createElement('span');
    growthBar.className = 'calendar-activity-growth-bar calendar-activity-growth-bar-mini';

    var totalFill = document.createElement('span');
    totalFill.className = 'calendar-activity-growth-total';
    totalFill.style.width = totalProgress + '%';

    growthBar.appendChild(totalFill);

    chip.appendChild(titleEl);
    chip.appendChild(metaEl);
    chip.appendChild(gainEl);
    chip.appendChild(growthBar);

    requestAnimationFrame(function () {
      updateChipTooltip(chip, titleEl, (activity.taskTitle || 'Aufgabe') + ' | ' + metaParts.join(' | ') + ' | Gesamt ' + totalProgress + '% | Plus +' + dayGain + '%');
    });

    return chip;
  }

  function updateOverflowToggleButton(overflownDaysCount) {
    var toggleBtn = document.getElementById('cal-toggle-overflow-days');
    if (!toggleBtn) return;

    if (!overflownDaysCount) {
      toggleBtn.disabled = true;
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = 'Keine Tage mit >3 Eintraegen';
      return;
    }

    toggleBtn.disabled = false;
    toggleBtn.setAttribute('aria-expanded', expandAllOverflowDays ? 'true' : 'false');
    toggleBtn.textContent = expandAllOverflowDays ? 'Alle Tage zuklappen' : 'Alle Tage aufklappen';
  }

  function toggleDayExpansion(dateKey, shouldExpand) {
    if (!dateKey) return;
    if (shouldExpand) expandedDaySet.add(dateKey);
    else expandedDaySet.delete(dateKey);
  }

  function createOverflowMoreButton(dateKey, hiddenCount) {
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'calendar-event-more';
    more.textContent = '+' + hiddenCount + ' mehr anzeigen';
    more.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDayExpansion(dateKey, true);
      renderCalendar(currentViewDate);
    });
    return more;
  }

  function createExpandToggleButton(dateKey, isExpanded) {
    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'calendar-day-expand-toggle';
    toggleBtn.textContent = isExpanded ? '▴' : '▾';
    toggleBtn.setAttribute('aria-label', isExpanded ? 'Tageskachel zuklappen' : 'Tageskachel aufklappen');
    toggleBtn.setAttribute('title', isExpanded ? 'Tageskachel zuklappen' : 'Tageskachel aufklappen');
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDayExpansion(dateKey, !isExpanded);
      renderCalendar(currentViewDate);
    });
    return toggleBtn;
  }

  function updateCalendarControlState() {
    var exportBtn = document.getElementById('cal-export-ics');
    var addBtn = document.getElementById('cal-add-event');
    var viewModeSelect = document.getElementById('cal-view-mode');
    var isActivityMode = currentCalendarMode === CALENDAR_MODE_ACTIVITY;
    var auth = getAuthManager();
    var canCreate = !auth || typeof auth.canCreateCalendarEvent !== 'function' || auth.canCreateCalendarEvent();

    if (viewModeSelect) viewModeSelect.value = currentCalendarMode;

    if (exportBtn) {
      exportBtn.disabled = isActivityMode;
      exportBtn.title = isActivityMode ? 'iCal Export ist nur in der Terminansicht verfuegbar.' : 'Kalender als iCal exportieren';
    }

    if (addBtn) {
      addBtn.disabled = isActivityMode || !canCreate;
      addBtn.title = !canCreate
        ? 'Gastnutzer koennen keine Termine anlegen.'
        : (isActivityMode ? 'Im Arbeitsfluss koennen keine Termine angelegt werden.' : 'Neuen Termin anlegen');
    }
  }

  function buildEventDetailsHtml(evt) {
    var auth = getAuthManager();
    var canEdit = !auth || typeof auth.canEditCalendarEvent !== 'function' || auth.canEditCalendarEvent(evt);
    var meta = getEventTypeMeta(evt.type || 'meeting');
    var participantNames = getEventParticipants(evt).map(getEmployeeName);
    var projectLabel = getProjectLabel(evt.projectId);

    var rows = [];
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Datum</span><span class="calendar-detail-value">' + escapeHtml(getDisplayDate(evt.date || evt.startDate)) + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Zeit</span><span class="calendar-detail-value">' + escapeHtml((evt.startTime || '') + (evt.endTime ? (' - ' + evt.endTime) : '') || 'Ganztag') + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Typ</span><span class="calendar-detail-value">' + escapeHtml(meta.label) + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Ort</span><span class="calendar-detail-value">' + escapeHtml(evt.location || 'Nicht angegeben') + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Projekt</span><span class="calendar-detail-value">' + escapeHtml(projectLabel || 'Kein Projekt') + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Mitarbeiter</span><span class="calendar-detail-value">' + escapeHtml(participantNames.length ? participantNames.join(', ') : 'Keine Zuweisung') + '</span></div>');

    var descriptionBlock = evt.description
      ? '<div class="calendar-detail-description"><h3>Beschreibung</h3><p>' + escapeHtml(evt.description) + '</p></div>'
      : '<div class="calendar-detail-description calendar-detail-description-muted"><h3>Beschreibung</h3><p>Keine Beschreibung hinterlegt.</p></div>';

    return '' +
      '<div class="calendar-detail-shell">' +
      '<div class="calendar-detail-hero" style="--detail-accent:' + meta.color + '">' +
      '<span class="calendar-event-tag" style="border-color:' + meta.color + ';color:' + meta.color + '">' + escapeHtml(meta.label) + '</span>' +
      '<h2>' + escapeHtml(evt.title || 'Termin') + '</h2>' +
      '</div>' +
      '<div class="calendar-detail-grid">' + rows.join('') + '</div>' +
      descriptionBlock +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-secondary" id="calendar-modal-close">Schliessen</button>' +
      (canEdit ? '<button type="button" class="btn btn-primary" id="calendar-modal-edit">Bearbeiten</button>' : '') +
      '</div>' +
      '</div>';
  }

  function buildEventEditorHtml(event, defaultDate) {
    var auth = getAuthManager();
    var projects = window.DataLayer && window.DataLayer.getProjects ? window.DataLayer.getProjects() : [];
    if (auth && typeof auth.getVisibleProjects === 'function') projects = auth.getVisibleProjects(projects);
    var employees = getEmployees();
    var attendeeIds = event ? getEventParticipants(event) : [];
    var editing = !!(event && event.id);

    var projectOptions = projects.map(function (project) {
      var selected = event && String(event.projectId) === String(project.id) ? ' selected' : '';
      return '<option value="' + escapeHtml(project.id) + '"' + selected + '>' + escapeHtml(project.title || project.name || project.id) + '</option>';
    }).join('');

    var employeeOptions = employees.map(function (emp) {
      var selected = attendeeIds.indexOf(String(emp.id)) !== -1 ? ' selected' : '';
      return '<option value="' + escapeHtml(emp.id) + '"' + selected + '>' + escapeHtml(emp.name || emp.title || emp.id) + '</option>';
    }).join('');

    return '' +
      '<h2>' + (editing ? 'Termin bearbeiten' : 'Neuer Termin') + '</h2>' +
      '<div class="calendar-modal-form">' +
      '<input type="hidden" id="evt-id" value="' + escapeHtml((event && event.id) || '') + '">' +
      '<input type="hidden" id="evt-created-at" value="' + escapeHtml((event && event.createdAt) || '') + '">' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-title">Titel *</label><input type="text" id="evt-title" value="' + escapeHtml((event && event.title) || '') + '" required></div>' +
      '<div class="form-group"><label for="evt-date">Datum</label><input type="date" id="evt-date" value="' + escapeHtml((event && (event.date || event.startDate)) || defaultDate || '') + '"></div>' +
      '</div>' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-start-time">Start</label><input type="time" id="evt-start-time" value="' + escapeHtml((event && event.startTime) || '') + '"></div>' +
      '<div class="form-group"><label for="evt-end-time">Ende</label><input type="time" id="evt-end-time" value="' + escapeHtml((event && event.endTime) || '') + '"></div>' +
      '</div>' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-type">Typ</label>' +
      '<select id="evt-type">' +
      '<option value="meeting"' + (((event && event.type === 'meeting') || !event) ? ' selected' : '') + '>Meeting</option>' +
      '<option value="deadline"' + ((event && event.type === 'deadline') ? ' selected' : '') + '>Deadline</option>' +
      '<option value="release"' + ((event && event.type === 'release') ? ' selected' : '') + '>Release</option>' +
      '<option value="holiday"' + ((event && event.type === 'holiday') ? ' selected' : '') + '>Urlaub</option>' +
      '<option value="task"' + ((event && event.type === 'task') ? ' selected' : '') + '>Task</option>' +
      '</select></div>' +
      '<div class="form-group"><label for="evt-project">Projekt</label><select id="evt-project"><option value="">-- Kein Projekt --</option>' + projectOptions + '</select></div>' +
      '</div>' +
      '<div class="form-group"><label for="evt-location">Ort</label><input type="text" id="evt-location" value="' + escapeHtml((event && event.location) || '') + '"></div>' +
      '<div class="form-group"><label for="evt-attendees">Mitarbeiter</label><select id="evt-attendees" multiple>' + employeeOptions + '</select><small class="text-muted">Strg/Cmd + Klick fuer Mehrfachauswahl.</small></div>' +
      '<div class="form-group"><label for="evt-description">Beschreibung</label><textarea id="evt-description" rows="3">' + escapeHtml((event && event.description) || '') + '</textarea></div>' +
      '<div class="form-group"><label><input type="checkbox" id="evt-all-day"' + ((event && event.allDay) ? ' checked' : '') + '> Ganztagstermin</label></div>' +
      '<div class="modal-actions">' +
      (editing ? '<button type="button" class="btn btn-danger" id="calendar-delete-btn">Loeschen</button>' : '') +
      '<button type="button" class="btn btn-secondary" id="calendar-cancel-btn">Abbrechen</button>' +
      '<button type="button" class="btn btn-primary" id="calendar-save-btn">Speichern</button>' +
      '</div>' +
      '</div>';
  }

  function openEventDetailsModal(eventId) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var event = getCalendarEvents().find(function (evt) { return evt.id === eventId; });
    if (!event) return;

    content.innerHTML = buildEventDetailsHtml(event);
    overlay.classList.remove('hidden');
    setSharedModalClosePolicy({ preventAccidentalClose: false, owner: 'calendar-details' });

    var closeBtn = document.getElementById('calendar-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var editBtn = document.getElementById('calendar-modal-edit');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        openEventEditorModal(event.id);
      });
    }
  }

  function openEventEditorModal(eventId, defaultDate, modalOptions) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var auth = getAuthManager();
    var event = eventId ? getCalendarEvents().find(function (evt) { return evt.id === eventId; }) : null;
    if (!event && auth && typeof auth.canCreateCalendarEvent === 'function' && !auth.canCreateCalendarEvent()) {
      alert('Gastnutzer koennen keine Termine anlegen.');
      return;
    }
    if (event && auth && typeof auth.canEditCalendarEvent === 'function' && !auth.canEditCalendarEvent(event)) {
      alert('Dieser Termin kann nur gelesen werden.');
      return;
    }
    content.innerHTML = buildEventEditorHtml(event, defaultDate);
    overlay.classList.remove('hidden');
    setSharedModalClosePolicy(modalOptions || { preventAccidentalClose: false, owner: 'calendar-editor' });

    var saveBtn = document.getElementById('calendar-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', window.saveCalendarEvent);

    var cancelBtn = document.getElementById('calendar-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    var deleteBtn = document.getElementById('calendar-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', window.deleteCalendarEvent);

    var titleField = document.getElementById('evt-title');
    if (titleField && titleField.focus) titleField.focus();
  }

  function setSharedModalClosePolicy(options) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var owner = options && options.owner ? String(options.owner) : 'calendar';
    var prevent = !!(options && options.preventAccidentalClose);

    content.setAttribute('data-modal-owner', owner);
    if (prevent) {
      content.setAttribute('data-prevent-overlay-close', 'true');
      content.setAttribute('data-prevent-escape-close', 'true');
      return;
    }

    content.removeAttribute('data-prevent-overlay-close');
    content.removeAttribute('data-prevent-escape-close');
  }

  function canCloseSharedModal(reason) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return true;
    if (overlay.classList.contains('hidden')) return false;

    var preventOverlay = content.getAttribute('data-prevent-overlay-close') === 'true';
    var preventEscape = content.getAttribute('data-prevent-escape-close') === 'true';

    if (reason === 'overlay' && preventOverlay) return false;
    if (reason === 'escape' && preventEscape) return false;
    return true;
  }

  function attachEventDayInteractions(cell, dateStr) {
    cell.addEventListener('dragover', function (e) {
      e.preventDefault();
    });

    cell.addEventListener('drop', function (e) {
      e.preventDefault();
      var eventId = e.dataTransfer.getData('text/plain');
      if (!eventId) return;

      var eventToMove = getCalendarEvents().find(function (ev) {
        return ev.id === eventId;
      });

      if (eventToMove) {
        var auth = getAuthManager();
        if (auth && typeof auth.canEditCalendarEvent === 'function' && !auth.canEditCalendarEvent(eventToMove)) return;
        eventToMove.date = dateStr;
        eventToMove.startDate = dateStr;
        window.DataLayer.updateCalendarEvent(eventToMove);
        renderCalendar(currentViewDate);
      }
    });

    cell.addEventListener('dblclick', function () {
      var auth = getAuthManager();
      if (auth && typeof auth.canCreateCalendarEvent === 'function' && !auth.canCreateCalendarEvent()) return;
      openEventEditorModal(null, dateStr);
    });
  }

  function renderCalendar(date) {
    try {
      if (!date) date = currentViewDate || new Date();
      currentViewDate = new Date(date.getFullYear(), date.getMonth(), 1);

      populateEmployeeFilterOptions();
      updateCalendarControlState();

      var year = currentViewDate.getFullYear();
      var month = currentViewDate.getMonth();
      var isActivityMode = currentCalendarMode === CALENDAR_MODE_ACTIVITY;

      var monthEl = document.getElementById('cal-current-month');
      if (monthEl) monthEl.textContent = getMonthLabel(currentViewDate);

      var grid = document.getElementById('calendar-grid');
      if (!grid) return;
      grid.innerHTML = '';

      var headers = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      headers.forEach(function (dayName) {
        var headerCell = document.createElement('div');
        headerCell.className = 'calendar-day-header';
        headerCell.textContent = dayName;
        grid.appendChild(headerCell);
      });

      var visibleEvents = filterEventsByEmployee(getCalendarEvents().slice().sort(sortEvents));
      var activityEntries = buildTaskActivityEntries();
      var overflowDaysCount = 0;

      var startOffset = getFirstDayOfMonth(year, month);
      var i;
      for (i = 0; i < startOffset; i++) {
        var empty = document.createElement('div');
        empty.className = 'calendar-day';
        empty.style.opacity = '0.3';
        grid.appendChild(empty);
      }

      var daysInMonth = getDaysInMonth(year, month);
      var today = new Date();

      for (var day = 1; day <= daysInMonth; day++) {
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        var dayItems = (isActivityMode ? activityEntries : visibleEvents).filter(function (item) {
          return isActivityMode
            ? String(item.date || '') === dateStr
            : String(item.date || item.startDate || '') === dateStr;
        });

        if (isActivityMode) {
          dayItems.sort(function (a, b) {
            var bTs = getSortableTimestamp(b.updatedAt);
            var aTs = getSortableTimestamp(a.updatedAt);
            if (bTs !== aTs) return bTs - aTs;
            return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
          });
        }

        var hasOverflow = dayItems.length > 3;
        if (hasOverflow) overflowDaysCount += 1;
        var isExpanded = hasOverflow && (expandAllOverflowDays || expandedDaySet.has(dateStr));

        var cell = document.createElement('div');
        cell.className = 'calendar-day';
        if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === day) {
          cell.classList.add('today');
        }
        if (hasOverflow) {
          cell.classList.add('has-overflow');
          if (isExpanded) cell.classList.add('expanded');
        }

        var dayNumber = document.createElement('div');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        cell.appendChild(dayNumber);

        var eventList = document.createElement('div');
        eventList.className = 'calendar-event-list';

        var itemsToRender = isExpanded ? dayItems : dayItems.slice(0, 3);
        itemsToRender.forEach(function (item) {
          eventList.appendChild(isActivityMode ? createDayActivityChip(item) : createDayEventChip(item));
        });

        if (hasOverflow && !isExpanded) {
          eventList.appendChild(createOverflowMoreButton(dateStr, dayItems.length - 3));
        }

        if (hasOverflow) {
          eventList.appendChild(createExpandToggleButton(dateStr, isExpanded));
        }

        cell.appendChild(eventList);
        if (!isActivityMode) attachEventDayInteractions(cell, dateStr);
        grid.appendChild(cell);
      }

      updateOverflowToggleButton(overflowDaysCount);

      if (isActivityMode) renderActivityList(currentViewDate, activityEntries);
      else renderEventList(currentViewDate, visibleEvents);
    } catch (err) {
      console.error('[Calendar] Error:', err);
    }
  }

  function renderEventList(viewDate, events) {
    var listEl = document.getElementById('calendar-events-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    var monthEvents = events.filter(function (evt) {
      if (!evt.date && !evt.startDate) return false;
      var dateValue = evt.date || evt.startDate;
      var eventDate = new Date(dateValue + 'T12:00:00');
      return eventDate.getFullYear() === viewDate.getFullYear() && eventDate.getMonth() === viewDate.getMonth();
    });

    var heading = document.createElement('div');
    heading.className = 'calendar-events-list-heading';
    heading.textContent = 'Termine im ' + getMonthLabel(viewDate) + (getSelectedEmployeeName() ? ' - ' + getSelectedEmployeeName() : '');
    listEl.appendChild(heading);

    if (!monthEvents.length) {
      var empty = document.createElement('div');
      empty.className = 'calendar-empty-state';
      empty.textContent = selectedEmployeeId
        ? (selectedEmployeeId === UNASSIGNED_FILTER_VALUE
          ? 'Es gibt in diesem Monat keine Termine ohne Mitarbeiterzuweisung.'
          : 'Fuer den ausgewaehlten Mitarbeiter sind in diesem Monat keine Termine vorhanden.')
        : 'Fuer diesen Monat sind noch keine Termine hinterlegt.';
      listEl.appendChild(empty);
      return;
    }

    monthEvents.sort(sortEvents).forEach(function (evt) {
      var card = document.createElement('article');
      card.className = 'calendar-event-card';

      var meta = getEventTypeMeta(evt.type || 'meeting');
      var participants = getEventParticipants(evt).map(getEmployeeName);
      var projectLabel = getProjectLabel(evt.projectId);
      var details = [];

      if (evt.location) details.push('<div><strong>Ort:</strong> ' + escapeHtml(evt.location) + '</div>');
      if (projectLabel) details.push('<div><strong>Projekt:</strong> ' + escapeHtml(projectLabel) + '</div>');
      if (participants.length) details.push('<div><strong>Mitarbeiter:</strong> ' + escapeHtml(participants.join(', ')) + '</div>');
      if (evt.description) details.push('<div><strong>Hinweis:</strong> ' + escapeHtml(evt.description) + '</div>');

      card.innerHTML = '' +
        '<div class="calendar-event-card-head">' +
        '<span class="calendar-event-tag" style="border-color:' + meta.color + ';color:' + meta.color + '">' + escapeHtml(meta.label) + '</span>' +
        '<span class="calendar-event-date">' + escapeHtml(getDisplayDate(evt.date || evt.startDate)) + '</span>' +
        '</div>' +
        '<h3>' + escapeHtml(evt.title || 'Termin') + '</h3>' +
        '<div class="calendar-event-meta">' + escapeHtml((evt.startTime ? evt.startTime : '') + (evt.endTime ? (' - ' + evt.endTime) : '')) + '</div>' +
        '<div class="calendar-event-details">' + details.join('') + '</div>';

      card.addEventListener('click', function () {
        openEventDetailsModal(evt.id);
      });

      listEl.appendChild(card);
    });
  }

  function buildActivitySummaryHtml(activities) {
    var uniqueTaskIds = Object.create(null);
    var uniqueEmployeeIds = Object.create(null);
    var completedCount = 0;
    var progressTotal = 0;

    activities.forEach(function (activity) {
      if (activity.taskId) uniqueTaskIds[activity.taskId] = true;
      if (activity.assigneeId) uniqueEmployeeIds[activity.assigneeId] = true;
      if (activity.type === 'completed') completedCount += 1;
      progressTotal += clampProgress(activity.progress);
    });

    var avgProgress = activities.length ? Math.round(progressTotal / activities.length) : 0;

    return '' +
      '<article class="calendar-activity-summary">' +
      '<div class="calendar-activity-summary-item"><span>Eintraege</span><strong>' + activities.length + '</strong></div>' +
      '<div class="calendar-activity-summary-item"><span>Aufgaben</span><strong>' + Object.keys(uniqueTaskIds).length + '</strong></div>' +
      '<div class="calendar-activity-summary-item"><span>Mitarbeiter</span><strong>' + Object.keys(uniqueEmployeeIds).length + '</strong></div>' +
      '<div class="calendar-activity-summary-item"><span>Erledigt</span><strong>' + completedCount + '</strong></div>' +
      '<div class="calendar-activity-summary-item"><span>Ø Fortschritt</span><strong>' + avgProgress + '%</strong></div>' +
      '</article>';
  }

  function renderActivityList(viewDate, activities) {
    var listEl = document.getElementById('calendar-events-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    var monthActivities = activities.filter(function (activity) {
      return isDateInMonth(activity.date, viewDate);
    });

    var heading = document.createElement('div');
    heading.className = 'calendar-events-list-heading';
    heading.textContent = 'Arbeitsfluss im ' + getMonthLabel(viewDate) + (getSelectedEmployeeName() ? ' - ' + getSelectedEmployeeName() : '');
    listEl.appendChild(heading);

    if (!monthActivities.length) {
      var empty = document.createElement('div');
      empty.className = 'calendar-empty-state';
      empty.textContent = selectedEmployeeId
        ? (selectedEmployeeId === UNASSIGNED_FILTER_VALUE
          ? 'Es gibt in diesem Monat keine Aktivitaeten fuer nicht zugewiesene Aufgaben.'
          : 'Fuer den ausgewaehlten Mitarbeiter wurden in diesem Monat keine Task-Aktivitaeten erfasst.')
        : 'Fuer diesen Monat wurden noch keine Task-Aktivitaeten erfasst.';
      listEl.appendChild(empty);
      return;
    }

    listEl.insertAdjacentHTML('beforeend', buildActivitySummaryHtml(monthActivities));

    var groups = Object.create(null);
    monthActivities.forEach(function (activity) {
      if (!groups[activity.date]) groups[activity.date] = [];
      groups[activity.date].push(activity);
    });

    Object.keys(groups).sort().reverse().forEach(function (dateKey) {
      var dailyActivities = groups[dateKey].slice().sort(function (a, b) {
        var bTs = getSortableTimestamp(b.updatedAt);
        var aTs = getSortableTimestamp(a.updatedAt);
        if (bTs !== aTs) return bTs - aTs;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
      var uniqueEmployees = Object.create(null);
      var completedToday = 0;

      dailyActivities.forEach(function (activity) {
        if (activity.assigneeId) uniqueEmployees[activity.assigneeId] = true;
        if (activity.type === 'completed') completedToday += 1;
      });

      var dayHeading = document.createElement('div');
      dayHeading.className = 'calendar-activity-day-heading';
      dayHeading.innerHTML = '' +
        '<strong>' + escapeHtml(getDisplayDate(dateKey)) + '</strong>' +
        '<span>' + dailyActivities.length + ' Aktivitaeten</span>' +
        '<span>' + Object.keys(uniqueEmployees).length + ' Mitarbeiter</span>' +
        '<span>' + completedToday + ' erledigt</span>';
      listEl.appendChild(dayHeading);

      dailyActivities.forEach(function (activity) {
        var card = document.createElement('article');
        var typeMeta = getActivityTypeMeta(activity.type);
        var assigneeName = activity.assigneeId ? getEmployeeName(activity.assigneeId) : 'Nicht zugewiesen';
        var workplace = activity.assigneeId ? getEmployeeWorkplace(activity.assigneeId) : '';
        var projectLabel = getProjectLabel(activity.projectId);
        var displayTime = getDisplayTime(activity.updatedAt);
        var totalProgress = clampProgress(activity.progress);
        var dayStart = clampProgress(activity.dayStartProgress);
        var dayGain = Math.max(0, totalProgress - dayStart);

        card.className = 'calendar-event-card calendar-activity-card';
        card.innerHTML = '' +
          '<div class="calendar-event-card-head">' +
          '<span class="calendar-event-tag" style="border-color:' + typeMeta.color + ';color:' + typeMeta.color + '">' + escapeHtml(typeMeta.label) + '</span>' +
          '<span class="calendar-event-date">' + escapeHtml(getTaskStatusLabel(activity.status)) + '</span>' +
          '</div>' +
          '<h3>' + escapeHtml(activity.taskTitle || 'Aufgabe') + '</h3>' +
          '<div class="calendar-event-meta">' + escapeHtml(assigneeName + (projectLabel ? ' • ' + projectLabel : '')) + '</div>' +
          (workplace ? '<div class="calendar-activity-workplace"><span class="material-symbols-rounded" aria-hidden="true">location_on</span><span>' + escapeHtml(workplace) + '</span></div>' : '') +
          '<div class="calendar-activity-progress-row"><span>Gesamtfortschritt</span><strong>' + escapeHtml(String(totalProgress)) + '%</strong></div>' +
          '<div class="calendar-activity-growth-bar" aria-hidden="true">' +
          '<span class="calendar-activity-growth-total" style="width:' + totalProgress + '%"></span>' +
          '</div>' +
          '<div class="calendar-activity-progress-row calendar-activity-progress-row-sub"><span>Plus</span><strong class="calendar-progress-today">+' + escapeHtml(String(dayGain)) + '%</strong></div>' +
          '<div class="calendar-event-details">' +
          '<div><strong>Status:</strong> ' + escapeHtml(getTaskStatusLabel(activity.status)) + '</div>' +
          '<div><strong>Aktivitaet:</strong> ' + escapeHtml(typeMeta.label) + '</div>' +
          '<div><strong>Zeitpunkt:</strong> ' + escapeHtml(displayTime || 'Nicht angegeben') + '</div>' +
          '</div>';
        listEl.appendChild(card);
      });
    });
  }

  window.openCalendarEventEditor = function (eventId) {
    openEventEditorModal(eventId);
  };

  window.saveCalendarEvent = function () {
    try {
      var auth = getAuthManager();
      var titleEl = document.getElementById('evt-title');
      var dateEl = document.getElementById('evt-date');
      var startEl = document.getElementById('evt-start-time');
      var endEl = document.getElementById('evt-end-time');
      var typeEl = document.getElementById('evt-type');
      var locationEl = document.getElementById('evt-location');
      var descriptionEl = document.getElementById('evt-description');
      var projectEl = document.getElementById('evt-project');
      var allDayEl = document.getElementById('evt-all-day');
      var attendeeSelect = document.getElementById('evt-attendees');
      var idEl = document.getElementById('evt-id');
      var createdAtEl = document.getElementById('evt-created-at');

      var title = titleEl ? titleEl.value.trim() : '';
      if (!title) {
        alert('Titel erforderlich');
        return;
      }

      var attendeeIds = [];
      if (attendeeSelect) {
        Array.prototype.forEach.call(attendeeSelect.options, function (option) {
          if (option.selected) attendeeIds.push(option.value);
        });
      }

      var payload = {
        title: title,
        date: dateEl ? dateEl.value : '',
        startDate: dateEl ? dateEl.value : '',
        type: typeEl ? typeEl.value : 'meeting',
        projectId: projectEl && projectEl.value ? projectEl.value : null,
        location: locationEl ? locationEl.value.trim() : '',
        description: descriptionEl ? descriptionEl.value.trim() : '',
        startTime: startEl ? startEl.value : '',
        endTime: endEl ? endEl.value : '',
        allDay: allDayEl ? !!allDayEl.checked : false,
        attendeeIds: attendeeIds,
        createdAt: createdAtEl && createdAtEl.value ? createdAtEl.value : new Date().toISOString()
      };

      var existingId = idEl ? idEl.value : '';
      if (existingId) {
        payload.id = existingId;
        if (auth && typeof auth.canEditCalendarEvent === 'function') {
          var existingEvent = window.DataLayer.getCalendarEventById(existingId);
          if (!auth.canEditCalendarEvent(existingEvent)) {
            alert('Dieser Termin kann nur gelesen werden.');
            return;
          }
        }
        window.DataLayer.updateCalendarEvent(payload);
      } else {
        if (auth && typeof auth.canCreateCalendarEvent === 'function' && !auth.canCreateCalendarEvent()) {
          alert('Gastnutzer koennen keine Termine anlegen.');
          return;
        }
        window.DataLayer.createCalendarEvent(payload);
      }

      closeModal();
      renderCalendar(currentViewDate);
    } catch (err) {
      console.error('[Save Event]', err);
    }
  };

  window.deleteCalendarEvent = function () {
    try {
      var auth = getAuthManager();
      var idEl = document.getElementById('evt-id');
      var existingId = idEl ? idEl.value : '';
      if (existingId && window.DataLayer.deleteCalendarEvent) {
        if (auth && typeof auth.canEditCalendarEvent === 'function') {
          var existingEvent = window.DataLayer.getCalendarEventById(existingId);
          if (!auth.canEditCalendarEvent(existingEvent)) {
            alert('Dieser Termin kann nicht geloescht werden.');
            return;
          }
        }
        window.DataLayer.deleteCalendarEvent(existingId);
      }
      closeModal();
      renderCalendar(currentViewDate);
    } catch (err) {
      console.error('[Delete Event]', err);
    }
  };

  window.closeModal = function () {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (overlay) overlay.classList.add('hidden');
    if (content) {
      content.removeAttribute('data-modal-owner');
      content.removeAttribute('data-prevent-overlay-close');
      content.removeAttribute('data-prevent-escape-close');
      content.innerHTML = '';
    }
  };

  function closeModal() {
    window.closeModal();
  }

  function exportICS() {
    try {
      var events = getCalendarEvents();
      if (!events.length) {
        alert('Keine Events zum Exportieren.');
        return;
      }

      var ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Projekt-Dashboard//DE\r\n';
      events.forEach(function (evt) {
        ics += 'BEGIN:VEVENT\r\n';
        if (evt.startDate || evt.date) ics += 'DTSTART:' + formatICSDate(evt.startDate || evt.date) + '\r\n';
        ics += 'SUMMARY:' + (evt.title || 'Event') + '\r\n';
        if (evt.type) ics += 'CATEGORIES:' + String(evt.type).toUpperCase() + '\r\n';
        ics += 'END:VEVENT\r\n';
      });
      ics += 'END:VCALENDAR';

      var blob = new Blob([ics], { type: 'text/calendar' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'kalender.ics';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ICS]', err);
    }
  }

  function formatICSDate(value) {
    var dt = new Date(value + 'T00:00:00');
    return dt.getFullYear() + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0') + 'T000000Z';
  }

  function setupCalendarNav() {
    var prev = document.getElementById('cal-prev-month');
    if (prev) {
      prev.addEventListener('click', function () {
        renderCalendar(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() - 1, 1));
      });
    }

    var next = document.getElementById('cal-next-month');
    if (next) {
      next.addEventListener('click', function () {
        renderCalendar(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + 1, 1));
      });
    }

    var addBtn = document.getElementById('cal-add-event');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        if (currentCalendarMode === CALENDAR_MODE_ACTIVITY) return;
        openEventEditorModal(null, getISODate(new Date()));
      });
    }

    var exportBtn = document.getElementById('cal-export-ics');
    if (exportBtn) exportBtn.addEventListener('click', exportICS);

    var viewModeSelect = document.getElementById('cal-view-mode');
    if (viewModeSelect) {
      viewModeSelect.addEventListener('change', function () {
        currentCalendarMode = viewModeSelect.value === CALENDAR_MODE_ACTIVITY ? CALENDAR_MODE_ACTIVITY : CALENDAR_MODE_EVENTS;
        expandedDaySet.clear();
        expandAllOverflowDays = false;
        renderCalendar(currentViewDate);
      });
    }

    var employeeFilter = document.getElementById('cal-employee-filter');
    if (employeeFilter) {
      employeeFilter.addEventListener('change', function () {
        selectedEmployeeId = employeeFilter.value || '';
        expandedDaySet.clear();
        expandAllOverflowDays = false;
        renderCalendar(currentViewDate);
      });
    }

    var overflowToggleBtn = document.getElementById('cal-toggle-overflow-days');
    if (overflowToggleBtn) {
      overflowToggleBtn.addEventListener('click', function () {
        expandAllOverflowDays = !expandAllOverflowDays;
        if (expandAllOverflowDays) {
          expandedDaySet.clear();
        }
        renderCalendar(currentViewDate);
      });
    }

    var overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target !== overlay) return;
        if (!canCloseSharedModal('overlay')) return;
        closeModal();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (!canCloseSharedModal('escape')) return;
      closeModal();
    });
  }

  function openEventModal(eventId, defaultDate, modalOptions) {
    openEventEditorModal(eventId, defaultDate, modalOptions);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupCalendarNav();
    renderCalendar(currentViewDate);
  });

  window.CalendarModule = {
    render: renderCalendar,
    exportICS: exportICS,
    openModal: openEventModal,
    openDetails: openEventDetailsModal,
    setMode: function (mode) {
      currentCalendarMode = mode === CALENDAR_MODE_ACTIVITY ? CALENDAR_MODE_ACTIVITY : CALENDAR_MODE_EVENTS;
      renderCalendar(currentViewDate);
    }
  };
})();

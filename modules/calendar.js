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
  var disabledTypeSet = new Set();

  var EVENT_TYPE_ORDER = ['meeting', 'deadline', 'release', 'training', 'holiday', 'sick', 'home-office', 'task', 'other'];

  var RSVP_META = {
    accepted: { label: 'Zugesagt', color: 'var(--accent-green)', icon: 'check_circle' },
    tentative: { label: 'Vielleicht', color: 'var(--accent-yellow)', icon: 'help' },
    declined: { label: 'Abgesagt', color: 'var(--accent-red)', icon: 'cancel' },
    pending: { label: 'Ausstehend', color: 'var(--text-muted)', icon: 'schedule' }
  };

  function getRsvpMeta(status) {
    return RSVP_META[status] || RSVP_META.pending;
  }

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
      meeting: { label: 'Meeting', color: 'var(--accent-blue)', icon: 'groups' },
      deadline: { label: 'Deadline', color: 'var(--accent-red)', icon: 'flag' },
      release: { label: 'Release', color: 'var(--accent-green)', icon: 'rocket_launch' },
      holiday: { label: 'Urlaub', color: 'var(--accent-purple)', icon: 'beach_access' },
      sick: { label: 'Krankmeldung', color: 'var(--accent-red)', icon: 'sick' },
      'home-office': { label: 'Homeoffice', color: 'var(--accent-cyan, #22b8cf)', icon: 'home_work' },
      task: { label: 'Task', color: 'var(--accent-yellow)', icon: 'task_alt' },
      training: { label: 'Schulung', color: 'var(--accent-cyan, #22b8cf)', icon: 'school' },
      other: { label: 'Sonstiges', color: 'var(--text-muted)', icon: 'event_note' }
    };
    return map[type] || { label: 'Termin', color: 'var(--accent-blue)', icon: 'event' };
  }

  function getActivityTypeMeta(type) {
    var map = {
      created: { label: 'Neu', color: 'var(--accent-blue)' },
      started: { label: 'Start', color: 'var(--accent-yellow)' },
      progress: { label: 'Fortschritt', color: 'var(--accent-blue)' },
      completed: { label: 'Erledigt', color: 'var(--accent-green)' },
      'github-commit': { label: 'GitHub-Commits (rueckwirkend)', color: 'var(--accent-green)' },
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

  /* ---------- RSVP / Terminbestaetigung ---------- */

  function getEventResponses(event) {
    var raw = event && event.responses && typeof event.responses === 'object' ? event.responses : {};
    var result = Object.create(null);
    getEventParticipants(event).forEach(function (id) {
      var entry = raw[id];
      var status = entry && ['accepted', 'declined', 'tentative'].indexOf(entry.status) !== -1 ? entry.status : 'pending';
      result[id] = {
        status: status,
        respondedAt: entry && entry.respondedAt ? entry.respondedAt : ''
      };
    });
    return result;
  }

  function getRsvpSummary(event) {
    var responses = getEventResponses(event);
    var summary = { accepted: 0, declined: 0, tentative: 0, pending: 0, total: 0 };
    Object.keys(responses).forEach(function (id) {
      summary[responses[id].status] += 1;
      summary.total += 1;
    });
    return summary;
  }

  function getCurrentUser() {
    var auth = getAuthManager();
    return auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
  }

  function canManageEventRsvp(event) {
    var auth = getAuthManager();
    if (!auth) return false;
    var mode = typeof auth.getMode === 'function' ? auth.getMode() : '';
    if (mode === 'admin' || mode === 'management' || mode === 'setup') return true;
    var user = getCurrentUser();
    return !!(user && String(event && event.createdByEmployeeId || '') === String(user.id));
  }

  function pushNotification(type, message) {
    try {
      if (window.DataLayer && window.DataLayer.createNotification) {
        window.DataLayer.createNotification({ type: type, message: message, createdAt: new Date().toISOString(), read: false });
      }
    } catch (err) { /* Benachrichtigung ist optional */ }
  }

  function respondToEvent(eventId, status) {
    var user = getCurrentUser();
    if (!user) {
      alert('Bitte anmelden, um auf Termineinladungen zu antworten.');
      return false;
    }
    var event = getCalendarEvents().find(function (evt) { return evt.id === eventId; });
    if (!event || isEmployeeStatus(event)) return false;
    if (getEventParticipants(event).indexOf(String(user.id)) === -1) return false;

    if (!event.responses || typeof event.responses !== 'object') event.responses = {};
    event.responses[String(user.id)] = {
      status: status,
      respondedAt: new Date().toISOString()
    };
    window.DataLayer.updateCalendarEvent(event);

    var meta = getRsvpMeta(status);
    pushNotification('calendar', (user.name || 'Mitarbeiter') + ' hat fuer "' + (event.title || 'Termin') + '" geantwortet: ' + meta.label);
    renderCalendar(currentViewDate);
    return true;
  }

  function sendRsvpReminder(eventId) {
    var event = getCalendarEvents().find(function (evt) { return evt.id === eventId; });
    if (!event) return;
    var responses = getEventResponses(event);
    var pendingNames = Object.keys(responses)
      .filter(function (id) { return responses[id].status === 'pending'; })
      .map(getEmployeeName);
    if (!pendingNames.length) {
      alert('Alle Teilnehmer haben bereits geantwortet.');
      return;
    }
    pushNotification('calendar', 'Erinnerung: Bitte Termin "' + (event.title || 'Termin') + '" am ' + getDisplayDate(event.date || event.startDate) + ' bestaetigen (' + pendingNames.join(', ') + ').');
    alert('Erinnerung fuer ' + pendingNames.length + ' ausstehende Antwort(en) wurde erstellt.');
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

  function getProjectLabel(id, missingLabel) {
    if (!id) return '';
    var projects = window.DataLayer && window.DataLayer.getProjects ? window.DataLayer.getProjects() : [];
    var match = projects.find(function (project) { return String(project.id) === String(id); });
    return match ? (match.title || match.name || (missingLabel ? 'Projekt ohne Namen' : String(id))) : (missingLabel || String(id));
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

  function isEmployeeStatus(event) {
    return !!event && (event.type === 'sick' || event.type === 'home-office' || (event.type === 'holiday' && event.employeeStatus === true));
  }

  function eventOverlaps(event, start, end) {
    var eventStart = String(event.date || event.startDate || '');
    var eventEnd = String(event.endDate || eventStart);
    return !!eventStart && eventStart <= end && eventEnd >= start;
  }

  function monthBounds(date) {
    return {
      start: getISODate(new Date(date.getFullYear(), date.getMonth(), 1)),
      end: getISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
    };
  }

  function eventDateLabel(event) {
    var start = event.date || event.startDate;
    return getDisplayDate(start) + (event.endDate && event.endDate !== start ? ' – ' + getDisplayDate(event.endDate) : '');
  }

  function eventMatchesEmployeeFilter(event, employeeId) {
    if (!employeeId) return true;
    if (event.source === 'github-commit') {
      var commitEmployeeId = String(event.commitEmployeeId || '');
      return employeeId === UNASSIGNED_FILTER_VALUE ? !commitEmployeeId : commitEmployeeId === String(employeeId);
    }
    if (employeeId === UNASSIGNED_FILTER_VALUE) {
      return getEventParticipants(event).length === 0;
    }
    return getEventParticipants(event).indexOf(String(employeeId)) !== -1;
  }

  function taskMatchesEmployeeFilter(task, employeeId) {
    if (!employeeId) return true;
    var assigneeIds = Array.isArray(task && task.assigneeIds) ? task.assigneeIds.slice() : [];
    if (task && task.assigneeId) assigneeIds.push(task.assigneeId);
    assigneeIds = assigneeIds.map(function (id) { return String(id || '').trim(); }).filter(Boolean);
    if (employeeId === UNASSIGNED_FILTER_VALUE) return !assigneeIds.length;
    return assigneeIds.indexOf(String(employeeId)) !== -1;
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

  function normalizeEventType(type) {
    return EVENT_TYPE_ORDER.indexOf(type) !== -1 ? type : 'other';
  }

  function filterEventsByType(events) {
    if (!disabledTypeSet.size) return events;
    return events.filter(function (evt) {
      return !disabledTypeSet.has(normalizeEventType(evt.type || 'meeting'));
    });
  }

  function filterAppointmentEvents(events) {
    return events.filter(function (event) { return event.source !== 'github-commit'; });
  }

  function renderTypeLegend(monthEvents) {
    var legendEl = document.getElementById('calendar-type-legend');
    if (!legendEl) return;
    legendEl.innerHTML = '';

    if (currentCalendarMode === CALENDAR_MODE_ACTIVITY) {
      legendEl.classList.add('hidden');
      return;
    }
    legendEl.classList.remove('hidden');

    var counts = Object.create(null);
    monthEvents.forEach(function (evt) {
      var type = normalizeEventType(evt.type || 'meeting');
      counts[type] = (counts[type] || 0) + 1;
    });

    EVENT_TYPE_ORDER.forEach(function (type) {
      var meta = getEventTypeMeta(type);
      var isActive = !disabledTypeSet.has(type);
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'calendar-legend-chip' + (isActive ? ' active' : '');
      chip.style.setProperty('--legend-color', meta.color);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      chip.title = isActive ? meta.label + ' ausblenden' : meta.label + ' einblenden';
      chip.innerHTML = '' +
        '<span class="material-symbols-rounded" aria-hidden="true">' + meta.icon + '</span>' +
        '<span>' + escapeHtml(meta.label) + '</span>' +
        '<span class="calendar-legend-count">' + (counts[type] || 0) + '</span>';
      chip.addEventListener('click', function () {
        if (disabledTypeSet.has(type)) disabledTypeSet.delete(type);
        else disabledTypeSet.add(type);
        renderCalendar(currentViewDate);
      });
      legendEl.appendChild(chip);
    });

    if (disabledTypeSet.size) {
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'calendar-legend-reset';
      reset.textContent = 'Alle Typen anzeigen';
      reset.addEventListener('click', function () {
        disabledTypeSet.clear();
        renderCalendar(currentViewDate);
      });
      legendEl.appendChild(reset);
    }
  }

  // Dringlichkeit offener Einladungen: 0 (>= 7 Tage entfernt) bis 1 (jetzt/überfällig).
  // Steuert Tempo/Ausschlag der Aufmerksamkeits-Animationen via CSS-Variable.
  function applyInviteUrgency(panel, events) {
    if (!panel) return;
    var hasPending = !!(events && events.length);
    panel.classList.toggle('has-pending', hasPending);
    if (!hasPending) {
      panel.style.removeProperty('--invite-urgency');
      panel.classList.remove('invite-urgency-high');
      return;
    }
    var now = Date.now();
    var minHours = Infinity;
    events.forEach(function (evt) {
      var dateKey = String(evt.date || evt.startDate || '');
      if (!dateKey) return;
      var start = new Date(dateKey + 'T' + (evt.startTime ? evt.startTime : '00:00') + ':00');
      if (isNaN(start.getTime())) return;
      var hours = (start.getTime() - now) / 3600000;
      if (hours < minHours) minHours = hours;
    });
    if (!isFinite(minHours)) minHours = 168;
    var urgency = Math.max(0, Math.min(1, 1 - minHours / 168));
    panel.style.setProperty('--invite-urgency', urgency.toFixed(3));
    panel.classList.toggle('invite-urgency-high', minHours <= 24);
  }

  function renderPendingInvites() {
    var panel = document.getElementById('calendar-pending-invites');
    if (!panel) return;
    panel.innerHTML = '';

    var user = getCurrentUser();
    if (!user || currentCalendarMode === CALENDAR_MODE_ACTIVITY) {
      panel.classList.add('hidden');
      applyInviteUrgency(panel, []);
      return;
    }

    var todayKey = getISODate(new Date());
    var pendingEvents = getCalendarEvents().filter(function (evt) {
      if (isEmployeeStatus(evt)) return false;
      var dateKey = String(evt.date || evt.startDate || '');
      if (!dateKey || dateKey < todayKey) return false;
      if (getEventParticipants(evt).indexOf(String(user.id)) === -1) return false;
      var response = getEventResponses(evt)[String(user.id)];
      return response && response.status === 'pending';
    }).sort(sortEvents);

    if (!pendingEvents.length) {
      panel.classList.add('hidden');
      applyInviteUrgency(panel, []);
      return;
    }
    panel.classList.remove('hidden');
    applyInviteUrgency(panel, pendingEvents);

    var heading = document.createElement('div');
    heading.className = 'calendar-invites-heading';
    heading.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">mark_email_unread</span>' +
      '<strong>Offene Termineinladungen</strong>' +
      '<span class="calendar-invites-count">' + pendingEvents.length + '</span>';
    panel.appendChild(heading);

    var list = document.createElement('div');
    list.className = 'calendar-invites-list';

    pendingEvents.slice(0, 5).forEach(function (evt) {
      var meta = getEventTypeMeta(normalizeEventType(evt.type || 'meeting'));
      var row = document.createElement('div');
      row.className = 'calendar-invite-row';
      row.style.setProperty('--invite-color', meta.color);

      var info = document.createElement('button');
      info.type = 'button';
      info.className = 'calendar-invite-info';
      info.innerHTML = '' +
        '<span class="calendar-invite-type"><span class="material-symbols-rounded" aria-hidden="true">' + meta.icon + '</span>' + escapeHtml(meta.label) + '</span>' +
        '<strong>' + escapeHtml(evt.title || 'Termin') + '</strong>' +
        '<span class="calendar-invite-date">' + escapeHtml(getDisplayDate(evt.date || evt.startDate) + (evt.startTime ? ', ' + evt.startTime + ' Uhr' : '')) + '</span>';
      info.addEventListener('click', function () { openEventDetailsModal(evt.id); });
      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'calendar-invite-actions';
      [['accepted', 'Zusagen'], ['tentative', 'Vielleicht'], ['declined', 'Absagen']].forEach(function (pair) {
        var rsvp = getRsvpMeta(pair[0]);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calendar-rsvp-btn calendar-rsvp-' + pair[0];
        btn.title = pair[1];
        btn.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">' + rsvp.icon + '</span><span>' + pair[1] + '</span>';
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          respondToEvent(evt.id, pair[0]);
        });
        actions.appendChild(btn);
      });
      row.appendChild(actions);
      list.appendChild(row);
    });

    if (pendingEvents.length > 5) {
      var moreNote = document.createElement('div');
      moreNote.className = 'calendar-invites-more';
      moreNote.textContent = '+' + (pendingEvents.length - 5) + ' weitere Einladung(en) in der Terminliste';
      list.appendChild(moreNote);
    }

    panel.appendChild(list);
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

    var commitImport = task.githubCommitImport;
    var dailyDate = commitImport && commitImport.dailyTaskDate;
    var commits = commitImport && Array.isArray(commitImport.commits) ? commitImport.commits : [];
    if (dailyDate && commits.length) {
      var lastCommit = commits.filter(function (commit) {
        return commit && commit.calendarDate === dailyDate && isFinite(Date.parse(commit.date));
      }).sort(function (a, b) { return Date.parse(b.date) - Date.parse(a.date); })[0];
      if (lastCommit) {
        history = history.filter(function (entry) { return entry.type !== 'created'; });
        history.push({
          type: 'github-commit', at: lastCommit.date, calendarDate: dailyDate,
          calendarTime: lastCommit.calendarTime, status: 'done', progress: 100,
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
          calendarDate: entry.calendarDate || '',
          calendarTime: entry.calendarTime || '',
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
        var dateKey = entry.calendarDate || getDateKeyFromValue(entry.at);
        if (!dateKey) return;
        var entryProgress = clampProgress(entry.progress);
        if (dayStartProgressByDate[dateKey] === undefined) {
          dayStartProgressByDate[dateKey] = previousProgress;
        }
        var dayProgressGain = entry.type === 'github-commit' ? 0 : Math.max(0, entryProgress - dayStartProgressByDate[dateKey]);
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
          dayStartProgress: entry.type === 'github-commit' ? entryProgress : dayStartProgressByDate[dateKey],
          dayProgressGain: dayProgressGain,
          dayGainSharePercent: dayGainSharePercent,
          assigneeId: entry.assigneeId || task.assigneeId || '',
          assigneeIds: entry.type === 'github-commit' && Array.isArray(task.assigneeIds) && task.assigneeIds.length
            ? task.assigneeIds.slice() : (entry.assigneeId || task.assigneeId ? [entry.assigneeId || task.assigneeId] : []),
          projectId: task.projectId || null,
          updatedAt: entry.at || '',
          calendarTime: entry.calendarTime || '',
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
    chip.dataset.type = normalizeEventType(evt.type || 'meeting');

    var meta = getEventTypeMeta(chip.dataset.type);

    var headEl = document.createElement('span');
    headEl.className = 'calendar-event-chip-head';

    var iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-rounded calendar-event-chip-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = meta.icon;
    iconEl.style.color = meta.color;

    var titleEl = document.createElement('strong');
    titleEl.className = 'calendar-event-chip-title';
    titleEl.textContent = evt.title || 'Termin';

    headEl.appendChild(iconEl);
    headEl.appendChild(titleEl);

    var metaEl = document.createElement('span');
    metaEl.className = 'calendar-event-chip-meta';
    var statusNames = isEmployeeStatus(evt) ? getEventParticipants(evt).map(getEmployeeName).join(', ') : '';
    metaEl.textContent = statusNames || (evt.allDay ? 'Ganztag' : ((evt.startTime ? evt.startTime : '') + (evt.endTime ? (' - ' + evt.endTime) : '')));

    chip.appendChild(headEl);
    chip.appendChild(metaEl);

    var summary = getRsvpSummary(evt);
    if (summary.total > 0 && !isEmployeeStatus(evt)) {
      var rsvpEl = document.createElement('span');
      rsvpEl.className = 'calendar-event-chip-rsvp';
      if (summary.accepted === summary.total) rsvpEl.classList.add('all-accepted');
      else if (summary.declined === summary.total) rsvpEl.classList.add('all-declined');
      rsvpEl.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">how_to_reg</span>' +
        escapeHtml(summary.accepted + '/' + summary.total + ' bestaetigt');
      chip.appendChild(rsvpEl);
    }

    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      openEventDetailsModal(evt.id);
    });

    requestAnimationFrame(function () {
      updateChipTooltip(chip, titleEl, evt.title || 'Termin');
    });

    return chip;
  }

  function getCommitEventDates() {
    var commitDates = Object.create(null);
    getTasks().forEach(function (task) {
      var commits = task.githubCommitImport && task.githubCommitImport.commits;
      if (!Array.isArray(commits)) return;
      commits.forEach(function (commit) {
        if (commit && commit.sha) commitDates['task-' + task.id + '-github-commit-' + commit.sha] = Date.parse(commit.date);
      });
    });
    return commitDates;
  }

  function groupCommitEvents(events, commitDates) {
    var groups = Object.create(null);
    var items = [];
    commitDates = commitDates || getCommitEventDates();
    events.forEach(function (event) {
      if (event.source !== 'github-commit') {
        items.push(event);
        return;
      }
      var key = String(event.projectId || '');
      if (!groups[key]) {
        groups[key] = { commitGroup: true, projectId: event.projectId || null, events: [] };
        items.push(groups[key]);
      }
      groups[key].events.push(event);
    });

    Object.keys(groups).forEach(function (key) {
      groups[key].events.sort(function (a, b) {
        var dateA = String(a.date || a.startDate || '') + 'T' + String(a.startTime || '');
        var dateB = String(b.date || b.startDate || '') + 'T' + String(b.startTime || '');
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        var timeA = commitDates[a.id], timeB = commitDates[b.id];
        if (isFinite(timeA) && isFinite(timeB) && timeA !== timeB) return timeB - timeA;
        if (isFinite(timeA) !== isFinite(timeB)) return isFinite(timeA) ? -1 : 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    });
    return items;
  }

  function createProjectBadge(projectId) {
    var badge = document.createElement('span');
    badge.className = 'calendar-activity-project';
    var label = getProjectLabel(projectId, 'Unbekanntes Projekt') || 'Ohne Projekt';
    var text = projectId ? 'Projekt: ' + label : label;
    badge.title = text;
    var icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'folder';
    var name = document.createElement('span');
    name.textContent = text;
    badge.appendChild(icon);
    badge.appendChild(name);
    return badge;
  }

  function createCommitGroup(group, compact, activityMode) {
    var container = document.createElement('section');
    container.className = 'calendar-commit-group' + (compact ? ' calendar-commit-group--compact' : '');
    container.addEventListener('click', function (event) { event.stopPropagation(); });
    container.addEventListener('dblclick', function (event) { event.stopPropagation(); });

    var heading = document.createElement('div');
    heading.className = 'calendar-commit-group-heading';
    heading.appendChild(createProjectBadge(group.projectId));
    var count = document.createElement('span');
    count.className = 'calendar-commit-group-count';
    count.textContent = group.events.length + (group.events.length === 1 ? ' Commit' : ' Commits');
    heading.appendChild(count);
    container.appendChild(heading);

    function appendCommit(parent, event) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'calendar-commit-item';
      var title = document.createElement('span');
      title.className = 'calendar-commit-item-title';
      title.textContent = String(event.title || 'GitHub-Commit').replace(/^GitHub-Commit:\s*/, '');
      button.appendChild(title);
      var meta = document.createElement('span');
      meta.className = 'calendar-commit-item-meta';
      var parts = [];
      if (!compact) parts.push(getDisplayDate(event.date || event.startDate));
      if (event.startTime) parts.push(event.startTime);
      var employee = event.commitEmployeeId ? getEmployeeName(event.commitEmployeeId) : 'Nicht zugewiesen';
      if (!compact) parts.push(employee);
      meta.textContent = parts.filter(Boolean).join(' · ');
      button.title = [title.textContent, getDisplayDate(event.date || event.startDate), event.startTime, employee].filter(Boolean).join(' · ');
      button.setAttribute('aria-label', button.title);
      button.appendChild(meta);
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        openEventDetailsModal(event.id);
      });
      parent.appendChild(button);
    }

    group.events.slice(0, 3).forEach(function (event) { appendCommit(container, event); });
    if (group.events.length > 3) {
      var details = document.createElement('details');
      details.className = 'calendar-commit-more';
      var summary = document.createElement('summary');
      summary.textContent = compact ? '+' + (group.events.length - 3) + ' weitere' : (group.events.length - 3) + ' weitere Commits anzeigen';
      details.appendChild(summary);
      group.events.slice(3).forEach(function (event) { appendCommit(details, event); });
      container.appendChild(details);
    }
    if (activityMode && !compact) {
      var note = document.createElement('div');
      note.className = 'calendar-activity-progress-row calendar-activity-progress-row-sub';
      note.textContent = 'Rueckwirkende Dokumentation; keine Arbeitsdauer erfasst.';
      container.appendChild(note);
    }
    return container;
  }

  function createDayActivityChip(activity) {
    var chip = document.createElement('div');
    var meta = getActivityTypeMeta(activity.type);
    var assigneeIds = Array.isArray(activity.assigneeIds) && activity.assigneeIds.length ? activity.assigneeIds : (activity.assigneeId ? [activity.assigneeId] : []);
    var assigneeName = assigneeIds.length ? assigneeIds.map(getEmployeeName).join(', ') : 'Nicht zugewiesen';
    var projectLabel = getProjectLabel(activity.projectId, 'Unbekanntes Projekt') || 'Ohne Projekt';
    var workplace = assigneeIds.length === 1 ? getEmployeeWorkplace(assigneeIds[0]) : '';
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

    var projectText = activity.projectId ? 'Projekt: ' + projectLabel : projectLabel;
    var projectEl = createProjectBadge(activity.projectId);

    var metaEl = document.createElement('span');
    metaEl.className = 'calendar-event-chip-meta';
    metaEl.textContent = metaParts.join(' • ');
    metaEl.style.color = meta.color;

    var gainEl = document.createElement('span');
    gainEl.className = 'calendar-event-chip-gain';
    gainEl.innerHTML = activity.type === 'github-commit'
      ? '<span>Rueckwirkende Dokumentation</span>'
      : '<span>Gesamt ' + escapeHtml(String(totalProgress)) + '%</span><span class="calendar-progress-today">Plus +' + escapeHtml(String(dayGain)) + '%</span>';

    var growthBar = document.createElement('span');
    growthBar.className = 'calendar-activity-growth-bar calendar-activity-growth-bar-mini';

    var totalFill = document.createElement('span');
    totalFill.className = 'calendar-activity-growth-total';
    totalFill.style.width = totalProgress + '%';

    growthBar.appendChild(totalFill);

    chip.appendChild(projectEl);
    chip.appendChild(titleEl);
    chip.appendChild(metaEl);
    chip.appendChild(gainEl);
    chip.appendChild(growthBar);

    requestAnimationFrame(function () {
      updateChipTooltip(chip, titleEl, projectText + ' | ' + (activity.taskTitle || 'Aufgabe') + ' | ' + metaParts.join(' | ') + (activity.type === 'github-commit' ? ' | Rueckwirkende Dokumentation' : ' | Gesamt ' + totalProgress + '% | Plus +' + dayGain + '%'));
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
    var canEdit = evt.source !== 'github-commit' && (!auth || typeof auth.canEditCalendarEvent !== 'function' || auth.canEditCalendarEvent(evt));
    var meta = getEventTypeMeta(normalizeEventType(evt.type || 'meeting'));
    var projectLabel = getProjectLabel(evt.projectId);
    var responses = getEventResponses(evt);
    var summary = getRsvpSummary(evt);
    var user = getCurrentUser();
    var userIsParticipant = !!(user && getEventParticipants(evt).indexOf(String(user.id)) !== -1);
    var userResponse = userIsParticipant ? responses[String(user.id)] : null;
    var organizerName = evt.createdByEmployeeId ? getEmployeeName(evt.createdByEmployeeId) : '';

    var rows = [];
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Datum</span><span class="calendar-detail-value">' + escapeHtml(eventDateLabel(evt)) + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Zeit</span><span class="calendar-detail-value">' + escapeHtml(evt.allDay ? 'Ganztag' : ((evt.startTime || '') + (evt.endTime ? (' - ' + evt.endTime) : '') || 'Ganztag')) + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Typ</span><span class="calendar-detail-value">' + escapeHtml(meta.label) + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Ort</span><span class="calendar-detail-value">' + escapeHtml(evt.location || 'Nicht angegeben') + '</span></div>');
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Projekt</span><span class="calendar-detail-value">' + escapeHtml(projectLabel || 'Kein Projekt') + '</span></div>');
    if (evt.source === 'github-commit') {
      rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Mitarbeiter</span><span class="calendar-detail-value">' + escapeHtml(evt.commitEmployeeId ? getEmployeeName(evt.commitEmployeeId) : 'Nicht zugewiesen') + '</span></div>');
    }
    rows.push('<div class="calendar-detail-item"><span class="calendar-detail-label">Organisator</span><span class="calendar-detail-value">' + escapeHtml(organizerName || 'Nicht angegeben') + '</span></div>');

    var participantIds = getEventParticipants(evt);
    var participantsBlock;
    if (isEmployeeStatus(evt)) {
      participantsBlock = '<div class="calendar-detail-participants"><h3>Mitarbeiter</h3><p>' + escapeHtml(participantIds.map(getEmployeeName).join(', ') || 'Nicht zugewiesen') + '</p></div>';
    } else if (participantIds.length) {
      var participantItems = participantIds.map(function (id) {
        var response = responses[id];
        var rsvpMeta = getRsvpMeta(response.status);
        var respondedHint = response.respondedAt ? ' title="Geantwortet am ' + escapeHtml(getDisplayDate(getISODate(response.respondedAt)) + ' ' + getDisplayTime(response.respondedAt)) + '"' : '';
        return '<li class="calendar-participant-row">' +
          '<span class="calendar-participant-name">' + escapeHtml(getEmployeeName(id)) + '</span>' +
          '<span class="calendar-rsvp-badge calendar-rsvp-badge-' + response.status + '"' + respondedHint + '>' +
          '<span class="material-symbols-rounded" aria-hidden="true">' + rsvpMeta.icon + '</span>' + escapeHtml(rsvpMeta.label) +
          '</span>' +
          '</li>';
      }).join('');

      var summaryBar = '' +
        '<div class="calendar-rsvp-summary" role="status">' +
        '<div class="calendar-rsvp-summary-bar" aria-hidden="true">' +
        (summary.total ? '<span class="calendar-rsvp-fill-accepted" style="width:' + Math.round((summary.accepted / summary.total) * 100) + '%"></span>' +
          '<span class="calendar-rsvp-fill-tentative" style="width:' + Math.round((summary.tentative / summary.total) * 100) + '%"></span>' +
          '<span class="calendar-rsvp-fill-declined" style="width:' + Math.round((summary.declined / summary.total) * 100) + '%"></span>' : '') +
        '</div>' +
        '<div class="calendar-rsvp-summary-counts">' +
        '<span class="calendar-rsvp-count-accepted">' + summary.accepted + ' Zusagen</span>' +
        '<span class="calendar-rsvp-count-tentative">' + summary.tentative + ' Vielleicht</span>' +
        '<span class="calendar-rsvp-count-declined">' + summary.declined + ' Absagen</span>' +
        '<span class="calendar-rsvp-count-pending">' + summary.pending + ' Ausstehend</span>' +
        '</div>' +
        '</div>';

      participantsBlock = '' +
        '<div class="calendar-detail-participants">' +
        '<h3>Teilnehmer (' + participantIds.length + ')</h3>' +
        summaryBar +
        '<ul class="calendar-participant-list">' + participantItems + '</ul>' +
        '</div>';
    } else {
      participantsBlock = '<div class="calendar-detail-participants calendar-detail-description-muted"><h3>Teilnehmer</h3><p>Keine Mitarbeiter zugewiesen.</p></div>';
    }

    var rsvpActionsBlock = '';
    if (userIsParticipant && !isEmployeeStatus(evt)) {
      var currentStatus = userResponse ? userResponse.status : 'pending';
      rsvpActionsBlock = '' +
        '<div class="calendar-detail-rsvp-actions">' +
        '<h3>Meine Teilnahme</h3>' +
        '<div class="calendar-rsvp-actions">' +
        '<button type="button" class="calendar-rsvp-btn calendar-rsvp-accepted' + (currentStatus === 'accepted' ? ' selected' : '') + '" data-rsvp="accepted"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span><span>Zusagen</span></button>' +
        '<button type="button" class="calendar-rsvp-btn calendar-rsvp-tentative' + (currentStatus === 'tentative' ? ' selected' : '') + '" data-rsvp="tentative"><span class="material-symbols-rounded" aria-hidden="true">help</span><span>Vielleicht</span></button>' +
        '<button type="button" class="calendar-rsvp-btn calendar-rsvp-declined' + (currentStatus === 'declined' ? ' selected' : '') + '" data-rsvp="declined"><span class="material-symbols-rounded" aria-hidden="true">cancel</span><span>Absagen</span></button>' +
        '</div>' +
        '</div>';
    }

    var reminderButton = (!isEmployeeStatus(evt) && participantIds.length && summary.pending > 0 && canManageEventRsvp(evt))
      ? '<button type="button" class="btn btn-secondary" id="calendar-modal-remind"><span class="material-symbols-rounded" aria-hidden="true">notifications_active</span><span>Erinnerung senden</span></button>'
      : '';

    var descriptionBlock = evt.description
      ? '<div class="calendar-detail-description"><h3>Beschreibung</h3><p>' + escapeHtml(evt.description) + '</p></div>'
      : '<div class="calendar-detail-description calendar-detail-description-muted"><h3>Beschreibung</h3><p>Keine Beschreibung hinterlegt.</p></div>';

    return '' +
      '<div class="calendar-detail-shell">' +
      '<div class="calendar-detail-hero" style="--detail-accent:' + meta.color + '">' +
      '<span class="calendar-event-tag" style="border-color:' + meta.color + ';color:' + meta.color + '"><span class="material-symbols-rounded" aria-hidden="true">' + meta.icon + '</span>' + escapeHtml(meta.label) + '</span>' +
      '<h2>' + escapeHtml(evt.title || 'Termin') + '</h2>' +
      '</div>' +
      '<div class="calendar-detail-grid">' + rows.join('') + '</div>' +
      participantsBlock +
      rsvpActionsBlock +
      descriptionBlock +
      '<div class="modal-actions">' +
      reminderButton +
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

    var attendeeCheckboxes = employees.map(function (emp) {
      var id = String(emp.id);
      var checked = attendeeIds.indexOf(id) !== -1 ? ' checked' : '';
      var name = emp.name || emp.title || id;
      return '<label class="calendar-attendee-option">' +
        '<input type="checkbox" name="evt-attendee" value="' + escapeHtml(id) + '"' + checked + '>' +
        '<span class="calendar-attendee-avatar" aria-hidden="true">' + escapeHtml(String(name).trim().charAt(0).toUpperCase() || '?') + '</span>' +
        '<span class="calendar-attendee-name">' + escapeHtml(name) + '</span>' +
        '</label>';
    }).join('');

    var typeOptions = EVENT_TYPE_ORDER.map(function (type) {
      var meta = getEventTypeMeta(type);
      var isSelected = event ? normalizeEventType(event.type || 'meeting') === type : type === 'meeting';
      return '<option value="' + type + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(meta.label) + '</option>';
    }).join('');

    return '' +
      '<h2>' + (editing ? 'Termin bearbeiten' : 'Neuer Termin') + '</h2>' +
      '<div class="calendar-modal-form">' +
      '<input type="hidden" id="evt-id" value="' + escapeHtml((event && event.id) || '') + '">' +
      '<input type="hidden" id="evt-created-at" value="' + escapeHtml((event && event.createdAt) || '') + '">' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-title">Titel *</label><input type="text" id="evt-title" value="' + escapeHtml((event && event.title) || '') + '" required></div>' +
      '<div class="form-group"><label for="evt-date">Beginn *</label><input type="date" id="evt-date" required value="' + escapeHtml((event && (event.date || event.startDate)) || defaultDate || '') + '"></div>' +
      '</div>' +
      '<div class="form-group"><label for="evt-end-date">Enddatum (einschliesslich, optional)</label><input type="date" id="evt-end-date" value="' + escapeHtml((event && event.endDate) || '') + '"><small class="text-muted">Mehrtägige Einträge sind ganztägig.</small></div>' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-start-time">Start</label><input type="time" id="evt-start-time" value="' + escapeHtml((event && event.startTime) || '') + '"></div>' +
      '<div class="form-group"><label for="evt-end-time">Ende</label><input type="time" id="evt-end-time" value="' + escapeHtml((event && event.endTime) || '') + '"></div>' +
      '</div>' +
      '<div class="calendar-modal-grid">' +
      '<div class="form-group"><label for="evt-type">Typ</label>' +
      '<select id="evt-type">' + typeOptions + '</select></div>' +
      '<div class="form-group" id="evt-project-group"><label for="evt-project">Projekt</label><select id="evt-project"><option value="">-- Kein Projekt --</option>' + projectOptions + '</select></div>' +
      '</div>' +
      '<div class="form-group" id="evt-location-group"><label for="evt-location">Ort</label><input type="text" id="evt-location" value="' + escapeHtml((event && event.location) || '') + '"></div>' +
      '<div class="form-group">' +
      '<label id="evt-attendee-label">Teilnehmer</label>' +
      '<div class="calendar-attendee-toolbar">' +
      '<button type="button" class="btn btn-secondary btn-compact" id="evt-attendees-project-team" title="Teammitglieder des gewaehlten Projekts auswaehlen"><span class="material-symbols-rounded" aria-hidden="true">diversity_3</span><span>Projektteam</span></button>' +
      '<button type="button" class="btn btn-secondary btn-compact" id="evt-attendees-all">Alle auswaehlen</button>' +
      '<button type="button" class="btn btn-secondary btn-compact" id="evt-attendees-none">Auswahl leeren</button>' +
      '<span class="calendar-attendee-selected-count" id="evt-attendee-count"></span>' +
      '</div>' +
      '<div class="calendar-attendee-list" id="evt-attendee-list">' + (attendeeCheckboxes || '<p class="text-muted">Keine Mitarbeiter angelegt.</p>') + '</div>' +
      '<small class="text-muted" id="evt-attendee-hint">Neue Teilnehmer erhalten den Status "Ausstehend" und koennen den Termin zu- oder absagen.</small>' +
      '</div>' +
      '<div class="form-group" id="evt-description-group"><label for="evt-description">Beschreibung</label><textarea id="evt-description" rows="3">' + escapeHtml((event && event.description) || '') + '</textarea></div>' +
      '<p class="text-muted hidden" id="evt-sick-notice">Krankmeldungen sind im gemeinsamen Kalender und dessen Daten für alle angemeldeten Nutzer sichtbar. Keine Diagnosen oder medizinischen Details eintragen.</p>' +
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

    var remindBtn = document.getElementById('calendar-modal-remind');
    if (remindBtn) {
      remindBtn.addEventListener('click', function () {
        sendRsvpReminder(event.id);
      });
    }

    Array.prototype.forEach.call(content.querySelectorAll('.calendar-rsvp-actions .calendar-rsvp-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var status = btn.getAttribute('data-rsvp');
        if (!status) return;
        if (respondToEvent(event.id, status)) {
          openEventDetailsModal(event.id);
        }
      });
    });
  }

  function openEventEditorModal(eventId, defaultDate, modalOptions) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var auth = getAuthManager();
    var event = eventId ? getCalendarEvents().find(function (evt) { return evt.id === eventId; }) : null;
    if (event && event.source === 'github-commit') {
      alert('GitHub-Commit-Eintraege werden aus der Aufgabe erzeugt und koennen hier nicht bearbeitet werden.');
      return;
    }
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

    setupAttendeePicker();
    setupEventEditor(event);

    var titleField = document.getElementById('evt-title');
    if (titleField && titleField.focus) titleField.focus();
  }

  function setupEventEditor(event) {
    var typeEl = document.getElementById('evt-type');
    var allDayEl = document.getElementById('evt-all-day');
    var titleEl = document.getElementById('evt-title');
    var label = document.getElementById('evt-attendee-label');
    var hint = document.getElementById('evt-attendee-hint');
    var notice = document.getElementById('evt-sick-notice');
    var descriptionGroup = document.getElementById('evt-description-group');
    var locationGroup = document.getElementById('evt-location-group');
    var projectGroup = document.getElementById('evt-project-group');
    var projectTeamButton = document.getElementById('evt-attendees-project-team');
    var startTime = document.getElementById('evt-start-time');
    var endTime = document.getElementById('evt-end-time');

    function updateTimeFields() {
      startTime.disabled = allDayEl.checked;
      endTime.disabled = allDayEl.checked;
    }

    function updateType() {
      var type = typeEl.value;
      var status = type === 'sick' || type === 'home-office' || (type === 'holiday' && (!event || event.type !== 'holiday' || event.employeeStatus === true));
      var sick = type === 'sick';
      label.textContent = status ? 'Betroffene Mitarbeiter *' : 'Teilnehmer';
      hint.textContent = status ? 'Mitarbeiter werden ohne Einladung oder Teilnahmebestaetigung eingetragen.' : 'Neue Teilnehmer erhalten den Status "Ausstehend" und koennen den Termin zu- oder absagen.';
      notice.classList.toggle('hidden', !sick);
      descriptionGroup.classList.toggle('hidden', sick);
      locationGroup.classList.toggle('hidden', sick);
      projectGroup.classList.toggle('hidden', sick);
      projectTeamButton.classList.toggle('hidden', sick);
      titleEl.readOnly = sick;
      if (sick) titleEl.value = 'Krankmeldung';
    }

    typeEl.addEventListener('change', function () {
      if (typeEl.value === 'sick' || typeEl.value === 'holiday' || typeEl.value === 'home-office') {
        allDayEl.checked = true;
        if (!titleEl.value || titleEl.value === 'Krankmeldung') titleEl.value = getEventTypeMeta(typeEl.value).label;
        if (!event && !getAttendeeCheckboxes().some(function (cb) { return cb.checked; })) {
          var currentUser = getCurrentUser();
          var defaultId = selectedEmployeeId && selectedEmployeeId !== UNASSIGNED_FILTER_VALUE ? selectedEmployeeId : (currentUser && String(currentUser.id));
          getAttendeeCheckboxes().forEach(function (cb) { if (cb.value === defaultId) cb.checked = true; });
          updateAttendeeSelectedCount();
        }
      } else if (titleEl.value === 'Krankmeldung') {
        titleEl.value = '';
      }
      updateType();
      updateTimeFields();
    });
    allDayEl.addEventListener('change', updateTimeFields);
    updateType();
    updateTimeFields();
  }

  function getAttendeeCheckboxes() {
    var list = document.getElementById('evt-attendee-list');
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll('input[name="evt-attendee"]'));
  }

  function updateAttendeeSelectedCount() {
    var countEl = document.getElementById('evt-attendee-count');
    if (!countEl) return;
    var selected = getAttendeeCheckboxes().filter(function (cb) { return cb.checked; }).length;
    countEl.textContent = selected ? selected + ' ausgewaehlt' : 'Keine Auswahl';
  }

  function setupAttendeePicker() {
    var checkboxes = getAttendeeCheckboxes();
    checkboxes.forEach(function (cb) {
      cb.addEventListener('change', updateAttendeeSelectedCount);
    });
    updateAttendeeSelectedCount();

    var allBtn = document.getElementById('evt-attendees-all');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        getAttendeeCheckboxes().forEach(function (cb) { cb.checked = true; });
        updateAttendeeSelectedCount();
      });
    }

    var noneBtn = document.getElementById('evt-attendees-none');
    if (noneBtn) {
      noneBtn.addEventListener('click', function () {
        getAttendeeCheckboxes().forEach(function (cb) { cb.checked = false; });
        updateAttendeeSelectedCount();
      });
    }

    var teamBtn = document.getElementById('evt-attendees-project-team');
    if (teamBtn) {
      teamBtn.addEventListener('click', function () {
        var projectEl = document.getElementById('evt-project');
        var projectId = projectEl ? projectEl.value : '';
        if (!projectId) {
          alert('Bitte zuerst ein Projekt auswaehlen, um dessen Team zu uebernehmen.');
          return;
        }
        var project = window.DataLayer && window.DataLayer.getProjectById ? window.DataLayer.getProjectById(projectId) : null;
        var teamIds = project && Array.isArray(project.teamMembers)
          ? project.teamMembers.map(function (member) { return String(member && member.employeeId || ''); }).filter(Boolean)
          : [];
        if (!teamIds.length) {
          alert('Das gewaehlte Projekt hat keine Teammitglieder.');
          return;
        }
        getAttendeeCheckboxes().forEach(function (cb) {
          if (teamIds.indexOf(String(cb.value)) !== -1) cb.checked = true;
        });
        updateAttendeeSelectedCount();
      });
    }
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
        if (eventToMove.endDate) {
          var oldStart = new Date((eventToMove.date || eventToMove.startDate) + 'T12:00:00');
          var oldEnd = new Date(eventToMove.endDate + 'T12:00:00');
          var movedEnd = new Date(dateStr + 'T12:00:00');
          movedEnd.setDate(movedEnd.getDate() + Math.round((Date.UTC(oldEnd.getFullYear(), oldEnd.getMonth(), oldEnd.getDate()) - Date.UTC(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate())) / 86400000));
          eventToMove.endDate = getISODate(movedEnd);
        }
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

  function buildWorkflowDays(activities, events, commitDates) {
    var days = Object.create(null);
    var allTaskDays = Object.create(null);
    var visibleTaskDays = Object.create(null);

    function dayFor(date) {
      if (!days[date]) days[date] = { activities: [], commits: [], items: [] };
      return days[date];
    }

    events.forEach(function (event) {
      if (event.source !== 'github-commit') return;
      var date = String(event.date || event.startDate || '');
      if (!date) return;
      var taskKey = String(event.taskId || '') + '\n' + date;
      if (event.taskId) allTaskDays[taskKey] = true;
      if (!eventMatchesEmployeeFilter(event, selectedEmployeeId)) return;
      if (event.taskId) visibleTaskDays[taskKey] = true;
      dayFor(date).commits.push(event);
    });

    activities.forEach(function (activity) {
      var taskKey = String(activity.taskId || '') + '\n' + activity.date;
      var represented = activity.type === 'github-commit' && allTaskDays[taskKey];
      if (represented && !visibleTaskDays[taskKey]) return;
      var day = dayFor(activity.date);
      day.activities.push(activity);
      if (!represented) day.items.push(activity);
    });

    Object.keys(days).forEach(function (date) {
      var day = days[date];
      day.items = day.items.concat(groupCommitEvents(day.commits, commitDates));
      day.items.sort(function (a, b) {
        function time(item) {
          return item.commitGroup ? String(item.events[0].startTime || '') :
            String(item.calendarTime || getDisplayTime(item.updatedAt) || '');
        }
        return time(b).localeCompare(time(a));
      });
    });
    return days;
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

      var allEvents = getCalendarEvents();
      var appointmentEvents = filterAppointmentEvents(allEvents);
      var visibleEvents = filterEventsByType(filterEventsByEmployee(appointmentEvents.slice().sort(sortEvents)));
      var bounds = monthBounds(currentViewDate);
      var legendEvents = filterEventsByEmployee(appointmentEvents).filter(function (evt) {
        return eventOverlaps(evt, bounds.start, bounds.end);
      });
      renderTypeLegend(legendEvents);
      renderPendingInvites();
      var activityEntries = buildTaskActivityEntries();
      var commitDates = isActivityMode ? getCommitEventDates() : null;
      var workflowDays = isActivityMode ? buildWorkflowDays(activityEntries, allEvents, commitDates) : null;
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
        var dayItems = isActivityMode ? (workflowDays[dateStr] ? workflowDays[dateStr].items : []) : visibleEvents.filter(function (item) {
          return eventOverlaps(item, dateStr, dateStr);
        });

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
          eventList.appendChild(item.commitGroup ? createCommitGroup(item, true, isActivityMode) : (isActivityMode ? createDayActivityChip(item) : createDayEventChip(item)));
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

      if (isActivityMode) renderActivityList(currentViewDate, activityEntries, workflowDays);
      else renderEventList(currentViewDate, visibleEvents);
    } catch (err) {
      console.error('[Calendar] Error:', err);
    }
  }

  function renderEventList(viewDate, events) {
    var listEl = document.getElementById('calendar-events-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    var bounds = monthBounds(viewDate);
    var monthEvents = events.filter(function (evt) { return eventOverlaps(evt, bounds.start, bounds.end); });

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

      var meta = getEventTypeMeta(normalizeEventType(evt.type || 'meeting'));
      var participants = getEventParticipants(evt).map(getEmployeeName);
      var projectLabel = getProjectLabel(evt.projectId);
      var summary = getRsvpSummary(evt);
      var details = [];

      if (evt.location) details.push('<div><strong>Ort:</strong> ' + escapeHtml(evt.location) + '</div>');
      if (projectLabel) details.push('<div><strong>Projekt:</strong> ' + escapeHtml(projectLabel) + '</div>');
      if (participants.length) details.push('<div><strong>Mitarbeiter:</strong> ' + escapeHtml(participants.join(', ')) + '</div>');
      if (evt.description) details.push('<div><strong>Hinweis:</strong> ' + escapeHtml(evt.description) + '</div>');

      var rsvpBlock = summary.total > 0 && !isEmployeeStatus(evt)
        ? '<div class="calendar-event-card-rsvp">' +
          '<span class="calendar-rsvp-pill calendar-rsvp-pill-accepted" title="Zusagen"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span>' + summary.accepted + '</span>' +
          '<span class="calendar-rsvp-pill calendar-rsvp-pill-tentative" title="Vielleicht"><span class="material-symbols-rounded" aria-hidden="true">help</span>' + summary.tentative + '</span>' +
          '<span class="calendar-rsvp-pill calendar-rsvp-pill-declined" title="Absagen"><span class="material-symbols-rounded" aria-hidden="true">cancel</span>' + summary.declined + '</span>' +
          '<span class="calendar-rsvp-pill calendar-rsvp-pill-pending" title="Ausstehend"><span class="material-symbols-rounded" aria-hidden="true">schedule</span>' + summary.pending + '</span>' +
          '</div>'
        : '';

      card.innerHTML = '' +
        '<div class="calendar-event-card-head">' +
        '<span class="calendar-event-tag" style="border-color:' + meta.color + ';color:' + meta.color + '"><span class="material-symbols-rounded" aria-hidden="true">' + meta.icon + '</span>' + escapeHtml(meta.label) + '</span>' +
        '<span class="calendar-event-date">' + escapeHtml(eventDateLabel(evt)) + '</span>' +
        '</div>' +
        '<h3>' + escapeHtml(evt.title || 'Termin') + '</h3>' +
        '<div class="calendar-event-meta">' + escapeHtml(evt.allDay ? 'Ganztag' : ((evt.startTime ? evt.startTime : '') + (evt.endTime ? (' - ' + evt.endTime) : ''))) + '</div>' +
        rsvpBlock +
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
      (activity.assigneeIds || (activity.assigneeId ? [activity.assigneeId] : [])).forEach(function (id) { uniqueEmployeeIds[id] = true; });
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

  function renderActivityList(viewDate, activities, workflowDays) {
    var listEl = document.getElementById('calendar-events-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    workflowDays = workflowDays || buildWorkflowDays(activities, getCalendarEvents(), getCommitEventDates());
    var monthDates = Object.keys(workflowDays).filter(function (date) { return isDateInMonth(date, viewDate); }).sort().reverse();
    var monthActivities = [];
    monthDates.forEach(function (date) { monthActivities = monthActivities.concat(workflowDays[date].activities); });

    var heading = document.createElement('div');
    heading.className = 'calendar-events-list-heading';
    heading.textContent = 'Arbeitsfluss im ' + getMonthLabel(viewDate) + (getSelectedEmployeeName() ? ' - ' + getSelectedEmployeeName() : '');
    listEl.appendChild(heading);

    if (!monthDates.length) {
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

    monthDates.forEach(function (dateKey) {
      var dailyActivities = workflowDays[dateKey].activities;
      var uniqueEmployees = Object.create(null);
      var completedToday = 0;

      dailyActivities.forEach(function (activity) {
        (activity.assigneeIds || (activity.assigneeId ? [activity.assigneeId] : [])).forEach(function (id) { uniqueEmployees[id] = true; });
        if (activity.type === 'completed') completedToday += 1;
      });

      var dayHeading = document.createElement('div');
      dayHeading.className = 'calendar-activity-day-heading';
      dayHeading.innerHTML = '' +
        '<strong>' + escapeHtml(getDisplayDate(dateKey)) + '</strong>' +
        '<span>' + dailyActivities.length + ' Aktivitaeten</span>' +
        (workflowDays[dateKey].commits.length ? '<span>' + workflowDays[dateKey].commits.length + ' Commits</span>' : '') +
        '<span>' + Object.keys(uniqueEmployees).length + ' Mitarbeiter</span>' +
        '<span>' + completedToday + ' erledigt</span>';
      listEl.appendChild(dayHeading);

      workflowDays[dateKey].items.forEach(function (activity) {
        if (activity.commitGroup) {
          listEl.appendChild(createCommitGroup(activity, false, true));
          return;
        }
        var card = document.createElement('article');
        var typeMeta = getActivityTypeMeta(activity.type);
        var assigneeIds = Array.isArray(activity.assigneeIds) && activity.assigneeIds.length ? activity.assigneeIds : (activity.assigneeId ? [activity.assigneeId] : []);
        var assigneeName = assigneeIds.length ? assigneeIds.map(getEmployeeName).join(', ') : 'Nicht zugewiesen';
        var workplace = assigneeIds.length === 1 ? getEmployeeWorkplace(assigneeIds[0]) : '';
        var projectLabel = getProjectLabel(activity.projectId, 'Unbekanntes Projekt') || 'Ohne Projekt';
        var displayTime = activity.calendarTime || getDisplayTime(activity.updatedAt);
        var totalProgress = clampProgress(activity.progress);
        var dayStart = clampProgress(activity.dayStartProgress);
        var dayGain = Math.max(0, totalProgress - dayStart);

        card.className = 'calendar-event-card calendar-activity-card';
        card.innerHTML = '' +
          '<div class="calendar-event-card-head">' +
          '<span class="calendar-event-tag" style="border-color:' + typeMeta.color + ';color:' + typeMeta.color + '">' + escapeHtml(typeMeta.label) + '</span>' +
          '<span class="calendar-event-date">' + escapeHtml(getTaskStatusLabel(activity.status)) + '</span>' +
          '</div>' +
          '<div class="calendar-activity-project" title="' + escapeHtml(activity.projectId ? 'Projekt: ' + projectLabel : projectLabel) + '"><span class="material-symbols-rounded" aria-hidden="true">folder</span><span>' + escapeHtml(activity.projectId ? 'Projekt: ' + projectLabel : projectLabel) + '</span></div>' +
          '<h3>' + escapeHtml(activity.taskTitle || 'Aufgabe') + '</h3>' +
          '<div class="calendar-event-meta">' + escapeHtml(assigneeName) + '</div>' +
          (workplace ? '<div class="calendar-activity-workplace"><span class="material-symbols-rounded" aria-hidden="true">location_on</span><span>' + escapeHtml(workplace) + '</span></div>' : '') +
          '<div class="calendar-activity-progress-row"><span>Gesamtfortschritt</span><strong>' + escapeHtml(String(totalProgress)) + '%</strong></div>' +
          '<div class="calendar-activity-growth-bar" aria-hidden="true">' +
          '<span class="calendar-activity-growth-total" style="width:' + totalProgress + '%"></span>' +
          '</div>' +
          (activity.type === 'github-commit'
            ? '<div class="calendar-activity-progress-row calendar-activity-progress-row-sub">Rueckwirkende Dokumentation; keine Arbeitsdauer erfasst.</div>'
            : '<div class="calendar-activity-progress-row calendar-activity-progress-row-sub"><span>Plus</span><strong class="calendar-progress-today">+' + escapeHtml(String(dayGain)) + '%</strong></div>') +
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
      var endDateEl = document.getElementById('evt-end-date');
      var startEl = document.getElementById('evt-start-time');
      var endEl = document.getElementById('evt-end-time');
      var typeEl = document.getElementById('evt-type');
      var locationEl = document.getElementById('evt-location');
      var descriptionEl = document.getElementById('evt-description');
      var projectEl = document.getElementById('evt-project');
      var allDayEl = document.getElementById('evt-all-day');
      var idEl = document.getElementById('evt-id');
      var createdAtEl = document.getElementById('evt-created-at');

      var title = titleEl ? titleEl.value.trim() : '';
      if (!title) {
        alert('Titel erforderlich');
        return;
      }

      var attendeeIds = [];
      getAttendeeCheckboxes().forEach(function (cb) {
        if (cb.checked) attendeeIds.push(cb.value);
      });

      var existingId = idEl ? idEl.value : '';
      var existingEvent = existingId ? window.DataLayer.getCalendarEventById(existingId) : null;
      if (existingId && !existingEvent) {
        alert('Der Termin wurde nicht gefunden.');
        return;
      }
      var type = typeEl ? typeEl.value : 'meeting';
      var status = type === 'sick' || type === 'home-office' || (type === 'holiday' && (!existingEvent || existingEvent.type !== 'holiday' || existingEvent.employeeStatus === true));
      var date = dateEl ? dateEl.value : '';
      var endDate = endDateEl ? endDateEl.value : '';
      var allDay = allDayEl && allDayEl.checked;
      if (!date) {
        alert('Bitte ein Beginn-Datum auswaehlen.');
        return;
      }
      if (endDate && endDate < date) {
        alert('Das Enddatum darf nicht vor dem Beginn liegen.');
        return;
      }
      if (endDate && endDate > date && !allDay) {
        alert('Mehrtägige Einträge muessen ganztägig sein.');
        return;
      }
      if (!allDay && startEl.value && endEl.value && endEl.value <= startEl.value) {
        alert('Die Endzeit muss nach der Startzeit liegen.');
        return;
      }
      if (status && !attendeeIds.length) {
        alert('Bitte mindestens einen Mitarbeiter auswaehlen.');
        return;
      }

      var payload = {
        title: type === 'sick' ? 'Krankmeldung' : title,
        date: date,
        startDate: date,
        endDate: endDate || '',
        type: type,
        employeeStatus: status,
        projectId: type !== 'sick' && projectEl && projectEl.value ? projectEl.value : null,
        location: type !== 'sick' && locationEl ? locationEl.value.trim() : '',
        description: type !== 'sick' && descriptionEl ? descriptionEl.value.trim() : '',
        startTime: !allDay && startEl ? startEl.value : '',
        endTime: !allDay && endEl ? endEl.value : '',
        allDay: !!allDay,
        attendeeIds: attendeeIds,
        createdAt: createdAtEl && createdAtEl.value ? createdAtEl.value : new Date().toISOString()
      };

      if (existingId) {
        payload = Object.assign({}, existingEvent, payload);
        payload.id = existingId;
        if (auth && typeof auth.canEditCalendarEvent === 'function') {
          if (!auth.canEditCalendarEvent(existingEvent)) {
            alert('Dieser Termin kann nur gelesen werden.');
            return;
          }
        }
        // Bestehende Antworten der weiterhin eingeladenen Teilnehmer uebernehmen
        payload.createdByEmployeeId = existingEvent && existingEvent.createdByEmployeeId || '';
        var previousResponses = existingEvent && existingEvent.responses && typeof existingEvent.responses === 'object' ? existingEvent.responses : {};
        var nextResponses = {};
        if (!status && !isEmployeeStatus(existingEvent)) {
          attendeeIds.forEach(function (id) {
            if (previousResponses[id]) nextResponses[id] = previousResponses[id];
          });
        }
        payload.responses = nextResponses;
        if (!window.DataLayer.updateCalendarEvent(payload)) {
          alert('Der Termin konnte nicht gespeichert werden.');
          return;
        }

        var newAttendees = attendeeIds.filter(function (id) {
          return isEmployeeStatus(existingEvent) || getEventParticipants(existingEvent).indexOf(String(id)) === -1;
        });
        if (newAttendees.length && !status) {
          pushNotification('calendar', 'Termineinladung "' + title + '" am ' + getDisplayDate(payload.date) + ' an: ' + newAttendees.map(getEmployeeName).join(', '));
        }
      } else {
        if (auth && typeof auth.canCreateCalendarEvent === 'function' && !auth.canCreateCalendarEvent()) {
          alert('Gastnutzer koennen keine Termine anlegen.');
          return;
        }
        var currentUser = getCurrentUser();
        if (currentUser) payload.createdByEmployeeId = String(currentUser.id);
        payload.responses = {};
        if (!window.DataLayer.createCalendarEvent(payload)) {
          alert('Der Termin konnte nicht gespeichert werden.');
          return;
        }
        if (attendeeIds.length && !status) {
          pushNotification('calendar', 'Neuer Termin "' + title + '" am ' + getDisplayDate(payload.date) + ' - Einladung an: ' + attendeeIds.map(getEmployeeName).join(', '));
        }
      }

      closeModal();
      renderCalendar(currentViewDate);
    } catch (err) {
      console.error('[Save Event]', err);
      alert('Der Termin konnte nicht gespeichert werden.');
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
        if (!window.DataLayer.deleteCalendarEvent(existingId)) {
          alert('Der Termin konnte nicht geloescht werden.');
          return;
        }
      }
      closeModal();
      renderCalendar(currentViewDate);
    } catch (err) {
      console.error('[Delete Event]', err);
      alert('Der Termin konnte nicht geloescht werden.');
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

  function escapeICSText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function formatICSDateTime(dateStr, timeStr) {
    var compactDate = String(dateStr || '').replace(/-/g, '');
    if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
      return compactDate + 'T' + timeStr.replace(':', '') + '00';
    }
    return compactDate;
  }

  function exportICS() {
    try {
      var events = filterEventsByType(filterEventsByEmployee(filterAppointmentEvents(getCalendarEvents())));
      if (!events.length) {
        alert('Keine Events zum Exportieren.');
        return;
      }

      var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Projekt-Dashboard//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

      events.forEach(function (evt) {
        var dateStr = evt.date || evt.startDate;
        if (!dateStr) return;
        var hasTime = !evt.allDay && evt.startTime;

        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + escapeICSText(evt.id || ('evt-' + Math.random().toString(36).slice(2))) + '@projekt-dashboard');
        lines.push('DTSTAMP:' + stamp);
        if (hasTime) {
          lines.push('DTSTART:' + formatICSDateTime(dateStr, evt.startTime));
          if (evt.endTime) lines.push('DTEND:' + formatICSDateTime(dateStr, evt.endTime));
        } else {
          lines.push('DTSTART;VALUE=DATE:' + formatICSDateTime(dateStr));
          if (evt.endDate && evt.endDate >= dateStr) {
            var exclusiveEnd = new Date(evt.endDate + 'T12:00:00');
            exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
            lines.push('DTEND;VALUE=DATE:' + formatICSDateTime(getISODate(exclusiveEnd)));
          }
        }
        lines.push('SUMMARY:' + escapeICSText(evt.title || 'Termin'));
        if (evt.location) lines.push('LOCATION:' + escapeICSText(evt.location));
        var exportDescription = evt.description || '';
        if (isEmployeeStatus(evt)) {
          exportDescription = 'Mitarbeiter: ' + getEventParticipants(evt).map(getEmployeeName).join(', ') + (exportDescription ? '\n' + exportDescription : '');
        }
        if (exportDescription) lines.push('DESCRIPTION:' + escapeICSText(exportDescription));
        if (evt.type) lines.push('CATEGORIES:' + escapeICSText(getEventTypeMeta(normalizeEventType(evt.type)).label.toUpperCase()));
        if (!isEmployeeStatus(evt)) getEventParticipants(evt).forEach(function (id) {
          lines.push('ATTENDEE;CN=' + escapeICSText(getEmployeeName(id)) + ':MAILTO:noreply@projekt-dashboard.local');
        });
        lines.push('END:VEVENT');
      });

      lines.push('END:VCALENDAR');
      var ics = lines.join('\r\n');

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

    var todayBtn = document.getElementById('cal-today');
    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        renderCalendar(new Date());
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
    respond: respondToEvent,
    applyInviteUrgency: applyInviteUrgency,
    setMode: function (mode) {
      currentCalendarMode = mode === CALENDAR_MODE_ACTIVITY ? CALENDAR_MODE_ACTIVITY : CALENDAR_MODE_EVENTS;
      renderCalendar(currentViewDate);
    }
  };
})();

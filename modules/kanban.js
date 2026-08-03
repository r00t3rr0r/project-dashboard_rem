(function() {
  'use strict';

  var NAMESPACE = 'KanbanBoard';

  // --- Konfiguration ---
  var COLUMNS = ['backlog', 'todo', 'in-progress', 'review', 'done'];
  var WIP_LIMITS = {};
  var WORKDAY_HOURS = 8;
  var STATUS_META = {
    backlog: { label: 'Backlog', icon: 'inventory_2' },
    todo: { label: 'To Do', icon: 'checklist' },
    'in-progress': { label: 'In Arbeit', icon: 'play_circle' },
    review: { label: 'Review', icon: 'rate_review' },
    done: { label: 'Erledigt', icon: 'task_alt' }
  };

  // --- Filter-Zustand ---
  var filterAssigneeId = '';
  var filterPriority = '';
  var filterUrgency = '';
  var filterProjectId = '';
  var currentKanbanView = 'board';
  var currentCardMode = 'full';

  var currentTaskDraft = null;
  var currentTaskChainDraft = null;
  var UNASSIGNED_FILTER_VALUE = '__unassigned__';
  var LIVE_REFRESH_INTERVAL_MS = 30000;
  var liveRefreshHandle = null;
  var pauseDialogState = null;
  var skipNextTaskRender = false;
  var MAX_TASK_ATTACHMENT_SIZE = 1024 * 1024;
  var MAX_TOTAL_TASK_ATTACHMENT_SIZE = 6 * 1024 * 1024;

  function getAuthManager() {
    return window.AuthManager || null;
  }

  // --- escapeHtml ---
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return 'rgba(94,162,255,' + alpha + ')';
    var normalized = hex.replace('#', '');
    if (normalized.length === 3) {
      normalized = normalized.split('').map(function (char) { return char + char; }).join('');
    }
    if (normalized.length !== 6) return 'rgba(94,162,255,' + alpha + ')';
    var red = parseInt(normalized.slice(0, 2), 16);
    var green = parseInt(normalized.slice(2, 4), 16);
    var blue = parseInt(normalized.slice(4, 6), 16);
    return 'rgba(' + red + ',' + green + ',' + blue + ',' + alpha + ')';
  }

  function formatHours(value) {
    var amount = Math.round((Number(value) || 0) * 10) / 10;
    if (amount % 1 === 0) return String(amount).replace('.', ',') + ' h';
    return amount.toFixed(1).replace('.', ',') + ' h';
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB';
    return (Math.round((value / (1024 * 1024)) * 10) / 10) + ' MB';
  }

  function getTaskAttachmentTotalSize(attachments) {
    return (attachments || []).reduce(function (sum, item) {
      return sum + (Number(item && item.size) || 0);
    }, 0);
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (event) { resolve(event.target.result); };
      reader.onerror = function () { reject(new Error('Datei konnte nicht gelesen werden.')); };
      reader.readAsDataURL(file);
    });
  }

  function toDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
    return '';
  }

  function getTodayDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getNowIsoString() {
    return new Date().toISOString();
  }

  function roundMinutes(value) {
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function normalizeTaskProgress(value, fallback) {
    var source = Number(value);
    if (isNaN(source)) source = Number(fallback);
    if (isNaN(source)) source = 0;
    return Math.max(0, Math.min(100, Math.round(source)));
  }

  function formatDurationMinutes(totalMinutes) {
    var safeMinutes = roundMinutes(totalMinutes);
    var hours = Math.floor(safeMinutes / 60);
    var minutes = safeMinutes % 60;
    if (hours <= 0) return minutes + ' min';
    return hours + ' h ' + String(minutes).padStart(2, '0') + ' min';
  }

  function getTaskTimeTracking(task) {
    var tracking = task && task.timeTracking && typeof task.timeTracking === 'object' ? task.timeTracking : {};
    if (!tracking.minutesByDate || typeof tracking.minutesByDate !== 'object') tracking.minutesByDate = {};
    if (!Array.isArray(tracking.pauseHistory)) tracking.pauseHistory = [];
    if (typeof tracking.totalMinutes !== 'number' || isNaN(tracking.totalMinutes)) tracking.totalMinutes = 0;
    if (typeof tracking.activeStartedAt !== 'string') tracking.activeStartedAt = '';
    if (typeof tracking.pausedAt !== 'string') tracking.pausedAt = '';
    tracking.isPaused = !!tracking.isPaused;
    tracking.pauseReasonPending = !!tracking.pauseReasonPending;
    if (typeof tracking.lastPauseReason !== 'string') tracking.lastPauseReason = '';
    task.timeTracking = tracking;
    return tracking;
  }

  function distributeMinutesByDate(startIso, endIso) {
    var start = new Date(startIso);
    var end = new Date(endIso);
    var distribution = [];
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return distribution;

    var cursor = new Date(start.getTime());
    while (cursor < end) {
      var dayEnd = new Date(cursor.getTime());
      dayEnd.setUTCHours(24, 0, 0, 0);
      var sliceEnd = dayEnd < end ? dayEnd : end;
      distribution.push({
        date: cursor.toISOString().slice(0, 10),
        minutes: (sliceEnd.getTime() - cursor.getTime()) / 60000
      });
      cursor = new Date(sliceEnd.getTime());
    }

    return distribution;
  }

  function appendTrackedMinutes(task, startIso, endIso) {
    var tracking = getTaskTimeTracking(task);
    var parts = distributeMinutesByDate(startIso, endIso);
    var addedMinutes = 0;

    parts.forEach(function (part) {
      var rounded = roundMinutes(part.minutes);
      if (rounded <= 0) return;
      tracking.minutesByDate[part.date] = roundMinutes(tracking.minutesByDate[part.date]) + rounded;
      addedMinutes += rounded;
    });

    tracking.totalMinutes = roundMinutes(tracking.totalMinutes) + addedMinutes;
    return addedMinutes;
  }

  function captureActiveSession(task, endIso, keepActive) {
    var tracking = getTaskTimeTracking(task);
    if (!tracking.activeStartedAt || tracking.isPaused) return 0;
    var endValue = endIso || getNowIsoString();
    var added = appendTrackedMinutes(task, tracking.activeStartedAt, endValue);
    tracking.activeStartedAt = keepActive ? endValue : '';
    return added;
  }

  function getLiveActiveMinutes(task, nowIso) {
    var tracking = getTaskTimeTracking(task);
    if (!tracking.activeStartedAt || tracking.isPaused || task.status !== 'in-progress') return 0;
    var now = new Date(nowIso || getNowIsoString());
    var started = new Date(tracking.activeStartedAt);
    if (isNaN(now.getTime()) || isNaN(started.getTime()) || now <= started) return 0;
    return Math.floor((now.getTime() - started.getTime()) / 60000);
  }

  function getTaskTrackedMinutes(task, nowIso) {
    var tracking = getTaskTimeTracking(task);
    return roundMinutes(tracking.totalMinutes) + getLiveActiveMinutes(task, nowIso);
  }

  function getTaskTrackedMinutesToday(task, nowIso) {
    var tracking = getTaskTimeTracking(task);
    var todayKey = getTodayDateKey();
    var storedMinutes = roundMinutes(tracking.minutesByDate[todayKey]);
    var liveMinutes = 0;

    if (tracking.activeStartedAt && !tracking.isPaused && task.status === 'in-progress') {
      var now = new Date(nowIso || getNowIsoString());
      var started = new Date(tracking.activeStartedAt);
      if (!isNaN(now.getTime()) && !isNaN(started.getTime()) && now > started) {
        var todayStart = new Date(now.getTime());
        todayStart.setUTCHours(0, 0, 0, 0);
        var effectiveStart = started > todayStart ? started : todayStart;
        if (now > effectiveStart) {
          liveMinutes = Math.floor((now.getTime() - effectiveStart.getTime()) / 60000);
        }
      }
    }

    return storedMinutes + liveMinutes;
  }

  function getTaskPlannedMinutes(task) {
    return Math.max(0, Math.round((Number(task && task.effortHours) || 0) * 60));
  }

  function getTaskRemainingMinutes(task, nowIso) {
    var plannedMinutes = getTaskPlannedMinutes(task);
    if (plannedMinutes <= 0) return 0;
    return Math.max(0, plannedMinutes - getTaskTrackedMinutes(task, nowIso));
  }

  function getTaskWorkdayPercent(minutes) {
    return Math.max(0, Math.min(160, Math.round((roundMinutes(minutes) / (WORKDAY_HOURS * 60)) * 100)));
  }

  function getTaskTimingState(task) {
    var tracking = getTaskTimeTracking(task);
    if (task.status !== 'in-progress') return 'idle';
    if (tracking.isPaused) return 'paused';
    if (tracking.activeStartedAt) return 'running';
    return 'idle';
  }

  function buildTaskEffortSnapshot(task, nowIso) {
    var plannedMinutes = getTaskPlannedMinutes(task);
    var trackedToday = getTaskTrackedMinutesToday(task, nowIso);
    var trackedTotal = getTaskTrackedMinutes(task, nowIso);
    var remainingMinutes = getTaskRemainingMinutes(task, nowIso);
    var timingState = getTaskTimingState(task);
    var tracking = getTaskTimeTracking(task);
    var pauseHint = '';
    var remainingSharePercent = plannedMinutes > 0
      ? Math.round((remainingMinutes / plannedMinutes) * 100)
      : 0;

    if (timingState === 'paused') {
      pauseHint = tracking.lastPauseReason ? 'Pausiert: ' + tracking.lastPauseReason : 'Pausiert: Grund folgt';
    } else if (timingState === 'running') {
      pauseHint = 'Bearbeitet gesamt ' + formatDurationMinutes(trackedTotal);
    }

    return {
      allocationPercent: getTaskWorkdayPercent(plannedMinutes),
      remainingPercent: getTaskWorkdayPercent(remainingMinutes),
      dayShareLabel: plannedMinutes > 0
        ? formatHours(plannedMinutes / 60) + ' von ' + WORKDAY_HOURS + ' h'
        : 'Aufwand offen',
      timingLabel: 'Heute ' + formatDurationMinutes(trackedToday),
      remainingLabel: plannedMinutes > 0
        ? 'Rest ' + formatDurationMinutes(remainingMinutes) + ' (' + remainingSharePercent + '%)'
        : 'Aufwand offen',
      pauseHint: pauseHint,
      state: timingState
    };
  }

  function startTaskWork(task, startIso) {
    var tracking = getTaskTimeTracking(task);
    tracking.isPaused = false;
    tracking.pausedAt = '';
    tracking.activeStartedAt = startIso || getNowIsoString();
  }

  function stopTaskWork(task, endIso) {
    var tracking = getTaskTimeTracking(task);
    captureActiveSession(task, endIso || getNowIsoString(), false);
    tracking.activeStartedAt = '';
    tracking.isPaused = false;
    tracking.pausedAt = '';
  }

  function pauseTaskWork(task, reason, pausedIso) {
    var tracking = getTaskTimeTracking(task);
    var nowIso = pausedIso || getNowIsoString();
    captureActiveSession(task, nowIso, false);
    tracking.isPaused = true;
    tracking.pausedAt = nowIso;
    tracking.pauseReasonPending = !reason;
    tracking.lastPauseReason = reason || '';
    tracking.pauseHistory.push({
      id: window.DataLayer.generateId(),
      pausedAt: nowIso,
      resumedAt: '',
      reason: reason || '',
      notedLater: !reason
    });
  }

  function resumeTaskWork(task, reason, resumeIso) {
    var tracking = getTaskTimeTracking(task);
    var nowIso = resumeIso || getNowIsoString();
    var latestPause = null;
    var index;

    for (index = tracking.pauseHistory.length - 1; index >= 0; index--) {
      if (!tracking.pauseHistory[index].resumedAt) {
        latestPause = tracking.pauseHistory[index];
        break;
      }
    }

    if (latestPause) {
      latestPause.resumedAt = nowIso;
      if (reason) {
        latestPause.reason = reason;
        latestPause.notedLater = false;
      }
    }

    tracking.pauseReasonPending = false;
    if (reason) tracking.lastPauseReason = reason;
    tracking.isPaused = false;
    tracking.pausedAt = '';
    tracking.activeStartedAt = nowIso;
  }

  function closePauseReasonModal() {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (overlay) overlay.classList.add('hidden');
    if (content) content.innerHTML = '';
    pauseDialogState = null;
  }

  function openPauseReasonModal(task, isResume, onSubmit) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    pauseDialogState = { taskId: task.id, isResume: isResume, onSubmit: onSubmit };

    content.innerHTML = '' +
      '<h2>' + (isResume ? 'Aufgabe fortsetzen' : 'Aufgabe unterbrechen') + '</h2>' +
      '<p class="text-muted">' + escapeHtml(task.title || 'Aufgabe') + '</p>' +
      '<div class="form-group">' +
      '  <label for="kanban-pause-reason-input">' + (isResume ? 'Pausengrund nachtragen' : 'Unterbrechungsgrund') + '</label>' +
      '  <textarea id="kanban-pause-reason-input" rows="3" placeholder="z. B. Rueckfrage, Meeting, Blocker"></textarea>' +
      '</div>' +
      '<p class="modal-hint">' + (isResume ? 'Zum Fortsetzen ist jetzt ein Grund erforderlich.' : 'Leer lassen, wenn der Grund erst beim Fortsetzen erfasst werden soll.') + '</p>' +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn btn-secondary" id="kanban-pause-cancel">Abbrechen</button>' +
      (isResume ? '' : '  <button type="button" class="btn btn-secondary" id="kanban-pause-later">Spaeter angeben</button>') +
      '  <button type="button" class="btn btn-primary" id="kanban-pause-confirm">' + (isResume ? 'Fortsetzen' : 'Jetzt pausieren') + '</button>' +
      '</div>';

    overlay.classList.remove('hidden');

    var cancelBtn = document.getElementById('kanban-pause-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closePauseReasonModal);

    var laterBtn = document.getElementById('kanban-pause-later');
    if (laterBtn) {
      laterBtn.addEventListener('click', function () {
        var submit = pauseDialogState && pauseDialogState.onSubmit;
        closePauseReasonModal();
        if (submit) submit('');
      });
    }

    var confirmBtn = document.getElementById('kanban-pause-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var input = document.getElementById('kanban-pause-reason-input');
        var reason = input ? input.value.trim() : '';
        if (isResume && !reason) {
          alert('Bitte den Pausengrund jetzt erfassen, bevor die Aufgabe fortgesetzt wird.');
          return;
        }
        var submit = pauseDialogState && pauseDialogState.onSubmit;
        closePauseReasonModal();
        if (submit) submit(reason);
      });
    }
  }

  function applyTaskStatusTransition(task, nextStatus, options) {
    if (!task || !nextStatus) return false;
    var settings = options || {};
    var nowIso = settings.at || getNowIsoString();
    var tracking = getTaskTimeTracking(task);
    var previousStatus = task.status;

    if (previousStatus === nextStatus && !settings.forceReopen) return false;

    if (previousStatus === 'in-progress' && nextStatus !== 'in-progress') {
      stopTaskWork(task, nowIso);
      tracking.pauseReasonPending = false;
    }

    task.status = nextStatus;

    if (nextStatus === 'in-progress' && previousStatus !== 'in-progress') {
      startTaskWork(task, nowIso);
    }

    if (nextStatus === 'done') {
      tracking.pauseReasonPending = false;
      task.progress = 100;
    }

    return true;
  }

  function persistTaskProgress(taskId, progressValue) {
    var task = window.DataLayer.getTaskById(taskId);
    if (!task) return false;

    var auth = getAuthManager();
    if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) return false;

    var nextProgress = normalizeTaskProgress(progressValue, task.progress);
    if (normalizeTaskProgress(task.progress, 0) === nextProgress) return false;

    task.progress = nextProgress;
    skipNextTaskRender = true;
    window.DataLayer.updateTask(task);
    return true;
  }

  function toggleTaskPause(taskId) {
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || task.status !== 'in-progress') return;
    var auth = getAuthManager();
    if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) return;
    var tracking = getTaskTimeTracking(task);

    if (!tracking.isPaused) {
      openPauseReasonModal(task, false, function (reason) {
        pauseTaskWork(task, String(reason || '').trim(), getNowIsoString());
        window.DataLayer.updateTask(task);
      });
      return;
    }

    if (tracking.pauseReasonPending) {
      openPauseReasonModal(task, true, function (reason) {
        resumeTaskWork(task, String(reason || '').trim(), getNowIsoString());
        window.DataLayer.updateTask(task);
      });
      return;
    }
    resumeTaskWork(task, '', getNowIsoString());
    window.DataLayer.updateTask(task);
  }

  function formatDateShort(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  function formatDateTimeShort(value) {
    if (!value) return 'n/a';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function askResolutionText(message, defaultValue) {
    var fallback = String(defaultValue || 'Blocker geloest');
    var quickOptions = [
      'Blocker geloest',
      'Freigabe erhalten',
      'Abhaengigkeit geklaert',
      'Ressourcen wieder verfuegbar'
    ];

    return new Promise(function(resolve) {
      if (!document || !document.body || typeof HTMLDialogElement === 'undefined') {
        try {
          if (typeof window.prompt === 'function') {
            resolve(window.prompt(message, fallback));
            return;
          }
        } catch (_err) {}
        resolve(fallback);
        return;
      }

      var dialog = document.createElement('dialog');
      dialog.className = 'resolution-dialog';
      dialog.style.padding = '1rem';
      dialog.style.border = '1px solid var(--border-color)';
      dialog.style.borderRadius = '0.9rem';
      dialog.style.background = 'var(--bg-card)';
      dialog.style.color = 'var(--text-primary)';
      dialog.style.maxWidth = '520px';
      dialog.style.width = 'min(92vw, 520px)';

      var quickHtml = quickOptions.map(function(item) {
        return '<button type="button" data-quick-resolution="' + escapeHtml(item) + '" class="btn btn-secondary" style="padding:0.35rem 0.6rem;font-size:0.75rem;">' + escapeHtml(item) + '</button>';
      }).join('');

      dialog.innerHTML = ''
        + '<form method="dialog" style="display:grid;gap:0.75rem;">'
        + '  <h3 style="margin:0;font-size:1rem;">' + escapeHtml(message || 'Grund fuer Entblockung') + '</h3>'
        + '  <div style="display:flex;flex-wrap:wrap;gap:0.45rem;">' + quickHtml + '</div>'
        + '  <textarea id="resolution-input" rows="3" placeholder="Grund eingeben" style="width:100%;"></textarea>'
        + '  <div style="display:flex;justify-content:flex-end;gap:0.5rem;">'
        + '    <button type="button" class="btn btn-secondary" data-resolution-cancel>Abbrechen</button>'
        + '    <button type="button" class="btn btn-primary" data-resolution-save>Speichern</button>'
        + '  </div>'
        + '</form>';

      document.body.appendChild(dialog);

      var input = dialog.querySelector('#resolution-input');
      if (input) input.value = fallback;

      function closeWith(value) {
        try { dialog.close(); } catch (_errClose) {}
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        resolve(value);
      }

      dialog.addEventListener('click', function(event) {
        var quick = event.target && event.target.closest ? event.target.closest('[data-quick-resolution]') : null;
        if (quick && input) {
          input.value = quick.getAttribute('data-quick-resolution') || '';
          input.focus();
          return;
        }
        var cancel = event.target && event.target.closest ? event.target.closest('[data-resolution-cancel]') : null;
        if (cancel) {
          closeWith(null);
          return;
        }
        var save = event.target && event.target.closest ? event.target.closest('[data-resolution-save]') : null;
        if (save) {
          var value = String((input && input.value) || '').trim();
          if (!value) {
            alert('Bitte einen Grund angeben oder eine Schnellauswahl waehlen.');
            if (input) input.focus();
            return;
          }
          closeWith(value);
        }
      });

      dialog.addEventListener('cancel', function(event) {
        event.preventDefault();
        closeWith(null);
      });

      dialog.showModal();
      if (input && input.focus) input.focus();
    });
  }

  function getOpenTaskBlockerEntry(task) {
    var history = task && Array.isArray(task.blockerHistory) ? task.blockerHistory : [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (!history[i].until) return history[i];
    }
    return null;
  }

  function getStatusLabel(status) {
    return STATUS_META[status] ? STATUS_META[status].label : (status || 'Unbekannt');
  }

  function getStatusIcon(status) {
    return STATUS_META[status] ? STATUS_META[status].icon : 'adjust';
  }

  function getStatusSummary(status) {
    if (status === 'in-progress') return 'Aktiv';
    if (status === 'done') return 'Abgeschlossen';
    return getStatusLabel(status);
  }

  function getAssignee(task) {
    if (!task || !task.assigneeId) return null;
    return (window.DataLayer.getEmployees() || []).find(function (employee) {
      return employee.id === task.assigneeId;
    }) || null;
  }

  function getAssigneeName(task) {
    var assignee = getAssignee(task);
    return assignee ? assignee.name : 'Nicht zugewiesen';
  }

  function sanitizeGitHubUsername(value) {
    var username = String(value || '').trim();
    if (!username) return '';
    username = username.replace(/^@+/, '');
    username = username.replace(/\/$/, '');
    username = username.replace(/[^A-Za-z0-9-]/g, '');
    return username;
  }

  function extractGitHubUsername(value) {
    var input = String(value || '').trim();
    if (!input) return '';
    var direct = sanitizeGitHubUsername(input);
    if (direct && direct.indexOf('githubcom') === -1 && input.indexOf('http') !== 0) {
      return direct;
    }
    var match = input.match(/github\.com\/([^\/#?]+)/i);
    if (match && match[1]) return sanitizeGitHubUsername(match[1]);
    return direct;
  }

  function getAssigneeGitHubAvatarUrl(task) {
    var assignee = getAssignee(task);
    if (!assignee || !assignee.github || typeof assignee.github !== 'object') return '';

    var github = assignee.github;
    var avatarUrl = typeof github.avatarUrl === 'string' ? github.avatarUrl.trim() : '';
    if (avatarUrl) return avatarUrl;

    var username = sanitizeGitHubUsername(github.username || extractGitHubUsername(github.profileUrl || ''));
    if (!username) return '';
    return 'https://github.com/' + encodeURIComponent(username) + '.png?size=200';
  }

  function getAssigneeInitials(name) {
    if (!name) return 'NA';
    var parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'NA';
    return parts.slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
  }

  function getAssigneeAvatarHtml(task, assigneeName, assigneeInitials) {
    var avatarUrl = getAssigneeGitHubAvatarUrl(task);
    if (!avatarUrl) {
      return '<span class="kanban-assignee-avatar" title="' + escapeHtml(assigneeName) + '">' + escapeHtml(assigneeInitials) + '</span>';
    }

    var safeUrl = String(avatarUrl).replace(/'/g, '%27');
    return '<span class="kanban-assignee-avatar kanban-assignee-avatar-image" title="' + escapeHtml(assigneeName) + '" style="background-image:url(\'' + escapeHtml(safeUrl) + '\')" aria-label="' + escapeHtml(assigneeName) + '"></span>';
  }

  function getEffortPercent(task) {
    return getTaskWorkdayPercent(getTaskPlannedMinutes(task));
  }

  function isTaskScheduledForToday(task) {
    if (!task || !task.schedule) return false;
    var schedule = task.schedule;
    var mode = schedule.mode || 'none';
    var today = getTodayDateKey();
    var deadline = toDateOnly(schedule.deadline);
    var fixedAt = toDateOnly(schedule.fixedAt);
    var rangeStart = toDateOnly(schedule.rangeStart);
    var rangeEnd = toDateOnly(schedule.rangeEnd);

    if (mode === 'deadline') return deadline === today;
    if (mode === 'fixed') return fixedAt === today;
    if (mode === 'range') {
      if (rangeStart && rangeEnd) return rangeStart <= today && rangeEnd >= today;
      if (rangeStart) return rangeStart <= today;
      if (rangeEnd) return rangeEnd >= today;
      return false;
    }
    if (mode === 'asap') return task.status !== 'done';
    return false;
  }

  function isTaskRelevantToday(task) {
    if (!task || task.status === 'done') return false;
    return task.status === 'in-progress' || isTaskScheduledForToday(task);
  }

  function getTaskEffortLabel(task) {
    return buildTaskEffortSnapshot(task).remainingLabel;
  }

  function matchesCurrentFilters(task, status) {
    if (!task) return false;
    if (status && task.status !== status) return false;
    if (filterAssigneeId === UNASSIGNED_FILTER_VALUE && task.assigneeId) return false;
    if (filterAssigneeId && filterAssigneeId !== UNASSIGNED_FILTER_VALUE && task.assigneeId !== filterAssigneeId) return false;
    if (filterPriority && task.priority !== filterPriority) return false;
    if (filterUrgency && task.urgency !== filterUrgency) return false;
    if (filterProjectId && task.projectId !== filterProjectId) return false;
    return true;
  }

  function getVisibleTasks() {
    var allTasks = window.DataLayer.getTasks() || [];
    var sequenceMeta = buildTaskSequenceMeta(allTasks);
    return allTasks.filter(function (task) {
      if (!matchesCurrentFilters(task)) return false;
      var meta = sequenceMeta[task.id];
      return !meta || !meta.hidden;
    }).map(function (task) {
      return attachTaskSequenceMeta(task, sequenceMeta[task.id]);
    });
  }

  function getProjectSequenceOrder(tasks) {
    var grouped = Object.create(null);
    (tasks || []).forEach(function (task) {
      if (!task || !task.id) return;
      var key = String(task.projectId || '__no_project__');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(task);
    });

    Object.keys(grouped).forEach(function (projectId) {
      grouped[projectId].sort(function (a, b) {
        var aSeq = Number(a && a.sequenceIndex || 0) || 0;
        var bSeq = Number(b && b.sequenceIndex || 0) || 0;
        if (aSeq && bSeq && aSeq !== bSeq) return aSeq - bSeq;
        if (aSeq && !bSeq) return -1;
        if (!aSeq && bSeq) return 1;
        var createdDelta = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        if (createdDelta !== 0) return createdDelta;
        return String(a.id).localeCompare(String(b.id));
      });
    });

    return grouped;
  }

  function buildTaskSequenceMeta(tasks) {
    var list = Array.isArray(tasks) ? tasks : [];
    var byId = Object.create(null);
    list.forEach(function (task) {
      if (!task || !task.id) return;
      byId[task.id] = task;
    });

    var projectOrder = getProjectSequenceOrder(list);
    var positionById = Object.create(null);
    Object.keys(projectOrder).forEach(function (projectId) {
      projectOrder[projectId].forEach(function (task, index) {
        positionById[task.id] = index;
      });
    });

    var predecessorById = Object.create(null);
    var dependentsById = Object.create(null);

    function registerEdge(predecessorId, taskId) {
      if (!predecessorId || !taskId || predecessorId === taskId) return;
      predecessorById[taskId] = predecessorId;
      if (!dependentsById[predecessorId]) dependentsById[predecessorId] = [];
      if (dependentsById[predecessorId].indexOf(taskId) === -1) dependentsById[predecessorId].push(taskId);
    }

    function findPrimaryPredecessor(task) {
      if (!task || !task.id) return null;

      var dependencyIds = Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds : [];
      var dependencyCandidates = dependencyIds.map(function (dependencyId) {
        return byId[String(dependencyId || '').trim()];
      }).filter(function (dependencyTask) {
        return dependencyTask && dependencyTask.id !== task.id && dependencyTask.projectId === task.projectId;
      });

      if (dependencyCandidates.length > 0) {
        dependencyCandidates.sort(function (left, right) {
          var leftSeq = Number(left && left.sequenceIndex || 0) || 0;
          var rightSeq = Number(right && right.sequenceIndex || 0) || 0;
          if (leftSeq !== rightSeq) return rightSeq - leftSeq;
          var leftPos = typeof positionById[left.id] === 'number' ? positionById[left.id] : -1;
          var rightPos = typeof positionById[right.id] === 'number' ? positionById[right.id] : -1;
          return rightPos - leftPos;
        });
        return dependencyCandidates[0];
      }

      if (task.dependsOnPrevious) {
        var ordered = projectOrder[String(task.projectId || '__no_project__')] || [];
        var position = typeof positionById[task.id] === 'number' ? positionById[task.id] : -1;
        if (position > 0) return ordered[position - 1];
      }

      return null;
    }

    list.forEach(function (task) {
      var predecessor = findPrimaryPredecessor(task);
      if (predecessor && predecessor.id) registerEdge(predecessor.id, task.id);
    });

    function getNearestOpenPredecessor(taskId, seen) {
      var predecessorId = predecessorById[taskId];
      if (!predecessorId) return null;
      if (!seen) seen = Object.create(null);
      if (seen[predecessorId]) return null;
      seen[predecessorId] = true;
      var predecessorTask = byId[predecessorId];
      if (predecessorTask && predecessorTask.status !== 'done') return predecessorTask;
      return getNearestOpenPredecessor(predecessorId, seen);
    }

    function countOpenDescendants(taskId, seen) {
      var children = dependentsById[taskId] || [];
      if (!children.length) return 0;
      if (!seen) seen = Object.create(null);
      var total = 0;

      children.forEach(function (childId) {
        if (seen[childId]) return;
        seen[childId] = true;
        var childTask = byId[childId];
        if (childTask && childTask.status !== 'done') total += 1;
        total += countOpenDescendants(childId, seen);
      });

      return total;
    }

    var meta = Object.create(null);
    list.forEach(function (task) {
      if (!task || !task.id) return;
      var isChainTask = !!predecessorById[task.id] || !!((dependentsById[task.id] || []).length);
      var openPredecessor = isChainTask && task.status !== 'done' ? getNearestOpenPredecessor(task.id) : null;
      var showAsNextStep = !!(openPredecessor && openPredecessor.status === 'in-progress');
      var hidden = isChainTask && task.status !== 'done' && !!openPredecessor && !showAsNextStep;
      var remaining = isChainTask && !hidden ? countOpenDescendants(task.id) : 0;
      meta[task.id] = { hidden: hidden, remaining: remaining };
    });

    return meta;
  }

  function attachTaskSequenceMeta(task, meta) {
    if (!task) return task;
    var copy = Object.assign({}, task);
    copy.kanbanChainRemainingCount = meta && typeof meta.remaining === 'number' ? meta.remaining : 0;
    return copy;
  }

  function getTodayTaskGroups() {
    var groups = Object.create(null);

    getVisibleTasks().filter(isTaskRelevantToday).forEach(function (task) {
      var assignee = getAssignee(task);
      var groupId = assignee ? assignee.id : 'unassigned';
      if (!groups[groupId]) {
        groups[groupId] = {
          id: groupId,
          name: assignee ? assignee.name : 'Nicht zugewiesen',
          initials: getAssigneeInitials(assignee ? assignee.name : 'Nicht zugewiesen'),
          totalHours: 0,
          taskCount: 0,
          tasks: []
        };
      }

      groups[groupId].tasks.push(task);
      groups[groupId].taskCount += 1;
      groups[groupId].totalHours += getTaskTrackedMinutesToday(task) / 60;
    });

    return Object.keys(groups).map(function (key) {
      var entry = groups[key];
      entry.loadPercent = Math.max(0, Math.min(160, Math.round((entry.totalHours / WORKDAY_HOURS) * 100)));
      return entry;
    }).sort(function (left, right) {
      if (right.totalHours !== left.totalHours) return right.totalHours - left.totalHours;
      return left.name.localeCompare(right.name, 'de');
    });
  }

  // --- Prioritäts-Farbe ---
  function getPriorityColor(priority) {
    switch (priority) {
      case 'blocker':return '#d64550';
      case 'high':   return '#e74c3c';
      case 'medium': return '#f1c40f';
      case 'low':    return '#2ecc71';
      default:       return '#95a5a6';
    }
  }

  function getPriorityLabel(priority) {
    switch (priority) {
      case 'blocker':return 'Blocker';
      case 'high':   return 'Hoch';
      case 'medium': return 'Mittel';
      case 'low':    return 'Niedrig';
      default:       return priority || '';
    }
  }

  function getUrgencyLabel(urgency) {
    switch (urgency) {
      case 'critical': return 'Kritisch';
      case 'high': return 'Dringend';
      case 'normal': return 'Normal';
      case 'low': return 'Entspannt';
      default: return 'Normal';
    }
  }

  function getUrgencyColor(urgency) {
    switch (urgency) {
      case 'critical': return '#d64550';
      case 'high': return '#ff8a4c';
      case 'normal': return '#5ea2ff';
      case 'low': return '#40d98c';
      default: return '#5ea2ff';
    }
  }

  function getScheduleLabel(task) {
    if (!task || !task.schedule) return 'Kein Termin';
    var schedule = task.schedule;
    var mode = schedule.mode || 'none';
    if (mode === 'deadline' && schedule.deadline) return 'Deadline ' + schedule.deadline;
    if (mode === 'fixed' && schedule.fixedAt) return 'Termin ' + schedule.fixedAt;
    if (mode === 'range') {
      var from = schedule.rangeStart || '?';
      var to = schedule.rangeEnd || '?';
      return 'Zeitraum ' + from + ' bis ' + to;
    }
    if (mode === 'asap') return 'Sofort erledigen';
    return 'Kein Termin';
  }

  function getTaskSubtaskStats(task) {
    var list = task && Array.isArray(task.subtasks) ? task.subtasks : [];
    if (list.length === 0) return { total: 0, completed: 0, percent: 0 };
    var completed = list.filter(function (st) { return !!st.completed; }).length;
    return {
      total: list.length,
      completed: completed,
      percent: Math.round((completed / list.length) * 100)
    };
  }

  function getProjectTitle(projectId) {
    if (!projectId) return 'Ohne Projekt';
    var project = (window.DataLayer.getProjects() || []).find(function (item) {
      return item.id === projectId;
    });
    return project ? (project.title || project.name || 'Projekt') : 'Ohne Projekt';
  }

  // --- Status-Farbe für Badges ---
  function getStatusColor(status) {
    switch (status) {
      case 'backlog':    return '#9b59b6';
      case 'todo':       return '#4a9eff';
      case 'in-progress':return '#f1c40f';
      case 'review':     return '#e74c3c';
      case 'done':       return '#2ecc71';
      default:           return '#666';
    }
  }

  // --- Subtasks rendern ---
  function renderSubtasks(subtasks, parentTaskId) {
    if (!subtasks || subtasks.length === 0) return '';
    var html = '<div class="kanban-subtasks">';
    subtasks.forEach(function(st) {
      var stateClass = st.completed ? ' is-done' : '';
      var stateIcon = st.completed ? 'check_circle' : 'radio_button_unchecked';
      html += '<button type="button" class="kanban-subtask-item' + stateClass + '" data-kanban-subtask-toggle="' + escapeHtml(st.id || '') + '" data-parent-task-id="' + escapeHtml(parentTaskId || '') + '" aria-pressed="' + (st.completed ? 'true' : 'false') + '" title="Teilaufgabe umschalten">' +
        '<span class="material-symbols-rounded" aria-hidden="true">' + stateIcon + '</span>' +
        '<span class="kanban-subtask-text">' + escapeHtml(st.title) + '</span>' +
        '</button>';
    });
    html += '</div>';
    return html;
  }

  function buildStatusSteps(task) {
    var auth = getAuthManager();
    var editable = !auth || typeof auth.canEditTask !== 'function' || auth.canEditTask(task);
    var html = '<div class="kanban-status-strip" role="group" aria-label="Status schnell wechseln">';
    COLUMNS.forEach(function (status) {
      var activeClass = task.status === status ? ' is-active' : '';
      html += '<button type="button" class="kanban-status-step' + activeClass + '" data-task-id="' + escapeHtml(task.id) + '" data-task-status="' + escapeHtml(status) + '" title="Status: ' + escapeHtml(getStatusLabel(status)) + '" ' + (editable ? '' : 'disabled') + '>' +
        '<span class="material-symbols-rounded" aria-hidden="true">' + getStatusIcon(status) + '</span>' +
        '</button>';
    });
    html += '</div>';
    return html;
  }

  // --- Task-Card HTML erstellen ---
  function createTaskCard(task) {
    var auth = getAuthManager();
    var editable = !auth || typeof auth.canEditTask !== 'function' || auth.canEditTask(task);
    var priorityClass = task.priority === 'high' || task.priority === 'blocker' ? 'priority-high' :
                        task.priority === 'medium' ? 'priority-medium' :
                        task.priority === 'low' ? 'priority-low' : '';
    var isCompactMode = currentCardMode === 'compact';
    var subtaskStats = getTaskSubtaskStats(task);
    var urgency = task.urgency || 'normal';
    var assigneeName = getAssigneeName(task);
    var assigneeInitials = getAssigneeInitials(assigneeName);
    var effortSnapshot = buildTaskEffortSnapshot(task);
    var timingState = effortSnapshot.state;
    var effortPercent = effortSnapshot.remainingPercent;
    var priorityTone = getPriorityColor(task.priority);
    var urgencyTone = getUrgencyColor(urgency);
    var dueDateLabel = task.dueDate ? formatDateShort(task.dueDate) : '';
    var isOverdue = task.dueDate && toDateOnly(task.dueDate) < getTodayDateKey() && task.status !== 'done';
    var description = (task.description || '').trim();
    var progressValue = normalizeTaskProgress(task.progress, 0);
    var attachmentCount = Array.isArray(task.attachments) ? task.attachments.length : 0;
    var dependencyCount = Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds.length : 0;
    var chainRemainingCount = Number(task.kanbanChainRemainingCount || 0) || 0;
    var chainBadge = '';
    if (chainRemainingCount > 0) {
      var chainFollowLabel = chainRemainingCount === 1
        ? 'Noch 1 Aufgabe folgt'
        : ('Noch ' + chainRemainingCount + ' Aufgaben folgen');
      var chainFollowHint = chainRemainingCount === 1
        ? 'Nach dieser Aufgabe rueckt noch 1 Folgeaufgabe nach.'
        : ('Nach dieser Aufgabe ruecken noch ' + chainRemainingCount + ' Folgeaufgaben nach.');
      chainBadge = '<span class="kanban-pill kanban-pill-chain" title="' + escapeHtml(chainFollowHint) + '">' +
        '<span class="material-symbols-rounded" aria-hidden="true">keyboard_double_arrow_left</span>' +
        '<span class="kanban-chain-label">' + escapeHtml(chainFollowLabel) + '</span>' +
      '</span>';
    }
    var attachmentBadge = attachmentCount > 0
      ? '<button class="kanban-icon-btn kanban-attachment-indicator" type="button" data-task-attachment-upload="' + escapeHtml(task.id) + '" title="' + attachmentCount + ' Anhang' + (attachmentCount === 1 ? '' : 'e') + ' · Datei anhaengen" ' + (editable ? '' : 'disabled') + '><span class="material-symbols-rounded" aria-hidden="true">attach_file</span><span>' + attachmentCount + '</span></button>'
      : '';
    var pauseBadge = timingState === 'paused'
      ? '<span class="kanban-pill kanban-pill-pause is-paused">Pausiert</span>'
      : '';
    var effortMetaLabel = effortSnapshot.timingLabel + (effortSnapshot.pauseHint ? ' · ' + effortSnapshot.pauseHint : '');

    var html = '<div class="kanban-card ' + priorityClass + (timingState === 'paused' ? ' is-paused' : '') + (isCompactMode ? ' is-compact' : '') + (editable ? '' : ' auth-readonly-card') + '" data-task-id="' + escapeHtml(task.id) + '" draggable="' + (editable ? 'true' : 'false') + '">';

    if (isCompactMode) {
      html += '<div class="kanban-card-head kanban-card-compact-head">';
      html += '<div class="kanban-card-context">';
      html += '<span class="kanban-card-project">' + escapeHtml(getProjectTitle(task.projectId)) + '</span>';
      html += chainBadge;
      html += attachmentBadge;
      html += '</div>';
      html += getAssigneeAvatarHtml(task, assigneeName, assigneeInitials);
      html += '<button class="kanban-icon-btn kanban-expand-btn" type="button" data-task-open="' + escapeHtml(task.id) + '" title="Aufgabe erweitern" ' + (editable ? '' : 'disabled') + '>';
      html += '<span class="material-symbols-rounded" aria-hidden="true">open_in_full</span>';
      html += '</button>';
      html += '</div>';
      html += '<div class="kanban-card-title-row">';
      html += '<div class="kanban-card-title kanban-card-title-compact">' + escapeHtml(task.title || 'Ohne Titel') + '</div>';
      html += '</div>';
      html += '</div>';
      return html;
    }

    html += '<div class="kanban-card-head">';
    html += '<div class="kanban-card-context">';
    html += '<span class="kanban-card-project">' + escapeHtml(getProjectTitle(task.projectId)) + '</span>';
    html += pauseBadge;
    html += '</div>';
    html += getAssigneeAvatarHtml(task, assigneeName, assigneeInitials);
    html += '</div>';

    html += '<div class="kanban-card-title-row">';
    html += '<div class="kanban-card-title">' + escapeHtml(task.title || 'Ohne Titel') + '</div>';
    html += '</div>';

    if (description) {
      html += '<div class="kanban-card-desc">' + escapeHtml(description).substring(0, 180) + '</div>';
    }

    html += '<div class="kanban-card-signals">';
    html += '<span class="kanban-pill" style="color:' + priorityTone + ';background:' + hexToRgba(priorityTone, 0.12) + ';border-color:' + hexToRgba(priorityTone, 0.28) + ';">P ' + escapeHtml(getPriorityLabel(task.priority)) + '</span>';
    html += '<span class="kanban-pill" style="color:' + urgencyTone + ';background:' + hexToRgba(urgencyTone, 0.12) + ';border-color:' + hexToRgba(urgencyTone, 0.28) + ';">D ' + escapeHtml(getUrgencyLabel(urgency)) + '</span>';
    if (task.dueDate) {
      html += '<span class="kanban-pill ' + (isOverdue ? 'is-overdue' : '') + '">' + escapeHtml(dueDateLabel) + '</span>';
    } else {
      html += '<span class="kanban-pill">' + escapeHtml(getScheduleLabel(task)) + '</span>';
    }
    if (dependencyCount > 0) {
      html += '<span class="kanban-pill kanban-pill-dependency' + (task.dependencyBlocked ? ' is-blocked' : '') + '">' + escapeHtml('Abh. ' + dependencyCount) + '</span>';
    }
    html += chainBadge;
    html += '</div>';

    html += '<div class="kanban-effort-block">';
    html += '<div class="kanban-effort-head">';
    html += '<span class="kanban-effort-label">Tagesanteil</span>';
    html += '<span class="kanban-effort-value" data-live-effort-share="' + escapeHtml(task.id) + '">' + escapeHtml(effortSnapshot.dayShareLabel) + '</span>';
    html += '</div>';
    html += '<div class="kanban-effort-meter">';
    html += '<div class="kanban-effort-allocation" style="width:' + effortSnapshot.allocationPercent + '%"></div>';
    html += '<div class="kanban-effort-fill" data-live-effort-fill="' + escapeHtml(task.id) + '" style="width:' + effortPercent + '%"></div>';
    html += '</div>';
    html += '<div class="kanban-effort-caption" data-live-effort-caption="' + escapeHtml(task.id) + '">' + escapeHtml(effortSnapshot.remainingLabel) + '</div>';
    html += '<div class="kanban-pause-caption' + (timingState === 'paused' ? ' is-paused' : '') + '" data-live-pause-caption="' + escapeHtml(task.id) + '">' + escapeHtml(effortMetaLabel) + '</div>';
    html += '</div>';

    html += '<div class="kanban-progress-block">';
    html += '<div class="kanban-progress-head">';
    html += '<span class="kanban-progress-label">Fortschritt</span>';
    html += '<span class="kanban-progress-value" data-task-progress-label="' + escapeHtml(task.id) + '">' + progressValue + '%</span>';
    html += '</div>';
    html += '<input type="range" min="0" max="100" step="1" class="kanban-progress-slider" draggable="false" data-task-progress-input="' + escapeHtml(task.id) + '" value="' + progressValue + '" aria-label="Fortschritt fuer ' + escapeHtml(task.title || 'Aufgabe') + '" ' + (editable ? '' : 'disabled') + '>';
    html += '</div>';

    if (task.subtasks && task.subtasks.length > 0) {
      html += renderSubtasks(task.subtasks, task.id);
      html += '<div class="kanban-subtask-progress"><div class="kanban-subtask-progress-fill" style="width:' + subtaskStats.percent + '%"></div></div>';
      html += '<div class="kanban-subtask-caption">Teilaufgaben ' + subtaskStats.completed + '/' + subtaskStats.total + '</div>';
    }

    html += '<div class="kanban-card-footer">';
    html += '<div class="kanban-card-footer-meta">';
    html += '<span class="kanban-assignee" title="' + escapeHtml(assigneeName) + '">' + escapeHtml(assigneeName) + '</span>';
    html += attachmentBadge;
    if (task.dueDate) {
      html += '<span class="kanban-due-date ' + (isOverdue ? 'overdue' : '') + '" title="Faellig am ' + escapeHtml(task.dueDate) + '">' + escapeHtml(dueDateLabel) + '</span>';
    }
    html += '</div>';
    html += '<div class="kanban-card-actions kanban-card-actions-bottom">';
    if (task.status === 'in-progress') {
      html += '<button class="kanban-icon-btn kanban-pause-btn' + (timingState === 'paused' ? ' is-paused' : '') + '" type="button" data-task-pause-toggle="' + escapeHtml(task.id) + '" title="' + (timingState === 'paused' ? 'Aufgabe fortsetzen' : 'Aufgabe unterbrechen') + '" ' + (editable ? '' : 'disabled') + '>';
      html += '<span class="material-symbols-rounded" aria-hidden="true">' + (timingState === 'paused' ? 'play_arrow' : 'pause') + '</span>';
      html += '</button>';
    }
    html += '<button class="kanban-icon-btn" type="button" data-task-complete="' + escapeHtml(task.id) + '" title="Aufgabe abschliessen" ' + (editable ? '' : 'disabled') + '>';
    html += '<span class="material-symbols-rounded" aria-hidden="true">task_alt</span>';
    html += '</button>';
    html += '<button class="kanban-icon-btn" type="button" data-task-open="' + escapeHtml(task.id) + '" title="Aufgabe bearbeiten" ' + (editable ? '' : 'disabled') + '>';
    html += '<span class="material-symbols-rounded" aria-hidden="true">open_in_full</span>';
    html += '</button>';
    html += '</div>';
    html += '</div></div>';
    return html;
  }

  // --- Filter angewendete Tasks holen ---
  function getFilteredTasks(status) {
    var allTasks = window.DataLayer.getTasks();
    var sequenceMeta = buildTaskSequenceMeta(allTasks);
    return allTasks.filter(function(t) {
      if (!matchesCurrentFilters(t, status)) return false;
      var meta = sequenceMeta[t.id];
      return !meta || !meta.hidden;
    }).map(function (task) {
      return attachTaskSequenceMeta(task, sequenceMeta[task.id]);
    });
  }

  function renderOverview() {
    var container = document.getElementById('kanban-overview');
    if (!container) return;

    var visibleTasks = getVisibleTasks();
    var todayGroups = getTodayTaskGroups();
    var todayTaskCount = todayGroups.reduce(function (sum, group) { return sum + group.taskCount; }, 0);
    var todayHours = todayGroups.reduce(function (sum, group) { return sum + group.totalHours; }, 0);
    var overdueCount = visibleTasks.filter(function (task) {
      return task.dueDate && toDateOnly(task.dueDate) < getTodayDateKey() && task.status !== 'done';
    }).length;

    var html = '<div class="kanban-overview-grid">';
    html += '<div class="kanban-overview-card">';
    html += '<span class="kanban-overview-label">Sichtbare Aufgaben</span>';
    html += '<strong class="kanban-overview-value">' + visibleTasks.length + '</strong>';
    html += '<span class="kanban-overview-note">Aktuelle Filter inklusive</span>';
    html += '</div>';
    html += '<div class="kanban-overview-card">';
    html += '<span class="kanban-overview-label">Heutige Planung</span>';
    html += '<strong class="kanban-overview-value">' + escapeHtml(formatHours(todayHours)) + '</strong>';
    html += '<span class="kanban-overview-note">' + todayTaskCount + ' Aufgaben fuer heute relevant</span>';
    html += '</div>';
    html += '<div class="kanban-overview-card">';
    html += '<span class="kanban-overview-label">Mitarbeiter heute</span>';
    html += '<strong class="kanban-overview-value">' + todayGroups.length + '</strong>';
    html += '<span class="kanban-overview-note">Direkt in die Tagesansicht filterbar</span>';
    html += '</div>';
    html += '<div class="kanban-overview-card">';
    html += '<span class="kanban-overview-label">Ueberfaellig</span>';
    html += '<strong class="kanban-overview-value">' + overdueCount + '</strong>';
    html += '<span class="kanban-overview-note">Offene Aufgaben mit vergangenem Termin</span>';
    html += '</div>';
    html += '</div>';

    if (todayGroups.length > 0) {
      html += '<div class="kanban-team-load-strip">';
      todayGroups.forEach(function (group) {
        var activeClass = filterAssigneeId && filterAssigneeId === group.id ? ' is-active' : '';
        html += '<button type="button" class="kanban-team-load-card' + activeClass + '" data-day-assignee="' + escapeHtml(group.id) + '">';
        html += '<span class="kanban-team-load-avatar">' + escapeHtml(group.initials) + '</span>';
        html += '<span class="kanban-team-load-content">';
        html += '<span class="kanban-team-load-name">' + escapeHtml(group.name) + '</span>';
        html += '<span class="kanban-team-load-meta">' + escapeHtml(formatHours(group.totalHours)) + ' · ' + group.taskCount + ' Aufgaben</span>';
        html += '<span class="kanban-team-load-meter"><span class="kanban-team-load-fill" style="width:' + group.loadPercent + '%"></span></span>';
        html += '</span>';
        html += '</button>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function renderDayView() {
    var container = document.getElementById('kanban-day-view');
    if (!container) return;

    var groups = getTodayTaskGroups();
    if (groups.length === 0) {
      container.innerHTML = '<div class="kanban-day-empty">Keine heute relevanten Aufgaben fuer die aktuelle Filterung.</div>';
      return;
    }

    var html = '<div class="kanban-day-grid">';
    groups.forEach(function (group) {
      html += '<section class="kanban-day-column">';
      html += '<div class="kanban-day-column-head">';
      html += '<div class="kanban-day-identity">';
      html += '<span class="kanban-team-load-avatar">' + escapeHtml(group.initials) + '</span>';
      html += '<div><h3>' + escapeHtml(group.name) + '</h3><p>' + group.taskCount + ' Aufgaben heute</p></div>';
      html += '</div>';
      html += '<button type="button" class="kanban-day-filter-btn" data-day-assignee="' + escapeHtml(group.id) + '">Filtern</button>';
      html += '</div>';
      html += '<div class="kanban-day-load">';
      html += '<div class="kanban-day-load-head"><span>Auslastung heute</span><strong>' + escapeHtml(formatHours(group.totalHours)) + ' / ' + WORKDAY_HOURS + ' h</strong></div>';
      html += '<div class="kanban-team-load-meter is-large"><span class="kanban-team-load-fill" style="width:' + group.loadPercent + '%"></span></div>';
      html += '</div>';
      html += '<div class="kanban-day-task-stack">';
      group.tasks.forEach(function (task) {
        html += createTaskCard(task);
      });
      html += '</div>';
      html += '</section>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  function syncFilterControls() {
    var assigneeSelect = document.getElementById('filter-assignee');
    var prioritySelect = document.getElementById('filter-priority');
    var urgencySelect = document.getElementById('filter-urgency');
    var projectSelect = document.getElementById('filter-project');

    if (assigneeSelect) assigneeSelect.value = filterAssigneeId;
    if (prioritySelect) prioritySelect.value = filterPriority;
    if (urgencySelect) urgencySelect.value = filterUrgency;
    if (projectSelect) projectSelect.value = filterProjectId;

    Array.prototype.slice.call(document.querySelectorAll('[data-kanban-view]')).forEach(function (button) {
      var isActive = button.getAttribute('data-kanban-view') === currentKanbanView;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-kanban-card-mode]')).forEach(function (button) {
      var isActive = button.getAttribute('data-kanban-card-mode') === currentCardMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateViewVisibility() {
    var boardView = document.getElementById('kanban-board-view');
    var dayView = document.getElementById('kanban-day-view');
    if (boardView) boardView.classList.toggle('hidden', currentKanbanView !== 'board');
    if (dayView) dayView.classList.toggle('hidden', currentKanbanView !== 'day');
  }

  // --- WIP-Check ---
  function checkWipLimit(status, callback) {
    callback(true);
  }

  // --- Spalte rendern ---
  function renderColumn(status) {
    var container = document.getElementById('kanban-' + status);
    if (!container) return;

    var tasks = getFilteredTasks(status);
    var html = '';
    tasks.forEach(function(task) {
      html += createTaskCard(task);
    });

    container.innerHTML = html;

    var column = container.closest('.kanban-column');
    var header = column ? column.querySelector('h2') : null;
    if (header) {
      header.innerHTML = '<span class="kanban-column-title">' + escapeHtml(getStatusLabel(status)) + '</span>' +
        '<span class="kanban-column-meta"><span>' + tasks.length + ' sichtbar</span></span>';
    }
  }

  // --- Alle Spalten rendern ---
  function renderAllColumns() {
    COLUMNS.forEach(function(status) {
      renderColumn(status);
    });
    renderOverview();
    renderDayView();
    updateViewVisibility();
    syncFilterControls();
    refreshLiveTaskMetrics();
  }

  function refreshLiveTaskMetrics() {
    var nowIso = getNowIsoString();

    Array.prototype.slice.call(document.querySelectorAll('[data-live-effort-fill]')).forEach(function (element) {
      var task = window.DataLayer.getTaskById(element.getAttribute('data-live-effort-fill'));
      if (!task) return;
      var snapshot = buildTaskEffortSnapshot(task, nowIso);
      element.style.width = snapshot.remainingPercent + '%';
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-live-effort-share]')).forEach(function (element) {
      var task = window.DataLayer.getTaskById(element.getAttribute('data-live-effort-share'));
      if (!task) return;
      element.textContent = buildTaskEffortSnapshot(task, nowIso).dayShareLabel;
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-live-effort-caption]')).forEach(function (element) {
      var task = window.DataLayer.getTaskById(element.getAttribute('data-live-effort-caption'));
      if (!task) return;
      element.textContent = buildTaskEffortSnapshot(task, nowIso).remainingLabel;
    });

    Array.prototype.slice.call(document.querySelectorAll('[data-live-pause-caption]')).forEach(function (element) {
      var task = window.DataLayer.getTaskById(element.getAttribute('data-live-pause-caption'));
      if (!task) return;
      var snapshot = buildTaskEffortSnapshot(task, nowIso);
      element.textContent = snapshot.timingLabel + (snapshot.pauseHint ? ' · ' + snapshot.pauseHint : '');
      element.classList.toggle('is-paused', snapshot.state === 'paused');
    });
  }

  function startLiveTaskRefresh() {
    if (liveRefreshHandle) return;
    liveRefreshHandle = window.setInterval(function () {
      refreshLiveTaskMetrics();
    }, LIVE_REFRESH_INTERVAL_MS);
  }

  function setTaskStatus(taskId, nextStatus) {
    var task = window.DataLayer.getTaskById(taskId);
    if (!task || !nextStatus || task.status === nextStatus) return;

    var auth = getAuthManager();
    if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) return;

    if (nextStatus === 'in-progress' && task.dependencyBlocked) {
      alert('Diese Aufgabe ist noch von einer vorherigen Aufgabe abhaengig und kann erst danach gestartet werden.');
      return;
    }

    checkWipLimit(nextStatus, function (canMove, message) {
      if (!canMove) {
        alert(message);
        return;
      }
      applyTaskStatusTransition(task, nextStatus, { at: getNowIsoString() });
      window.DataLayer.updateTask(task);
    });
  }

  // --- Drag & Drop Setup ---
  function setupDragAndDrop() {
    // Fortschritts-Slider: Card-Drag während Slider-Bedienung deaktivieren
    document.addEventListener('pointerdown', function(e) {
      var block = e.target.closest('.kanban-progress-block');
      if (!block) return;
      var card = block.closest('.kanban-card');
      if (!card) return;
      card.setAttribute('draggable', 'false');
      function restore() {
        card.setAttribute('draggable', 'true');
        document.removeEventListener('pointerup', restore);
        document.removeEventListener('pointercancel', restore);
      }
      document.addEventListener('pointerup', restore);
      document.addEventListener('pointercancel', restore);
    });

    // Task Cards: dragstart
    document.addEventListener('dragstart', function(e) {
      if (e.target.closest('.kanban-progress-block')) { e.preventDefault(); return; }
      var card = e.target.closest('.kanban-card');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(function() { card.classList.add('dragging'); }, 0);
    });

    // Task Cards: dragend
    document.addEventListener('dragend', function(e) {
      var card = e.target.closest('.kanban-card');
      if (!card) return;
      card.classList.remove('dragging');
    });

    // Kanban Columns (Drop-Zonen): dragover + drop
    COLUMNS.forEach(function(status) {
      var container = document.getElementById('kanban-' + status);
      if (!container) return;

      container.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.classList.add('drag-over');
      });

      container.addEventListener('dragleave', function(e) {
        // Nur wenn wirklich die Zone verlassen wird (nicht Kind-Element)
        if (!container.contains(e.relatedTarget)) {
          container.classList.remove('drag-over');
        }
      });

      container.addEventListener('drop', function(e) {
        e.preventDefault();
        container.classList.remove('drag-over');

        var taskId = e.dataTransfer.getData('text/plain');
        if (!taskId || !taskId.trim()) return;

        // WIP-Limit prüfen
        checkWipLimit(status, function(canDrop, msg) {
          if (!canDrop) {
            alert(msg);
            return;
          }

          var task = window.DataLayer.getTaskById(taskId);
          if (task && task.status !== status) {
            applyTaskStatusTransition(task, status, { at: getNowIsoString() });
            window.DataLayer.updateTask(task);
            renderAllColumns();
          }
        });
      });
    });
  }

  // --- Subtask-Checkbox Interaktion ---
  function setupSubtaskCheckboxes() {
    document.addEventListener('click', function(e) {
      var toggle = e.target.closest('[data-kanban-subtask-toggle]');
      if (toggle) {
        var taskId = toggle.dataset.parentTaskId;
        var subtaskId = toggle.dataset.kanbanSubtaskToggle;
        var task = window.DataLayer.getTaskById(taskId);
        if (!task || !task.subtasks) return;

        task.subtasks.forEach(function(st) {
          if (String(st.id) === String(subtaskId)) {
            st.completed = !st.completed;
          }
        });

        window.DataLayer.updateTask(task);
      }
    });
  }

  function closeTaskControlModal() {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (overlay) overlay.classList.add('hidden');
    if (content) content.innerHTML = '';
    currentTaskDraft = null;
    currentTaskChainDraft = null;
  }

  function buildSubtaskListHtml(task) {
    var items = Array.isArray(task.subtasks) ? task.subtasks : [];
    if (items.length === 0) return '<p class="text-muted">Noch keine Teilaufgaben.</p>';

    var html = '<div class="task-cockpit-list">';
    items.forEach(function (st) {
      html += '<div class="task-cockpit-list-item">';
      html += '<label><input type="checkbox" data-subtask-toggle="' + escapeHtml(st.id) + '" ' + (st.completed ? 'checked' : '') + '> ' + escapeHtml(st.title) + '</label>';
      html += '<button type="button" class="btn btn-secondary" data-subtask-remove="' + escapeHtml(st.id) + '">Entfernen</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildNotesHtml(task) {
    var notes = Array.isArray(task.notes) ? task.notes : [];
    if (notes.length === 0) return '<p class="text-muted">Keine Hinweise vorhanden.</p>';

    var html = '<div class="task-cockpit-list">';
    notes.forEach(function (note) {
      html += '<div class="task-cockpit-list-item">';
      html += '<div class="task-note-text">' + escapeHtml(note.text) + '</div>';
      html += '<button type="button" class="btn btn-secondary" data-note-remove="' + escapeHtml(note.id) + '">Entfernen</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildAttachmentsHtml(task) {
    var files = Array.isArray(task.attachments) ? task.attachments : [];
    if (files.length === 0) return '<p class="text-muted">Keine Dateien/Links hinterlegt.</p>';

    var html = '<div class="task-cockpit-list">';
    files.forEach(function (attachment) {
      var href = attachment.dataUrl || attachment.url || '#';
      var meta = [];
      if (attachment.size > 0) meta.push(formatBytes(attachment.size));
      if (attachment.type && attachment.type !== 'link') meta.push(attachment.type);
      html += '<div class="task-cockpit-list-item">';
      html += '<div>';
      html += '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener" download="' + escapeHtml(attachment.name || 'Anhang') + '">' + escapeHtml(attachment.name || attachment.url || 'Anhang') + '</a>';
      if (meta.length) {
        html += '<div class="text-muted">' + escapeHtml(meta.join(' · ')) + '</div>';
      }
      html += '</div>';
      html += '<button type="button" class="btn btn-secondary" data-attachment-remove="' + escapeHtml(attachment.id) + '">Entfernen</button>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function addLinkAttachmentToDraft(taskDraft, name, url) {
    if (!taskDraft) return false;
    var safeUrl = String(url || '').trim();
    var safeName = String(name || '').trim();
    if (!safeUrl) return false;
    taskDraft.attachments.push({
      id: window.DataLayer.generateId(),
      name: safeName || safeUrl,
      url: safeUrl,
      type: 'link',
      size: 0,
      addedAt: new Date().toISOString()
    });
    return true;
  }

  function addFilesToTaskDraft(taskDraft, fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!taskDraft || !files.length) return Promise.resolve({ added: 0 });

    var currentTotal = getTaskAttachmentTotalSize(taskDraft.attachments);
    var jobs = [];
    var allowedFiles = [];

    files.forEach(function (file) {
      if (file.size > MAX_TASK_ATTACHMENT_SIZE) {
        alert('Datei "' + file.name + '" ist zu gross (max ' + formatBytes(MAX_TASK_ATTACHMENT_SIZE) + ').');
        return;
      }
      if (currentTotal + file.size > MAX_TOTAL_TASK_ATTACHMENT_SIZE) {
        alert('Anhang-Limit pro Aufgabe erreicht. Maximal ' + formatBytes(MAX_TOTAL_TASK_ATTACHMENT_SIZE) + '.');
        return;
      }
      currentTotal += file.size;
      allowedFiles.push(file);
      jobs.push(readFileAsDataUrl(file));
    });

    if (!jobs.length) return Promise.resolve({ added: 0 });

    return Promise.all(jobs).then(function (dataUrls) {
      dataUrls.forEach(function (dataUrl, index) {
        var file = allowedFiles[index];
        taskDraft.attachments.push({
          id: window.DataLayer.generateId(),
          name: file.name,
          url: '',
          dataUrl: dataUrl,
          type: file.type || 'application/octet-stream',
          size: file.size || 0,
          addedAt: new Date().toISOString()
        });
      });
      return { added: allowedFiles.length };
    });
  }

  function openTaskAttachmentPicker(taskId) {
    var task = window.DataLayer.getTaskById(taskId);
    if (!task) return;

    var auth = getAuthManager();
    if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) {
      alert('Diese Aufgabe kann nur gelesen werden.');
      return;
    }

    var picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.className = 'sr-only';

    picker.addEventListener('change', function () {
      if (!picker.files || !picker.files.length) return;
      addFilesToTaskDraft(task, picker.files).then(function (result) {
        if (!result || result.added <= 0) return;
        window.DataLayer.updateTask(task);
      }).catch(function (error) {
        alert('Dateiupload fehlgeschlagen: ' + error.message);
      });
    });

    document.body.appendChild(picker);
    picker.click();
    window.setTimeout(function () {
      if (picker.parentNode) picker.parentNode.removeChild(picker);
    }, 0);
  }

  function buildTaskBlockerPanel(task) {
    var openEntry = getOpenTaskBlockerEntry(task);
    var dependencyIds = Array.isArray(task && task.dependencyTaskIds) ? task.dependencyTaskIds.slice() : [];
    var dependencyBlocked = !!(task && task.dependencyBlocked);
    var dependencyReason = task && task.dependencyBlockReason ? task.dependencyBlockReason : '';
    var canResolve = !!(window.DataLayer && typeof window.DataLayer.canResolveBlocker === 'function' && window.DataLayer.canResolveBlocker({
      targetType: 'task',
      targetId: task && task.id ? task.id : '',
      blockerTaskId: task && task.blockerTaskId ? task.blockerTaskId : ''
    }));
    var history = Array.isArray(task.blockerHistory) ? task.blockerHistory.slice() : [];
    history.sort(function(a, b) {
      return String(b.from || '').localeCompare(String(a.from || ''));
    });

    var html = '<section class="task-cockpit-blocker">';
    html += '<h3>Blocker-Status</h3>';

    if (dependencyBlocked) {
      html += '<p><strong>Status:</strong> Wartet auf ' + escapeHtml(dependencyIds.length ? dependencyIds.map(function (id) {
        var dep = window.DataLayer && typeof window.DataLayer.getTaskById === 'function' ? window.DataLayer.getTaskById(id) : null;
        return dep && dep.title ? dep.title : id;
      }).join(', ') : 'vorgelagerte Aufgabe') + '</p>';
      html += '<p><strong>Grund:</strong> ' + escapeHtml(dependencyReason || 'Abhaengigkeit noch offen') + '</p>';
    }

    if (task.blocked) {
      html += '<p><strong>Status:</strong> Blockiert seit ' + escapeHtml(formatDateTimeShort((openEntry && openEntry.from) || task.blockedAt || task.blockedUpdatedAt || task.updatedAt || task.createdAt)) + '</p>';
      html += '<p><strong>Grund:</strong> ' + escapeHtml((openEntry && openEntry.reason) || task.blockedReason || 'Kein Grund hinterlegt') + '</p>';
      html += '<button type="button" class="btn btn-secondary" id="task-cockpit-resolve-blocker" ' + (canResolve ? '' : 'disabled') + '>Blocker entfernen</button>';
      if (!canResolve) {
        html += '<p class="text-muted">Entfernen nur durch Admin oder Ersteller des Blockers moeglich.</p>';
      }
    } else if (!dependencyBlocked) {
      html += '<p class="text-muted">Aktuell kein Blocker aktiv.</p>';
    } else {
      html += '<p class="text-muted">Diese Aufgabe wird automatisch freigegeben, sobald die vorherige Aufgabe erledigt ist.</p>';
    }

    html += '<details class="task-cockpit-blocker-history">';
    html += '<summary>Historie (von/bis/warum)</summary>';
    if (!history.length) {
      html += '<p class="text-muted">Keine Blocker-Historie vorhanden.</p>';
    } else {
      html += '<ul class="task-cockpit-list">';
      history.slice(0, 6).forEach(function(entry) {
        var period = formatDateTimeShort(entry.from) + ' → ' + (entry.until ? formatDateTimeShort(entry.until) : 'offen');
        var text = (entry.reason || 'Kein Grund hinterlegt') + (entry.resolution ? (' · Aufloesung: ' + entry.resolution) : '');
        html += '<li class="task-cockpit-list-item">';
        html += '<div><strong>' + escapeHtml(period) + '</strong><div class="text-muted">' + escapeHtml(text) + '</div></div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    html += '</details>';
    html += '</section>';
    return html;
  }

  function renderScheduleFields(task) {
    var scheduleWrap = document.getElementById('task-cockpit-schedule-fields');
    if (!scheduleWrap) return;
    var schedule = task.schedule || { mode: 'none' };
    var mode = schedule.mode || 'none';
    var html = '';

    if (mode === 'deadline') {
      html += '<div class="form-group"><label for="task-cockpit-deadline">Deadline</label><input type="date" id="task-cockpit-deadline" value="' + escapeHtml(schedule.deadline || '') + '"></div>';
    } else if (mode === 'fixed') {
      html += '<div class="form-group"><label for="task-cockpit-fixed">Fester Termin</label><input type="date" id="task-cockpit-fixed" value="' + escapeHtml(schedule.fixedAt || '') + '"></div>';
    } else if (mode === 'range') {
      html += '<div class="task-cockpit-grid">';
      html += '<div class="form-group"><label for="task-cockpit-range-start">Zeitraum Start</label><input type="date" id="task-cockpit-range-start" value="' + escapeHtml(schedule.rangeStart || '') + '"></div>';
      html += '<div class="form-group"><label for="task-cockpit-range-end">Zeitraum Ende</label><input type="date" id="task-cockpit-range-end" value="' + escapeHtml(schedule.rangeEnd || '') + '"></div>';
      html += '</div>';
    } else if (mode === 'asap') {
      html += '<p class="text-muted">Diese Aufgabe ist als umgehend markiert und wird im Team-Kalender heute eingeplant.</p>';
    } else {
      html += '<p class="text-muted">Kein fester Termin gesetzt.</p>';
    }

    scheduleWrap.innerHTML = html;
  }

  function normalizeTaskCollections(task) {
    if (!Array.isArray(task.subtasks)) task.subtasks = [];
    if (!Array.isArray(task.notes)) task.notes = [];
    if (!Array.isArray(task.attachments)) task.attachments = [];
    if (!task.schedule || typeof task.schedule !== 'object') {
      task.schedule = { mode: 'none', deadline: '', fixedAt: '', rangeStart: '', rangeEnd: '' };
    }
  }

  function getProjectTaskList(projectId) {
    return (window.DataLayer.getTasks() || []).filter(function (task) {
      return String(task && task.projectId || '') === String(projectId || '');
    });
  }

  function sortTasksBySequence(list) {
    return (list || []).slice().sort(function (a, b) {
      var aSeq = Number(a && a.sequenceIndex || 0) || 0;
      var bSeq = Number(b && b.sequenceIndex || 0) || 0;
      if (aSeq && bSeq && aSeq !== bSeq) return aSeq - bSeq;
      if (aSeq && !bSeq) return -1;
      if (!aSeq && bSeq) return 1;
      var createdDelta = String(a && a.createdAt || '').localeCompare(String(b && b.createdAt || ''));
      if (createdDelta !== 0) return createdDelta;
      return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
  }

  function buildProjectDependencyGraph(projectTasks) {
    var list = sortTasksBySequence(projectTasks || []);
    var byId = Object.create(null);
    var positionById = Object.create(null);
    var predecessorById = Object.create(null);
    var dependentsById = Object.create(null);

    list.forEach(function (task, index) {
      if (!task || !task.id) return;
      byId[task.id] = task;
      positionById[task.id] = index;
    });

    function registerEdge(predecessorId, taskId) {
      if (!predecessorId || !taskId || predecessorId === taskId) return;
      predecessorById[taskId] = predecessorId;
      if (!dependentsById[predecessorId]) dependentsById[predecessorId] = [];
      if (dependentsById[predecessorId].indexOf(taskId) === -1) dependentsById[predecessorId].push(taskId);
    }

    function findPrimaryPredecessor(task) {
      if (!task || !task.id) return null;
      var dependencyIds = Array.isArray(task.dependencyTaskIds) ? task.dependencyTaskIds : [];
      var candidates = dependencyIds.map(function (dependencyId) {
        return byId[String(dependencyId || '').trim()];
      }).filter(function (item) {
        return item && item.id !== task.id;
      });

      if (candidates.length > 0) {
        candidates.sort(function (left, right) {
          var leftSeq = Number(left && left.sequenceIndex || 0) || 0;
          var rightSeq = Number(right && right.sequenceIndex || 0) || 0;
          if (leftSeq !== rightSeq) return rightSeq - leftSeq;
          return (positionById[right.id] || 0) - (positionById[left.id] || 0);
        });
        return candidates[0];
      }

      if (task.dependsOnPrevious) {
        var position = typeof positionById[task.id] === 'number' ? positionById[task.id] : -1;
        if (position > 0) return list[position - 1];
      }

      return null;
    }

    list.forEach(function (task) {
      var predecessor = findPrimaryPredecessor(task);
      if (predecessor && predecessor.id) registerEdge(predecessor.id, task.id);
    });

    return {
      byId: byId,
      predecessorById: predecessorById,
      dependentsById: dependentsById
    };
  }

  function getTaskChainRows(taskDraft) {
    var projectTasks = getProjectTaskList(taskDraft && taskDraft.projectId);
    var graph = buildProjectDependencyGraph(projectTasks);
    var taskId = taskDraft && taskDraft.id ? taskDraft.id : '';
    var component = Object.create(null);
    var queue = taskId ? [taskId] : [];

    while (queue.length) {
      var currentId = queue.shift();
      if (!currentId || component[currentId]) continue;
      component[currentId] = true;

      var predecessorId = graph.predecessorById[currentId];
      if (predecessorId && !component[predecessorId]) queue.push(predecessorId);

      var dependents = graph.dependentsById[currentId] || [];
      dependents.forEach(function (depId) {
        if (!component[depId]) queue.push(depId);
      });
    }

    var ids = Object.keys(component);
    if (!ids.length && taskId) ids = [taskId];

    var rows = ids.map(function (id) {
      var source = id === taskId ? taskDraft : graph.byId[id];
      if (!source) source = { id: id, title: '', effortHours: 0, status: 'todo' };
      return {
        taskId: id,
        title: source.title || '',
        effortHours: Number(source.effortHours || 0) || 0,
        status: source.status || 'todo',
        isCurrent: id === taskId,
        isNew: false
      };
    });

    rows = rows.map(function (row) {
      var source = row.isCurrent ? taskDraft : (graph.byId[row.taskId] || {});
      row.__seq = Number(source && source.sequenceIndex || 0) || 0;
      row.__createdAt = source && source.createdAt || '';
      return row;
    }).sort(function (a, b) {
      if (a.__seq && b.__seq && a.__seq !== b.__seq) return a.__seq - b.__seq;
      if (a.__seq && !b.__seq) return -1;
      if (!a.__seq && b.__seq) return 1;
      var createdDelta = String(a.__createdAt || '').localeCompare(String(b.__createdAt || ''));
      if (createdDelta !== 0) return createdDelta;
      return String(a.taskId || '').localeCompare(String(b.taskId || ''));
    }).map(function (row) {
      delete row.__seq;
      delete row.__createdAt;
      return row;
    });

    return {
      originalTaskIds: rows.filter(function (row) { return !!row.taskId; }).map(function (row) { return row.taskId; }),
      rows: rows
    };
  }

  function getMaxProjectSequenceIndex(projectId) {
    var maxIndex = 0;
    getProjectTaskList(projectId).forEach(function (task) {
      var seq = Number(task && task.sequenceIndex || 0) || 0;
      if (seq > maxIndex) maxIndex = seq;
    });
    return maxIndex;
  }

  function buildTaskChainEditorHtml(chainDraft) {
    var rows = chainDraft && Array.isArray(chainDraft.rows) ? chainDraft.rows : [];
    var html = '<section class="task-cockpit-chain">';
    html += '<div class="task-cockpit-chain-head">';
    html += '<h3>Kettenaufgaben</h3>';
    html += '<button type="button" class="btn btn-secondary" id="task-cockpit-chain-add">Schritt hinzufuegen</button>';
    html += '</div>';
    html += '<p class="text-muted">Entfernte Schritte werden geloescht. Beim Speichern wird die Reihenfolge neu verkettet.</p>';

    if (!rows.length) {
      html += '<p class="text-muted">Noch keine Kette vorhanden.</p>';
    } else {
      html += '<div class="task-cockpit-chain-rows">';
      rows.forEach(function (row, index) {
        var statusLabel = getStatusLabel(row.status || 'todo');
        var currentMarker = row.isCurrent ? ' <span class="task-cockpit-chain-current">(aktuelle Aufgabe)</span>' : '';
        html += '<div class="task-cockpit-chain-row" data-chain-row="' + index + '">';
        html += '<div class="task-cockpit-chain-row-head">';
        html += '<strong>Schritt ' + (index + 1) + currentMarker + '</strong>';
        html += '<span class="task-cockpit-chain-status">' + escapeHtml(statusLabel) + '</span>';
        html += '</div>';
        html += '<div class="task-cockpit-inline">';
        html += '<input type="text" data-chain-field="title" data-row-index="' + index + '" value="' + escapeHtml(row.title || '') + '" placeholder="Schritt-Titel" ' + (row.isCurrent ? 'readonly' : '') + '>';
        html += '<input type="number" min="0" step="0.5" data-chain-field="effort" data-row-index="' + index + '" value="' + escapeHtml(String(Number(row.effortHours || 0) || 0)) + '" aria-label="Aufwand in Stunden" ' + (row.isCurrent ? 'readonly' : '') + '>';
        html += '<button type="button" class="btn btn-secondary" data-chain-remove="' + index + '" ' + (row.isCurrent ? 'disabled' : '') + '>Entfernen</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</section>';
    return html;
  }

  function renderTaskChainEditor() {
    var chainWrap = document.getElementById('task-cockpit-chain-wrap');
    if (!chainWrap) return;
    chainWrap.innerHTML = buildTaskChainEditorHtml(currentTaskChainDraft);
  }

  function saveTaskChainDraft(currentTask) {
    if (!currentTask || !currentTask.id || !currentTaskChainDraft || !Array.isArray(currentTaskChainDraft.rows)) return;

    var rows = currentTaskChainDraft.rows.filter(function (row) {
      return !!String(row && row.title || '').trim();
    }).map(function (row) {
      return {
        taskId: row.taskId || '',
        title: String(row.title || '').trim(),
        effortHours: Number(row.effortHours || 0) || 0,
        status: row.status || 'todo',
        isCurrent: !!row.isCurrent,
        isNew: !!row.isNew
      };
    });

    var hasCurrent = rows.some(function (row) { return row.isCurrent || row.taskId === currentTask.id; });
    if (!hasCurrent) {
      rows.unshift({
        taskId: currentTask.id,
        title: currentTask.title || 'Ohne Titel',
        effortHours: Number(currentTask.effortHours || 0) || 0,
        status: currentTask.status || 'todo',
        isCurrent: true,
        isNew: false
      });
    }

    var existingRows = rows.filter(function (row) { return !!row.taskId; });
    var existingSequence = existingRows.map(function (row) {
      var source = row.taskId === currentTask.id ? currentTask : window.DataLayer.getTaskById(row.taskId);
      return Number(source && source.sequenceIndex || 0) || 0;
    }).filter(function (value) { return value > 0; });

    var baseSequence = existingSequence.length
      ? Math.min.apply(Math, existingSequence)
      : getMaxProjectSequenceIndex(currentTask.projectId) + 1;

    var removedIds = (currentTaskChainDraft.originalTaskIds || []).filter(function (taskId) {
      if (!taskId || taskId === currentTask.id) return false;
      return !rows.some(function (row) { return row.taskId === taskId; });
    });

    var previousTaskId = '';
    rows.forEach(function (row, index) {
      var sequenceIndex = baseSequence + index;
      var dependencyIds = previousTaskId ? [previousTaskId] : [];
      var rowTask = null;

      if (row.taskId === currentTask.id) {
        rowTask = currentTask;
      } else if (row.taskId) {
        rowTask = window.DataLayer.getTaskById(row.taskId);
      }

      if (rowTask) {
        if (rowTask.id !== currentTask.id) {
          rowTask.title = row.title;
          rowTask.effortHours = row.effortHours;
        }
        rowTask.projectId = currentTask.projectId || null;
        rowTask.sequenceIndex = sequenceIndex;
        rowTask.dependsOnPrevious = index > 0;
        rowTask.dependencyTaskIds = dependencyIds;
        if (rowTask.id !== currentTask.id) window.DataLayer.updateTask(rowTask);
        previousTaskId = rowTask.id;
        return;
      }

      var createdTask = window.DataLayer.createTask({
        title: row.title,
        description: '',
        priority: currentTask.priority || 'medium',
        urgency: currentTask.urgency || 'normal',
        projectId: currentTask.projectId || null,
        assigneeId: currentTask.assigneeId || null,
        labels: Array.isArray(currentTask.labels) ? currentTask.labels.slice() : [],
        status: 'todo',
        effortHours: row.effortHours,
        schedule: { mode: 'none', deadline: '', fixedAt: '', rangeStart: '', rangeEnd: '' },
        subtasks: [],
        notes: [],
        attachments: [],
        sequenceIndex: sequenceIndex,
        dependsOnPrevious: index > 0,
        dependencyTaskIds: dependencyIds
      });

      if (createdTask && createdTask.id) {
        row.taskId = createdTask.id;
        previousTaskId = createdTask.id;
      }
    });

    removedIds.forEach(function (taskId) {
      window.DataLayer.deleteTask(taskId);
    });
  }

  function openTaskControlModal(taskId) {
    var task = window.DataLayer.getTaskById(taskId);
    if (!task) return;

    var auth = getAuthManager();
    if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) {
      alert('Diese Aufgabe kann nur gelesen werden.');
      return;
    }

    currentTaskDraft = clone(task);
    normalizeTaskCollections(currentTaskDraft);
    currentTaskChainDraft = getTaskChainRows(currentTaskDraft);

    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var employees = window.DataLayer.getEmployees() || [];
    var projects = window.DataLayer.getProjects() || [];
    var labels = window.DataLayer.getLabels() || [];

    var employeeOptions = '<option value="">-- Nicht zugewiesen --</option>' + employees.map(function (emp) {
      var selected = currentTaskDraft.assigneeId === emp.id ? ' selected' : '';
      return '<option value="' + escapeHtml(emp.id) + '"' + selected + '>' + escapeHtml(emp.name) + '</option>';
    }).join('');

    var projectOptions = '<option value="">-- Kein Projekt --</option>' + projects.map(function (project) {
      var selected = currentTaskDraft.projectId === project.id ? ' selected' : '';
      return '<option value="' + escapeHtml(project.id) + '"' + selected + '>' + escapeHtml(project.title || project.name || 'Projekt') + '</option>';
    }).join('');

    var labelOptions = labels.map(function (label) {
      var selected = currentTaskDraft.labels && currentTaskDraft.labels.indexOf(label.id) !== -1 ? ' selected' : '';
      return '<option value="' + escapeHtml(label.id) + '"' + selected + '>' + escapeHtml(label.name || 'Label') + '</option>';
    }).join('');

    content.innerHTML = '' +
      '<h2>Aufgabe steuern</h2>' +
      '<p class="text-muted">Erstellt: ' + escapeHtml(new Date(currentTaskDraft.createdAt || Date.now()).toLocaleString('de-DE')) + '</p>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label for="task-cockpit-title">Titel *</label><input type="text" id="task-cockpit-title" value="' + escapeHtml(currentTaskDraft.title || '') + '"></div>' +
      '  <div class="form-group"><label for="task-cockpit-status">Status</label><select id="task-cockpit-status"><option value="backlog">Backlog</option><option value="todo">To Do</option><option value="in-progress">In Progress</option><option value="review">Review</option><option value="done">Done</option></select></div>' +
      '</div>' +
      '<div class="form-group"><label for="task-cockpit-description">Beschreibung</label><textarea id="task-cockpit-description" rows="3">' + escapeHtml(currentTaskDraft.description || '') + '</textarea></div>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label for="task-cockpit-priority">Priorität</label><select id="task-cockpit-priority"><option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option><option value="blocker">Blocker</option></select></div>' +
      '  <div class="form-group"><label for="task-cockpit-urgency">Dringlichkeit</label><select id="task-cockpit-urgency"><option value="low">Niedrig</option><option value="normal">Normal</option><option value="high">Hoch</option><option value="critical">Kritisch</option></select></div>' +
      '  <div class="form-group"><label for="task-cockpit-effort">Aufwand (h)</label><input type="number" min="0" step="0.5" id="task-cockpit-effort" value="' + escapeHtml(String(currentTaskDraft.effortHours || 0)) + '"></div>' +
      '</div>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label for="task-cockpit-assignee">Zuweisung</label><select id="task-cockpit-assignee">' + employeeOptions + '</select></div>' +
      '  <div class="form-group"><label for="task-cockpit-project">Projekt</label><select id="task-cockpit-project">' + projectOptions + '</select></div>' +
      '</div>' +
      '<div class="form-group"><label for="task-cockpit-labels">Labels</label><select id="task-cockpit-labels" multiple style="min-height:96px;">' + labelOptions + '</select></div>' +
      '<div class="form-group"><label for="task-cockpit-schedule-mode">Terminlogik</label><select id="task-cockpit-schedule-mode"><option value="none">Kein Termin</option><option value="deadline">Deadline</option><option value="fixed">Fester Termin</option><option value="range">Zeitraum</option><option value="asap">Umgehend</option></select></div>' +
      '<div id="task-cockpit-schedule-fields"></div>' +
      '<hr>' +
      '<div id="task-cockpit-chain-wrap">' + buildTaskChainEditorHtml(currentTaskChainDraft) + '</div>' +
      '<hr>' +
      '<h3>Teilaufgaben</h3>' +
      '<div id="task-cockpit-subtasks">' + buildSubtaskListHtml(currentTaskDraft) + '</div>' +
      '<div class="task-cockpit-inline">' +
      '  <input type="text" id="task-cockpit-subtask-input" placeholder="Neue Teilaufgabe">' +
      '  <button type="button" class="btn btn-secondary" id="task-cockpit-subtask-add">Hinzufügen</button>' +
      '</div>' +
      '<hr>' +
      '<h3>Notizen / Hinweise</h3>' +
      '<div id="task-cockpit-notes">' + buildNotesHtml(currentTaskDraft) + '</div>' +
      '<div class="task-cockpit-inline">' +
      '  <input type="text" id="task-cockpit-note-input" placeholder="Hinweis hinzufügen">' +
      '  <button type="button" class="btn btn-secondary" id="task-cockpit-note-add">Hinzufügen</button>' +
      '</div>' +
      '<hr>' +
      '<h3>Dateien / Links</h3>' +
      '<div id="task-cockpit-attachments">' + buildAttachmentsHtml(currentTaskDraft) + '</div>' +
      '<div class="task-cockpit-grid">' +
      '  <div class="form-group"><label for="task-cockpit-attachment-name">Name</label><input type="text" id="task-cockpit-attachment-name" placeholder="z. B. Spezifikation.pdf"></div>' +
      '  <div class="form-group"><label for="task-cockpit-attachment-url">URL / Pfad</label><input type="text" id="task-cockpit-attachment-url" placeholder="https://... oder /pfad/datei"></div>' +
      '</div>' +
      '<div class="task-cockpit-inline">' +
      '  <button type="button" class="kanban-icon-btn" id="task-cockpit-attachment-upload" title="Datei anhaengen"><span class="material-symbols-rounded" aria-hidden="true">attach_file</span><span class="sr-only">Datei anhaengen</span></button>' +
      '  <input type="file" id="task-cockpit-attachment-file" class="sr-only" multiple>' +
      '  <span class="text-muted">Datei hochladen oder Link per Enter hinzufuegen. Max. ' + formatBytes(MAX_TASK_ATTACHMENT_SIZE) + ' pro Datei.</span>' +
      '</div>' +
      '<hr>' +
      buildTaskBlockerPanel(currentTaskDraft) +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn btn-secondary" id="task-cockpit-close">Schließen</button>' +
      '  <button type="button" class="btn btn-danger" id="task-cockpit-delete">Löschen</button>' +
      '  <button type="button" class="btn btn-primary" id="task-cockpit-save">Speichern</button>' +
      '</div>';

    overlay.classList.remove('hidden');

    var statusInput = document.getElementById('task-cockpit-status');
    var priorityInput = document.getElementById('task-cockpit-priority');
    var urgencyInput = document.getElementById('task-cockpit-urgency');
    var scheduleMode = document.getElementById('task-cockpit-schedule-mode');

    if (statusInput) statusInput.value = currentTaskDraft.status || 'todo';
    if (priorityInput) priorityInput.value = currentTaskDraft.priority || 'medium';
    if (urgencyInput) urgencyInput.value = currentTaskDraft.urgency || 'normal';
    if (scheduleMode) scheduleMode.value = (currentTaskDraft.schedule && currentTaskDraft.schedule.mode) || 'none';
    renderScheduleFields(currentTaskDraft);

    if (scheduleMode) {
      scheduleMode.addEventListener('change', function () {
        currentTaskDraft.schedule.mode = scheduleMode.value;
        renderScheduleFields(currentTaskDraft);
      });
    }

    var chainWrap = document.getElementById('task-cockpit-chain-wrap');
    if (chainWrap) {
      chainWrap.addEventListener('input', function (event) {
        var input = event.target;
        if (!input || !input.getAttribute) return;
        var field = input.getAttribute('data-chain-field');
        var rowIndex = parseInt(input.getAttribute('data-row-index') || '-1', 10);
        if (!field || rowIndex < 0 || !currentTaskChainDraft || !currentTaskChainDraft.rows || !currentTaskChainDraft.rows[rowIndex]) return;
        if (field === 'title') {
          currentTaskChainDraft.rows[rowIndex].title = input.value || '';
        } else if (field === 'effort') {
          currentTaskChainDraft.rows[rowIndex].effortHours = Number(input.value || 0) || 0;
        }
      });

      chainWrap.addEventListener('click', function (event) {
        var addBtn = event.target.closest('#task-cockpit-chain-add');
        if (addBtn) {
          currentTaskChainDraft.rows.push({
            taskId: '',
            title: '',
            effortHours: 0,
            status: 'todo',
            isCurrent: false,
            isNew: true
          });
          renderTaskChainEditor();
          return;
        }

        var removeBtn = event.target.closest('[data-chain-remove]');
        if (!removeBtn) return;
        var removeIndex = parseInt(removeBtn.getAttribute('data-chain-remove') || '-1', 10);
        if (removeIndex < 0 || !currentTaskChainDraft || !currentTaskChainDraft.rows || !currentTaskChainDraft.rows[removeIndex]) return;
        var row = currentTaskChainDraft.rows[removeIndex];
        if (row.isCurrent) return;
        if (row.taskId && !window.confirm('Dieser Schritt wird inklusive Aufgabe geloescht. Fortfahren?')) return;
        currentTaskChainDraft.rows.splice(removeIndex, 1);
        renderTaskChainEditor();
      });
    }

    var subtaskContainer = document.getElementById('task-cockpit-subtasks');
    if (subtaskContainer) {
      subtaskContainer.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-subtask-remove]');
        if (removeBtn) {
          var subtaskId = removeBtn.getAttribute('data-subtask-remove');
          currentTaskDraft.subtasks = currentTaskDraft.subtasks.filter(function (st) { return st.id !== subtaskId; });
          subtaskContainer.innerHTML = buildSubtaskListHtml(currentTaskDraft);
        }
      });

      subtaskContainer.addEventListener('change', function (event) {
        var toggle = event.target.closest('[data-subtask-toggle]');
        if (!toggle) return;
        var subtaskId = toggle.getAttribute('data-subtask-toggle');
        currentTaskDraft.subtasks.forEach(function (st) {
          if (st.id === subtaskId) st.completed = !!toggle.checked;
        });
      });
    }

    var noteContainer = document.getElementById('task-cockpit-notes');
    if (noteContainer) {
      noteContainer.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-note-remove]');
        if (!removeBtn) return;
        var noteId = removeBtn.getAttribute('data-note-remove');
        currentTaskDraft.notes = currentTaskDraft.notes.filter(function (note) { return note.id !== noteId; });
        noteContainer.innerHTML = buildNotesHtml(currentTaskDraft);
      });
    }

    var attachmentsContainer = document.getElementById('task-cockpit-attachments');
    if (attachmentsContainer) {
      attachmentsContainer.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-attachment-remove]');
        if (!removeBtn) return;
        var attachmentId = removeBtn.getAttribute('data-attachment-remove');
        currentTaskDraft.attachments = currentTaskDraft.attachments.filter(function (item) { return item.id !== attachmentId; });
        attachmentsContainer.innerHTML = buildAttachmentsHtml(currentTaskDraft);
      });
    }

    var addSubtaskBtn = document.getElementById('task-cockpit-subtask-add');
    if (addSubtaskBtn) {
      addSubtaskBtn.addEventListener('click', function () {
        var input = document.getElementById('task-cockpit-subtask-input');
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;
        currentTaskDraft.subtasks.push({ id: window.DataLayer.generateId(), title: text, completed: false, createdAt: new Date().toISOString() });
        input.value = '';
        subtaskContainer.innerHTML = buildSubtaskListHtml(currentTaskDraft);
      });
    }

    var addNoteBtn = document.getElementById('task-cockpit-note-add');
    if (addNoteBtn) {
      addNoteBtn.addEventListener('click', function () {
        var input = document.getElementById('task-cockpit-note-input');
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;
        currentTaskDraft.notes.push({ id: window.DataLayer.generateId(), text: text, createdAt: new Date().toISOString() });
        input.value = '';
        noteContainer.innerHTML = buildNotesHtml(currentTaskDraft);
      });
    }

    var addAttachmentBtn = document.getElementById('task-cockpit-attachment-url');
    var addAttachmentNameInput = document.getElementById('task-cockpit-attachment-name');
    var attachmentUploadBtn = document.getElementById('task-cockpit-attachment-upload');
    var attachmentFileInput = document.getElementById('task-cockpit-attachment-file');
    if (addAttachmentBtn) {
      addAttachmentBtn.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        var url = addAttachmentBtn.value.trim();
        var name = addAttachmentNameInput ? addAttachmentNameInput.value.trim() : '';
        if (!addLinkAttachmentToDraft(currentTaskDraft, name, url)) return;
        addAttachmentBtn.value = '';
        if (addAttachmentNameInput) addAttachmentNameInput.value = '';
        attachmentsContainer.innerHTML = buildAttachmentsHtml(currentTaskDraft);
      });
    }

    if (attachmentUploadBtn && attachmentFileInput) {
      attachmentUploadBtn.addEventListener('click', function () {
        attachmentFileInput.click();
      });

      attachmentFileInput.addEventListener('change', function () {
        addFilesToTaskDraft(currentTaskDraft, attachmentFileInput.files).then(function (result) {
          if (result && result.added > 0) {
            attachmentsContainer.innerHTML = buildAttachmentsHtml(currentTaskDraft);
          }
          attachmentFileInput.value = '';
        }).catch(function (error) {
          attachmentFileInput.value = '';
          alert('Dateiupload fehlgeschlagen: ' + error.message);
        });
      });
    }

    var closeBtn = document.getElementById('task-cockpit-close');
    if (closeBtn) closeBtn.addEventListener('click', closeTaskControlModal);

    var deleteBtn = document.getElementById('task-cockpit-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (!currentTaskDraft || !currentTaskDraft.id) return;
        if (!window.confirm('Aufgabe wirklich löschen?')) return;
        window.DataLayer.deleteTask(currentTaskDraft.id);
        closeTaskControlModal();
      });
    }

    var resolveBlockerBtn = document.getElementById('task-cockpit-resolve-blocker');
    if (resolveBlockerBtn) {
      resolveBlockerBtn.addEventListener('click', function () {
        if (!currentTaskDraft || !currentTaskDraft.id) return;
        if (window.DataLayer && typeof window.DataLayer.canResolveBlocker === 'function' && !window.DataLayer.canResolveBlocker({
          targetType: 'task',
          targetId: currentTaskDraft.id,
          blockerTaskId: currentTaskDraft.blockerTaskId || ''
        })) {
          alert('Blocker koennen nur von Admins oder vom Ersteller des Blockers entfernt werden.');
          return;
        }
        askResolutionText('Warum wurde der Blocker entfernt?', 'Blocker geloest').then(function(resolution) {
          if (resolution === null) return;
          if (window.DataLayer && typeof window.DataLayer.resolveTaskBlock === 'function') {
            var resolved = window.DataLayer.resolveTaskBlock(currentTaskDraft.id, {
              at: getNowIsoString(),
              resolution: String(resolution || '').trim() || 'Blocker geloest'
            });
            if (!resolved) {
              alert('Blocker konnte nicht entfernt werden (Rechte oder Datenstand).');
              return;
            }
          }
          closeTaskControlModal();
        });
      });
    }

    var saveBtn = document.getElementById('task-cockpit-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!currentTaskDraft) return;

        var titleInput = document.getElementById('task-cockpit-title');
        if (!titleInput || !titleInput.value.trim()) {
          alert('Titel ist erforderlich.');
          return;
        }

        currentTaskDraft.title = titleInput.value.trim();
        currentTaskDraft.description = (document.getElementById('task-cockpit-description').value || '').trim();
        var nextStatus = document.getElementById('task-cockpit-status').value;
        currentTaskDraft.priority = document.getElementById('task-cockpit-priority').value;
        currentTaskDraft.urgency = document.getElementById('task-cockpit-urgency').value;
        currentTaskDraft.effortHours = parseFloat(document.getElementById('task-cockpit-effort').value || '0') || 0;
        currentTaskDraft.assigneeId = document.getElementById('task-cockpit-assignee').value || null;
        currentTaskDraft.projectId = document.getElementById('task-cockpit-project').value || null;

        var labelsSelect = document.getElementById('task-cockpit-labels');
        var selectedLabelIds = [];
        if (labelsSelect && labelsSelect.selectedOptions) {
          for (var i = 0; i < labelsSelect.selectedOptions.length; i++) {
            selectedLabelIds.push(labelsSelect.selectedOptions[i].value);
          }
        }
        currentTaskDraft.labels = selectedLabelIds;

        var mode = document.getElementById('task-cockpit-schedule-mode').value;
        currentTaskDraft.schedule = {
          mode: mode,
          deadline: '',
          fixedAt: '',
          rangeStart: '',
          rangeEnd: ''
        };
        if (mode === 'deadline') {
          var deadlineInput = document.getElementById('task-cockpit-deadline');
          currentTaskDraft.schedule.deadline = deadlineInput ? deadlineInput.value : '';
        } else if (mode === 'fixed') {
          var fixedInput = document.getElementById('task-cockpit-fixed');
          currentTaskDraft.schedule.fixedAt = fixedInput ? fixedInput.value : '';
        } else if (mode === 'range') {
          var startInput = document.getElementById('task-cockpit-range-start');
          var endInput = document.getElementById('task-cockpit-range-end');
          currentTaskDraft.schedule.rangeStart = startInput ? startInput.value : '';
          currentTaskDraft.schedule.rangeEnd = endInput ? endInput.value : '';
        }

        applyTaskStatusTransition(currentTaskDraft, nextStatus, { at: getNowIsoString() });

        saveTaskChainDraft(currentTaskDraft);
        window.DataLayer.updateTask(currentTaskDraft);
        closeTaskControlModal();
      });
    }
  }

  function setupTaskCardInteractions() {
    document.addEventListener('input', function (e) {
      var progressInput = e.target.closest('[data-task-progress-input]');
      if (!progressInput) return;

      var taskId = progressInput.getAttribute('data-task-progress-input');
      var progressValue = normalizeTaskProgress(progressInput.value, 0);
      progressInput.value = String(progressValue);

      var card = progressInput.closest('.kanban-card');
      if (card) {
        var valueLabel = card.querySelector('[data-task-progress-label]');
        if (valueLabel) valueLabel.textContent = progressValue + '%';
      }

      persistTaskProgress(taskId, progressValue);
    });

    document.addEventListener('click', function (e) {
      var attachmentBtn = e.target.closest('[data-task-attachment-upload]');
      if (attachmentBtn) {
        openTaskAttachmentPicker(attachmentBtn.getAttribute('data-task-attachment-upload'));
        return;
      }

      var pauseBtn = e.target.closest('[data-task-pause-toggle]');
      if (pauseBtn) {
        toggleTaskPause(pauseBtn.getAttribute('data-task-pause-toggle'));
        return;
      }

      var completeBtn = e.target.closest('[data-task-complete]');
      if (completeBtn) {
        setTaskStatus(completeBtn.getAttribute('data-task-complete'), 'done');
        return;
      }

      var statusBtn = e.target.closest('[data-task-status]');
      if (statusBtn) {
        setTaskStatus(statusBtn.getAttribute('data-task-id'), statusBtn.getAttribute('data-task-status'));
        return;
      }

      var dayAssigneeBtn = e.target.closest('[data-day-assignee]');
      if (dayAssigneeBtn) {
        var assigneeId = dayAssigneeBtn.getAttribute('data-day-assignee');
        filterAssigneeId = assigneeId === 'unassigned' ? UNASSIGNED_FILTER_VALUE : assigneeId;
        renderAllColumns();
        return;
      }

      var viewBtn = e.target.closest('[data-kanban-view]');
      if (viewBtn) {
        currentKanbanView = viewBtn.getAttribute('data-kanban-view') || 'board';
        updateViewVisibility();
        syncFilterControls();
        return;
      }

      var cardModeBtn = e.target.closest('[data-kanban-card-mode]');
      if (cardModeBtn) {
        currentCardMode = cardModeBtn.getAttribute('data-kanban-card-mode') || 'full';
        renderAllColumns();
        return;
      }

      var openBtn = e.target.closest('[data-task-open]');
      if (openBtn) {
        openTaskControlModal(openBtn.getAttribute('data-task-open'));
        return;
      }

      var card = e.target.closest('.kanban-card');
      if (!card) return;
      if (e.target.closest('.kanban-subtask-item') || e.target.closest('.kanban-status-step') || e.target.closest('.kanban-icon-btn') || e.target.closest('[data-task-progress-input]')) return;
      openTaskControlModal(card.dataset.taskId);
    });
  }

  function handleDataChanged(event) {
    if (skipNextTaskRender && event && event.entity === 'tasks' && event.action === 'update') {
      skipNextTaskRender = false;
      refreshLiveTaskMetrics();
      return;
    }
    skipNextTaskRender = false;
    renderAllColumns();
  }

  // --- Filterleiste rendern und Event-Handler ---
  function setupFilters() {
    var filterBar = document.getElementById('kanban-filters');
    if (!filterBar) return;

    var employees = window.DataLayer.getEmployees();
    var projects = window.DataLayer.getProjects();

    var html = '<div class="kanban-filter-bar">';
    html += '<div class="kanban-filter-group kanban-view-switch" role="group" aria-label="Kanban Ansicht">';
    html += '<button type="button" class="kanban-view-btn is-active" data-kanban-view="board" aria-pressed="true"><span class="material-symbols-rounded" aria-hidden="true">view_kanban</span><span>Board</span></button>';
    html += '<button type="button" class="kanban-view-btn" data-kanban-view="day" aria-pressed="false"><span class="material-symbols-rounded" aria-hidden="true">today</span><span>Tageslast</span></button>';
    html += '</div>';
    html += '<div class="kanban-filter-group kanban-view-switch" role="group" aria-label="Kartenansicht">';
    html += '<button type="button" class="kanban-view-btn is-active" data-kanban-card-mode="full" aria-pressed="true"><span class="material-symbols-rounded" aria-hidden="true">view_agenda</span><span>Voll</span></button>';
    html += '<button type="button" class="kanban-view-btn" data-kanban-card-mode="compact" aria-pressed="false"><span class="material-symbols-rounded" aria-hidden="true">view_list</span><span>Kompakt</span></button>';
    html += '</div>';
    html += '<div class="kanban-filter-group">';
    html += '<label for="filter-assignee">Mitarbeiter</label>';
    html += '<select id="filter-assignee">';
    html += '<option value="">Alle</option>';
    html += '<option value="' + UNASSIGNED_FILTER_VALUE + '">Nicht zugewiesen</option>';
    employees.forEach(function(emp) {
      html += '<option value="' + escapeHtml(emp.id) + '">' + escapeHtml(emp.name) + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<div class="kanban-filter-group">';
    html += '<label for="filter-priority">Prioritaet</label>';
    html += '<select id="filter-priority">';
    html += '<option value="">Alle</option>';
    html += '<option value="high">Hoch</option>';
    html += '<option value="medium">Mittel</option>';
    html += '<option value="low">Niedrig</option>';
    html += '<option value="blocker">Blocker</option>';
    html += '</select>';
    html += '</div>';
    html += '<div class="kanban-filter-group">';
    html += '<label for="filter-urgency">Dringlichkeit</label>';
    html += '<select id="filter-urgency">';
    html += '<option value="">Alle</option>';
    html += '<option value="critical">Kritisch</option>';
    html += '<option value="high">Hoch</option>';
    html += '<option value="normal">Normal</option>';
    html += '<option value="low">Niedrig</option>';
    html += '</select>';
    html += '</div>';
    html += '<div class="kanban-filter-group">';
    html += '<label for="filter-project">Projekt</label>';
    html += '<select id="filter-project">';
    html += '<option value="">Alle</option>';
    projects.forEach(function(project) {
      html += '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.title || project.name || 'Projekt') + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<div class="kanban-filter-group kanban-filter-actions">';
    html += '<label>&nbsp;</label>';
    html += '<button id="filter-reset" class="btn btn-secondary" type="button"><span class="material-symbols-rounded" aria-hidden="true">replay</span><span>Reset</span></button>';
    html += '</div>';
    html += '</div>';

    filterBar.innerHTML = html;

    // Event-Handler für Filter-Dropdowns
    document.getElementById('filter-assignee').addEventListener('change', function(e) {
      filterAssigneeId = e.target.value;
      renderAllColumns();
    });

    document.getElementById('filter-priority').addEventListener('change', function(e) {
      filterPriority = e.target.value;
      renderAllColumns();
    });

    document.getElementById('filter-urgency').addEventListener('change', function(e) {
      filterUrgency = e.target.value;
      renderAllColumns();
    });

    document.getElementById('filter-project').addEventListener('change', function(e) {
      filterProjectId = e.target.value;
      renderAllColumns();
    });

    var resetBtn = document.getElementById('filter-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        filterAssigneeId = '';
        filterPriority = '';
        filterUrgency = '';
        filterProjectId = '';
        renderAllColumns();
      });
    }

    syncFilterControls();
  }

  // --- Main Render Function ---
  function initKanban() {
    try {
      setupFilters();
      renderAllColumns();
      setupDragAndDrop();
      setupSubtaskCheckboxes();
      setupTaskCardInteractions();
      startLiveTaskRefresh();
    } catch(e) { console.error('[' + NAMESPACE + '] Error:', e); }
  }

  // --- Init: Warte auf DOMContentLoaded und DataLayer ---
  function onReady() {
    if (!window.DataLayer) {
      setTimeout(onReady, 100);
      return;
    }

    // Public API
    window.KanbanBoard = {
      renderAllColumns: renderAllColumns,
      getFilteredTasks: getFilteredTasks,
      setFilterAssigneeId: function(id) { filterAssigneeId = id; renderAllColumns(); },
      setFilterPriority: function(p) { filterPriority = p; renderAllColumns(); }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        initKanban();
        window.DataLayer.on('dataChanged', handleDataChanged);
      });
    } else {
      initKanban();
      window.DataLayer.on('dataChanged', handleDataChanged);
    }
  }

  onReady();

})();

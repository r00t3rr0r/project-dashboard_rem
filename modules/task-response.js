/* Expected answers for tasks. */
(function () {
  'use strict';

  var types = {
    file: { label: 'Datei', icon: 'attach_file', color: 'var(--accent-purple)' },
    choice: { label: 'Auswahl', icon: 'checklist', color: 'var(--accent-cyan, #22b8cf)' },
    text: { label: 'Text', icon: 'edit_note', color: 'var(--accent-yellow)' },
    appointment: { label: 'Termin', icon: 'event', color: 'var(--accent-blue)' }
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function canConfigure(task) {
    var auth = window.AuthManager;
    if (!auth || typeof auth.getMode !== 'function') return true;
    var mode = auth.getMode();
    if (mode === 'setup' || mode === 'admin' || mode === 'management') return true;
    var user = typeof auth.getCurrentUser === 'function' && auth.getCurrentUser();
    return !!(user && task && task.createdByEmployeeId && String(user.id) === String(task.createdByEmployeeId));
  }

  function editorHtml(prefix, requirement, locked) {
    var config = requirement || {};
    return '<section class="task-response-editor"><h3>Erwartete Antwort</h3>' +
      (locked ? '<p class="text-muted">Die Antwortvorgabe ist für Sie nicht bearbeitbar oder wurde bereits beantwortet.</p>' : '') +
      '<div class="form-group"><label for="' + prefix + '-response-type">Antwortmethode</label><select id="' + prefix + '-response-type"' + (locked ? ' disabled' : '') + '>' +
      '<option value="">Keine Antwort erforderlich</option>' +
      Object.keys(types).map(function (type) {
        return '<option value="' + type + '"' + (config.type === type ? ' selected' : '') + '>' + types[type].label + '</option>';
      }).join('') + '</select></div>' +
      '<div id="' + prefix + '-response-fields"' + (!config.type ? ' hidden' : '') + '>' +
      '<div class="form-group"><label for="' + prefix + '-response-prompt">Was wird benötigt?</label><textarea id="' + prefix + '-response-prompt" rows="2"' + (locked ? ' disabled' : '') + '>' + escapeHtml(config.prompt || '') + '</textarea></div>' +
      '<div class="form-group" id="' + prefix + '-response-options-wrap"' + (config.type === 'choice' ? '' : ' hidden') + '><label for="' + prefix + '-response-options">Antwortmöglichkeiten (eine pro Zeile)</label><textarea id="' + prefix + '-response-options" rows="3"' + (locked ? ' disabled' : '') + '>' + escapeHtml((config.options || []).join('\n')) + '</textarea></div>' +
      '<small class="text-muted">Eine gültige Antwort ist vor dem Abschluss erforderlich. Bei Terminen wird ein Meeting im Teamkalender angelegt.</small></div></section>';
  }

  function bindEditor(prefix) {
    var select = document.getElementById(prefix + '-response-type');
    function update() {
      document.getElementById(prefix + '-response-fields').hidden = !select.value;
      document.getElementById(prefix + '-response-options-wrap').hidden = select.value !== 'choice';
    }
    select.addEventListener('change', update);
    update();
  }

  function readEditor(prefix) {
    var type = document.getElementById(prefix + '-response-type').value;
    if (!type) return null;
    if (!types[type]) throw new Error('Ungültige Antwortmethode.');
    var prompt = document.getElementById(prefix + '-response-prompt').value.trim();
    if (!prompt) throw new Error('Bitte beschreiben, welcher Inhalt als Antwort benötigt wird.');
    var options = [];
    if (type === 'choice') {
      options = document.getElementById(prefix + '-response-options').value.split('\n').map(function (value) {
        return value.trim();
      }).filter(Boolean);
      if (options.length < 2 || new Set(options).size !== options.length) {
        throw new Error('Bitte mindestens zwei unterschiedliche Antwortmöglichkeiten angeben.');
      }
    }
    return { type: type, prompt: prompt, options: options };
  }

  function hasValidAnswer(task) {
    var requirement = task && task.responseRequirement;
    if (!requirement) return true;
    var answer = task.response;
    if (!answer || answer.type !== requirement.type) return false;
    if (answer.type === 'text') return typeof answer.value === 'string' && !!answer.value.trim();
    if (answer.type === 'choice') return Array.isArray(requirement.options) && requirement.options.indexOf(answer.value) !== -1;
    if (answer.type === 'file') return !!(answer.attachment && /^\/api\/task-attachments\/[0-9a-f]{32}$/.test(answer.attachment.url || ''));
    if (answer.type === 'appointment') return !!(answer.date && answer.startTime && answer.endTime && answer.endTime > answer.startTime && answer.calendarEventId);
    return false;
  }

  function detailHtml(task, editable) {
    var requirement = task.responseRequirement;
    if (!requirement) return '';
    var meta = types[requirement.type];
    if (!meta) return '<section class="task-response-panel"><strong>Unbekannte Antwortmethode</strong></section>';
    var answer = hasValidAnswer(task) ? task.response : null;
    var html = '<section class="task-response-panel" style="--response-color:' + meta.color + '"><h3><span class="material-symbols-rounded" aria-hidden="true">' + meta.icon + '</span> Erwartete Antwort: ' + meta.label + '</h3>' +
      '<p class="task-response-prompt">' + escapeHtml(requirement.prompt || '') + '</p><p class="task-response-status">' + (answer ? 'Antwort eingegangen' : 'Antwort erforderlich vor Abschluss') + '</p>';
    if (answer) {
      if (answer.type === 'file') {
        html += '<p>Antwort: <a href="' + escapeHtml(answer.attachment.url) + '" download="' + escapeHtml(answer.attachment.name) + '">' + escapeHtml(answer.attachment.name) + '</a></p>';
      } else if (answer.type === 'appointment') {
        html += '<p>Termin: ' + escapeHtml(answer.date) + ', ' + escapeHtml(answer.startTime) + '–' + escapeHtml(answer.endTime) + ' Uhr (Teamkalender)</p>';
      } else {
        html += '<p class="task-response-prompt">Antwort: ' + escapeHtml(answer.value) + '</p>';
      }
    }
    if (editable) {
      if (requirement.type === 'text') {
        html += '<label for="task-response-value">Ihre Antwort</label><textarea id="task-response-value" rows="3">' + escapeHtml(answer && answer.value || '') + '</textarea>';
      } else if (requirement.type === 'choice') {
        html += '<label for="task-response-value">Ihre Antwort</label><select id="task-response-value"><option value="">Bitte auswählen</option>' +
          (requirement.options || []).map(function (option) {
            return '<option value="' + escapeHtml(option) + '"' + (answer && answer.value === option ? ' selected' : '') + '>' + escapeHtml(option) + '</option>';
          }).join('') + '</select>';
      } else if (requirement.type === 'file') {
        html += '<label for="task-response-file">Datei als Antwort</label><input id="task-response-file" type="file">';
      } else {
        html += '<div class="task-response-date-fields"><label>Datum<input id="task-response-date" type="date" value="' + escapeHtml(answer && answer.date || '') + '"></label>' +
          '<label>Beginn<input id="task-response-start" type="time" value="' + escapeHtml(answer && answer.startTime || '') + '"></label>' +
          '<label>Ende<input id="task-response-end" type="time" value="' + escapeHtml(answer && answer.endTime || '') + '"></label></div>' +
          '<small>Die zugewiesenen Mitarbeitenden werden zum Meeting eingeladen.</small>';
      }
      html += '<button type="button" class="btn btn-primary" id="task-response-submit">' + (answer ? 'Antwort aktualisieren' : 'Antwort abgeben') + '</button><p id="task-response-feedback" role="status" aria-live="polite"></p>';
    }
    return html + '</section>';
  }

  function bindDetail(taskId, uploadFile, refresh) {
    var button = document.getElementById('task-response-submit');
    if (!button) return;
    button.addEventListener('click', function () {
      var task = window.DataLayer.getTaskById(taskId);
      if (!task || !task.responseRequirement) {
        alert('Die Aufgabe oder Antwortvorgabe wurde nicht gefunden. Bitte die Ansicht erneut öffnen.');
        return;
      }
      var auth = window.AuthManager;
      if (auth && typeof auth.canEditTask === 'function' && !auth.canEditTask(task)) {
        alert('Diese Aufgabe kann nur gelesen werden.');
        return;
      }
      var requirement = JSON.stringify(task.responseRequirement);
      var type = task.responseRequirement.type;
      var answer = { type: type, submittedAt: new Date().toISOString() };
      var user = auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
      answer.employeeId = user && user.id ? String(user.id) : '';
      var pending = Promise.resolve();
      if (type === 'text' || type === 'choice') {
        answer.value = document.getElementById('task-response-value').value.trim();
        if (!answer.value || (type === 'choice' && task.responseRequirement.options.indexOf(answer.value) === -1)) {
          alert('Bitte eine gültige Antwort eingeben.');
          return;
        }
      } else if (type === 'file') {
        var files = document.getElementById('task-response-file').files;
        if (!files.length) { alert('Bitte eine Datei auswählen.'); return; }
        pending = uploadFile(files).then(function (attachment) { answer.attachment = attachment; });
      } else if (type === 'appointment') {
        answer.date = document.getElementById('task-response-date').value;
        answer.startTime = document.getElementById('task-response-start').value;
        answer.endTime = document.getElementById('task-response-end').value;
        if (!answer.date || !answer.startTime || !answer.endTime || answer.endTime <= answer.startTime) {
          alert('Bitte Datum und gültige Beginn- und Endzeit angeben.');
          return;
        }
        if (auth && typeof auth.canCreateCalendarEvent === 'function' && !auth.canCreateCalendarEvent()) {
          alert('Für eine Terminantwort ist die Berechtigung zum Anlegen von Kalenderterminen erforderlich.');
          return;
        }
      } else {
        alert('Unbekannte Antwortmethode.');
        return;
      }
      button.disabled = true;
      var feedback = document.getElementById('task-response-feedback');
      feedback.textContent = 'Antwort wird gespeichert …';
      pending.then(function () {
        var fresh = window.DataLayer.getTaskById(taskId);
        if (!fresh || JSON.stringify(fresh.responseRequirement) !== requirement) throw new Error('Die Antwortvorgabe wurde geändert. Bitte die Aufgabe erneut öffnen.');
        var event = null;
        var previousEvent = null;
        if (type === 'appointment') {
          var eventId = fresh.response && fresh.response.calendarEventId;
          previousEvent = eventId && window.DataLayer.getCalendarEventById(eventId);
          event = Object.assign({}, previousEvent || {}, {
            title: fresh.title, date: answer.date, startDate: answer.date, endDate: '', startTime: answer.startTime,
            endTime: answer.endTime, allDay: false, type: 'meeting', employeeStatus: false,
            projectId: fresh.projectId || null, attendeeIds: (fresh.assigneeIds || []).slice(),
            description: 'Termin zur Aufgabe: ' + fresh.title
          });
          if (!event.createdByEmployeeId && answer.employeeId) event.createdByEmployeeId = answer.employeeId;
          if (previousEvent) {
            if (!window.DataLayer.updateCalendarEvent(event)) throw new Error('Der Kalendertermin konnte nicht aktualisiert werden.');
          } else {
            event.responses = {};
            event = window.DataLayer.createCalendarEvent(event);
            if (!event) throw new Error('Der Kalendertermin konnte nicht angelegt werden.');
          }
          answer.calendarEventId = event.id;
        }
        if (!window.DataLayer.updateTaskResponse(taskId, answer)) {
          if (event) {
            var restored = previousEvent ? window.DataLayer.updateCalendarEvent(previousEvent) : window.DataLayer.deleteCalendarEvent(event.id);
            if (!restored) throw new Error('Die Antwort konnte nicht gespeichert und der Kalendertermin nicht zurückgesetzt werden. Bitte den Kalender prüfen.');
          }
          throw new Error('Die Antwort konnte nicht gespeichert werden.');
        }
        return window.DataLayer.waitForTaskAndCalendarSave().then(function (saved) {
          if (!saved) throw new Error('Die Antwort oder der Kalendertermin konnte nicht dauerhaft gespeichert werden. Bitte erneut prüfen.');
          refresh();
        });
      }).catch(function (error) {
        console.error('[Task response]', error);
        feedback.textContent = error.message || 'Die Antwort konnte nicht gespeichert werden.';
        button.disabled = false;
      });
    });
  }

  window.TaskResponse = {
    editorHtml: editorHtml,
    canConfigure: canConfigure,
    bindEditor: bindEditor,
    readEditor: readEditor,
    hasValidAnswer: hasValidAnswer,
    detailHtml: detailHtml,
    bindDetail: bindDetail
  };
})();

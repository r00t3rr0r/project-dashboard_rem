/* ========================================
   Projekt-Dashboard — Sprint Management Module
   ======================================== */
(function () {
  'use strict';

  var NAMESPACE = 'SprintModule';
  var STORAGE_KEY_PREFIX = 'pd_sprint_';

  // ---- Data Helpers (localStorage) ----
  function _load(key, fallback) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
      return raw ? JSON.parse(raw) : (fallback || []);
    } catch (e) {
      console.warn('[' + NAMESPACE + '] Load error for ' + key, e);
      return fallback || [];
    }
  }

  function _save(key, data) {
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(data));
    } catch (e) {
      console.warn('[' + NAMESPACE + '] Save error for ' + key, e);
    }
  }

  // ---- Sprint CRUD ----
  function getSprints()       { return _load('sprints', []); }
  function setSprints(arr)    { _save('sprints', arr); }
  function getRetros()        { return _load('retros', {}); }
  function setRetros(obj)     { _save('retros', obj); }

  function generateId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // ---- Sprint-Erstellung ----
  window[NAMESPACE + '.createSprint'] = function (name, start, end, goal) {
    try {
      if (!name || !start || !end) return alert('Name, Start- und End-Datum sind erforderlich.');
      var sprints = getSprints();
      // Prüfe ob aktiver Sprint existiert → nur ein aktiver Sprint gleichzeitig
      var activeExists = sprints.find(function (s) { return s.status === 'active'; });
      if (activeExists) {
        return alert('Es gibt bereits einen aktiven Sprint: ' + activeExists.name + '. Beende ihn zuerst.');
      }

      var sprint = {
        id: generateId('sp'),
        name: name,
        startDate: start,
        endDate: end,
        goal: goal || '',
        status: 'active',
        tasks: [],           // Task-IDs die zum Sprint gehören
        createdAt: new Date().toISOString(),
        completedAt: null
      };

      sprints.push(sprint);
      setSprints(sprints);
      window.DataLayer.emit('dataChanged');
      return sprint;
    } catch (e) {
      console.error('[' + NAMESPACE + '] createSprint error:', e);
      alert('Fehler beim Erstellen des Sprints: ' + e.message);
      return null;
    }
  };

  // ---- Sprint beenden ----
  window[NAMESPACE + '.endSprint'] = function (sprintId) {
    try {
      var sprints = getSprints();
      var sprint = sprints.find(function (s) { return s.id === sprintId; });
      if (!sprint) return alert('Sprint nicht gefunden.');

      sprint.status = 'completed';
      sprint.completedAt = new Date().toISOString();
      setSprints(sprints);
      window.DataLayer.emit('dataChanged');
    } catch (e) {
      console.error('[' + NAMESPACE + '] endSprint error:', e);
    }
  };

  // ---- Sprint löschen ----
  window[NAMESPACE + '.deleteSprint'] = function (sprintId) {
    try {
      var sprints = getSprints();
      sprints = sprints.filter(function (s) { return s.id !== sprintId; });
      setSprints(sprints);

      // Retro löschen falls vorhanden
      var retros = getRetros();
      delete retros[sprintId];
      setRetros(retros);

      window.DataLayer.emit('dataChanged');
    } catch (e) {
      console.error('[' + NAMESPACE + '] deleteSprint error:', e);
    }
  };

  // ---- Sprint zu Tasks hinzufügen/entfernen ----
  window[NAMESPACE + '.addTaskToSprint'] = function (sprintId, taskId) {
    try {
      var sprints = getSprints();
      var sprint = sprints.find(function (s) { return s.id === sprintId; });
      if (!sprint || sprint.status !== 'active') return;

      if (!sprint.tasks) sprint.tasks = [];
      if (sprint.tasks.indexOf(taskId) === -1) {
        sprint.tasks.push(taskId);
        setSprints(sprints);
        window.DataLayer.emit('dataChanged');
        window[NAMESPACE + '.render']();
      }
    } catch (e) {
      console.error('[' + NAMESPACE + '] addTaskToSprint error:', e);
    }
  };

  window[NAMESPACE + '.removeTaskFromSprint'] = function (sprintId, taskId) {
    try {
      var sprints = getSprints();
      var sprint = sprints.find(function (s) { return s.id === sprintId; });
      if (!sprint || !sprint.tasks) return;

      sprint.tasks = sprint.tasks.filter(function (t) { return t !== taskId; });
      setSprints(sprints);
      window.DataLayer.emit('dataChanged');
      window[NAMESPACE + '.render']();
    } catch (e) {
      console.error('[' + NAMESPACE + '] removeTaskFromSprint error:', e);
    }
  };

  // ---- Retro Notiz speichern ----
  window[NAMESPACE + '.saveRetrospective'] = function (sprintId, notes) {
    try {
      var retros = getRetros();
      if (!retros[sprintId]) retros[sprintId] = {};
      retros[sprintId].notes = notes || '';
      retros[sprintId].updatedAt = new Date().toISOString();
      setRetros(retros);
      window.DataLayer.emit('dataChanged');
    } catch (e) {
      console.error('[' + NAMESPACE + '] saveRetrospective error:', e);
    }
  };

  // ---- Sprint-Statistiken berechnen ----
  window[NAMESPACE + '.getSprintStats'] = function (sprintId) {
    try {
      var sprints = getSprints();
      var sprint = sprints.find(function (s) { return s.id === sprintId; });
      if (!sprint || !sprint.tasks) return null;

      var allTasks = window.DataLayer.getTasks();
      var sprintTasks = allTasks.filter(function (t) { return sprint.tasks.indexOf(t.id) !== -1; });

      var total = sprintTasks.length;
      var done = sprintTasks.filter(function (t) { return t.status === 'done'; }).length;
      var inProgress = sprintTasks.filter(function (t) { return t.status === 'in-progress'; }).length;
      var review = sprintTasks.filter(function (t) { return t.status === 'review'; }).length;
      var todo = sprintTasks.filter(function (t) { return ['todo', 'backlog'].indexOf(t.status) !== -1; }).length;

      // Velocity: done Tasks pro Sprint-Tag
      var start = new Date(sprint.startDate);
      var end = new Date(sprint.completedAt || new Date());
      var days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
      var velocity = total > 0 ? done / days : 0;

      return {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        goal: sprint.goal,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        totalTasks: total,
        completedTasks: done,
        inProgressTasks: inProgress,
        reviewTasks: review,
        backlogTasks: todo,
        progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
        velocity: parseFloat(velocity.toFixed(2)),
        daysElapsed: Math.max(0, Math.round(((new Date()) - start) / (1000 * 60 * 60 * 24))),
        daysRemaining: total > 0 ? Math.max(0, Math.round((new Date(sprint.endDate) - new Date()) / (1000 * 60 * 60 * 24))) : 0
      };
    } catch (e) {
      console.error('[' + NAMESPACE + '] getSprintStats error:', e);
      return null;
    }
  };

  // ---- Render-Funktionen ----

  /** renderSprintOverview() — Hauptansicht der Sprint-Seite */
  window[NAMESPACE + '.render'] = function () {
    try {
      var hasIntegratedCards = !!(
        document.getElementById('active-sprint-detail') ||
        document.getElementById('sprint-form') ||
        document.getElementById('sprint-task-list')
      );

      if (!hasIntegratedCards) return;

      var sprints = getSprints();
      var activeSprint = sprints.find(function (s) { return s.status === 'active'; });
      var completedSprints = sprints.filter(function (s) { return s.status === 'completed'; });
      renderIntegratedSprintCards(activeSprint, completedSprints);
    } catch (e) {
      console.error('[' + NAMESPACE + '] render error:', e);
    }
  };

  function renderIntegratedSprintCards(activeSprint, completedSprints) {
    bindIntegratedSprintForm();

    var detailEl = document.getElementById('active-sprint-detail');
    var taskListEl = document.getElementById('sprint-task-list');
    var velocityEl = document.getElementById('velocity-value');
    var progressBarEl = document.getElementById('task-progress-bar');
    var taskPercentEl = document.getElementById('task-percent');
    var chartDoneEl = document.getElementById('chart-bar-progress');
    var chartPlannedEl = document.getElementById('chart-bar-planned');
    var retroNotesEl = document.getElementById('retro-notes');

    var allTasks = window.DataLayer.getTasks();
    var sprintTaskIds = activeSprint && activeSprint.tasks ? activeSprint.tasks : [];
    var sprintTasks = allTasks.filter(function (t) { return sprintTaskIds.indexOf(t.id) !== -1; });
    var unassignedTasks = allTasks.filter(function (t) { return sprintTaskIds.indexOf(t.id) === -1; });
    var stats = activeSprint ? window[NAMESPACE + '.getSprintStats'](activeSprint.id) : null;

    if (detailEl) {
      if (!activeSprint) {
        detailEl.innerHTML = '<p class="text-muted">Kein aktiver Sprint bestehend.</p>' +
          '<button type="button" class="btn btn-secondary mt-1" onclick="' + NAMESPACE + '.showCreateModal()">Modal zum Erstellen öffnen</button>';
      } else {
        detailEl.innerHTML =
          '<div class="mb-1"><strong>' + escapeHtml(activeSprint.name) + '</strong></div>' +
          '<p class="text-secondary mb-1">Zeitraum: ' + new Date(activeSprint.startDate).toLocaleDateString('de-DE') +
          ' - ' + new Date(activeSprint.endDate).toLocaleDateString('de-DE') + '</p>' +
          (activeSprint.goal ? '<p class="text-secondary mb-1"><strong>Ziel:</strong> ' + escapeHtml(activeSprint.goal) + '</p>' : '') +
          '<div class="flex-row">' +
          '<span class="badge badge-blue">Abgeschlossen: ' + completedSprints.length + '</span>' +
          '<button type="button" class="btn btn-danger" onclick="' + NAMESPACE + '.showEndSprintModal(\'' + activeSprint.id + '\')">Sprint beenden</button>' +
          '</div>';
      }
    }

    setCountText('c-backlog', sprintTasks.filter(function (t) { return t.status === 'backlog'; }).length);
    setCountText('c-todo', sprintTasks.filter(function (t) { return t.status === 'todo'; }).length);
    setCountText('c-in-progress', sprintTasks.filter(function (t) { return t.status === 'in-progress'; }).length);
    setCountText('c-review', sprintTasks.filter(function (t) { return t.status === 'review'; }).length);
    setCountText('c-done', sprintTasks.filter(function (t) { return t.status === 'done'; }).length);

    if (taskListEl) {
      if (!activeSprint) {
        taskListEl.innerHTML = '<p class="text-muted">Erstelle zuerst einen aktiven Sprint, um Tasks zu planen.</p>';
      } else {
        var employees = window.DataLayer.getEmployees();
        var listHtml = '';

        if (sprintTasks.length === 0) {
          listHtml += '<p class="text-muted mb-1">Noch keine Tasks im aktiven Sprint.</p>';
        } else {
          listHtml += '<h3 class="mb-1">Im Sprint (' + sprintTasks.length + ')</h3>';
          listHtml += '<div class="data-table"><table><thead><tr>' +
            '<th>Status</th><th>Task</th><th>Assignee</th><th>Aktion</th></tr></thead><tbody>';

          sprintTasks.forEach(function (t) {
            var emp = employees.find(function (e) { return e.id === t.assigneeId; });
            listHtml += '<tr>' +
              '<td><span class="badge badge-' + getStatusBadgeColor(t.status) + '">' + escapeHtml(t.status || 'todo') + '</span></td>' +
              '<td>' + escapeHtml(t.title || 'Unbenannt') + '</td>' +
              '<td>' + (emp ? escapeHtml(emp.name) : '-') + '</td>' +
              '<td><button type="button" class="btn btn-secondary" style="font-size:0.75rem;padding:2px 8px;" onclick="' + NAMESPACE + '.removeTaskFromSprint(\'' + activeSprint.id + '\',\'' + t.id + '\')">Entfernen</button></td>' +
              '</tr>';
          });

          listHtml += '</tbody></table></div>';
        }

        if (unassignedTasks.length > 0) {
          listHtml += '<h3 class="mt-2 mb-1">Verfugbare Tasks (' + unassignedTasks.length + ')</h3>';
          listHtml += '<div class="data-table"><table><thead><tr>' +
            '<th>Status</th><th>Task</th><th>Prioritat</th><th>Aktion</th></tr></thead><tbody>';

          unassignedTasks.forEach(function (t) {
            listHtml += '<tr>' +
              '<td><span class="badge badge-' + getStatusBadgeColor(t.status) + '">' + escapeHtml(t.status || 'todo') + '</span></td>' +
              '<td>' + escapeHtml(t.title || 'Unbenannt') + '</td>' +
              '<td>' + escapeHtml(t.priority || 'normal') + '</td>' +
              '<td><button type="button" class="btn btn-primary" style="font-size:0.75rem;padding:2px 8px;" onclick="' + NAMESPACE + '.addTaskToSprint(\'' + activeSprint.id + '\',\'' + t.id + '\')">+ Hinzufugen</button></td>' +
              '</tr>';
          });

          listHtml += '</tbody></table></div>';
        }

        taskListEl.innerHTML = listHtml;
      }
    }

    if (velocityEl) velocityEl.textContent = stats ? String(stats.velocity) : '0';
    if (progressBarEl) progressBarEl.style.width = (stats ? stats.progressPercent : 0) + '%';
    if (taskPercentEl) {
      taskPercentEl.textContent = stats
        ? (stats.progressPercent + ' % | ' + stats.completedTasks + ' / ' + stats.totalTasks)
        : '0 % | 0 / 0';
    }

    var donePct = stats ? stats.progressPercent : 0;
    var plannedPct = Math.max(0, 100 - donePct);
    if (chartDoneEl) chartDoneEl.style.width = donePct + '%';
    if (chartPlannedEl) chartPlannedEl.style.width = plannedPct + '%';

    if (retroNotesEl) {
      if (!retroNotesEl.dataset.bound) {
        retroNotesEl.dataset.bound = '1';
        retroNotesEl.addEventListener('change', function () {
          var sid = this.dataset.sprintId;
          if (!sid) return;
          window[NAMESPACE + '.saveRetrospective'](sid, this.value || '');
        });
      }

      if (!activeSprint) {
        retroNotesEl.value = '';
        retroNotesEl.dataset.sprintId = '';
        retroNotesEl.disabled = true;
      } else {
        var retros = getRetros();
        var notes = retros[activeSprint.id] && retros[activeSprint.id].notes ? retros[activeSprint.id].notes : '';
        retroNotesEl.dataset.sprintId = activeSprint.id;
        retroNotesEl.disabled = false;
        if (document.activeElement !== retroNotesEl) {
          retroNotesEl.value = notes;
        }
      }
    }
  }

  function setCountText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function bindIntegratedSprintForm() {
    var form = document.getElementById('sprint-form');
    if (!form) return;

    var startInput = document.getElementById('sp-start');
    var endInput = document.getElementById('sp-end');

    if (!form.dataset.initialized) {
      form.dataset.initialized = '1';

      if (startInput && !startInput.value) {
        var now = new Date();
        startInput.value = now.toISOString().slice(0, 10);
      }
      if (endInput && !endInput.value) {
        var twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        endInput.value = twoWeeks.toISOString().slice(0, 10);
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var nameInput = document.getElementById('sp-name');
        var goalInput = document.getElementById('sp-goal');

        var name = nameInput ? nameInput.value.trim() : '';
        var start = startInput ? startInput.value : '';
        var end = endInput ? endInput.value : '';
        var goal = goalInput ? goalInput.value.trim() : '';

        if (!name || !start || !end) {
          alert('Name, Start- und End-Datum sind erforderlich.');
          return;
        }
        if (new Date(end) <= new Date(start)) {
          alert('Enddatum muss nach Startdatum liegen.');
          return;
        }

        var created = window[NAMESPACE + '.createSprint'](name, start, end, goal);
        if (created) {
          if (nameInput) nameInput.value = '';
          if (goalInput) goalInput.value = '';
          window[NAMESPACE + '.render']();
        }
      });
    }
  }

  // ---- Helpers ----

  function getStatusBadgeColor(status) {
    switch (status) {
      case 'done': return 'green';
      case 'in-progress': return 'yellow';
      case 'review': return 'blue';
      case 'backlog': return 'purple';
      default: return 'blue';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  // ---- Modals ----

  window[NAMESPACE + '.showCreateModal'] = function () {
    try {
      var now = new Date();
      var twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      showConfirmModal(
        '🏃 Neuen Sprint erstellen',
        '<div style="display:flex;flex-direction:column;gap:14px;">' +
          '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Sprint-Name<br>' +
            '<input id="sprint_name" type="text" placeholder="z.B. Sprint 24" ' +
            'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);" required></label>' +
          '<div style="display:flex;gap:14px;">' +
            '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);flex:1;">Startdatum<br>' +
              '<input id="sprint_start" type="date" value="' + now.toISOString().slice(0, 10) + '" ' +
              'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);"></label>' +
            '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);flex:1;">Enddatum<br>' +
              '<input id="sprint_end" type="date" value="' + twoWeeks.toISOString().slice(0, 10) + '" ' +
              'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);"></label>' +
          '</div>' +
          '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Sprint-Ziel<br>' +
            '<textarea id="sprint_goal" rows="3" placeholder="Was soll dieser Sprint erreichen?" ' +
            'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);resize:vertical;"></textarea></label>' +
        '</div>',
        function () {
          var name = document.getElementById('sprint_name').value.trim();
          var start = document.getElementById('sprint_start').value;
          var end = document.getElementById('sprint_end').value;
          var goal = document.getElementById('sprint_goal').value.trim();

          if (!name || !start || !end) return alert('Name, Start- und End-Datum sind erforderlich.');
          if (new Date(end) <= new Date(start)) return alert('Enddatum muss nach Startdatum liegen.');

          var sprint = window[NAMESPACE + '.createSprint'](name, start, end, goal);
          sprintCloseModal();
          renderAll();
        },
        ['Sprint erstellen']
      );
    } catch (e) {
      console.error('[' + NAMESPACE + '] showCreateModal error:', e);
    }
  };

  window[NAMESPACE + '.showEndSprintModal'] = function (sprintId) {
    try {
      var sprints = getSprints();
      var s = sprints.find(function (sp) { return sp.id === sprintId; });
      if (!s) return;
      showConfirmModal(
        '⏹ Sprint beenden: ' + escapeHtml(s.name),
        '<p style="color:var(--text-secondary);">Bist du sicher, dass du diesen Sprint beenden willst?</p>' +
          '<p style="color:var(--text-muted);font-size:0.85rem;">Alle Tasks werden als Sprint-Statistik gespeichert.</p>',
        function () {
          window[NAMESPACE + '.endSprint'](sprintId);
          sprintCloseModal();
          renderAll();
        },
        ['Beenden']
      );
    } catch (e) {
      console.error('[' + NAMESPACE + '] showEndSprintModal error:', e);
    }
  };

  window[NAMESPACE + '.showSprintDetailModal'] = function (sprintId) {
    try {
      var sStats = window[NAMESPACE + '.getSprintStats'](sprintId);
      if (!sStats) return;

      showConfirmModal(
        '📊 Sprint-Details: ' + escapeHtml(sStats.name),
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          '<p><strong>Goal:</strong> ' + escapeHtml(sStats.goal) + '</p>' +
          '<p><strong>Gesamt Tasks:</strong> ' + sStats.totalTasks + '</p>' +
          '<p><strong>Abschließen:</strong> ' + sStats.completedTasks + '/' + sStats.totalTasks + ' (' + sStats.progressPercent + '%)</p>' +
          '<p><strong>In Progress:</strong> ' + sStats.inProgressTasks + '</p>' +
          '<p><strong>Review:</strong> ' + sStats.reviewTasks + '</p>' +
          '<p><strong>Velocity:</strong> ' + sStats.velocity + ' Tasks/Tag</p>' +
          '<p><strong>Dauer:</strong> ' + sStats.daysElapsed + ' Tage (verbleibend: ' + sStats.daysRemaining + ')</p>' +
        '</div>',
        function () { sprintCloseModal(); },
        ['Schließen']
      );
    } catch (e) {
      console.error('[' + NAMESPACE + '] showSprintDetailModal error:', e);
    }
  };

  window[NAMESPACE + '.addRetroPrompt'] = function (sprintId, prompt, existingNotes) {
    try {
      var textarea = document.getElementById('retro-notes');
      if (!textarea) return;
      var val = textarea.value;
      if (val && !val.endsWith('\n')) val += '\n';
      textarea.value = val + '## ' + prompt + '\n\n' + (existingNotes || '') + '\n---\n';
    } catch (e) {
      console.error('[' + NAMESPACE + '] addRetroPrompt error:', e);
    }
  };

  // ---- Modal Helper (lokal, da employees.js closeModal auch hat) ---
  function showConfirmModal(title, contentHtml, onConfirm, buttons) {
    var overlay = document.createElement('div');
    overlay.id = 'sprint-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--overlay-bg);z-index:9998;display:flex;align-items:center;justify-content:center;';

    var modalContent = document.createElement('div');
    modalContent.style.cssText = 'background:var(--bg-card);border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px var(--shadow-color);';

    var btns = buttons || ['OK', 'Abbrechen'];
    modalContent.innerHTML = '<h3 style="margin:0 0 16px;color:var(--text-primary);">' + escapeHtml(title) + '</h3>' + contentHtml;

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;';
    btnRow.innerHTML = '';

    btns.forEach(function (label, i) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = i === 0 ? 'padding:8px 16px;border-radius:6px;border:none;background:var(--accent-blue);color:#fff;cursor:pointer;' : 'padding:8px 16px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;';
      if (i === 0) {
        btn.onclick = function () { onConfirm(); };
      } else {
        btn.onclick = sprintCloseModal;
      }
      btnRow.appendChild(btn);
    });

    modalContent.appendChild(btnRow);
    overlay.appendChild(modalContent);
    document.body.appendChild(overlay);
  }

  function sprintCloseModal() {
    var overlay = document.getElementById('sprint-modal-overlay');
    if (overlay) document.body.removeChild(overlay);
  }
  window[NAMESPACE + '.closeModal'] = sprintCloseModal;

  // ---- Init: Auto-Render wenn Sprint-Seite aktiv ist ----
  function initSprint() {
    try {
      var checkInterval = setInterval(function () {
        var el = document.getElementById('sprint');
        if (!el) return;
        clearInterval(checkInterval);

        // Nur rendern wenn diese Seite aktiv ist
        function autoRender() {
          var activePage = document.querySelector('.page.active');
          if (activePage && activePage.id === 'sprint') {
            window[NAMESPACE + '.render']();
          }
        }

        // Initial render
        autoRender();

        // Bei Navigation neu rendern
        document.addEventListener('click', function (e) {
          var link = e.target.closest('[data-page]');
          if (link && link.getAttribute('data-page') === 'sprint') {
            setTimeout(autoRender, 100);
          }
        });

      }, 200);
    } catch (e) {
      console.error('[' + NAMESPACE + '] init error:', e);
    }
  }

  function renderAll() {
    window[NAMESPACE + '.render']();
  }

  // Compatibility bridge: some inline handlers use object-style access (SprintModule.method()).
  (function exposeObjectNamespace() {
    var target = window.SprintModule || {};
    [
      'createSprint',
      'endSprint',
      'deleteSprint',
      'addTaskToSprint',
      'removeTaskFromSprint',
      'saveRetrospective',
      'getSprintStats',
      'render',
      'showCreateModal',
      'showEndSprintModal',
      'showSprintDetailModal',
      'addRetroPrompt',
      'closeModal'
    ].forEach(function (method) {
      target[method] = function () {
        var fn = window[NAMESPACE + '.' + method];
        if (typeof fn === 'function') {
          return fn.apply(null, arguments);
        }
      };
    });
    window.SprintModule = target;
  })();

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSprint);
  } else {
    initSprint();
  }

})();

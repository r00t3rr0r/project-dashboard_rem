(function() {
  'use strict';

  var blockerFilterState = {
    scope: 'active',
    target: 'all',
    projectId: 'all',
    sort: 'newest'
  };

  function ensureDepartmentNoticeHost() {
    var dashboardPage = document.getElementById('dashboard');
    if (!dashboardPage) return null;
    var host = document.getElementById('dashboard-department-notices');
    if (host) return host;

    host = document.createElement('section');
    host.id = 'dashboard-department-notices';
    host.className = 'dashboard-notice-zone';

    var header = dashboardPage.querySelector('.section-header');
    if (header && header.nextSibling) {
      dashboardPage.insertBefore(host, header.nextSibling);
    } else {
      dashboardPage.appendChild(host);
    }
    return host;
  }

  function ensureDashboardBlockerHost() {
    var dashboardPage = document.getElementById('dashboard');
    if (!dashboardPage) return null;
    var host = document.getElementById('dashboard-blocker-zone');
    if (host) return host;

    host = document.createElement('section');
    host.id = 'dashboard-blocker-zone';
    host.className = 'dashboard-notice-zone dashboard-blocker-zone hidden';

    var statsGrid = dashboardPage.querySelector('.overview-grid');
    if (statsGrid && statsGrid.nextSibling) {
      dashboardPage.insertBefore(host, statsGrid.nextSibling);
    } else {
      dashboardPage.appendChild(host);
    }
    return host;
  }

  function formatDateTime(iso) {
    if (!iso) return 'n/a';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return 'n/a';
    return date.toLocaleString('de-DE');
  }

  function formatDate(iso) {
    if (!iso) return 'n/a';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return 'n/a';
    return date.toLocaleDateString('de-DE');
  }

  function getAuthManager() {
    return window.AuthManager || null;
  }

  function getDashboardProjects() {
    var projects = (window.DataLayer.getProjects() || []).slice();
    var auth = getAuthManager();
    if (!auth) return projects;

    // Guests sollen auf dem Dashboard alle Projekte als Uebersicht sehen.
    if (typeof auth.getMode === 'function' && auth.getMode() === 'guest') {
      return projects;
    }

    if (typeof auth.getVisibleProjects === 'function') {
      return auth.getVisibleProjects(projects);
    }
    return projects;
  }

  function getStatusLabel(project) {
    var status = String(project && project.status || '').toLowerCase();
    if (status === 'planning') return 'Planung';
    if (status === 'active') return 'Aktiv';
    if (status === 'blocked') return 'Blockiert';
    if (status === 'done') return 'Abgeschlossen';
    return status || 'Unbekannt';
  }

  function getStatusBadgeClass(project) {
    var status = String(project && project.status || '').toLowerCase();
    if (status === 'blocked') return 'badge-red';
    if (status === 'done') return 'badge-green';
    if (status === 'active') return 'badge-blue';
    return 'badge-yellow';
  }

  function buildDashboardProjectMirrorHtml() {
    var source = document.getElementById('project-list');
    if (!source) return '';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = source.innerHTML || '';

    // Im Dashboard keine Projektwissen-Verwaltung anzeigen.
    var infohubNode = wrapper.querySelector('.project-infohub');
    while (infohubNode) {
      if (typeof infohubNode.remove === 'function') {
        infohubNode.remove();
      } else if (infohubNode.parentNode) {
        infohubNode.parentNode.removeChild(infohubNode);
      }
      infohubNode = wrapper.querySelector('.project-infohub');
    }

    // Duplicate IDs wuerden Inputs/Labels in zwei Seitenbereichen kollidieren.
    wrapper.querySelectorAll('[id]').forEach(function(node) {
      node.removeAttribute('id');
    });

    // Dashboard zeigt die Projekte als Uebersicht im Lesemodus.
    wrapper.querySelectorAll('input, select, textarea, button').forEach(function(node) {
      node.disabled = true;
      node.removeAttribute('data-action');
      node.removeAttribute('data-id');
    });

    wrapper.querySelectorAll('[data-action]').forEach(function(node) {
      node.removeAttribute('data-action');
    });

    return wrapper.innerHTML;
  }

  function buildDashboardProjectOverviewLayout(mirrorHtml) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = mirrorHtml || '';

    var rows = [];
    wrapper.querySelectorAll('.project-card').forEach(function(card) {
      card.querySelectorAll('.project-card-head-main > p.text-muted').forEach(function(node) {
        var text = String(node.textContent || '').trim().toLowerCase();
        if (text === 'aus github importiert') {
          node.remove();
        }
      });

      var titleNode = card.querySelector('h3');
      var title = titleNode ? String(titleNode.textContent || '').trim() : 'Projekt';
      var timeline = card.querySelector('.project-head-timeline');
      var scheduleHtml = '';
      if (timeline) {
        var timelineClone = timeline.cloneNode(true);
        var timelineList = timelineClone.querySelector('.project-head-timeline-list');
        if (timelineList) {
          var timelineItems = timelineList.querySelectorAll('.project-head-timeline-item');
          timelineItems.forEach(function(item, index) {
            if (index > 0) item.remove();
          });
        }

        scheduleHtml = '<section class="dashboard-project-schedule-card" aria-label="Timeline '+escapeHtml(title)+'">'
          +timelineClone.outerHTML
          +'</section>';
        if (typeof timeline.remove === 'function') {
          timeline.remove();
        } else if (timeline.parentNode) {
          timeline.parentNode.removeChild(timeline);
        }
      }

      var rail = card.querySelector('.project-card-head-rail');
      if (rail && !rail.children.length) {
        if (typeof rail.remove === 'function') {
          rail.remove();
        } else if (rail.parentNode) {
          rail.parentNode.removeChild(rail);
        }
      }

      rows.push(
        '<div class="dashboard-project-row'+(scheduleHtml ? ' has-schedule' : '')+'">'
          +card.outerHTML
          +(scheduleHtml ? scheduleHtml : '')
        +'</div>'
      );
    });

    return '<div class="dashboard-projects-layout">' + rows.join('') + '</div>';
  }

  function renderDashboardProjectOverview() {
    var container = document.getElementById('dashboard-projects-full');
    if (!container) return;

    if (window.ProjectsModule && typeof window.ProjectsModule.render === 'function') {
      window.ProjectsModule.render();
    }

    var mirrorHtml = buildDashboardProjectMirrorHtml();
    if (!mirrorHtml.trim()) {
      container.innerHTML = '<h3>Projekte</h3><p class="chart-empty">Keine freigegebenen Projekte vorhanden.</p>';
      return;
    }

    container.innerHTML = '<h3>Projekte</h3>' + buildDashboardProjectOverviewLayout(mirrorHtml);
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

  function getOpenBlockerHistoryEntry(entity) {
    var history = entity && Array.isArray(entity.blockerHistory) ? entity.blockerHistory : [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (!history[i].until) return history[i];
    }
    return null;
  }

  function getBlockerRows() {
    var tasks = window.DataLayer.getTasks() || [];
    var projects = window.DataLayer.getProjects() || [];
    var blockerTasksById = {};
    var projectById = {};

    projects.forEach(function(project) {
      if (!project || !project.id) return;
      projectById[String(project.id)] = project;
    });

    tasks.forEach(function(task) {
      if (task && task.id && task.isBlocker) blockerTasksById[String(task.id)] = task;
    });

    var rows = [];

    function pushRowFromHistory(targetType, entity, historyEntry) {
      if (!entity) return;
      var blockerTask = historyEntry && historyEntry.blockerTaskId ? blockerTasksById[String(historyEntry.blockerTaskId)] : null;
      var projectRef = targetType === 'project'
        ? entity
        : (entity.projectId ? projectById[String(entity.projectId)] : null);

      rows.push({
        targetType: targetType,
        targetId: entity.id,
        targetTitle: targetType === 'project' ? (entity.title || entity.name || 'Projekt') : (entity.title || 'Aufgabe'),
        reason: (historyEntry && historyEntry.reason) || entity.blockedReason || '',
        from: (historyEntry && historyEntry.from) || entity.blockedAt || entity.blockedUpdatedAt || entity.updatedAt || entity.createdAt || '',
        until: (historyEntry && historyEntry.until) || '',
        resolution: (historyEntry && historyEntry.resolution) || '',
        active: !historyEntry || !historyEntry.until,
        blockerTaskId: (historyEntry && historyEntry.blockerTaskId) || entity.blockerTaskId || '',
        blockerTaskTitle: blockerTask ? blockerTask.title : '',
        projectId: projectRef ? String(projectRef.id || '') : '',
        projectTitle: projectRef ? (projectRef.title || projectRef.name || 'Projekt') : ''
      });
    }

    tasks.forEach(function(task) {
      if (!task || task.isBlocker) return;
      var history = Array.isArray(task.blockerHistory) ? task.blockerHistory : [];
      if (history.length) {
        history.forEach(function(entry) {
          pushRowFromHistory('task', task, entry);
        });
        return;
      }
      if (task.blocked) pushRowFromHistory('task', task, null);
    });

    projects.forEach(function(project) {
      if (!project) return;
      var history = Array.isArray(project.blockerHistory) ? project.blockerHistory : [];
      if (history.length) {
        history.forEach(function(entry) {
          pushRowFromHistory('project', project, entry);
        });
        return;
      }
      if (project.blocked) pushRowFromHistory('project', project, null);
    });

    return rows;
  }

  function applyBlockerFilters(rows) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    var nowTs = Date.now();
    var thresholdTs = nowTs - (30 * 24 * 60 * 60 * 1000);

    if (blockerFilterState.scope === 'active') {
      list = list.filter(function(row) { return !!row.active; });
    } else if (blockerFilterState.scope === 'last30') {
      list = list.filter(function(row) {
        var fromTs = Date.parse(row.from || '');
        var untilTs = Date.parse(row.until || '');
        if (!isNaN(untilTs) && untilTs >= thresholdTs) return true;
        if (!isNaN(fromTs) && fromTs >= thresholdTs) return true;
        return false;
      });
    }

    if (blockerFilterState.target !== 'all') {
      list = list.filter(function(row) {
        return row.targetType === blockerFilterState.target;
      });
    }

    if (blockerFilterState.projectId !== 'all') {
      list = list.filter(function(row) {
        return String(row.projectId || '') === String(blockerFilterState.projectId);
      });
    }

    if (blockerFilterState.sort === 'oldest') {
      list.sort(function(a, b) {
        return String(a.from || '').localeCompare(String(b.from || ''));
      });
    } else if (blockerFilterState.sort === 'longest') {
      list.sort(function(a, b) {
        var aFrom = Date.parse(a.from || '') || nowTs;
        var bFrom = Date.parse(b.from || '') || nowTs;
        var aUntil = Date.parse(a.until || '') || nowTs;
        var bUntil = Date.parse(b.until || '') || nowTs;
        return (bUntil - bFrom) - (aUntil - aFrom);
      });
    } else {
      list.sort(function(a, b) {
        return String(b.from || '').localeCompare(String(a.from || ''));
      });
    }

    return list;
  }

  function buildProjectFilterOptions(rows) {
    var map = {};
    (rows || []).forEach(function(row) {
      if (!row.projectId) return;
      map[row.projectId] = row.projectTitle || 'Projekt';
    });

    var keys = Object.keys(map);
    keys.sort(function(a, b) {
      return String(map[a] || '').localeCompare(String(map[b] || ''));
    });

    return keys.map(function(key) {
      var selected = blockerFilterState.projectId === key ? ' selected' : '';
      return '<option value="' + escapeHtml(key) + '"' + selected + '>' + escapeHtml(map[key]) + '</option>';
    }).join('');
  }

  function renderDashboardBlockers() {
    var host = ensureDashboardBlockerHost();
    if (!host) return;

    var allRows = getBlockerRows();
    var activeRows = allRows.filter(function(row) { return !!row.active; });
    if (!activeRows.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }

    var blockers = applyBlockerFilters(allRows);

    var html = '';
    html += '<div class="dashboard-notice-head">';
    html += '  <span class="dashboard-notice-kicker">Blocker-Register</span>';
    html += '  <span class="dashboard-notice-count">' + blockers.length + '/' + allRows.length + '</span>';
    html += '</div>';
    html += '<div class="dashboard-blocker-controls">';
    html += '  <label>Zeitraum <select data-blocker-filter="scope">';
    html += '    <option value="active"' + (blockerFilterState.scope === 'active' ? ' selected' : '') + '>Aktiv</option>';
    html += '    <option value="last30"' + (blockerFilterState.scope === 'last30' ? ' selected' : '') + '>Letzte 30 Tage</option>';
    html += '    <option value="all"' + (blockerFilterState.scope === 'all' ? ' selected' : '') + '>Alle</option>';
    html += '  </select></label>';
    html += '  <label>Ziel <select data-blocker-filter="target">';
    html += '    <option value="all"' + (blockerFilterState.target === 'all' ? ' selected' : '') + '>Aufgaben + Projekte</option>';
    html += '    <option value="task"' + (blockerFilterState.target === 'task' ? ' selected' : '') + '>Nur Aufgaben</option>';
    html += '    <option value="project"' + (blockerFilterState.target === 'project' ? ' selected' : '') + '>Nur Projekte</option>';
    html += '  </select></label>';
    html += '  <label>Projekt <select data-blocker-filter="projectId">';
    html += '    <option value="all">Alle Projekte</option>';
    html +=      buildProjectFilterOptions(allRows);
    html += '  </select></label>';
    html += '  <label>Sortierung <select data-blocker-filter="sort">';
    html += '    <option value="newest"' + (blockerFilterState.sort === 'newest' ? ' selected' : '') + '>Neueste zuerst</option>';
    html += '    <option value="oldest"' + (blockerFilterState.sort === 'oldest' ? ' selected' : '') + '>Aelteste zuerst</option>';
    html += '    <option value="longest"' + (blockerFilterState.sort === 'longest' ? ' selected' : '') + '>Laengste Dauer zuerst</option>';
    html += '  </select></label>';
    html += '</div>';

    if (!blockers.length) {
      html += '<p class="text-muted">Keine Eintraege fuer den gewaehlten Filter.</p>';
      host.classList.remove('hidden');
      host.innerHTML = html;
      return;
    }

    html += '<div class="dashboard-notice-list">';

    blockers.forEach(function(item) {
      var canResolve = !!(window.DataLayer && typeof window.DataLayer.canResolveBlocker === 'function' && window.DataLayer.canResolveBlocker({
        targetType: item.targetType,
        targetId: item.targetId,
        blockerTaskId: item.blockerTaskId || ''
      }));
      html += '<article class="dashboard-notice-card ' + (item.active ? 'severity-critical' : 'severity-info') + ' blocker-card">';
      html += '  <header class="dashboard-notice-card-head">';
      html += '    <h3>' + escapeHtml(item.targetType === 'project' ? 'Projekt blockiert' : 'Aufgabe blockiert') + ': ' + escapeHtml(item.targetTitle) + '</h3>';
      html += '    <span class="dashboard-notice-time">' + escapeHtml(formatDateTime(item.from)) + ' bis ' + escapeHtml(item.active ? 'offen' : formatDateTime(item.until)) + '</span>';
      html += '  </header>';
      html += '  <p><strong>Grund:</strong> ' + escapeHtml(item.reason || 'Kein Grund hinterlegt') + '</p>';
      if (item.projectTitle && item.targetType === 'task') {
        html += '  <p><strong>Projekt:</strong> ' + escapeHtml(item.projectTitle) + '</p>';
      }
      if (item.blockerTaskTitle) {
        html += '  <p><strong>Blocker:</strong> ' + escapeHtml(item.blockerTaskTitle) + '</p>';
      }
      if (!item.active && item.resolution) {
        html += '  <p><strong>Aufloesung:</strong> ' + escapeHtml(item.resolution) + '</p>';
      }
      html += '  <div class="dashboard-notice-actions">';
      if (item.active) {
        html += '    <button class="btn btn-secondary" type="button" data-resolve-blocker="' + escapeHtml(item.targetType + '::' + item.targetId) + '" ' + (canResolve ? '' : 'disabled') + '>Blocker entfernen</button>';
      }
      html += '  </div>';
      html += '</article>';
    });

    html += '</div>';

    host.classList.remove('hidden');
    host.innerHTML = html;
  }

  function updateBlockerFilter(filterName, value) {
    if (!Object.prototype.hasOwnProperty.call(blockerFilterState, filterName)) return;
    blockerFilterState[filterName] = String(value || '');
    renderDashboardBlockers();
  }

  function getDepartmentNotices() {
    var notifications = window.DataLayer.getNotifications() || [];
    return notifications.filter(function(item) {
      if (!item) return false;
      var type = String(item.type || '').toLowerCase();
      return type === 'department_notice' && !item.read;
    }).sort(function(a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function renderDepartmentNotices() {
    var host = ensureDepartmentNoticeHost();
    if (!host) return;

    var notices = getDepartmentNotices();
    if (!notices.length) {
      host.classList.add('hidden');
      host.innerHTML = '';
      return;
    }

    host.classList.remove('hidden');

    var html = '';
    html += '<div class="dashboard-notice-head">';
    html += '  <span class="dashboard-notice-kicker">Abteilungshinweise</span>';
    html += '  <span class="dashboard-notice-count">' + notices.length + '</span>';
    html += '</div>';
    html += '<div class="dashboard-notice-list">';

    notices.forEach(function(notice) {
      var severity = String(notice.severity || 'info').toLowerCase();
      var title = notice.title || 'Hinweis';
      var message = notice.message || notice.body || '';
      var stamp = notice.createdAt ? new Date(notice.createdAt).toLocaleString('de-DE') : '';
      html += '<article class="dashboard-notice-card severity-' + escapeHtml(severity) + '">';
      html += '  <header class="dashboard-notice-card-head">';
      html += '    <h3>' + escapeHtml(title) + '</h3>';
      html += '    <span class="dashboard-notice-time">' + escapeHtml(stamp) + '</span>';
      html += '  </header>';
      html += '  <p>' + escapeHtml(message) + '</p>';
      html += '  <div class="dashboard-notice-actions">';
      html += '    <button class="btn btn-secondary" type="button" data-dismiss-notice="' + escapeHtml(notice.id) + '">Als gelesen markieren</button>';
      html += '  </div>';
      html += '</article>';
    });

    html += '</div>';
    host.innerHTML = html;
  }

  function dismissDepartmentNotice(id) {
    if (!id) return;
    if (window.DataLayer && typeof window.DataLayer.markNotificationRead === 'function') {
      window.DataLayer.markNotificationRead(id);
    }
  }

  function resolveBlockerToken(token) {
    if (!token || !window.DataLayer || typeof window.DataLayer.resolveBlocker !== 'function') return;
    var parts = String(token).split('::');
    if (parts.length !== 2) return;

    var targetType = parts[0];
    var targetId = parts[1];
    if (typeof window.DataLayer.canResolveBlocker === 'function' && !window.DataLayer.canResolveBlocker({
      targetType: targetType,
      targetId: targetId
    })) {
      alert('Blocker koennen nur von Admins oder vom Ersteller des Blockers entfernt werden.');
      return;
    }

    askResolutionText('Warum wurde der Blocker entfernt?', 'Blocker geloest').then(function(resolution) {
      if (resolution === null) return;

      var resolved = window.DataLayer.resolveBlocker({
        targetType: targetType,
        targetId: targetId,
        resolution: String(resolution || '').trim() || 'Blocker geloest',
        at: new Date().toISOString()
      });
      if (!resolved) {
        alert('Blocker konnte nicht entfernt werden (Rechte oder Datenstand).');
      }
    });
  }

  // --- Statistik-Cards rendern ---
  function renderStatsCards() {
    var tasks = window.DataLayer.getTasks();
    var employees = window.DataLayer.getEmployees();

    // Gesamt Tasks
    var elTotal = document.getElementById('stat-tasks-total');
    if (elTotal) {
      elTotal.innerHTML = '<h3>Gesamt Tasks</h3><div class="stat-value">' + tasks.length + '</div>';
    }

    // In Progress Count
    var inProgress = tasks.filter(function(t) { return t.status === 'in-progress'; }).length;
    var elProgress = document.getElementById('stat-tasks-progress');
    if (elProgress) {
      elProgress.innerHTML = '<h3>In Progress</h3><div class="stat-value">' + inProgress + '</div>';
    }

    // Aktive Mitarbeiter
    var activeEmps = employees.filter(function(e) {
      return e.availability === 'Verfügbar' || e.availability === 'Belastet';
    }).length;
    var elActive = document.getElementById('stat-employees-active');
    if (elActive) {
      elActive.innerHTML = '<h3>Aktive Mitarbeiter</h3><div class="stat-value">' + activeEmps + '</div>';
    }

    // Upcoming Deadlines (nächste 7 Tage)
    var now = new Date();
    var weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    var upcoming = tasks.filter(function(t) {
      if (!t.dueDate) return false;
      var d = new Date(t.dueDate);
      return d <= weekFromNow && t.status !== 'done';
    }).length;
    var elDeadlines = document.getElementById('stat-upcoming-deadlines');
    if (elDeadlines) {
      elDeadlines.innerHTML = '<h3>Deadlines (7d)</h3><div class="stat-value">' + upcoming + '</div>';
    }
  }

  // --- Projekt-Fortschrittsbalken rendern ---
  function renderProjectProgress() {
    var projects = getDashboardProjects();
    var container = document.getElementById('chart-progress-bar');
    if (!container) return;

    if (projects.length === 0) {
      container.innerHTML = '<h3>Projekt-Fortschritt</h3><p class="chart-empty">Keine Projekte vorhanden.</p>';
      return;
    }

    var html = '';
    projects.forEach(function(project) {
      var tasks = window.DataLayer.getTasks().filter(function(t) { return t.projectId === project.id; });
      var done = tasks.filter(function(t) { return t.status === 'done'; }).length;
      var percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

      // Status-Farbe bestimmen
      var colorClass = 'green';
      if (percent < 40 || !project.startDate) colorClass = 'red';
      else if (percent < 80) colorClass = 'yellow';

      html += '<div class="project-progress-item">';
      html += '<div class="project-progress-head">';
      html += '<span class="project-progress-title">' + escapeHtml(project.title || project.name) + '</span>';
      html += '<span class="project-progress-percent">' + percent + '%</span></div>';
      html += '<div class="progress-bar-container">';
      html += '<div class="progress-bar-fill ' + colorClass + '" style="width:' + percent + '%;"></div>';
      html += '</div></div>';
    });

    container.innerHTML = '<h3>Projekt-Fortschritt</h3>' + html;
  }

  // --- Task-Status-Distribution (CSS conic-gradient) ---
  function renderTaskDistribution() {
    var tasks = window.DataLayer.getTasks();
    var container = document.getElementById('chart-task-distribution');
    if (!container) return;

    if (tasks.length === 0) {
      container.innerHTML = '<h3>Task-Verteilung nach Status</h3><p class="chart-empty">Keine Tasks vorhanden.</p>';
      return;
    }

    var statusCounts = {};
    tasks.forEach(function(t) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    });

    // conic-gradient berechnen
    var gradientParts = [];
    var colors = {'backlog':'#9b59b6','todo':'#4a9eff','in-progress':'#f1c40f','review':'#e74c3c','done':'#2ecc71'};
    var total = tasks.length;
    var cumulative = 0;

    Object.keys(statusCounts).forEach(function(status) {
      var pct = (statusCounts[status] / total) * 100;
      gradientParts.push((colors[status] || '#666') + ' ' + cumulative + '% ' + (cumulative + pct) + '%');
      cumulative += pct;
    });

    container.innerHTML = '<h3>Task-Verteilung nach Status</h3>' +
      '<div class="task-distribution-wrap">' +
      '<div class="task-distribution-donut" style="background:conic-gradient(' +
      gradientParts.join(',') + ');flex-shrink:0;"></div>' +
      '<div class="task-distribution-legend">' + Object.keys(statusCounts).map(function(s) {
        return '<div class="task-distribution-legend-item"><span class="task-distribution-dot" style="color:' + (colors[s]||'#666') + ';">&#9679;</span><span>' + escapeHtml(s || 'unbekannt') + ': ' + statusCounts[s] + '</span></div>';
      }).join('') + '</div></div>';
  }

  // --- Team-Load Donut-Chart ---
  function renderTeamLoad() {
    var employees = window.DataLayer.getEmployees();
    var tasks = window.DataLayer.getTasks();
    var container = document.getElementById('chart-team-load');
    if (!container) return;

    if (employees.length === 0 || tasks.length === 0) {
      container.innerHTML = '<h3>Aufgabenverteilung</h3><p class="chart-empty">Nicht genügend Daten für Chart.</p>';
      return;
    }

    // Tasks pro Mitarbeiter zählen
    var empLoad = {};
    employees.forEach(function(e) { empLoad[e.id] = { name: e.name, count: 0 }; });
    tasks.filter(function(t) { return t.assigneeId; }).forEach(function(t) {
      if (empLoad[t.assigneeId]) empLoad[t.assigneeId].count++;
    });

    var html = '<h3>Aufgabenverteilung</h3>';
    html += '<div class="team-load-grid">';

    Object.values(empLoad).forEach(function(emp) {
      if (emp.count > 0) {
        html += '<div class="team-load-card">' +
          '<div class="team-load-name">' + escapeHtml(emp.name) + '</div>' +
          '<div class="team-load-count">' + emp.count + ' Tasks</div></div>';
      }
    });

    html += '</div>';
    container.innerHTML = html;
  }

  // --- escapeHtml helper ---
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  // --- Main Render Function ---
  function renderDashboard() {
    try {
      renderDashboardBlockers();
      renderDepartmentNotices();
      renderStatsCards();
      renderProjectProgress();
      renderDashboardProjectOverview();
      renderTaskDistribution();
      renderTeamLoad();
    } catch(e) { console.error('[Dashboard] Error:', e); }
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function() {
    var dashboardPage = document.getElementById('dashboard');
    if (dashboardPage) {
      dashboardPage.addEventListener('click', function(event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-dismiss-notice]') : null;
        if (btn) {
          event.preventDefault();
          dismissDepartmentNotice(btn.getAttribute('data-dismiss-notice') || '');
          return;
        }

        var blockerBtn = event.target && event.target.closest ? event.target.closest('[data-resolve-blocker]') : null;
        if (!blockerBtn) return;
        event.preventDefault();
        resolveBlockerToken(blockerBtn.getAttribute('data-resolve-blocker') || '');
      });

      dashboardPage.addEventListener('change', function(event) {
        var select = event.target && event.target.closest ? event.target.closest('[data-blocker-filter]') : null;
        if (!select) return;
        updateBlockerFilter(select.getAttribute('data-blocker-filter') || '', select.value || '');
      });
    }

    renderDashboard();
    window.DataLayer.on('dataChanged', renderDashboard);
  });

  // --- Public API ---
  window.DashboardManager = {
    refresh: renderDashboard,
    dismissDepartmentNotice: dismissDepartmentNotice,
    renderStatsCards: renderStatsCards,
    renderProjectProgress: renderProjectProgress,
    renderDashboardProjectOverview: renderDashboardProjectOverview,
    renderTaskDistribution: renderTaskDistribution,
    renderTeamLoad: renderTeamLoad
  };
})();

(function() {
  'use strict';

  var blockerFilterState = {
    scope: 'active',
    target: 'all',
    projectId: 'all',
    sort: 'newest'
  };
  var BLOCKER_FILTER_STORAGE_KEY = 'pd_dashboard_blocker_filters';
  var teamChatReplyToId = '';
  var teamChatScrollToBottom = false;
  var teamChatPlaceholder = null;

  function readSavedBlockerFilterState() {
    try {
      if (!window.localStorage) return null;
      var raw = window.localStorage.getItem(BLOCKER_FILTER_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function writeSavedBlockerFilterState() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(BLOCKER_FILTER_STORAGE_KEY, JSON.stringify(blockerFilterState));
      }
    } catch (_err) {}
  }

  function restoreBlockerFilterState() {
    var saved = readSavedBlockerFilterState();
    if (!saved) return;
    Object.keys(blockerFilterState).forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(saved, key)) {
        blockerFilterState[key] = String(saved[key] || '');
      }
    });
  }

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

    // Alle Mitarbeiter, unabhängig von ihrer Rolle, sollen auf dem Dashboard
    // die komplette Projektübersicht sehen. Nur Gäste bleiben auf Sichtbarkeit
    // des Auth-Systems beschränkt.
    if (typeof auth.getMode === 'function') {
      var mode = auth.getMode();
      if (mode === 'guest') return projects;
      if (mode === 'employee' || mode === 'admin' || mode === 'setup') return projects;
    }

    if (typeof auth.getVisibleProjects === 'function') {
      return auth.getVisibleProjects(projects);
    }
    return projects;
  }

  function clampProjectProgress(value, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = Number(fallback);
    if (!isFinite(number)) number = 0;
    number = Math.round(number);
    if (number < 0) number = 0;
    if (number > 100) number = 100;
    return number;
  }

  function getRoleColor(role) {
    var value = String(role || '').trim().toLowerCase();
    if (value === 'admin' || value === 'administrator') return '#ef4444';
    if (value === 'manager' || value === 'lead' || value === 'leitung') return '#8b5cf6';
    if (value === 'developer' || value === 'entwickler' || value === 'engineer') return '#3b82f6';
    if (value === 'designer' || value === 'design') return '#ec4899';
    if (value === 'qa' || value === 'tester' || value === 'test') return '#f59e0b';
    if (value === 'devops' || value === 'ops') return '#10b981';
    return '#6b7280';
  }

  function getProjectProgressPercent(project) {
    var tasks = (window.DataLayer && typeof window.DataLayer.getTasks === 'function' ? window.DataLayer.getTasks() : []).filter(function(task) {
      return task && task.projectId === project.id;
    });

    var doneCount = tasks.filter(function(task) {
      return String(task.status || '').toLowerCase() === 'done';
    }).length;
    var totalCount = tasks.length;
    var ratio = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

    if (typeof project.progress === 'number' && !isNaN(project.progress)) {
      return clampProjectProgress(project.progress, ratio);
    }

    var status = String(project && project.status || '').toLowerCase();
    if (status === 'done') return 100;
    if (status === 'blocked') return Math.max(0, Math.min(100, Math.round(ratio * 0.7)));
    return ratio;
  }

  function getProjectContactEmployee(project) {
    var employees = (window.DataLayer && typeof window.DataLayer.getEmployees === 'function' ? window.DataLayer.getEmployees() : []) || [];
    var employeesById = {};
    employees.forEach(function(employee) {
      if (employee && employee.id) employeesById[String(employee.id)] = employee;
    });

    var tasks = (window.DataLayer && typeof window.DataLayer.getTasks === 'function' ? window.DataLayer.getTasks() : []).filter(function(task) {
      return task && task.projectId === project.id;
    });

    var contactId = project && (project.contactEmployeeId || project.contactId || '');
    if (contactId && employeesById[String(contactId)]) {
      return employeesById[String(contactId)];
    }

    var teamMembers = Array.isArray(project && project.teamMembers) ? project.teamMembers : [];
    for (var i = 0; i < teamMembers.length; i++) {
      var member = teamMembers[i];
      var memberId = member && (member.employeeId || member.id);
      if (memberId && employeesById[String(memberId)]) {
        return employeesById[String(memberId)];
      }
    }

    var activeTasks = tasks.filter(function(task) {
      return String(task.status || '').toLowerCase() === 'in-progress';
    }).sort(function(a, b) {
      return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
    });

    if (activeTasks.length) {
      var activeAssigneeId = activeTasks[0].assigneeId || activeTasks[0].employeeId;
      if (activeAssigneeId && employeesById[String(activeAssigneeId)]) {
        return employeesById[String(activeAssigneeId)];
      }
    }

    var nextTask = tasks.filter(function(task) {
      return String(task.status || '').toLowerCase() !== 'done';
    }).sort(function(a, b) {
      return (new Date(a.dueDate || a.createdAt || 0).getTime() || 0) - (new Date(b.dueDate || b.createdAt || 0).getTime() || 0);
    })[0];

    if (nextTask) {
      var assigneeId = nextTask.assigneeId || nextTask.employeeId;
      if (assigneeId && employeesById[String(assigneeId)]) {
        return employeesById[String(assigneeId)];
      }
    }

    return null;
  }

  function getDefaultEmployeeAvatarDataUrl(employee) {
    var name = String((employee && employee.name) || 'Mitarbeiter').trim() || 'Mitarbeiter';
    var roleColor = employee && employee.role ? getRoleColor(employee.role) : '#5ba6ff';
    var svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" aria-label="' + escapeHtml(name) + '">',
      '<defs>',
      '<linearGradient id="employeeAvatarGradient" x1="0%" y1="0%" x2="100%" y2="100%">',
      '<stop offset="0%" stop-color="' + roleColor + '"/>',
      '<stop offset="100%" stop-color="#1f2937"/>',
      '</linearGradient>',
      '</defs>',
      '<rect width="40" height="40" rx="20" fill="url(#employeeAvatarGradient)"/>',
      '<circle cx="20" cy="15" r="6.25" fill="rgba(255,255,255,0.9)"/>',
      '<path d="M12 31c1.8-5.1 6.2-8 8-8s6.2 2.9 8 8" fill="rgba(255,255,255,0.9)"/>',
      '</svg>'
    ].join('');
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  function renderProjectContactAvatar(project) {
    var employee = getProjectContactEmployee(project);
    if (!employee) {
      return '<span class="project-progress-contact-avatar project-progress-contact-avatar-fallback" title="Kein Ansprechpartner">N</span>';
    }

    var name = String(employee.name || 'Mitarbeiter').trim() || 'Mitarbeiter';
    var avatarUrl = getEmployeeAvatarUrl(employee) || getDefaultEmployeeAvatarDataUrl(employee);
    return '<span class="project-progress-contact-avatar" title="' + escapeHtml(name) + '"><img src="' + escapeHtml(avatarUrl) + '" alt="' + escapeHtml(name) + '" /></span>';
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

  function setHtmlIfChanged(node, html) {
    if (!node) return false;
    var next = String(html || '');
    if (node.innerHTML === next) return false;
    node.innerHTML = next;
    return true;
  }

  function captureDashboardUiState() {
    var dashboard = document.getElementById('dashboard');
    var active = document.activeElement;
    var focusState = null;
    if (dashboard && active && active !== document.body && dashboard.contains(active)) {
      var key = null;
      if (active.id) {
        key = { kind: 'id', value: String(active.id) };
      } else if (active.hasAttribute('data-blocker-filter')) {
        key = { kind: 'blocker-filter', value: String(active.getAttribute('data-blocker-filter') || '') };
      } else if (active.name) {
        key = {
          kind: 'named',
          value: String(active.name),
          tag: String(active.tagName || '').toLowerCase()
        };
      }

      focusState = {
        key: key,
        tag: String(active.tagName || '').toLowerCase(),
        value: (typeof active.value === 'string') ? active.value : null,
        selectionStart: (typeof active.selectionStart === 'number') ? active.selectionStart : null,
        selectionEnd: (typeof active.selectionEnd === 'number') ? active.selectionEnd : null
      };
    }

    var mainContent = document.querySelector('.main-content');
    var teamChat = document.getElementById('chart-task-distribution');
    var teamChatList = teamChat ? teamChat.querySelector('[data-team-chat-messages]') : null;
    var teamChatTarget = teamChat ? teamChat.querySelector('[name="team-chat-target"]') : null;
    var teamChatRequire = teamChat ? teamChat.querySelector('[name="team-chat-require-reply"]') : null;
    var teamChatMessage = teamChat ? teamChat.querySelector('[name="team-chat-message"]') : null;
    var projectDetails = {};
    var projectsContainer = document.getElementById('dashboard-projects-full');
    if (projectsContainer) {
      projectsContainer.querySelectorAll('details[data-project-state-key]').forEach(function(node) {
        var key = String(node.getAttribute('data-project-state-key') || '').trim();
        if (!key) return;
        projectDetails[key] = !!node.open;
      });
    }
    return {
      focus: focusState,
      mainScrollTop: mainContent ? mainContent.scrollTop : null,
      mainScrollLeft: mainContent ? mainContent.scrollLeft : null,
      projectDetails: projectDetails,
      teamChat: teamChat ? {
        expanded: teamChat.classList.contains('is-expanded'),
        scrollTop: teamChatList ? teamChatList.scrollTop : 0,
        target: teamChatTarget ? teamChatTarget.value : 'all',
        requireReply: !!(teamChatRequire && teamChatRequire.checked),
        message: teamChatMessage ? teamChatMessage.value : ''
      } : null
    };
  }

  function restoreDashboardUiState(state) {
    if (!state) return;

    var mainContent = document.querySelector('.main-content');
    if (mainContent && state.mainScrollTop !== null) {
      mainContent.scrollTop = Number(state.mainScrollTop) || 0;
      mainContent.scrollLeft = Number(state.mainScrollLeft) || 0;
    }

    if (state.projectDetails && typeof state.projectDetails === 'object') {
      var projectsContainer = document.getElementById('dashboard-projects-full');
      if (projectsContainer) {
        projectsContainer.querySelectorAll('details[data-project-state-key]').forEach(function(node) {
          var key = String(node.getAttribute('data-project-state-key') || '').trim();
          if (!key) return;
          if (Object.prototype.hasOwnProperty.call(state.projectDetails, key)) {
            node.open = !!state.projectDetails[key];
          }
        });
      }
    }

    if (state.teamChat) {
      var teamChat = document.getElementById('chart-task-distribution');
      if (teamChat) {
        setTeamChatExpanded(teamChat, !!state.teamChat.expanded);
        var teamChatList = teamChat.querySelector('[data-team-chat-messages]');
        var teamChatTarget = teamChat.querySelector('[name="team-chat-target"]');
        var teamChatRequire = teamChat.querySelector('[name="team-chat-require-reply"]');
        var teamChatMessage = teamChat.querySelector('[name="team-chat-message"]');
        if (teamChatList) teamChatList.scrollTop = Number(state.teamChat.scrollTop) || 0;
        if (teamChatTarget) teamChatTarget.value = state.teamChat.target || 'all';
        if (teamChatRequire) teamChatRequire.checked = !!state.teamChat.requireReply;
        if (teamChatMessage) teamChatMessage.value = state.teamChat.message || '';
      }
    }

    if (!state.focus || !state.focus.key) return;

    var dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    var target = null;
    if (state.focus.key.kind === 'id') {
      var byId = document.getElementById(state.focus.key.value);
      if (byId && dashboard.contains(byId)) target = byId;
    } else if (state.focus.key.kind === 'blocker-filter') {
      target = dashboard.querySelector('[data-blocker-filter="' + state.focus.key.value + '"]');
    } else if (state.focus.key.kind === 'named') {
      target = dashboard.querySelector(state.focus.key.tag + '[name="' + state.focus.key.value + '"]');
    }

    if (!target || typeof target.focus !== 'function') return;

    if (state.focus.value !== null && typeof target.value === 'string' && !target.disabled) {
      target.value = state.focus.value;
    }

    if (state.focus.tag === 'select') return;
    if (document.activeElement === target) return;

    try {
      target.focus({ preventScroll: true });
    } catch (_errFocus) {
      target.focus();
    }

    if (typeof target.setSelectionRange === 'function' && typeof state.focus.selectionStart === 'number' && typeof state.focus.selectionEnd === 'number') {
      try {
        target.setSelectionRange(state.focus.selectionStart, state.focus.selectionEnd);
      } catch (_errSelection) {}
    }
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

    var projectsPage = document.getElementById('projects');
    var projectsPageIsActive = !!(projectsPage && projectsPage.classList.contains('active'));

    // Avoid collapsing expanded project details while the user works on the projects page.
    if (!projectsPageIsActive && window.ProjectsModule && typeof window.ProjectsModule.render === 'function') {
      window.ProjectsModule.render();
    }

    var mirrorHtml = buildDashboardProjectMirrorHtml();
    if (!mirrorHtml.trim()) {
      setHtmlIfChanged(container, '<h3>Projekte</h3><p class="chart-empty">Keine freigegebenen Projekte vorhanden.</p>');
      return;
    }

    setHtmlIfChanged(container, '<h3>Projekte</h3>' + buildDashboardProjectOverviewLayout(mirrorHtml));
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
      setHtmlIfChanged(host, '');
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
      setHtmlIfChanged(host, html);
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
    setHtmlIfChanged(host, html);
  }

  function updateBlockerFilter(filterName, value) {
    if (!Object.prototype.hasOwnProperty.call(blockerFilterState, filterName)) return;
    blockerFilterState[filterName] = String(value || '');
    writeSavedBlockerFilterState();
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
      setHtmlIfChanged(host, '');
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
    setHtmlIfChanged(host, html);
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
      setHtmlIfChanged(elTotal, '<h3>Gesamt Tasks</h3><div class="stat-value">' + tasks.length + '</div>');
    }

    // In Progress Count
    var inProgress = tasks.filter(function(t) { return t.status === 'in-progress'; }).length;
    var elProgress = document.getElementById('stat-tasks-progress');
    if (elProgress) {
      setHtmlIfChanged(elProgress, '<h3>In Progress</h3><div class="stat-value">' + inProgress + '</div>');
    }

    // Aktive Mitarbeiter
    var activeEmps = employees.filter(function(e) {
      return e.availability === 'Verfügbar' || e.availability === 'Belastet';
    }).length;
    var elActive = document.getElementById('stat-employees-active');
    if (elActive) {
      setHtmlIfChanged(elActive, '<h3>Aktive Mitarbeiter</h3><div class="stat-value">' + activeEmps + '</div>');
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
      setHtmlIfChanged(elDeadlines, '<h3>Deadlines (7d)</h3><div class="stat-value">' + upcoming + '</div>');
    }
  }

  // --- Projekt-Fortschrittsbalken rendern ---
  function renderProjectProgress() {
    var projects = getDashboardProjects();
    var container = document.getElementById('chart-progress-bar');
    if (!container) return;

    if (!container.dataset.progressCollapsed) {
      container.dataset.progressCollapsed = 'true';
    }

    if (!container.dataset.progressBound) {
      container.addEventListener('click', function(event) {
        var toggle = event.target.closest('[data-progress-toggle]');
        if (!toggle || !toggle.closest('#chart-progress-bar')) return;
        container.dataset.progressCollapsed = container.dataset.progressCollapsed === 'true' ? 'false' : 'true';
        renderProjectProgress();
      });
      container.dataset.progressBound = 'true';
    }

    var isCollapsed = container.dataset.progressCollapsed === 'true';

    if (projects.length === 0) {
      setHtmlIfChanged(container, '<h3>Projekt-Fortschritt</h3><p class="chart-empty">Keine Projekte vorhanden.</p>');
      return;
    }

    container.classList.toggle('project-progress-compact', isCollapsed);
    container.classList.toggle('project-progress-expanded', !isCollapsed);

    var html = '<h3>Projekt-Fortschritt</h3>';
    html += '<button type="button" class="project-progress-toggle" data-progress-toggle="true" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">' + (isCollapsed ? 'Volle Ansicht' : 'Kompakt') + '</button>';
    html += '<div class="project-progress-list">';
    projects.forEach(function(project) {
      var tasks = (window.DataLayer && typeof window.DataLayer.getTasks === 'function' ? window.DataLayer.getTasks() : []).filter(function(task) {
        return task && task.projectId === project.id;
      });
      var percent = getProjectProgressPercent(project);
      var activeTask = tasks.some(function(task) {
        return String(task.status || '').toLowerCase() === 'in-progress';
      });
      var toneClass = percent >= 75 ? 'is-strong' : (percent >= 40 ? 'is-mid' : 'is-low');
      var stateClass = activeTask ? 'is-running' : 'is-idle';

      html += '<article class="project-progress-item">';
      html += '<div class="project-progress-head">';
      html += '<div class="project-progress-head-main">';
      html += '<span class="project-progress-title">' + escapeHtml(project.title || project.name) + '</span>';
      html += renderProjectContactAvatar(project);
      html += '</div>';
      html += '<span class="project-progress-percent">' + percent + '%</span>';
      html += '</div>';
      html += '<div class="project-head-progress ' + toneClass + ' ' + stateClass + '">';
      html += '<span class="project-head-progress-label">Aktueller Fortschritt</span>';
      html += '<div class="project-head-progress-track" aria-hidden="true"><span class="project-head-progress-fill" style="--project-progress:' + percent + '%;"></span></div>';
      html += '<div class="project-head-progress-meta">';
      html += '<span class="project-head-progress-value">' + percent + '%</span>';
      if (activeTask) {
        html += '<span class="project-head-progress-live-dot" aria-label="Aktive Bearbeitung"></span><span class="project-head-progress-live-text">In Arbeit</span>';
      }
      html += '</div>';
      html += '</div>';
      html += '</article>';
    });
    html += '</div>';

    setHtmlIfChanged(container, html);
  }

  function getDateKeyFromValue(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return '';

    return parsed.getFullYear() + '-' +
      String(parsed.getMonth() + 1).padStart(2, '0') + '-' +
      String(parsed.getDate()).padStart(2, '0');
  }

  function getCurrentWeekStartDate(today) {
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function getCurrentWeekDays() {
    var labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    var today = new Date();
    var start = getCurrentWeekStartDate(today);
    var days = [];

    for (var i = 0; i < 7; i++) {
      var dayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push({
        label: labels[i],
        date: dayDate,
        dateKey: getDateKeyFromValue(dayDate),
        isToday: getDateKeyFromValue(dayDate) === getDateKeyFromValue(today)
      });
    }

    return days;
  }

  function getEventParticipants(event) {
    var attendeeIds = [];
    if (Array.isArray(event && event.attendeeIds)) attendeeIds = event.attendeeIds.slice();
    else if (Array.isArray(event && event.attendees)) attendeeIds = event.attendees.slice();
    if (!attendeeIds.length && event && event.attendeeId) attendeeIds = [event.attendeeId];

    var seen = {};
    return attendeeIds.map(function(id) {
      return String(id || '').trim();
    }).filter(function(id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function getEventTypeLabel(type) {
    var map = {
      meeting: 'Meeting',
      deadline: 'Deadline',
      release: 'Release',
      holiday: 'Urlaub',
      task: 'Task'
    };
    return map[String(type || '').toLowerCase()] || 'Termin';
  }

  function getEventTimeLabel(event) {
    var startTime = String(event && event.startTime || '').trim();
    if (startTime) return startTime;

    var fromDateTime = event && (event.startDate || event.date || '');
    if (typeof fromDateTime === 'string' && /T/.test(fromDateTime)) {
      var parsed = new Date(fromDateTime);
      if (!isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      }
    }

    return '';
  }

  function getEmployeeDisplayNameById(employeeById, id) {
    if (!id) return '';
    var employee = employeeById[String(id)] || null;
    return employee ? String(employee.name || employee.title || id) : String(id);
  }

  function getProjectDisplayNameById(projectById, id) {
    if (!id) return '';
    var project = projectById[String(id)] || null;
    return project ? String(project.title || project.name || id) : String(id);
  }

  // --- Legacy Team-Wochenkalender ---
  function renderLegacyTaskDistribution() {
    var dataLayer = window.DataLayer || null;
    var employees = (dataLayer && typeof dataLayer.getEmployees === 'function' ? dataLayer.getEmployees() : []) || [];
    var projects = (dataLayer && typeof dataLayer.getProjects === 'function' ? dataLayer.getProjects() : []) || [];
    var tasks = (dataLayer && typeof dataLayer.getTasks === 'function' ? dataLayer.getTasks() : []) || [];
    var events = (dataLayer && typeof dataLayer.getCalendarEvents === 'function' ? dataLayer.getCalendarEvents() : []) || [];
    var container = document.getElementById('chart-task-distribution');
    if (!container) return;

    var weekDays = getCurrentWeekDays();
    var weekDayMap = {};
    weekDays.forEach(function(day) {
      weekDayMap[day.dateKey] = [];
    });

    var employeeById = {};
    employees.forEach(function(employee) {
      if (employee && employee.id) employeeById[String(employee.id)] = employee;
    });

    var taskById = {};
    tasks.forEach(function(task) {
      if (task && task.id) taskById[String(task.id)] = task;
    });

    var projectById = {};
    projects.forEach(function(project) {
      if (project && project.id) projectById[String(project.id)] = project;
    });

    var sortedEmployees = employees.slice().sort(function(a, b) {
      var nameA = String(a && (a.name || a.title) || '').trim();
      var nameB = String(b && (b.name || b.title) || '').trim();
      return nameA.localeCompare(nameB, 'de');
    });

    var UNASSIGNED_ROW_ID = '__unassigned__';
    var rowMeta = [];
    sortedEmployees.forEach(function(employee) {
      rowMeta.push({
        id: String(employee.id || ''),
        name: String(employee.name || employee.title || 'Unbekannter Mitarbeiter')
      });
    });
    rowMeta.push({ id: UNASSIGNED_ROW_ID, name: 'Ohne Zuordnung' });

    var gridMap = {};
    rowMeta.forEach(function(row) {
      gridMap[row.id] = {};
      weekDays.forEach(function(day) {
        gridMap[row.id][day.dateKey] = [];
      });
    });

    events.forEach(function(evt) {
      if (!evt) return;
      var dateKey = getDateKeyFromValue(evt.date || evt.startDate || '');
      if (!dateKey || !weekDayMap[dateKey]) return;

      var participantIds = getEventParticipants(evt);
      if (!participantIds.length && evt.taskId && taskById[String(evt.taskId)] && taskById[String(evt.taskId)].assigneeId) {
        participantIds = [String(taskById[String(evt.taskId)].assigneeId)];
      }

      var participantNames = participantIds.map(function(id) {
        return getEmployeeDisplayNameById(employeeById, id);
      }).filter(Boolean);

      var eventItem = {
        title: evt.title || 'Ohne Titel',
        type: evt.type || 'meeting',
        projectLabel: getProjectDisplayNameById(projectById, evt.projectId || ''),
        timeLabel: getEventTimeLabel(evt),
        participantsLabel: participantNames.length ? participantNames.join(', ') : 'Ohne Zuordnung'
      };

      weekDayMap[dateKey].push(eventItem);

      if (!participantIds.length) {
        participantIds = [UNASSIGNED_ROW_ID];
      }

      var seenRow = {};
      participantIds.forEach(function(participantId) {
        var rowId = String(participantId || '').trim();
        if (!rowId) rowId = UNASSIGNED_ROW_ID;
        if (!gridMap[rowId]) rowId = UNASSIGNED_ROW_ID;
        if (seenRow[rowId]) return;
        seenRow[rowId] = true;
        gridMap[rowId][dateKey].push(eventItem);
      });
    });

    weekDays.forEach(function(day) {
      weekDayMap[day.dateKey].sort(function(a, b) {
        var tA = String(a.timeLabel || '99:99');
        var tB = String(b.timeLabel || '99:99');
        if (tA !== tB) return tA.localeCompare(tB);
        return String(a.title || '').localeCompare(String(b.title || ''), 'de');
      });
    });

    var weekEventsTotal = weekDays.reduce(function(sum, day) {
      return sum + weekDayMap[day.dateKey].length;
    }, 0);

    var rangeStart = weekDays[0].date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    var rangeEnd = weekDays[6].date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    weekDays.forEach(function(day) {
      weekDayMap[day.dateKey].sort(function(a, b) {
        var tA = String(a.timeLabel || '99:99');
        var tB = String(b.timeLabel || '99:99');
        if (tA !== tB) return tA.localeCompare(tB);
        return String(a.title || '').localeCompare(String(b.title || ''), 'de');
      });

      rowMeta.forEach(function(row) {
        gridMap[row.id][day.dateKey].sort(function(a, b) {
          var tA = String(a.timeLabel || '99:99');
          var tB = String(b.timeLabel || '99:99');
          if (tA !== tB) return tA.localeCompare(tB);
          return String(a.title || '').localeCompare(String(b.title || ''), 'de');
        });
      });
    });

    var columnHeadersHtml = weekDays.map(function(day) {
      var dayDateLabel = day.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      var totalForDay = weekDayMap[day.dateKey].length;
      return '<div class="team-week-col-head' + (day.isToday ? ' is-today' : '') + '">' +
        '<span class="team-week-col-label">' + escapeHtml(day.label) + '</span>' +
        '<span class="team-week-col-date">' + escapeHtml(dayDateLabel) + '</span>' +
        '<span class="team-week-col-count">' + String(totalForDay) + '</span>' +
      '</div>';
    }).join('');

    var rowsHtml = rowMeta.map(function(row) {
      var cellsHtml = weekDays.map(function(day) {
        var dayEvents = gridMap[row.id][day.dateKey] || [];
        if (!dayEvents.length) {
          return '<div class="team-week-cell"><span class="team-week-cell-empty">-</span></div>';
        }

        var itemsHtml = dayEvents.map(function(eventItem) {
          var timeCell = eventItem.timeLabel ? '<span class="team-week-event-time">' + escapeHtml(eventItem.timeLabel) + '</span>' : '<span class="team-week-event-time team-week-event-time-empty">Ganztagig</span>';
          var projectCell = eventItem.projectLabel ? '<span class="team-week-event-project">' + escapeHtml(String(eventItem.projectLabel)) + '</span>' : '';
          return '<li class="team-week-event-item">' +
            '<div class="team-week-event-head">' +
            timeCell +
            '<span class="team-week-event-type">' + escapeHtml(getEventTypeLabel(eventItem.type)) + '</span>' +
            '</div>' +
            '<div class="team-week-event-title">' + escapeHtml(eventItem.title) + '</div>' +
            projectCell +
          '</li>';
        }).join('');

        return '<div class="team-week-cell"><ul class="team-week-event-list">' + itemsHtml + '</ul></div>';
      }).join('');

      return '<div class="team-week-row">' +
        '<div class="team-week-row-employee">' + escapeHtml(row.name) + '</div>' +
        cellsHtml +
      '</div>';
    }).join('');

    setHtmlIfChanged(container,
      '<h3>Wochenkalender Team-Termine</h3>' +
      '<div class="team-week-calendar-header">' +
      '<span class="team-week-calendar-range">Diese Woche: ' + escapeHtml(rangeStart) + ' - ' + escapeHtml(rangeEnd) + '</span>' +
      '<span class="team-week-calendar-summary">Mitarbeitende: ' + String(employees.length) + ' | Termine: ' + String(weekEventsTotal) + '</span>' +
      '</div>' +
      '<div class="team-week-matrix-wrap">' +
      '<div class="team-week-row team-week-row-header">' +
      '<div class="team-week-row-employee team-week-row-employee-header">Mitarbeiter</div>' +
      columnHeadersHtml +
      '</div>' +
      rowsHtml +
      '</div>'
    );
  }

  function getTeamChatCurrentUser() {
    var auth = getAuthManager();
    return auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
  }

  function getTeamChatReplyState(message, messages) {
    var requiredIds = Array.isArray(message.requiredEmployeeIds) ? message.requiredEmployeeIds.map(String) : [];
    if (!message.replyRequired || !requiredIds.length) return null;
    var answered = {};
    messages.forEach(function(candidate) {
      if (!candidate || String(candidate.replyToId || '') !== String(message.id || '')) return;
      answered[String(candidate.authorId || '')] = true;
    });
    return {
      total: requiredIds.length,
      openIds: requiredIds.filter(function(id) { return !answered[id]; })
    };
  }

  function renderTaskDistribution() {
    var dataLayer = window.DataLayer || null;
    var container = document.getElementById('chart-task-distribution');
    if (!container) return;

    var employees = dataLayer && typeof dataLayer.getEmployees === 'function' ? dataLayer.getEmployees() || [] : [];
    var messages = dataLayer && typeof dataLayer.getTeamChatMessages === 'function' ? dataLayer.getTeamChatMessages().slice() : [];
    var currentUser = getTeamChatCurrentUser();
    var currentUserId = currentUser ? String(currentUser.id || '') : '';
    var employeeById = {};
    employees.forEach(function(employee) {
      if (employee && employee.id) employeeById[String(employee.id)] = employee;
    });
    messages.sort(function(a, b) {
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });

    if (teamChatReplyToId && !messages.some(function(message) { return String(message.id) === teamChatReplyToId; })) {
      teamChatReplyToId = '';
    }
    var replyTarget = teamChatReplyToId ? messages.find(function(message) { return String(message.id) === teamChatReplyToId; }) : null;
    var messageById = {};
    messages.forEach(function(message) { messageById[String(message.id || '')] = message; });

    var employeeOptions = employees.slice().sort(function(a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'de');
    }).map(function(employee) {
      return '<option value="' + escapeHtml(String(employee.id || '')) + '">' + escapeHtml(employee.name || 'Mitarbeiter') + '</option>';
    }).join('');

    var messagesHtml = messages.map(function(message) {
      var author = employeeById[String(message.authorId || '')] || null;
      var authorName = String(message.authorName || (author && author.name) || 'Ehemaliger Mitarbeiter');
      var targetId = String(message.targetEmployeeId || '');
      var targetName = message.targetType === 'all' ? 'Alle' : String(message.targetEmployeeName || (employeeById[targetId] && employeeById[targetId].name) || 'Mitarbeiter');
      var isAddressed = message.targetType === 'all' || (!!currentUserId && targetId === currentUserId);
      var isOwn = !!currentUserId && String(message.authorId || '') === currentUserId;
      var replyParent = message.replyToId ? messageById[String(message.replyToId)] : null;
      var replyState = getTeamChatReplyState(message, messages);
      var currentUserMustReply = !!(replyState && currentUserId && replyState.openIds.indexOf(currentUserId) !== -1);
      var avatarUrl = getEmployeeAvatarUrl(author || { id: message.authorId, name: authorName });
      var authorOnline = isEmployeeDashboardOnline(author);
      var requirementHtml = '';
      if (replyState) {
        requirementHtml = replyState.openIds.length
          ? '<span class="team-chat-required' + (currentUserMustReply ? ' is-mine' : '') + '">Antwort erforderlich · ' + replyState.openIds.length + ' offen</span>'
          : '<span class="team-chat-required is-done">Antwortpflicht erfüllt</span>';
      }
      var parentHtml = replyParent
        ? '<div class="team-chat-parent">Antwort auf <strong>' + escapeHtml(replyParent.authorName || 'Mitarbeiter') + '</strong>: ' + escapeHtml(String(replyParent.body || '').slice(0, 90)) + '</div>'
        : '';
      return '<article class="team-chat-message' + (isAddressed ? ' is-addressed' : '') + (isOwn ? ' is-own' : '') + (currentUserMustReply ? ' needs-reply' : '') + '">' +
        '<span class="team-chat-avatar-presence' + (authorOnline ? ' is-online' : '') + '"><img class="team-chat-avatar" src="' + escapeHtml(avatarUrl) + '" alt="">' + (authorOnline ? '<span class="profile-presence-dot" aria-hidden="true"></span>' : '') + '</span>' +
        '<div class="team-chat-message-main">' +
          '<div class="team-chat-message-head"><strong>' + escapeHtml(authorName) + (authorOnline ? '<span class="employee-presence" title="Online im Dashboard"><span class="profile-presence-dot" aria-hidden="true"></span><span>Online</span></span>' : '') + '</strong><time datetime="' + escapeHtml(message.createdAt || '') + '">' + escapeHtml(formatDateTime(message.createdAt)) + '</time></div>' +
          parentHtml +
          '<div class="team-chat-target' + (isAddressed ? ' is-addressed' : '') + '">An ' + escapeHtml(targetName) + '</div>' +
          '<div class="team-chat-body">' + escapeHtml(message.body || '') + '</div>' +
          '<div class="team-chat-message-actions">' + requirementHtml + (currentUser ? '<button type="button" class="team-chat-reply" data-team-chat-reply="' + escapeHtml(String(message.id || '')) + '">Antworten</button>' : '') + '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    var composerHtml = currentUser
      ? '<form class="team-chat-composer" data-team-chat-form>' +
          (replyTarget ? '<div class="team-chat-replying">Antwort an <strong>' + escapeHtml(replyTarget.authorName || 'Mitarbeiter') + '</strong><button type="button" data-team-chat-cancel-reply aria-label="Antwort abbrechen" title="Antwort abbrechen">×</button></div>' : '') +
          '<textarea id="team-chat-message-input" name="team-chat-message" rows="3" maxlength="2000" required placeholder="Nachricht an das Team schreiben..."></textarea>' +
          '<div class="team-chat-compose-row">' +
            '<label>An <select name="team-chat-target"><option value="all">Alle</option>' + employeeOptions + '</select></label>' +
            '<label class="team-chat-require"><input type="checkbox" name="team-chat-require-reply"> Antwort erforderlich</label>' +
            '<button type="submit" class="btn btn-primary">Senden</button>' +
          '</div>' +
        '</form>'
      : '<div class="team-chat-login-note">Zum Schreiben bitte als Mitarbeiter anmelden.</div>';

    var isExpanded = container.classList.contains('is-expanded');
    var changed = setHtmlIfChanged(container,
      '<div class="team-chat-titlebar"><div><h3>Team-Gruppenchat</h3><span>' + String(employees.length) + ' Mitarbeitende · öffentlich für das gesamte Team</span></div>' +
      '<button type="button" class="team-chat-expand" data-team-chat-expand aria-label="' + (isExpanded ? 'Chat verkleinern' : 'Chat vergrößern') + '" title="' + (isExpanded ? 'Chat verkleinern' : 'Chat vergrößern') + '">' + (isExpanded ? '×' : '↗') + '</button></div>' +
      '<div class="team-chat-messages" data-team-chat-messages>' + (messagesHtml || '<div class="team-chat-empty">Noch keine Nachrichten. Starte die Unterhaltung.</div>') + '</div>' +
      composerHtml
    );

    if (changed && teamChatScrollToBottom) {
      teamChatScrollToBottom = false;
      window.requestAnimationFrame(function() {
        var list = container.querySelector('[data-team-chat-messages]');
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }

  function isTeamChatInteractionActive() {
    var container = document.getElementById('chart-task-distribution');
    if (!container) return false;
    var active = document.activeElement;
    if (!active || !container.contains(active)) return false;
    var tag = String(active.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      var inputType = String(active.type || '').toLowerCase();
      return inputType !== 'button' && inputType !== 'submit' && inputType !== 'reset' && inputType !== 'checkbox' && inputType !== 'radio';
    }
    return false;
  }

  function submitTeamChatMessage(form) {
    var dataLayer = window.DataLayer || null;
    var currentUser = getTeamChatCurrentUser();
    if (!currentUser || !dataLayer || typeof dataLayer.createTeamChatMessage !== 'function') return;
    var input = form.querySelector('[name="team-chat-message"]');
    var targetSelect = form.querySelector('[name="team-chat-target"]');
    var requireInput = form.querySelector('[name="team-chat-require-reply"]');
    var body = String(input && input.value || '').trim();
    if (!body) return;

    var targetValue = String(targetSelect && targetSelect.value || 'all');
    var employees = dataLayer.getEmployees ? dataLayer.getEmployees() || [] : [];
    var targetEmployee = targetValue === 'all' ? null : employees.find(function(employee) { return String(employee.id || '') === targetValue; });
    var replyRequired = !!(requireInput && requireInput.checked);
    var requiredEmployeeIds = [];
    if (replyRequired) {
      requiredEmployeeIds = targetValue === 'all'
        ? employees.filter(function(employee) { return String(employee.id || '') !== String(currentUser.id || ''); }).map(function(employee) { return String(employee.id || ''); })
        : (targetEmployee ? [String(targetEmployee.id || '')] : []);
    }

    dataLayer.createTeamChatMessage({
      authorId: String(currentUser.id || ''),
      authorName: String(currentUser.name || 'Mitarbeiter'),
      targetType: targetValue === 'all' ? 'all' : 'employee',
      targetEmployeeId: targetEmployee ? String(targetEmployee.id || '') : '',
      targetEmployeeName: targetEmployee ? String(targetEmployee.name || 'Mitarbeiter') : '',
      body: body,
      replyToId: teamChatReplyToId,
      replyRequired: replyRequired,
      requiredEmployeeIds: requiredEmployeeIds
    });
    input.value = '';
    if (targetSelect) targetSelect.value = 'all';
    if (requireInput) requireInput.checked = false;
    teamChatReplyToId = '';
    teamChatScrollToBottom = true;
  }

  function setTeamChatExpanded(container, expanded) {
    if (!container) return;
    var dashboard = document.getElementById('dashboard');
    if (expanded && container.parentNode !== document.body) {
      teamChatPlaceholder = document.createComment('team-chat-placeholder');
      container.parentNode.insertBefore(teamChatPlaceholder, container);
      document.body.appendChild(container);
    } else if (!expanded && teamChatPlaceholder && teamChatPlaceholder.parentNode) {
      teamChatPlaceholder.parentNode.insertBefore(container, teamChatPlaceholder);
      teamChatPlaceholder.parentNode.removeChild(teamChatPlaceholder);
      teamChatPlaceholder = null;
    }

    container.classList.toggle('is-expanded', expanded);
    document.body.classList.toggle('team-chat-open', expanded);
    if (dashboard) dashboard.classList.toggle('team-chat-expanded', expanded);
    var button = container.querySelector('[data-team-chat-expand]');
    if (button) {
      button.textContent = expanded ? '×' : '↗';
      button.setAttribute('aria-label', expanded ? 'Chat verkleinern' : 'Chat vergrößern');
      button.setAttribute('title', expanded ? 'Chat verkleinern' : 'Chat vergrößern');
    }
  }

  function handleTeamChatClick(event) {
    var expandBtn = event.target && event.target.closest ? event.target.closest('[data-team-chat-expand]') : null;
    if (expandBtn) {
      var chat = document.getElementById('chart-task-distribution');
      setTeamChatExpanded(chat, !(chat && chat.classList.contains('is-expanded')));
      return;
    }

    var replyBtn = event.target && event.target.closest ? event.target.closest('[data-team-chat-reply]') : null;
    if (replyBtn) {
      teamChatReplyToId = String(replyBtn.getAttribute('data-team-chat-reply') || '');
      renderTaskDistribution();
      var chatInput = document.getElementById('team-chat-message-input');
      if (chatInput) chatInput.focus();
      return;
    }

    var cancelReplyBtn = event.target && event.target.closest ? event.target.closest('[data-team-chat-cancel-reply]') : null;
    if (cancelReplyBtn) {
      teamChatReplyToId = '';
      renderTaskDistribution();
    }
  }

  function getEmployeeAvatarUrl(employee) {
    var github = employee && employee.github ? employee.github : null;
    if (!github) return getDefaultEmployeeAvatarDataUrl(employee);

    if (github.avatarUrl) {
      return String(github.avatarUrl).trim();
    }

    var username = String(github.username || '').trim();
    if (!username && github.profileUrl) {
      var match = String(github.profileUrl).match(/github\.com\/([^\/#?]+)/i);
      if (match && match[1]) username = match[1];
    }

    username = username.replace(/^@+/, '').replace(/\/$/, '').replace(/[^A-Za-z0-9-]/g, '');
    return username ? 'https://github.com/' + encodeURIComponent(username) + '.png?size=96' : getDefaultEmployeeAvatarDataUrl(employee);
  }

  function getTaskProgressValue(task) {
    var progress = typeof task.progress === 'number' && !isNaN(task.progress) ? task.progress : null;
    if (progress === null) {
      if (task.status === 'done') return 100;
      if (task.status === 'review') return 85;
      if (task.status === 'in-progress') return 55;
      if (task.status === 'todo') return 10;
      return 0;
    }

    if (progress < 0) return 0;
    if (progress > 100) return 100;
    return Math.round(progress);
  }

  function normalizeTaskStatus(task) {
    var status = String(task && task.status || '').trim().toLowerCase();
    if (status === 'in progress' || status === 'in arbeit' || status === 'inarbeit') return 'in-progress';
    return status;
  }

  function getTeamLoadProgressAccent(progress) {
    if (progress >= 80) return '#58d39b';
    if (progress >= 40) return '#4fa9ff';
    return '#ffa85a';
  }

  function getEmployeeTeamLoadTasks(employee, tasks) {
    var employeeId = String(employee && employee.id || '');
    var employeeName = String(employee && employee.name || '').trim().toLowerCase();

    return (tasks || []).filter(function(task) {
      if (!task) return false;
      if (normalizeTaskStatus(task) !== 'in-progress') return false;
      if (String(task.assigneeId || '') === employeeId) return true;
      if (task.employeeName && String(task.employeeName).trim().toLowerCase() === employeeName) return true;
      return false;
    }).sort(function(a, b) {
      var diff = getTaskProgressValue(b) - getTaskProgressValue(a);
      if (diff !== 0) return diff;

      if (a.status === 'in-progress' && b.status !== 'in-progress') return -1;
      if (b.status === 'in-progress' && a.status !== 'in-progress') return 1;

      return String(a.title || '').localeCompare(String(b.title || ''), 'de');
    });
  }

  function getTaskProjectLabel(task, projectsById) {
    var project = task && task.projectId ? projectsById[String(task.projectId)] : null;
    if (project) return String(project.title || project.name || '').trim();
    return String(task && (task.projectTitle || task.projectName) || '').trim();
  }

  function getDashboardEmployeesSnapshot() {
    var employees = window.DataLayer && typeof window.DataLayer.getEmployees === 'function'
      ? (window.DataLayer.getEmployees() || [])
      : [];

    if (employees.length) return employees;

    try {
      var raw = window.localStorage ? window.localStorage.getItem('pd_employees') : '';
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function(item) { return item && typeof item === 'object'; }) : [];
    } catch (_err) {
      return [];
    }
  }

  function getTeamLoadEmployeeRows(employees, tasks) {
    var rows = [];
    var seen = {};

    (employees || []).forEach(function(employee) {
      if (!employee) return;
      var key = employee.id ? 'id:' + String(employee.id) : 'name:' + String(employee.name || '').trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      rows.push({
        employee: employee,
        activeTasks: getEmployeeTeamLoadTasks(employee, tasks)
      });
    });

    if (rows.length) return rows;

    (tasks || []).forEach(function(task) {
      if (!task || normalizeTaskStatus(task) !== 'in-progress') return;

      var assigneeId = String(task.assigneeId || task.employeeId || '').trim();
      var assigneeName = String(task.employeeName || task.assigneeName || '').trim();
      var key = assigneeId ? 'id:' + assigneeId : 'name:' + assigneeName.toLowerCase();
      if (!key || seen[key]) return;

      seen[key] = true;
      rows.push({
        employee: {
          id: assigneeId,
          name: assigneeName || 'Mitarbeiter',
          github: null,
          currentActivity: ''
        },
        activeTasks: (tasks || []).filter(function(candidate) {
          if (!candidate || normalizeTaskStatus(candidate) !== 'in-progress') return false;
          if (assigneeId && String(candidate.assigneeId || candidate.employeeId || '').trim() === assigneeId) return true;
          return assigneeName && String(candidate.employeeName || candidate.assigneeName || '').trim().toLowerCase() === assigneeName.toLowerCase();
        }).sort(function(a, b) {
          var diff = getTaskProgressValue(b) - getTaskProgressValue(a);
          if (diff !== 0) return diff;
          return String(a.title || '').localeCompare(String(b.title || ''), 'de');
        })
      });
    });

    return rows;
  }

  // --- Team-Load Donut-Chart ---
  function isEmployeeDashboardOnline(employee) {
    return !!(window.AuthManager && typeof window.AuthManager.isEmployeeDashboardOnline === 'function' && window.AuthManager.isEmployeeDashboardOnline(employee));
  }

  function renderTeamLoad() {
    var employees = getDashboardEmployeesSnapshot();
    var tasks = window.DataLayer.getTasks() || [];
    var projects = window.DataLayer.getProjects() || [];
    var container = document.getElementById('chart-team-load');
    if (!container) return;

    if (employees.length === 0) {
      setHtmlIfChanged(container, '<h3>Aufgabenverteilung</h3><p class="chart-empty">Nicht genügend Daten für Chart.</p>');
      return;
    }

    var projectsById = {};
    projects.forEach(function(project) {
      if (!project || !project.id) return;
      projectsById[String(project.id)] = project;
    });

    var employeeRows = getTeamLoadEmployeeRows(employees, tasks).sort(function(a, b) {
      if (b.activeTasks.length !== a.activeTasks.length) return b.activeTasks.length - a.activeTasks.length;
      return String(a.employee.name || '').localeCompare(String(b.employee.name || ''), 'de');
    });

    if (employeeRows.length === 0) {
      setHtmlIfChanged(container, '<h3>Aufgabenverteilung</h3><p class="chart-empty">Nicht genügend Daten für Chart.</p>');
      return;
    }

    var html = '<h3>Aufgabenverteilung</h3>';
    html += '<div class="team-load-grid">';

    employeeRows.forEach(function(row) {
      var employee = row.employee || {};
      var activeTasks = row.activeTasks || [];
      var avatarUrl = getEmployeeAvatarUrl(employee);
      var profileUrl = employee.github && employee.github.profileUrl ? String(employee.github.profileUrl).trim() : '';
      var githubLabel = employee.github && employee.github.username ? '@' + String(employee.github.username).replace(/^@+/, '') : '';
      var currentActivity = String(employee.currentActivity || '').trim();
      var workplace = String(employee.workplace || '').trim();
      var dailyStatus = employee.dailyWorkStatus && typeof employee.dailyWorkStatus === 'object' ? employee.dailyWorkStatus : null;
      var now = new Date();
      var todayKey = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      if (dailyStatus && String(dailyStatus.date || '') !== todayKey) dailyStatus = null;
      var dailyStatusDate = dailyStatus ? String(dailyStatus.date || '') : '';
      var dailyNote = dailyStatus ? String(dailyStatus.note || '').trim() : '';
      var dailySick = !!(dailyStatus && dailyStatus.sick);
      var dailyWorkplace = dailyStatus && dailyStatus.workplace ? String(dailyStatus.workplace).trim() : workplace;
      var activeLabel = activeTasks.length === 1 ? '1 aktiv' : activeTasks.length + ' aktiv';
      var isOnline = isEmployeeDashboardOnline(employee);

      html += '<article class="team-load-card' + (isOnline ? ' is-online' : '') + '">';
      if (avatarUrl && profileUrl) {
        html += '<a class="team-load-avatar-link" href="' + escapeHtml(profileUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="GitHub Profil von ' + escapeHtml(employee.name || 'Mitarbeiter') + '">';
        html += '<img class="team-load-avatar" src="' + escapeHtml(avatarUrl) + '" alt="' + escapeHtml(employee.name || 'Mitarbeiter') + '">';
        html += '</a>';
      } else if (avatarUrl) {
        html += '<span class="team-load-avatar-link" aria-hidden="true">';
        html += '<img class="team-load-avatar" src="' + escapeHtml(avatarUrl) + '" alt="' + escapeHtml(employee.name || 'Mitarbeiter') + '">';
        html += '</span>';
      } else {
        html += '<span class="team-load-avatar team-load-avatar-fallback" aria-hidden="true">' + escapeHtml(String(employee.name || '?').charAt(0).toUpperCase()) + '</span>';
      }

      html += '<div class="team-load-main">';
      html += '<div class="team-load-header">';
      html += '<div class="team-load-headcopy">';
      html += '<div class="team-load-name">' + escapeHtml(employee.name || 'Mitarbeiter');
      if (isOnline) {
        html += '<span class="team-load-presence" title="Online im Dashboard"><span class="team-load-presence-dot" aria-hidden="true"></span><span>Online</span></span>';
      }
      html += '</div>';
      html += '<div class="team-load-meta">';
      if (githubLabel) {
        html += '<span>' + escapeHtml(githubLabel) + '</span>';
      }
      if (currentActivity) {
        if (githubLabel) html += '<span>·</span>';
        html += '<span>' + escapeHtml(currentActivity) + '</span>';
      }
      if (!githubLabel && !currentActivity) {
        html += '<span>Keine GitHub-Verknüpfung</span>';
      }
      html += '</div></div>';
      html += '<span class="team-load-count' + (activeTasks.length ? ' is-active' : ' is-idle') + '">' + escapeHtml(activeLabel) + '</span>';
      html += '</div>';

      if (dailyStatusDate || workplace) {
        html += '<div class="team-load-day-status' + (dailySick ? ' is-sick' : '') + '">';
        if (dailySick) {
          html += '<div class="team-load-workplace" title="Heute krankgemeldet">';
          html += '<span class="material-symbols-rounded" aria-hidden="true">medical_services</span><span>Krankgemeldet</span></div>';
        } else if (dailyWorkplace) {
          html += '<div class="team-load-workplace" title="Arbeitsort: ' + escapeHtml(dailyWorkplace) + '">';
          html += '<span class="material-symbols-rounded" aria-hidden="true">location_on</span>';
          html += '<span>' + escapeHtml(dailyWorkplace) + '</span></div>';
        }
        if (dailyNote) {
          html += '<div class="team-load-day-note" title="' + escapeHtml(dailyNote) + '"><span class="material-symbols-rounded" aria-hidden="true">sticky_note_2</span><span>' + escapeHtml(dailyNote) + '</span></div>';
        }
        html += '</div>';
      }

      if (activeTasks.length) {
        html += '<div class="team-load-tasks">';
        activeTasks.forEach(function(task) {
          var progress = getTaskProgressValue(task);
          var accent = getTeamLoadProgressAccent(progress);
          var projectLabel = getTaskProjectLabel(task, projectsById);
          var taskLabel = String(task.title || 'Aufgabe').trim();
          var title = projectLabel ? taskLabel + ' · ' + projectLabel : taskLabel;

          html += '<div class="team-load-task-progress" style="--team-progress:' + progress + '%;--team-progress-accent:' + accent + ';">';
          html += '<div class="team-load-task-topline">';
          html += '<span class="team-load-task-label" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>';
          html += '<span class="team-load-task-value">' + progress + '%</span>';
          html += '</div>';
          html += '<span class="team-load-task-track" aria-hidden="true"><span class="team-load-task-fill"></span></span>';
          html += '</div>';
        });

        if (activeTasks.length > 2) {
          html += '<div class="team-load-more">+' + (activeTasks.length - 2) + ' weitere aktive Aufgaben</div>';
        }

        html += '</div>';
      } else {
        html += '<div class="team-load-empty">' + escapeHtml(currentActivity || 'Derzeit keine Aufgabe in Arbeit') + '</div>';
      }

      html += '</div></article>';
    });

    if (!employeeRows.some(function(row) { return row.activeTasks.length > 0; })) {
      html += '<p class="team-load-empty team-load-empty-global">Keine aktiven Aufgaben vorhanden.</p>';
    }

    html += '</div>';
    setHtmlIfChanged(container, html);
  }

  // --- escapeHtml helper ---
  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  // --- Main Render Function ---
  function renderDashboard(context) {
    var eventEntity = context && context.entity ? String(context.entity) : '';
    var skipTeamChatRender = isTeamChatInteractionActive() && eventEntity && eventEntity !== 'teamChatMessages';
    var uiState = captureDashboardUiState();
    try {
      renderDashboardBlockers();
      renderDepartmentNotices();
      renderStatsCards();
      renderProjectProgress();
      renderDashboardProjectOverview();
      if (!skipTeamChatRender) renderTaskDistribution();
      renderTeamLoad();
    } catch(e) { console.error('[Dashboard] Error:', e); }
    restoreDashboardUiState(uiState);
  }

  var dashboardRenderQueued = false;
  var pendingDashboardRenderContext = null;
  function scheduleDashboardRender(context) {
    if (context && typeof context === 'object') {
      pendingDashboardRenderContext = {
        action: String(context.action || ''),
        entity: String(context.entity || '')
      };
    }
    if (dashboardRenderQueued) return;
    dashboardRenderQueued = true;
    var runner = (typeof window.requestAnimationFrame === 'function')
      ? window.requestAnimationFrame
      : function(cb) { return window.setTimeout(cb, 16); };
    runner(function() {
      dashboardRenderQueued = false;
      var renderContext = pendingDashboardRenderContext;
      pendingDashboardRenderContext = null;
      renderDashboard(renderContext);
    });
  }

  // --- Init ---
  document.addEventListener('DOMContentLoaded', function() {
    restoreBlockerFilterState();

    var dashboardPage = document.getElementById('dashboard');
    var teamChatContainer = document.getElementById('chart-task-distribution');
    if (teamChatContainer) {
      teamChatContainer.addEventListener('click', function(event) {
        event.stopPropagation();
        handleTeamChatClick(event);
      });
      teamChatContainer.addEventListener('submit', function(event) {
        var form = event.target && event.target.closest ? event.target.closest('[data-team-chat-form]') : null;
        if (!form) return;
        event.preventDefault();
        event.stopPropagation();
        submitTeamChatMessage(form);
      });
    }
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
    if (window.DataLayer && typeof window.DataLayer.on === 'function') {
      window.DataLayer.on('dataChanged', function(event) {
        scheduleDashboardRender(event || null);
      });
    }
  });

  // --- Public API ---
  window.DashboardManager = {
    refresh: scheduleDashboardRender,
    dismissDepartmentNotice: dismissDepartmentNotice,
    renderStatsCards: renderStatsCards,
    renderProjectProgress: renderProjectProgress,
    renderDashboardProjectOverview: renderDashboardProjectOverview,
    renderTaskDistribution: renderTaskDistribution,
    renderTeamLoad: renderTeamLoad
  };
})();

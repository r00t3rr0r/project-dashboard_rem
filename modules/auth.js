/* ========================================
   Auth & Permissions
   Lokale Session, Login fuer Mitarbeiter und rechtebasierte Navigation
   ======================================== */
(function () {
  'use strict';

  var SESSION_KEY = 'pd_auth_session_v1';
  var SESSION_PERSIST_KEY = 'pd_auth_session_persist_v1';
  var TOOLBAR_ID = 'auth-toolbar-group';
  var WORKPLACE_TOOLBAR_ID = 'workplace-toolbar-group';
  var WORKPLACE_OPTIONS = [
    { value: '', label: 'Arbeitsort waehlen' },
    { value: 'B\u00fcro', label: 'B\u00fcro' },
    { value: 'Homeoffice', label: 'Homeoffice' },
    { value: 'Hybrid', label: 'Hybrid' },
    { value: 'Au\u00dfendienst', label: 'Au\u00dfendienst' },
    { value: 'Kundenstandort', label: 'Kundenstandort' },
    { value: 'Au\u00dfer Landes', label: 'Au\u00dfer Landes' }
  ];
  var ALL_PAGES = [
    'dashboard',
    'projects',
    'meeting',
    'tasks',
    'kanban',
    'calendar',
    'analytics',
    'employees',
    'labels',
    'quicktask',
    'ai-conf',
    'healthcheck',
    'timeline',
    'releases',
    'standup',
    'documentation',
    'notifications',
    'templates',
    'sharing',
    'integrations',
    'sprint'
  ];
  var PAGE_LABELS = {
    dashboard: 'Dashboard',
    projects: 'Projekte',
    meeting: 'Meeting Protokoll',
    tasks: 'Aufgaben',
    kanban: 'Kanban Board',
    calendar: 'Team-Kalender',
    analytics: 'Analytics',
    employees: 'Mitarbeiter',
    labels: 'Labels',
    quicktask: 'QuickTask',
    'ai-conf': 'AI Conf',
    healthcheck: 'Gesundheits-Check',
    timeline: 'Timeline',
    releases: 'Releases',
    standup: 'Standup',
    documentation: 'Dokumentation',
    notifications: 'Benachrichtigungen',
    templates: 'Vorlagen',
    sharing: 'Sharing',
    integrations: 'Integrationen',
    sprint: 'Sprints'
  };
  var GUEST_PAGES = ['dashboard', 'calendar', 'kanban'];
  var EMPLOYEE_DEFAULT_PAGES = ['dashboard', 'projects', 'tasks', 'kanban', 'calendar', 'quicktask', 'employees'];
  var PASSWORD_SCHEME = 'pbkdf2';
  var PASSWORD_PBKDF2_ITERATIONS = 180000;
  var PASSWORD_PBKDF2_BYTES = 32;
  var SESSION_VERSION = 2;
  var SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
  var SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
  var SESSION_TOUCH_INTERVAL_MS = 30 * 1000;
  var AUTH_REFRESH_INTERVAL_MS = 15000;
  var DASHBOARD_PRESENCE_TOUCH_INTERVAL_MS = 45000;
  var wrapped = false;
  var originalMethods = {};
  var authRefreshTimer = null;
  var initStarted = false;
  var authStateBootstrapped = false;
  var authDataLoaded = false;
  var authBootstrapPromise = null;
  var dailyStatusPromptTimer = null;
  var dailyStatusDialogOpen = false;
  var dailyStatusConfirmedKey = '';
  var dashboardPresenceLastTouchedAt = 0;

  function stableHashHex(input) {
    var text = String(input || '');
    var hash = 2166136261;
    var i;
    for (i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0).padStart(8, '0');
  }

  function toIsoStringSafe(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  function getUserAgentTag() {
    var ua = (window.navigator && window.navigator.userAgent) ? String(window.navigator.userAgent) : '';
    return stableHashHex(ua);
  }

  function createPasswordStateTag(passwordHash) {
    return stableHashHex(String(passwordHash || ''));
  }

  function createSessionId() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }

  function buildSessionForEmployee(employee) {
    var nowIso = new Date().toISOString();
    var hash = employee && employee.auth && employee.auth.login ? employee.auth.login.passwordHash : '';
    return {
      version: SESSION_VERSION,
      sessionId: createSessionId(),
      employeeId: employee && employee.id ? String(employee.id) : '',
      uaTag: getUserAgentTag(),
      passwordStateTag: createPasswordStateTag(hash),
      issuedAt: nowIso,
      lastSeenAt: nowIso
    };
  }

  function isSessionExpired(session) {
    var now = Date.now();
    var issuedAt = Date.parse(String(session && session.issuedAt || ''));
    var lastSeenAt = Date.parse(String(session && session.lastSeenAt || ''));
    if (isNaN(issuedAt) || isNaN(lastSeenAt)) return true;
    if ((now - issuedAt) > SESSION_MAX_AGE_MS) return true;
    if ((now - lastSeenAt) > SESSION_IDLE_TIMEOUT_MS) return true;
    return false;
  }

  function sessionMatchesClient(session) {
    var uaTag = String(session && session.uaTag || '');
    if (!uaTag) return false;
    return constantTimeEquals(uaTag, getUserAgentTag());
  }

  function touchSessionIfNeeded(session) {
    if (!session || typeof session !== 'object') return;
    var lastSeenAt = Date.parse(String(session.lastSeenAt || ''));
    var now = Date.now();
    if (!isNaN(lastSeenAt) && (now - lastSeenAt) < SESSION_TOUCH_INTERVAL_MS) return;
    session.lastSeenAt = new Date(now).toISOString();
    writeSession(session);
  }

  function touchDashboardPresence() {
    if (document.visibilityState !== 'visible') return;
    var dashboardPage = document.getElementById('dashboard');
    if (!dashboardPage || !dashboardPage.classList.contains('active')) return;
    if ((Date.now() - dashboardPresenceLastTouchedAt) < DASHBOARD_PRESENCE_TOUCH_INTERVAL_MS) return;

    var user = getCurrentUser();
    if (!user || !window.DataLayer || typeof window.DataLayer.updateEmployee !== 'function') return;

    var next = clone(user);
    next.dashboardPresenceAt = new Date().toISOString();
    dashboardPresenceLastTouchedAt = Date.now();
    window.DataLayer.updateEmployee(next);
  }

  function isEmployeeDashboardOnline(employee) {
    var lastPresenceAt = Date.parse(String(employee && employee.dashboardPresenceAt || ''));
    return !isNaN(lastPresenceAt) && (Date.now() - lastPresenceAt) <= 100000;
  }

  function readSession() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        raw = window.localStorage.getItem(SESSION_PERSIST_KEY);
      }

      var parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};

      return {
        version: Number(parsed.version || 0),
        sessionId: String(parsed.sessionId || ''),
        employeeId: String(parsed.employeeId || ''),
        uaTag: String(parsed.uaTag || ''),
        passwordStateTag: String(parsed.passwordStateTag || ''),
        issuedAt: toIsoStringSafe(parsed.issuedAt),
        lastSeenAt: toIsoStringSafe(parsed.lastSeenAt)
      };
    } catch (_err) {
      return {};
    }
  }

  function writeSession(data) {
    try {
      if (!data || !data.employeeId) {
        window.sessionStorage.removeItem(SESSION_KEY);
        window.localStorage.removeItem(SESSION_PERSIST_KEY);
        return;
      }
      var sessionData = {
        version: Number(data.version || SESSION_VERSION),
        sessionId: String(data.sessionId || ''),
        employeeId: String(data.employeeId || ''),
        uaTag: String(data.uaTag || ''),
        passwordStateTag: String(data.passwordStateTag || ''),
        issuedAt: toIsoStringSafe(data.issuedAt),
        lastSeenAt: toIsoStringSafe(data.lastSeenAt)
      };

      var serialized = JSON.stringify(sessionData);
      window.sessionStorage.setItem(SESSION_KEY, serialized);
      window.localStorage.setItem(SESSION_PERSIST_KEY, serialized);
    } catch (_err) {}
  }

  function emitAuthChanged() {
    var detail = getSessionState();
    try {
      window.dispatchEvent(new CustomEvent('authChanged', { detail: detail }));
    } catch (_err) {}
    if (window.DataLayer && typeof window.DataLayer.emit === 'function') {
      window.DataLayer.emit('authChanged', detail);
    }
  }

  function unique(list) {
    var seen = {};
    return (list || []).filter(function (item) {
      var value = String(item || '').trim();
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizePageList(pages) {
    return unique((Array.isArray(pages) ? pages : []).map(function (page) {
      return String(page || '').trim();
    })).filter(function (page) {
      return ALL_PAGES.indexOf(page) !== -1;
    });
  }

  function slugifyName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'mitarbeiter';
  }

  function normalizeUsername(value, fallbackName) {
    return slugifyName(String(value || '').trim() || fallbackName || 'mitarbeiter');
  }

  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeEmployeeAccess(employee) {
    var copy = employee && typeof employee === 'object' ? clone(employee) : {};
    var auth = copy.auth && typeof copy.auth === 'object' ? copy.auth : {};
    var login = auth.login && typeof auth.login === 'object' ? auth.login : {};
    var permissions = auth.permissions && typeof auth.permissions === 'object' ? auth.permissions : {};
    var accessLevel = auth.accessLevel === 'admin' ? 'admin' : 'employee';
    var username = normalizeUsername(login.username, copy.name || 'mitarbeiter');
    var passwordHash = typeof login.passwordHash === 'string' ? login.passwordHash.trim() : '';
    var pages = accessLevel === 'admin'
      ? ALL_PAGES.slice()
      : normalizePageList(permissions.pages && permissions.pages.length ? permissions.pages : EMPLOYEE_DEFAULT_PAGES);
    if (accessLevel !== 'admin' && pages.indexOf('employees') === -1) pages.push('employees');

    copy.auth = {
      accessLevel: accessLevel,
      login: {
        enabled: !!login.enabled,
        username: username,
        passwordHash: passwordHash,
        passwordSet: !!(passwordHash || login.passwordSet)
      },
      permissions: {
        pages: pages
      }
    };

    return copy;
  }

  function getEmployees() {
    if (!window.DataLayer || typeof window.DataLayer.getEmployees !== 'function') return [];
    return (window.DataLayer.getEmployees() || []).map(normalizeEmployeeAccess);
  }

  function getLoginEmployees() {
    return getEmployees().filter(function (employee) {
      return !!(employee.auth && employee.auth.login && employee.auth.login.enabled && employee.auth.login.passwordHash);
    });
  }

  function isSetupMode() {
    if (!authStateBootstrapped || !authDataLoaded) return false;
    if (window.DataLayer && typeof window.DataLayer.hasData === 'function' && window.DataLayer.hasData()) {
      return false;
    }

    var employees = getEmployees();
    if (employees.length === 0) return true;
    if (getLoginEmployees().length > 0) return false;

    // In local fallback mode password hashes can be omitted intentionally.
    // Treat enabled/password-set logins as configured to avoid false setup state.
    var hasProvisionedLogins = employees.some(function (employee) {
      var login = employee && employee.auth && employee.auth.login ? employee.auth.login : null;
      if (!login) return false;
      return !!(login.enabled || login.passwordSet);
    });

    return !hasProvisionedLogins;
  }

  function bootstrapAuthState() {
    if (authBootstrapPromise) return authBootstrapPromise;

    var readyPromise = Promise.resolve(true);
    if (window.DataLayer && window.DataLayer.ready && typeof window.DataLayer.ready.then === 'function') {
      readyPromise = window.DataLayer.ready.catch(function () {
        return false;
      });
    }

    authBootstrapPromise = readyPromise.then(function (result) {
      authDataLoaded = result !== false;
      authStateBootstrapped = true;
      return result;
    }).catch(function () {
      authDataLoaded = false;
      authStateBootstrapped = true;
      return false;
    });

    return authBootstrapPromise;
  }

  function getCurrentUser() {
    if (isSetupMode()) return null;

    var session = readSession();
    var employeeId = String(session.employeeId || '').trim();
    if (!employeeId) return null;

    var employee = getEmployees().find(function (item) {
      return String(item.id) === employeeId;
    }) || null;

    if (!employee) {
      return null;
    }

    if (!employee.auth.login.enabled || !employee.auth.login.passwordHash) {
      return null;
    }

    var isLegacySession = Number(session.version || 0) < SESSION_VERSION;
    var passwordStateTag = createPasswordStateTag(employee.auth.login.passwordHash);
    if (
      isLegacySession ||
      !session.sessionId ||
      !sessionMatchesClient(session) ||
      isSessionExpired(session) ||
      !constantTimeEquals(String(session.passwordStateTag || ''), passwordStateTag)
    ) {
      writeSession(null);
      return null;
    }

    touchSessionIfNeeded(session);

    return employee;
  }

  function isAdmin(user) {
    var employee = user || getCurrentUser();
    return !!(employee && employee.auth && employee.auth.accessLevel === 'admin');
  }

  function getMode() {
    if (isSetupMode()) return 'setup';
    if (isAdmin()) return 'admin';
    if (getCurrentUser()) return 'employee';
    return 'guest';
  }

  function getVisiblePages() {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return ALL_PAGES.slice();
    if (mode === 'employee') {
      var user = getCurrentUser();
      var pages = user && user.auth && user.auth.permissions ? user.auth.permissions.pages : [];
      var visible = normalizePageList((pages || []).concat(['dashboard']));
      return visible.length ? visible : EMPLOYEE_DEFAULT_PAGES.slice();
    }
    return GUEST_PAGES.slice();
  }

  function getFallbackPage() {
    var visible = getVisiblePages();
    if (visible.indexOf('dashboard') !== -1) return 'dashboard';
    return visible[0] || 'dashboard';
  }

  function canAccessPage(page) {
    return getVisiblePages().indexOf(String(page || '').trim()) !== -1;
  }

  function canManageEmployees() {
    var mode = getMode();
    return mode === 'setup' || mode === 'admin';
  }

  function canEditOwnEmployee(employee) {
    var mode = getMode();
    if (mode !== 'employee') return false;
    var user = getCurrentUser();
    if (!user) return false;
    var employeeId = employee && typeof employee === 'object' ? employee.id : employee;
    return String(employeeId || '') === String(user.id || '');
  }

  function sanitizeSelfEmployeeUpdate(employee) {
    var employeeId = employee && employee.id ? String(employee.id) : '';
    if (!employeeId) throw new Error('Mitarbeiter-ID fehlt.');

    var current = getEmployees().find(function (item) {
      return String(item.id) === employeeId;
    });
    if (!current) throw new Error('Mitarbeiter nicht gefunden.');

    if (!canEditOwnEmployee(current)) {
      throw new Error('Nur das eigene Profil kann bearbeitet werden.');
    }

    var incoming = employee && typeof employee === 'object' ? clone(employee) : {};
    var next = clone(current);

    if (Object.prototype.hasOwnProperty.call(incoming, 'currentActivity')) {
      next.currentActivity = String(incoming.currentActivity || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'focusAreas')) {
      var focus = Array.isArray(incoming.focusAreas) ? incoming.focusAreas : [];
      next.focusAreas = unique(focus.map(function (item) {
        return String(item || '').trim();
      }).filter(Boolean));
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'availability')) {
      var allowedAvailability = ['Verf\u00fcgbar', 'Belastet', 'Urlaub'];
      var availability = String(incoming.availability || '').trim();
      if (allowedAvailability.indexOf(availability) !== -1) {
        next.availability = availability;
      }
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'workplace')) {
      var workplace = String(incoming.workplace || '').trim();
      var allowedWorkplaces = WORKPLACE_OPTIONS.map(function (option) { return option.value; });
      if (allowedWorkplaces.indexOf(workplace) !== -1) {
        next.workplace = workplace;
      }
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'dailyWorkStatus')) {
      var dailyStatus = incoming.dailyWorkStatus && typeof incoming.dailyWorkStatus === 'object'
        ? incoming.dailyWorkStatus
        : {};
      var dailyWorkplace = String(dailyStatus.workplace || '').trim();
      var allowedDailyWorkplaces = WORKPLACE_OPTIONS.map(function (option) { return option.value; });
      var isSick = !!dailyStatus.sick;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(dailyStatus.date || '')) &&
          (isSick || allowedDailyWorkplaces.indexOf(dailyWorkplace) !== -1)) {
        next.dailyWorkStatus = {
          date: String(dailyStatus.date),
          workplace: isSick ? '' : dailyWorkplace,
          note: String(dailyStatus.note || '').trim().slice(0, 500),
          sick: isSick,
          updatedAt: toIsoStringSafe(dailyStatus.updatedAt) || new Date().toISOString()
        };
      }
    }

    if (Object.prototype.hasOwnProperty.call(incoming, 'capacityPoints')) {
      var capacity = Number(incoming.capacityPoints);
      if (isFinite(capacity)) {
        next.capacityPoints = Math.max(2, Math.min(20, Math.round(capacity)));
      }
    }

    if (incoming.github && typeof incoming.github === 'object') {
      next.github = Object.assign({}, next.github || {}, {
        username: Object.prototype.hasOwnProperty.call(incoming.github, 'username') ? incoming.github.username : (next.github && next.github.username),
        profileUrl: Object.prototype.hasOwnProperty.call(incoming.github, 'profileUrl') ? incoming.github.profileUrl : (next.github && next.github.profileUrl),
        aliases: Object.prototype.hasOwnProperty.call(incoming.github, 'aliases') ? incoming.github.aliases : (next.github && next.github.aliases),
        privateAccessToken: Object.prototype.hasOwnProperty.call(incoming.github, 'privateAccessToken') ? incoming.github.privateAccessToken : (next.github && next.github.privateAccessToken)
      });
    }

    if (incoming.auth && typeof incoming.auth === 'object' && incoming.auth.login && typeof incoming.auth.login === 'object') {
      next.auth = next.auth && typeof next.auth === 'object' ? next.auth : {};
      next.auth.login = next.auth.login && typeof next.auth.login === 'object' ? next.auth.login : {};

      if (Object.prototype.hasOwnProperty.call(incoming.auth.login, 'username')) {
        next.auth.login.username = normalizeUsername(incoming.auth.login.username, current.name || 'mitarbeiter');
      }

      if (Object.prototype.hasOwnProperty.call(incoming.auth.login, 'passwordHash')) {
        var passwordHash = String(incoming.auth.login.passwordHash || '').trim();
        if (passwordHash) next.auth.login.passwordHash = passwordHash;
      }
    }

    return normalizeEmployeeAccess(next);
  }

  function getProjectById(projectId) {
    if (!window.DataLayer || typeof window.DataLayer.getProjectById !== 'function') return null;
    return window.DataLayer.getProjectById(projectId);
  }

  function getTasks() {
    if (!window.DataLayer || typeof window.DataLayer.getTasks !== 'function') return [];
    return window.DataLayer.getTasks() || [];
  }

  function employeeOwnsProject(user, project) {
    if (!user || !project) return false;
    if (String(project.createdByEmployeeId || '') === String(user.id)) return true;

    var team = Array.isArray(project.teamMembers) ? project.teamMembers : [];
    if (team.some(function (member) { return String(member && member.employeeId || '') === String(user.id); })) {
      return true;
    }

    return getTasks().some(function (task) {
      return String(task.projectId || '') === String(project.id || '') && String(task.assigneeId || '') === String(user.id);
    });
  }

  function canViewProject(project) {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    if (!project) return false;
    if (mode === 'guest') return false;
    if (mode === 'employee') return true;
    return employeeOwnsProject(getCurrentUser(), project);
  }

  function canEditProject(project) {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    return canViewProject(project);
  }

  function canCreateProject() {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    return mode === 'employee' && canAccessPage('projects');
  }

  function ensureProjectMembership(project, user) {
    if (!project || !user) return project;
    if (!Array.isArray(project.teamMembers)) project.teamMembers = [];
    if (!project.teamMembers.some(function (member) { return String(member && member.employeeId || '') === String(user.id); })) {
      project.teamMembers.push({
        id: window.DataLayer && window.DataLayer.generateId ? window.DataLayer.generateId() : String(Date.now()),
        employeeId: user.id,
        role: 'Owner',
        assignedAt: new Date().toISOString()
      });
    }
    return project;
  }

  function prepareProjectPayload(project) {
    var next = clone(project || {});
    var user = getCurrentUser();
    if (getMode() === 'employee' && user) {
      if (!next.createdByEmployeeId) next.createdByEmployeeId = user.id;
      ensureProjectMembership(next, user);
    }
    return next;
  }

  function canCreateTask() {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    return mode === 'employee' && (canAccessPage('kanban') || canAccessPage('quicktask'));
  }

  function canEditTask(task) {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    if (mode !== 'employee' || !task) return false;
    var user = getCurrentUser();
    if (!user) return false;
    if (String(task.assigneeId || '') === String(user.id)) return true;
    if (task.projectId) {
      return canViewProject(getProjectById(task.projectId));
    }
    return String(task.createdByEmployeeId || '') === String(user.id);
  }

  function canMoveTask(task) {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    if (mode !== 'employee' || !task) return false;
    var user = getCurrentUser();
    return !!(user && String(task.assigneeId || '') === String(user.id || ''));
  }

  function prepareTaskPayload(task) {
    var next = clone(task || {});
    var user = getCurrentUser();
    if (getMode() === 'employee' && user) {
      if (next.projectId && !canViewProject(getProjectById(next.projectId))) {
        throw new Error('Dieses Projekt ist fuer den aktuellen Mitarbeiter nicht freigegeben.');
      }
      next.assigneeId = user.id;
      if (!next.createdByEmployeeId) next.createdByEmployeeId = user.id;
    }
    return next;
  }

  function getEventParticipants(event) {
    var ids = [];
    if (Array.isArray(event && event.attendeeIds)) ids = event.attendeeIds.slice();
    else if (Array.isArray(event && event.attendees)) ids = event.attendees.slice();
    else if (event && event.attendeeId) ids = [event.attendeeId];
    return unique(ids);
  }

  function canCreateCalendarEvent() {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    return mode === 'employee' && canAccessPage('calendar');
  }

  function canEditCalendarEvent(event) {
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return true;
    if (mode !== 'employee' || !event) return false;
    var user = getCurrentUser();
    if (!user) return false;
    if (String(event.createdByEmployeeId || '') === String(user.id)) return true;
    return getEventParticipants(event).indexOf(String(user.id)) !== -1;
  }

  function prepareCalendarEventPayload(event) {
    var next = clone(event || {});
    var user = getCurrentUser();
    if (getMode() === 'employee' && user) {
      if (!Array.isArray(next.attendeeIds) || !next.attendeeIds.length) {
        next.attendeeIds = [user.id];
      }
      if (!next.createdByEmployeeId) next.createdByEmployeeId = user.id;
      if (next.projectId && !canViewProject(getProjectById(next.projectId))) {
        throw new Error('Termine koennen nur in freigegebenen Projekten angelegt werden.');
      }
    }
    return next;
  }

  function getVisibleProjects(projects) {
    var list = Array.isArray(projects) ? projects.slice() : [];
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return list;
    if (mode === 'guest') return [];
    if (mode === 'employee') return list;
    return list.filter(canViewProject);
  }

  function getAssignableEmployees(employees) {
    var list = Array.isArray(employees) ? employees.slice() : [];
    var mode = getMode();
    if (mode === 'setup' || mode === 'admin') return list;
    var user = getCurrentUser();
    return user ? list.filter(function (employee) { return String(employee.id) === String(user.id); }) : [];
  }

  function deny(message) {
    window.alert(message || 'Dafuer fehlen die erforderlichen Rechte.');
    return false;
  }

  function wrapDataLayer() {
    if (wrapped || !window.DataLayer) return;
    wrapped = true;

    [
      'createEmployee',
      'updateEmployee',
      'deleteEmployee',
      'createProject',
      'updateProject',
      'deleteProject',
      'createTask',
      'updateTask',
      'deleteTask',
      'createCalendarEvent',
      'updateCalendarEvent',
      'deleteCalendarEvent'
    ].forEach(function (name) {
      originalMethods[name] = window.DataLayer[name];
    });

    window.DataLayer.createEmployee = function (employee) {
      if (!canManageEmployees()) return deny('Nur Administratoren koennen Mitarbeiter anlegen.');
      return originalMethods.createEmployee(normalizeEmployeeAccess(employee));
    };

    window.DataLayer.updateEmployee = function (employee) {
      if (canManageEmployees()) {
        return originalMethods.updateEmployee(normalizeEmployeeAccess(employee));
      }
      try {
        return originalMethods.updateEmployee(sanitizeSelfEmployeeUpdate(employee));
      } catch (err) {
        return deny(err && err.message ? err.message : 'Mitarbeiterprofil konnte nicht aktualisiert werden.');
      }
    };

    window.DataLayer.deleteEmployee = function (employeeId) {
      if (!canManageEmployees()) return deny('Nur Administratoren koennen Mitarbeiter loeschen.');
      return originalMethods.deleteEmployee(employeeId);
    };

    window.DataLayer.createProject = function (project) {
      if (!canCreateProject()) return deny('Der aktuelle Nutzer darf keine Projekte anlegen.');
      return originalMethods.createProject(prepareProjectPayload(project));
    };

    window.DataLayer.updateProject = function (project) {
      if (!canEditProject(project)) return deny('Dieses Projekt darf nicht bearbeitet werden.');
      return originalMethods.updateProject(prepareProjectPayload(project));
    };

    window.DataLayer.deleteProject = function (projectId) {
      var project = getProjectById(projectId);
      if (!canEditProject(project)) return deny('Dieses Projekt darf nicht geloescht werden.');
      return originalMethods.deleteProject(projectId);
    };

    window.DataLayer.createTask = function (task) {
      if (!canCreateTask()) return deny('Nur angemeldete Mitarbeiter duerfen Aufgaben anlegen.');
      try {
        return originalMethods.createTask(prepareTaskPayload(task));
      } catch (err) {
        return deny(err && err.message ? err.message : 'Aufgabe konnte nicht gespeichert werden.');
      }
    };

    window.DataLayer.updateTask = function (task) {
      if (!canEditTask(task)) return deny('Diese Aufgabe darf nicht bearbeitet werden.');
      try {
        return originalMethods.updateTask(prepareTaskPayload(task));
      } catch (err) {
        return deny(err && err.message ? err.message : 'Aufgabe konnte nicht gespeichert werden.');
      }
    };

    window.DataLayer.deleteTask = function (taskId) {
      var task = typeof window.DataLayer.getTaskById === 'function' ? window.DataLayer.getTaskById(taskId) : null;
      if (!canEditTask(task)) return deny('Diese Aufgabe darf nicht geloescht werden.');
      return originalMethods.deleteTask(taskId);
    };

    window.DataLayer.createCalendarEvent = function (event) {
      if (!canCreateCalendarEvent()) return deny('Nur angemeldete Mitarbeiter duerfen Termine anlegen.');
      try {
        return originalMethods.createCalendarEvent(prepareCalendarEventPayload(event));
      } catch (err) {
        return deny(err && err.message ? err.message : 'Termin konnte nicht gespeichert werden.');
      }
    };

    window.DataLayer.updateCalendarEvent = function (event) {
      if (!canEditCalendarEvent(event)) return deny('Dieser Termin darf nicht bearbeitet werden.');
      try {
        return originalMethods.updateCalendarEvent(prepareCalendarEventPayload(event));
      } catch (err) {
        return deny(err && err.message ? err.message : 'Termin konnte nicht gespeichert werden.');
      }
    };

    window.DataLayer.deleteCalendarEvent = function (eventId) {
      var event = typeof window.DataLayer.getCalendarEventById === 'function' ? window.DataLayer.getCalendarEventById(eventId) : null;
      if (!canEditCalendarEvent(event)) return deny('Dieser Termin darf nicht geloescht werden.');
      return originalMethods.deleteCalendarEvent(eventId);
    };
  }

  function getPageOptions() {
    return ALL_PAGES.map(function (page) {
      return {
        value: page,
        label: PAGE_LABELS[page] || page
      };
    });
  }

  function createHashFallback(text) {
    var hash = 0;
    var input = String(text || '');
    var index;
    for (index = 0; index < input.length; index += 1) {
      hash = ((hash << 5) - hash) + input.charCodeAt(index);
      hash |= 0;
    }
    return Promise.resolve('fallback:' + String(hash >>> 0));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function hexToBytes(hex) {
    var text = String(hex || '').trim().toLowerCase();
    if (!text || text.length % 2 !== 0 || /[^0-9a-f]/.test(text)) return null;
    var out = new Uint8Array(text.length / 2);
    for (var i = 0; i < text.length; i += 2) {
      out[i / 2] = parseInt(text.slice(i, i + 2), 16);
    }
    return out;
  }

  function constantTimeEquals(a, b) {
    var left = String(a || '');
    var right = String(b || '');
    if (left.length !== right.length) return false;
    var mismatch = 0;
    for (var i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return mismatch === 0;
  }

  function hashPasswordLegacy(password) {
    var text = String(password || '');
    if (!window.crypto || !window.crypto.subtle || typeof window.TextEncoder !== 'function') {
      return createHashFallback(text);
    }

    return window.crypto.subtle.digest('SHA-256', new window.TextEncoder().encode(text)).then(function (buffer) {
      return bytesToHex(new Uint8Array(buffer));
    }).catch(function () {
      return createHashFallback(text);
    });
  }

  function hashPasswordPortable(password) {
    var text = String(password || '');
    return Promise.all([
      createHashFallback(text),
      hashPasswordLegacy(text)
    ]).then(function (hashes) {
      return ['compat', String(hashes[0] || ''), String(hashes[1] || '')].join('$');
    });
  }

  function derivePbkdf2Hash(password, saltHex, iterations) {
    if (!window.crypto || !window.crypto.subtle || typeof window.TextEncoder !== 'function') {
      return Promise.reject(new Error('PBKDF2 nicht verfuegbar'));
    }

    var saltBytes = hexToBytes(saltHex);
    if (!saltBytes) return Promise.reject(new Error('Ungueltiger Salt'));

    return window.crypto.subtle.importKey(
      'raw',
      new window.TextEncoder().encode(String(password || '')),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    ).then(function (key) {
      return window.crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: iterations,
        hash: 'SHA-256'
      }, key, PASSWORD_PBKDF2_BYTES * 8);
    }).then(function (bits) {
      return bytesToHex(new Uint8Array(bits));
    });
  }

  function hashPasswordForStorage(password) {
    return hashPasswordPortable(password);
  }

  function verifyPasswordAgainstStoredHash(password, storedHash) {
    var value = String(storedHash || '').trim();
    if (!value) return Promise.resolve(false);

    if (value.indexOf('compat$') === 0) {
      var compatParts = value.split('$');
      var fallbackHash = String(compatParts[1] || '');
      var legacyHash = String(compatParts[2] || '');

      return Promise.all([
        createHashFallback(password),
        hashPasswordLegacy(password)
      ]).then(function (hashes) {
        var fallbackCandidate = String(hashes[0] || '');
        var legacyCandidate = String(hashes[1] || '');
        return (
          (fallbackHash && constantTimeEquals(fallbackCandidate, fallbackHash)) ||
          (fallbackHash && constantTimeEquals(legacyCandidate, fallbackHash)) ||
          (legacyHash && constantTimeEquals(fallbackCandidate, legacyHash)) ||
          (legacyHash && constantTimeEquals(legacyCandidate, legacyHash))
        );
      }).catch(function () {
        return false;
      });
    }

    if (value.indexOf(PASSWORD_SCHEME + '$') === 0) {
      var parts = value.split('$');
      if (parts.length !== 4) return Promise.resolve(false);
      var iterations = parseInt(parts[1], 10);
      var saltHex = parts[2];
      var hashHex = parts[3];
      if (!iterations || iterations < 10000 || !hashHex) return Promise.resolve(false);

      return derivePbkdf2Hash(password, saltHex, iterations).then(function (candidate) {
        return constantTimeEquals(candidate, hashHex);
      }).catch(function () {
        return false;
      });
    }

    return Promise.all([
      hashPasswordLegacy(password),
      createHashFallback(password)
    ]).then(function (hashes) {
      var legacyHash = String(hashes[0] || '');
      var fallbackHash = String(hashes[1] || '');
      return constantTimeEquals(legacyHash, value) || constantTimeEquals(fallbackHash, value);
    });
  }

  function syncAuthStateFromServer() {
    if (!window.DataLayer || typeof window.DataLayer.refreshFromRemote !== 'function') {
      return Promise.resolve(false);
    }

    return window.DataLayer.refreshFromRemote().catch(function () {
      return false;
    });
  }

  function hashPassword(password) {
    return hashPasswordPortable(password);
  }

  function buildEmployeeAuth(existingEmployee, patch) {
    var employee = normalizeEmployeeAccess(existingEmployee || {});
    var next = clone(employee.auth);
    var input = patch && typeof patch === 'object' ? patch : {};

    next.accessLevel = input.accessLevel === 'admin' ? 'admin' : 'employee';
    next.login.enabled = !!input.loginEnabled;
    next.login.username = normalizeUsername(input.username, existingEmployee && existingEmployee.name || 'mitarbeiter');

    if (next.accessLevel === 'admin') {
      next.permissions.pages = ALL_PAGES.slice();
    } else {
      next.permissions.pages = normalizePageList(input.pages && input.pages.length ? input.pages : EMPLOYEE_DEFAULT_PAGES);
      if (!next.permissions.pages.length) next.permissions.pages = EMPLOYEE_DEFAULT_PAGES.slice();
    }

    var password = String(input.password || '').trim();
    var hashPromise = Promise.resolve(next.login.passwordHash || '');
    if (password) {
      hashPromise = hashPasswordForStorage(password);
    }

    return hashPromise.then(function (passwordHash) {
      if (password) next.login.passwordHash = passwordHash;
      if (next.login.enabled && !next.login.passwordHash) {
        throw new Error('Fuer einen Login ist ein Passwort erforderlich.');
      }
      return next;
    });
  }

  function login(username, password) {
    return syncAuthStateFromServer().then(function () {
      if (isSetupMode()) return { ok: false, message: 'Bitte zuerst einen Administrator im Mitarbeiterbereich anlegen.' };

      var targetUser = normalizeUsername(username, 'mitarbeiter');
      var employee = getLoginEmployees().find(function (item) {
        return normalizeUsername(item.auth.login.username, item.name) === targetUser;
      });

      if (!employee) return { ok: false, message: 'Login nicht gefunden.' };

      return verifyPasswordAgainstStoredHash(password, employee.auth.login.passwordHash).then(function (isValid) {
        if (!isValid) {
          return { ok: false, message: 'Passwort ist nicht korrekt.' };
        }
        writeSession(buildSessionForEmployee(employee));
        dashboardPresenceLastTouchedAt = 0;
        touchDashboardPresence();
        emitAuthChanged();
        refreshUi();
        return { ok: true, user: employee };
      });
    });
  }

  function logout() {
    writeSession(null);
    dashboardPresenceLastTouchedAt = 0;
    emitAuthChanged();
    refreshUi();
  }

  function closeModal() {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (overlay) overlay.classList.add('hidden');
    if (content) {
      if (content.getAttribute('data-modal-owner') === 'daily-status') {
        dailyStatusDialogOpen = false;
      }
      content.innerHTML = '';
      content.className = 'modal';
      content.removeAttribute('data-modal-owner');
      content.removeAttribute('data-prevent-overlay-close');
      content.removeAttribute('data-prevent-escape-close');
    }
  }

  function showDailyStatusAfterLogin(user) {
    if (dailyStatusPromptTimer) {
      window.clearTimeout(dailyStatusPromptTimer);
      dailyStatusPromptTimer = null;
    }
    closeModal();
    dailyStatusDialogOpen = false;
    openDailyStatusDialog(getCurrentUser() || user);
  }

  function openLoginModal(skipSync) {
    if (!skipSync) {
      syncAuthStateFromServer().then(function () {
        openLoginModal(true);
      });
      return;
    }

    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    var loginEmployees = getLoginEmployees();
    if (!loginEmployees.length) {
      window.alert('Es ist noch kein Mitarbeiter-Login eingerichtet.');
      return;
    }

    var options = loginEmployees.map(function (employee) {
      return '<option value="' + employee.auth.login.username + '">' + employee.name + ' (' + employee.auth.login.username + ')</option>';
    }).join('');

    content.innerHTML = ''
      + '<h2>Login</h2>'
      + '<div class="calendar-modal-form auth-login-form">'
      + '<div class="form-group"><label for="auth-login-user">Mitarbeiter</label><select id="auth-login-user">' + options + '</select></div>'
      + '<div class="form-group"><label for="auth-login-password">Passwort</label><input id="auth-login-password" type="password" autocomplete="current-password"></div>'
      + '<div class="modal-actions">'
      + '<button type="button" class="btn btn-secondary" id="auth-login-cancel">Abbrechen</button>'
      + '<button type="button" class="btn btn-primary" id="auth-login-submit">Einloggen</button>'
      + '</div>'
      + '</div>';

    overlay.classList.remove('hidden');

    var submitBtn = document.getElementById('auth-login-submit');
    var cancelBtn = document.getElementById('auth-login-cancel');
    var passwordInput = document.getElementById('auth-login-password');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        var userEl = document.getElementById('auth-login-user');
        login(userEl ? userEl.value : '', passwordInput ? passwordInput.value : '').then(function (result) {
          if (!result.ok) {
            window.alert(result.message || 'Login fehlgeschlagen.');
            return;
          }
          showDailyStatusAfterLogin(result.user);
        });
      });
    }
    if (passwordInput && passwordInput.focus) passwordInput.focus();
  }

  function getLocalDateKey() {
    var now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function hasDailyWorkStatus(user) {
    var confirmationKey = user && user.id ? String(user.id) + ':' + getLocalDateKey() : '';
    if (confirmationKey && dailyStatusConfirmedKey === confirmationKey) return true;
    var status = user && user.dailyWorkStatus;
    if (!status || String(status.date || '') !== getLocalDateKey()) return false;
    return !!status.sick || !!String(status.workplace || '').trim();
  }

  function closeDailyStatusDialog() {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (overlay) overlay.classList.add('hidden');
    if (content) {
      content.innerHTML = '';
      content.className = 'modal';
      content.removeAttribute('data-modal-owner');
      content.removeAttribute('data-prevent-overlay-close');
      content.removeAttribute('data-prevent-escape-close');
    }
    dailyStatusDialogOpen = false;
  }

  function openDailyStatusDialog(user) {
    var overlay = document.getElementById('modal-overlay');
    var content = document.getElementById('modal-content');
    if (!overlay || !content || !user || dailyStatusDialogOpen || hasDailyWorkStatus(user)) return;

    dailyStatusDialogOpen = true;
    content.className = 'modal daily-status-modal';
    content.setAttribute('data-modal-owner', 'daily-status');
    content.setAttribute('data-prevent-overlay-close', 'true');
    content.setAttribute('data-prevent-escape-close', 'true');
    content.innerHTML = ''
      + '<div class="daily-status-heading">'
      + '  <span class="material-symbols-rounded" aria-hidden="true">today</span>'
      + '  <div><p class="daily-status-eyebrow">Tagesstart</p><h2>Wie arbeitest du heute?</h2></div>'
      + '</div>'
      + '<p class="daily-status-intro" id="daily-status-greeting"></p>'
      + '<form id="daily-status-form" class="daily-status-form" novalidate>'
      + '  <label class="daily-status-sick-option"><input type="checkbox" id="daily-status-sick"><span class="material-symbols-rounded" aria-hidden="true">medical_services</span><span><strong>Heute krankmelden</strong><small>Der Arbeitsort ist dann nicht erforderlich.</small></span></label>'
      + '  <div class="form-group" id="daily-status-workplace-group"><label for="daily-status-workplace">Arbeitsort <span aria-hidden="true">*</span></label><select id="daily-status-workplace" required>'
      + WORKPLACE_OPTIONS.map(function (option) {
          return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('')
      + '  </select><small class="daily-status-error" id="daily-status-error" role="alert"></small></div>'
      + '  <div class="form-group"><label for="daily-status-note">Notiz zum Arbeitstag <span class="text-muted">(optional)</span></label><textarea id="daily-status-note" rows="3" maxlength="500" placeholder="z. B. vormittags Kundentermin, ab 14 Uhr erreichbar"></textarea></div>'
      + '  <div class="daily-status-actions"><span><span class="material-symbols-rounded" aria-hidden="true">lock</span> Einmal täglich erforderlich</span><button type="submit" class="btn btn-primary" id="daily-status-save">Tagesstatus speichern</button></div>'
      + '</form>';

    var greeting = document.getElementById('daily-status-greeting');
    var form = document.getElementById('daily-status-form');
    var sickInput = document.getElementById('daily-status-sick');
    var workplaceInput = document.getElementById('daily-status-workplace');
    var workplaceGroup = document.getElementById('daily-status-workplace-group');
    var noteInput = document.getElementById('daily-status-note');
    var errorEl = document.getElementById('daily-status-error');
    if (greeting) greeting.textContent = 'Guten Tag, ' + String(user.name || 'Mitarbeiter') + '. Diese Angabe ist für dein Team sichtbar.';
    if (workplaceInput) workplaceInput.value = String(user.workplace || '');

    function syncSickState() {
      var sick = !!(sickInput && sickInput.checked);
      if (workplaceInput) workplaceInput.disabled = sick;
      if (workplaceGroup) workplaceGroup.classList.toggle('is-disabled', sick);
      if (errorEl) errorEl.textContent = '';
    }

    if (sickInput) sickInput.addEventListener('change', syncSickState);
    if (form) form.addEventListener('submit', function (event) {
      event.preventDefault();
      var sick = !!(sickInput && sickInput.checked);
      var workplace = String(workplaceInput && workplaceInput.value || '').trim();
      if (!sick && !workplace) {
        if (errorEl) errorEl.textContent = 'Bitte wähle deinen heutigen Arbeitsort.';
        if (workplaceInput) workplaceInput.focus();
        return;
      }

      var currentUser = getCurrentUser();
      if (!currentUser) return;
      var next = clone(currentUser);
      next.workplace = sick ? String(currentUser.workplace || '') : workplace;
      next.dailyWorkStatus = {
        date: getLocalDateKey(),
        workplace: sick ? '' : workplace,
        note: String(noteInput && noteInput.value || '').trim(),
        sick: sick,
        updatedAt: new Date().toISOString()
      };
      next.updatedAt = new Date().toISOString();

      var saveButton = document.getElementById('daily-status-save');
      if (saveButton) saveButton.disabled = true;
      var confirmationKey = String(currentUser.id || '') + ':' + getLocalDateKey();
      dailyStatusConfirmedKey = confirmationKey;
      if (dailyStatusPromptTimer) {
        window.clearTimeout(dailyStatusPromptTimer);
        dailyStatusPromptTimer = null;
      }
      var saved = window.DataLayer && typeof window.DataLayer.updateEmployee === 'function'
        ? window.DataLayer.updateEmployee(next)
        : false;
      if (saved === false) {
        if (dailyStatusConfirmedKey === confirmationKey) dailyStatusConfirmedKey = '';
        if (saveButton) saveButton.disabled = false;
        if (errorEl) errorEl.textContent = 'Der Tagesstatus konnte nicht gespeichert werden. Bitte erneut versuchen.';
        return;
      }
      closeDailyStatusDialog();
    });

    overlay.classList.remove('hidden');
    syncSickState();
    if (workplaceInput && workplaceInput.focus) workplaceInput.focus();
  }

  function scheduleDailyStatusPrompt() {
    if (dailyStatusPromptTimer || dailyStatusDialogOpen || !authStateBootstrapped) return;
    var user = getCurrentUser();
    if (!user || hasDailyWorkStatus(user)) return;
    dailyStatusPromptTimer = window.setTimeout(function () {
      dailyStatusPromptTimer = null;
      openDailyStatusDialog(getCurrentUser());
    }, 0);
  }

  function ensureToolbar() {
    var actions = document.querySelector('.toolbar-actions');
    if (!actions) return null;

    var group = document.getElementById(TOOLBAR_ID);
    if (!group) {
      group = document.createElement('div');
      group.id = TOOLBAR_ID;
      group.className = 'toolbar-group toolbar-group-auth';
      group.innerHTML = ''
        + '<span id="auth-status" class="toolbar-status toolbar-status-secondary auth-status"></span>'
        + '<button id="auth-login-btn" class="btn btn-secondary" type="button">Login</button>'
        + '<button id="auth-logout-btn" class="btn btn-secondary" type="button">Logout</button>';
      actions.appendChild(group);
    }

    var workplaceGroup = document.getElementById(WORKPLACE_TOOLBAR_ID);
    if (!workplaceGroup) {
      workplaceGroup = document.createElement('label');
      workplaceGroup.id = WORKPLACE_TOOLBAR_ID;
      workplaceGroup.className = 'toolbar-group toolbar-group-workplace';
      workplaceGroup.hidden = true;
      workplaceGroup.innerHTML = ''
        + '<span class="material-symbols-rounded toolbar-workplace-icon" aria-hidden="true">location_on</span>'
        + '<span class="toolbar-workplace-label">Arbeitsort</span>'
        + '<select id="workplace-select" class="toolbar-workplace-select" aria-label="Eigenen Arbeitsort festlegen">'
        + WORKPLACE_OPTIONS.map(function (option) {
          return '<option value="' + option.value + '">' + option.label + '</option>';
        }).join('')
        + '</select>';
      actions.insertBefore(workplaceGroup, group);
    }

    var loginBtn = document.getElementById('auth-login-btn');
    var logoutBtn = document.getElementById('auth-logout-btn');
    if (loginBtn && !loginBtn.dataset.bound) {
      loginBtn.dataset.bound = 'true';
      loginBtn.addEventListener('click', function () {
        if (isSetupMode()) {
          if (window.AppShell && typeof window.AppShell.navigateTo === 'function') {
            window.AppShell.navigateTo('employees');
          }
          return;
        }
        openLoginModal();
      });
    }
    if (logoutBtn && !logoutBtn.dataset.bound) {
      logoutBtn.dataset.bound = 'true';
      logoutBtn.addEventListener('click', logout);
    }

    var workplaceSelect = document.getElementById('workplace-select');
    if (workplaceSelect && !workplaceSelect.dataset.bound) {
      workplaceSelect.dataset.bound = 'true';
      workplaceSelect.addEventListener('change', function () {
        var user = getCurrentUser();
        if (!user || !window.DataLayer || typeof window.DataLayer.updateEmployee !== 'function') return;

        var previousValue = String(user.workplace || '');
        var next = clone(user);
        next.workplace = workplaceSelect.value;
        if (next.dailyWorkStatus && String(next.dailyWorkStatus.date || '') === getLocalDateKey() && !next.dailyWorkStatus.sick) {
          next.dailyWorkStatus.workplace = workplaceSelect.value;
          next.dailyWorkStatus.updatedAt = new Date().toISOString();
        }
        next.updatedAt = new Date().toISOString();
        workplaceSelect.disabled = true;

        var saved = window.DataLayer.updateEmployee(next);
        workplaceSelect.disabled = false;
        if (saved === false) {
          workplaceSelect.value = previousValue;
          window.alert('Arbeitsort konnte nicht gespeichert werden.');
        }
      });
    }

    return group;
  }

  function updateToolbar() {
    var statusEl = document.getElementById('auth-status');
    var loginBtn = document.getElementById('auth-login-btn');
    var logoutBtn = document.getElementById('auth-logout-btn');
    var workplaceGroup = document.getElementById(WORKPLACE_TOOLBAR_ID);
    var workplaceSelect = document.getElementById('workplace-select');
    if (!statusEl || !loginBtn || !logoutBtn) return;

    var mode = getMode();
    var user = getCurrentUser();

    if (!authStateBootstrapped) {
      statusEl.textContent = 'Authentifizierung: Daten werden synchronisiert';
      loginBtn.textContent = 'Bitte warten';
      loginBtn.hidden = true;
      logoutBtn.hidden = true;
      if (workplaceGroup) workplaceGroup.hidden = true;
      return;
    }

    if (mode === 'setup') {
      statusEl.textContent = 'Setup-Modus: ersten Admin anlegen';
      loginBtn.textContent = 'Mitarbeiterbereich';
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
      if (workplaceGroup) workplaceGroup.hidden = true;
      return;
    }

    if (mode === 'guest') {
      statusEl.textContent = 'Gastmodus: nur Lesezugriff';
      loginBtn.textContent = 'Login';
      loginBtn.hidden = false;
      logoutBtn.hidden = true;
      if (workplaceGroup) workplaceGroup.hidden = true;
      return;
    }

    statusEl.textContent = (isAdmin(user) ? 'Admin' : 'Mitarbeiter') + ': ' + (user && user.name ? user.name : 'Angemeldet');
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
    if (workplaceGroup) workplaceGroup.hidden = false;
    if (workplaceSelect) workplaceSelect.value = String(user && user.workplace || '');
  }

  function updateSidebarVisibility() {
    var visiblePages = getVisiblePages();
    document.querySelectorAll('.nav-menu a[data-page]').forEach(function (link) {
      var page = String(link.getAttribute('data-page') || '').trim();
      var allowed = visiblePages.indexOf(page) !== -1;
      var item = link.parentElement;
      if (item) item.style.display = allowed ? '' : 'none';
    });
  }

  function setLockNote(sectionId, message) {
    var section = document.getElementById(sectionId);
    if (!section) return;

    var note = section.querySelector('[data-auth-lock-note]');
    if (!message) {
      if (note && note.parentNode) note.parentNode.removeChild(note);
      return;
    }

    if (!note) {
      note = document.createElement('div');
      note.className = 'auth-lock-note';
      note.setAttribute('data-auth-lock-note', 'true');
      section.insertBefore(note, section.firstChild);
    }
    note.textContent = message;
  }

  function setControlsDisabled(root, disabled) {
    if (!root) return;
    root.querySelectorAll('input, select, textarea, button').forEach(function (node) {
      if (node.id === 'theme-toggle' || node.id === 'mobile-menu-btn') return;
      node.disabled = !!disabled;
    });
  }

  function refreshUi() {
    ensureToolbar();
    updateToolbar();
    updateSidebarVisibility();

    var mode = getMode();
    document.body.setAttribute('data-auth-mode', mode);
    document.body.classList.toggle('auth-readonly', mode === 'guest');

    var dbActionsGroup = document.getElementById('toolbar-db-actions');
    var dataTransferGroup = document.getElementById('toolbar-data-transfer-actions');
    var showStorageAdminActions = mode === 'setup' || mode === 'admin';
    if (dbActionsGroup) {
      dbActionsGroup.hidden = !showStorageAdminActions;
      dbActionsGroup.style.display = showStorageAdminActions ? '' : 'none';
    }
    if (dataTransferGroup) {
      dataTransferGroup.hidden = !showStorageAdminActions;
      dataTransferGroup.style.display = showStorageAdminActions ? '' : 'none';
    }

    var quicktaskForm = document.getElementById('quicktask-form');
    var quicktaskAllowed = canCreateTask();
    setControlsDisabled(quicktaskForm, !quicktaskAllowed);
    setLockNote('quicktask', quicktaskAllowed ? '' : 'QuickTask ist nur fuer angemeldete Mitarbeiter freigeschaltet.');

    var employeePage = document.getElementById('employees');
    var canUseEmployeesPage = mode !== 'guest';
    setControlsDisabled(employeePage, !canUseEmployeesPage);
    if (canManageEmployees()) {
      setLockNote('employees', '');
    } else if (mode === 'employee') {
      setLockNote('employees', 'Du kannst dein eigenes Profil (z. B. Passwort, GitHub-Link, Fokus) bearbeiten. Admin-Felder bleiben gesperrt.');
    } else {
      setLockNote('employees', 'Die Mitarbeiteransicht ist fuer Gaeste gesperrt.');
    }

    var projectCreateBtn = document.getElementById('project-focus-create');
    var projectImportBtn = document.getElementById('project-focus-import');
    if (projectCreateBtn) projectCreateBtn.disabled = !canCreateProject();
    if (projectImportBtn) projectImportBtn.disabled = !canCreateProject();
    setLockNote('projects', canAccessPage('projects') && !canCreateProject() ? 'Projekte koennen hier nur eingesehen werden.' : '');

    var calendarAddBtn = document.getElementById('cal-add-event');
    if (calendarAddBtn) calendarAddBtn.disabled = !canCreateCalendarEvent() || calendarAddBtn.disabled;
    setLockNote('calendar', canCreateCalendarEvent() ? '' : 'Gastnutzer sehen den Kalender nur im Lesemodus.');

    setLockNote('kanban', mode === 'guest' ? 'Gastnutzer sehen das Kanban Board im Lesemodus.' : '');

    document.querySelectorAll('.kanban-card[data-task-id]').forEach(function (card) {
      var taskId = card.getAttribute('data-task-id');
      var task = window.DataLayer && typeof window.DataLayer.getTaskById === 'function' ? window.DataLayer.getTaskById(taskId) : null;
      var editable = canEditTask(task);
      card.setAttribute('draggable', editable ? 'true' : 'false');
      card.classList.toggle('auth-readonly-card', !editable);
    });

    var activePage = document.querySelector('.page.active');
    if (activePage && !canAccessPage(activePage.id) && window.AppShell && typeof window.AppShell.navigateTo === 'function') {
      window.AppShell.navigateTo(getFallbackPage());
    }

    scheduleDailyStatusPrompt();
  }

  function getSessionState() {
    var user = getCurrentUser();
    return {
      mode: getMode(),
      user: user,
      visiblePages: getVisiblePages(),
      setupMode: isSetupMode()
    };
  }

  function startAuthRefreshLoop() {
    if (authRefreshTimer || !window.DataLayer || typeof window.DataLayer.refreshFromRemote !== 'function') return;

    authRefreshTimer = window.setInterval(function () {
      window.DataLayer.refreshFromRemote().then(function (updated) {
        if (updated) refreshUi();
      }).catch(function () {});
    }, AUTH_REFRESH_INTERVAL_MS);
  }

  function init() {
    if (initStarted) return;
    initStarted = true;

    wrapDataLayer();
    refreshUi();
    startAuthRefreshLoop();

    bootstrapAuthState().then(function () {
      refreshUi();
      emitAuthChanged();
    });

    window.addEventListener('authChanged', refreshUi);
    window.addEventListener('hashchange', touchDashboardPresence);
    window.setInterval(touchDashboardPresence, DASHBOARD_PRESENCE_TOUCH_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        syncAuthStateFromServer().then(function () {
          refreshUi();
          touchDashboardPresence();
        });
      }
    });
    if (window.DataLayer && typeof window.DataLayer.on === 'function') {
      window.DataLayer.on('dataChanged', function (event) {
        if (event && event.entity === 'employees') refreshUi();
      });
    }
  }

  window.AuthManager = {
    init: init,
    refreshUi: refreshUi,
    normalizeEmployee: normalizeEmployeeAccess,
    buildEmployeeAuth: buildEmployeeAuth,
    getMode: getMode,
    getCurrentUser: getCurrentUser,
    isEmployeeDashboardOnline: isEmployeeDashboardOnline,
    getSessionState: getSessionState,
    getVisiblePages: getVisiblePages,
    getFallbackPage: getFallbackPage,
    canAccessPage: canAccessPage,
    canManageEmployees: canManageEmployees,
    canCreateProject: canCreateProject,
    canViewProject: canViewProject,
    canEditProject: canEditProject,
    getVisibleProjects: getVisibleProjects,
    canCreateTask: canCreateTask,
    canEditTask: canEditTask,
    canMoveTask: canMoveTask,
    canCreateCalendarEvent: canCreateCalendarEvent,
    canEditCalendarEvent: canEditCalendarEvent,
    getAssignableEmployees: getAssignableEmployees,
    getPageOptions: getPageOptions,
    login: login,
    logout: logout,
    openLoginModal: openLoginModal,
    isSetupMode: isSetupMode
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
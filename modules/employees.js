/* ========================================
   Employee Manager
   Erweiterte Mitarbeiteruebersicht mit Last- und Aufgabenvisualisierung
   ======================================== */
(function() {
  'use strict';

  var NAMESPACE = 'EmployeeManager';
  var ASSIGNMENTS_KEY = 'EmployeeManager_assignments';
  var LEGACY_EMPLOYEE_KEY = 'EmployeeManager_employees';
  var GITHUB_ACTIVITY_CACHE_KEY = 'EmployeeManager_github_activity_cache_v1';
  var GITHUB_ACTIVITY_DAYS = 84;
  var GITHUB_ACTIVITY_TTL_MS = 6 * 60 * 60 * 1000;
  var isWired = false;
  var githubSyncRequests = {};

  var FILTER_STATE = {
    search: '',
    role: '',
    availability: '',
    loadBand: 'all',
    sort: 'load-desc'
  };

  var DND_STATE = {
    taskId: '',
    sourceEmployeeId: ''
  };

  var roleColors = {
    'Project Lead': '#8b5cf6',
    'Developer': '#3b82f6',
    'Designer': '#ec4899',
    'DevOps': '#10b981',
    'QA': '#f59e0b',
    'Consultant': '#6366f1'
  };

  var availColors = {
    'Verfügbar': '#22c55e',
    'Belastet': '#f59e0b',
    'Urlaub': '#ef4444'
  };

  var loadBandConfig = {
    low: { label: 'Niedrig', color: '#22c55e' },
    balanced: { label: 'Ausgewogen', color: '#4a9eff' },
    high: { label: 'Hoch', color: '#f59e0b' },
    overload: { label: 'Ueberlast', color: '#ef4444' }
  };

  function storageRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : (fallback || []);
    } catch (e) {
      console.warn('[' + NAMESPACE + '] Storage read failed for ' + key, e);
      return fallback || [];
    }
  }

  function storageWrite(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[' + NAMESPACE + '] Storage write failed for ' + key, e);
    }
  }

  function hasDataLayer() {
    return !!(window.DataLayer &&
      typeof window.DataLayer.getEmployees === 'function' &&
      typeof window.DataLayer.createEmployee === 'function' &&
      typeof window.DataLayer.updateEmployee === 'function');
  }

  function getAuthManager() {
    return window.AuthManager || null;
  }

  function getCurrentUser() {
    var auth = getAuthManager();
    if (!auth || typeof auth.getCurrentUser !== 'function') return null;
    return auth.getCurrentUser() || null;
  }

  function canManageEmployees() {
    var auth = getAuthManager();
    if (!auth || typeof auth.canManageEmployees !== 'function') return true;
    return !!auth.canManageEmployees();
  }

  function canEditEmployeeProfile(employeeId) {
    if (canManageEmployees()) return true;
    var auth = getAuthManager();
    if (!auth || typeof auth.getMode !== 'function') return false;
    if (auth.getMode() !== 'employee') return false;
    var user = getCurrentUser();
    return !!(user && String(user.id || '') === String(employeeId || ''));
  }

  function canManageEmployeeAccessFields() {
    return canManageEmployees();
  }

  function ensureCanEditEmployeeProfile(employeeId) {
    if (canEditEmployeeProfile(employeeId)) return true;
    alert('Nur das eigene Mitarbeiterprofil darf bearbeitet werden.');
    return false;
  }

  function generateId(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
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

  function buildGitHubProfileUrl(username) {
    var normalized = sanitizeGitHubUsername(username);
    return normalized ? 'https://github.com/' + normalized : '';
  }

  function normalizeAliasList(value, fallbackName, fallbackUsername) {
    var source = value;
    if (!Array.isArray(source)) {
      source = typeof source === 'string' ? source.split(/[\n,;]+/) : [];
    }

    var aliases = [];
    var seen = {};

    function pushAlias(alias) {
      var normalized = String(alias || '').trim();
      if (!normalized) return;
      var key = normalized.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      aliases.push(normalized);
    }

    source.forEach(pushAlias);
    pushAlias(fallbackName);
    pushAlias(fallbackUsername);
    return aliases;
  }

  function normalizeGitHubProfile(raw, fallbackName) {
    var profile = raw;
    if (typeof profile === 'string') {
      profile = { profileUrl: profile };
    }
    profile = profile && typeof profile === 'object' ? Object.assign({}, profile) : {};

    var username = extractGitHubUsername(profile.username || profile.profileUrl || profile.login || '');
    profile.username = username;
    profile.profileUrl = profile.profileUrl ? String(profile.profileUrl).trim() : buildGitHubProfileUrl(username);
    if (!profile.profileUrl && username) profile.profileUrl = buildGitHubProfileUrl(username);
    profile.aliases = normalizeAliasList(profile.aliases, fallbackName, username);
    profile.privateAccessToken = typeof profile.privateAccessToken === 'string' ? profile.privateAccessToken.trim() : '';
    if (typeof profile.lastSyncedAt !== 'string') profile.lastSyncedAt = '';
    if (typeof profile.syncError !== 'string') profile.syncError = '';
    if (typeof profile.syncStatus !== 'string') profile.syncStatus = username ? 'idle' : 'unlinked';
    return profile;
  }

  function formatDateShort(value) {
    if (!value) return 'n/a';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'n/a';
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }

  function getEmployeeGitHubAvatarUrl(employee) {
    if (!employee) return '';

    // Check if there's a custom avatar stored
    var customAvatar = employee.customAvatarBase64 ? String(employee.customAvatarBase64).trim() : '';
    
    // GitHub avatar takes priority if linked
    if (employee.github) {
      var github = normalizeGitHubProfile(employee.github, employee.name);
      var username = github.username || extractGitHubUsername(github.profileUrl || '');
      if (username) {
        if (github.avatarUrl) return github.avatarUrl;
        return 'https://github.com/' + encodeURIComponent(username) + '.png?size=200';
      }
    }
    
    // Fall back to custom avatar if no GitHub
    if (customAvatar) {
      return customAvatar;
    }

    return '';
  }

  function getDefaultEmployeeAvatarDataUrl(employee) {
    var name = String((employee && employee.name) || 'Mitarbeiter').trim() || 'Mitarbeiter';
    var roleColor = getRoleColor(employee && employee.role ? employee.role : '');
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

  function renderEmployeeAvatar(emp) {
    var avatarUrl = getEmployeeGitHubAvatarUrl(emp) || getDefaultEmployeeAvatarDataUrl(emp);
    var isUploadable = canEditEmployeeProfile(emp.id);
    var hasCustomAvatar = !!(emp.customAvatarBase64 && String(emp.customAvatarBase64).trim());
    var hasGitHubAvatar = !!(emp.github && (emp.github.username || emp.github.profileUrl));
    var actionTitle = isUploadable ? (hasCustomAvatar ? 'Bild ändern oder zu GitHub zurücksetzen' : 'Profilbild hochladen') : (hasGitHubAvatar ? 'GitHub-Profil' : emp.role);
    var clickAttrs = isUploadable ? ' data-action="upload-avatar" data-emp-id="' + escapeHtml(emp.id) + '" role="button" tabindex="0" style="cursor: pointer;"' : '';
    var isOnline = !!(window.AuthManager && typeof window.AuthManager.isEmployeeDashboardOnline === 'function' && window.AuthManager.isEmployeeDashboardOnline(emp));
    return '<span class="employee-avatar-presence' + (isOnline ? ' is-online' : '') + '"><div class="employee-avatar employee-avatar-image" ' + clickAttrs + ' style="background-color:' + getRoleColor(emp.role) + '; background-image:url(\'' + escapeHtml(avatarUrl) + '\'); background-size:cover; background-position:center;" title="' + escapeHtml(actionTitle) + '"></div>' + (isOnline ? '<span class="profile-presence-dot" aria-hidden="true"></span>' : '') + '</span>';
  }

  function formatDateTime(value) {
    if (!value) return 'n/a';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'n/a';
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getIsoDay(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return startOfDay(date).toISOString().slice(0, 10);
  }

  function getGitHubActivityCache() {
    return storageRead(GITHUB_ACTIVITY_CACHE_KEY, {});
  }

  function setGitHubActivityCache(cache) {
    storageWrite(GITHUB_ACTIVITY_CACHE_KEY, cache || {});
  }

  function getEmployeeCacheEntry(employee) {
    var cache = getGitHubActivityCache();
    var entry = cache[employee.id];
    if (!entry || typeof entry !== 'object') return null;
    if (entry.username !== (employee.github && employee.github.username || '')) return null;
    return entry;
  }

  function isCacheFresh(entry) {
    if (!entry || !entry.fetchedAt) return false;
    var ts = Date.parse(entry.fetchedAt);
    return !isNaN(ts) && (Date.now() - ts) < GITHUB_ACTIVITY_TTL_MS;
  }

  function getLinkedGitHubProjects() {
    return getProjects().filter(function(project) {
      return !!(project && project.github && project.github.owner && project.github.repo);
    });
  }

  function getEmployeeGitHubIdentity(employee) {
    var github = employee && employee.github ? employee.github : {};
    var usernames = [];
    var aliases = [];
    var seenUsernames = {};
    var seenAliases = {};

    function pushUsername(value) {
      var username = sanitizeGitHubUsername(value).toLowerCase();
      if (!username || seenUsernames[username]) return;
      seenUsernames[username] = true;
      usernames.push(username);
    }

    function pushAlias(value) {
      var alias = String(value || '').trim().toLowerCase();
      if (!alias || seenAliases[alias]) return;
      seenAliases[alias] = true;
      aliases.push(alias);
    }

    pushUsername(github.username);
    pushUsername(extractGitHubUsername(github.profileUrl || ''));
    (github.aliases || []).forEach(function(alias) {
      pushAlias(alias);
      pushUsername(alias);
    });
    pushAlias(employee.name);

    return {
      usernames: usernames,
      aliases: aliases,
      profileUrl: github.profileUrl || (usernames[0] ? buildGitHubProfileUrl(usernames[0]) : '')
    };
  }

  function commitBelongsToEmployee(commit, employee) {
    if (!commit || !employee) return false;
    var identity = getEmployeeGitHubIdentity(employee);
    var commitLogin = sanitizeGitHubUsername(commit.authorLogin || extractGitHubUsername(commit.authorProfileUrl || '')).toLowerCase();
    var commitAuthor = String(commit.author || '').trim().toLowerCase();
    var commitEmail = String(commit.authorEmail || '').trim().toLowerCase();

    if (commitLogin && identity.usernames.indexOf(commitLogin) !== -1) return true;
    if (commitAuthor && identity.aliases.indexOf(commitAuthor) !== -1) return true;
    if (commitEmail) {
      return identity.usernames.some(function(username) {
        return commitEmail.indexOf(username) !== -1;
      });
    }
    return false;
  }

  function normalizeProjectCommitForEmployee(project, commit) {
    return {
      sha: commit.sha || '',
      message: commit.message || '',
      author: commit.author || '',
      authorLogin: commit.authorLogin || '',
      authorProfileUrl: commit.authorProfileUrl || '',
      authorEmail: commit.authorEmail || '',
      date: commit.date || '',
      url: commit.url || '',
      projectId: project.id,
      projectTitle: project.title || project.name || 'Unbenanntes Projekt',
      repoUrl: project.github && project.github.url ? project.github.url : ''
    };
  }

  function aggregateGitHubActivity(employee, commits, source, fetchedAt, syncError) {
    var cutoff = startOfDay(new Date(Date.now() - (GITHUB_ACTIVITY_DAYS - 1) * 24 * 60 * 60 * 1000)).getTime();
    var countsByDay = {};
    var projectMap = {};
    var recentCommits = [];
    var seenCommitKeys = {};

    (commits || []).forEach(function(commit) {
      var ts = Date.parse(commit.date || '');
      if (isNaN(ts) || ts < cutoff) return;

      var key = (commit.projectId || 'global') + '::' + (commit.sha || commit.date || commit.message || Math.random().toString(36).slice(2));
      if (seenCommitKeys[key]) return;
      seenCommitKeys[key] = true;

      var day = getIsoDay(ts);
      countsByDay[day] = (countsByDay[day] || 0) + 1;
      recentCommits.push(commit);

      var projectId = commit.projectId || 'unknown';
      if (!projectMap[projectId]) {
        projectMap[projectId] = {
          projectId: commit.projectId || '',
          projectTitle: commit.projectTitle || 'Ohne Projekt',
          repoUrl: commit.repoUrl || '',
          commitCount: 0,
          activeDays: {},
          lastCommitAt: ''
        };
      }

      projectMap[projectId].commitCount += 1;
      projectMap[projectId].activeDays[day] = true;
      if (!projectMap[projectId].lastCommitAt || Date.parse(commit.date || '') > Date.parse(projectMap[projectId].lastCommitAt || '')) {
        projectMap[projectId].lastCommitAt = commit.date || '';
      }
    });

    recentCommits.sort(function(a, b) {
      return Date.parse(b.date || '') - Date.parse(a.date || '');
    });

    var projectActivity = Object.keys(projectMap).map(function(projectId) {
      var project = projectMap[projectId];
      return {
        projectId: project.projectId,
        projectTitle: project.projectTitle,
        repoUrl: project.repoUrl,
        commitCount: project.commitCount,
        activeDays: Object.keys(project.activeDays).length,
        lastCommitAt: project.lastCommitAt
      };
    }).sort(function(a, b) {
      if (b.commitCount !== a.commitCount) return b.commitCount - a.commitCount;
      return String(a.projectTitle || '').localeCompare(String(b.projectTitle || ''), 'de');
    });

    return {
      employeeId: employee.id,
      username: employee.github && employee.github.username ? employee.github.username : '',
      profileUrl: employee.github && employee.github.profileUrl ? employee.github.profileUrl : '',
      source: source || 'project-cache',
      fetchedAt: fetchedAt || '',
      syncError: syncError || '',
      countsByDay: countsByDay,
      projectActivity: projectActivity,
      recentCommits: recentCommits.slice(0, 10),
      totalCommits: recentCommits.length,
      activeDays: Object.keys(countsByDay).length,
      lastActivityAt: recentCommits.length ? recentCommits[0].date || '' : ''
    };
  }

  function buildProjectCacheGitHubActivity(employee) {
    var commits = [];
    getLinkedGitHubProjects().forEach(function(project) {
      (project.githubCommits || []).forEach(function(commit) {
        if (commitBelongsToEmployee(commit, employee)) {
          commits.push(normalizeProjectCommitForEmployee(project, commit));
        }
      });
    });
    return aggregateGitHubActivity(employee, commits, 'project-cache', '', '');
  }

  function getEmployeeGitHubActivity(employee) {
    var cacheEntry = getEmployeeCacheEntry(employee);
    if (cacheEntry && (isCacheFresh(cacheEntry) || cacheEntry.totalCommits > 0)) {
      return cacheEntry;
    }
    return buildProjectCacheGitHubActivity(employee);
  }

  function getContributionLevel(count) {
    if (!count) return 0;
    if (count >= 7) return 4;
    if (count >= 4) return 3;
    if (count >= 2) return 2;
    return 1;
  }

  function buildContributionWeeks(countsByDay) {
    var today = startOfDay(new Date());
    var visibleStart = new Date(today.getTime() - (GITHUB_ACTIVITY_DAYS - 1) * 24 * 60 * 60 * 1000);
    var start = new Date(visibleStart);
    var weekday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - weekday);
    var totalDays = Math.ceil(((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000) + 1) / 7) * 7;
    var weeks = [];
    var cursor = new Date(start);

    for (var index = 0; index < totalDays; index++) {
      var weekIndex = Math.floor(index / 7);
      if (!weeks[weekIndex]) weeks[weekIndex] = [];
      var isoDay = getIsoDay(cursor);
      var isFuture = cursor.getTime() > today.getTime();
      var count = isFuture ? null : (countsByDay[isoDay] || 0);

      weeks[weekIndex].push({
        isoDay: isoDay,
        count: count,
        level: isFuture ? -1 : getContributionLevel(count),
        isFuture: isFuture,
        label: formatDateShort(cursor) + ': ' + (count || 0) + ' Commit' + ((count || 0) === 1 ? '' : 's')
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return weeks;
  }

  function renderGitHubMatrix(activity) {
    var weeks = buildContributionWeeks(activity && activity.countsByDay ? activity.countsByDay : {});
    var html = '<div class="employee-github-matrix-shell">' +
      '<div class="employee-github-matrix-daylabels">' +
        '<span>Mo</span><span>Mi</span><span>Fr</span><span>So</span>' +
      '</div>' +
      '<div class="employee-github-matrix" aria-label="GitHub Aktivitaet letzte 12 Wochen">';

    weeks.forEach(function(week) {
      html += '<div class="employee-github-week">';
      week.forEach(function(day, dayIndex) {
        var extraClass = day.isFuture ? ' is-future' : ' lvl-' + day.level;
        html += '<span class="employee-github-cell' + extraClass + '" title="' + escapeHtml(day.label) + '" aria-label="' + escapeHtml(day.label) + '"></span>';
        if (dayIndex === 6) {
          return;
        }
      });
      html += '</div>';
    });

    html += '</div>' +
      '<div class="employee-github-legend"><span>Weniger</span><i class="employee-github-cell lvl-0"></i><i class="employee-github-cell lvl-1"></i><i class="employee-github-cell lvl-2"></i><i class="employee-github-cell lvl-3"></i><i class="employee-github-cell lvl-4"></i><span>Mehr</span></div>' +
      '</div>';
    return html;
  }

  function renderGitHubProjectActivity(activity) {
    var projects = activity && Array.isArray(activity.projectActivity) ? activity.projectActivity : [];
    if (!projects.length) {
      return '<p class="employee-github-empty">Noch keine projektbezogene GitHub-Aktivitaet gefunden.</p>';
    }

    var html = '<div class="employee-github-projects">';
    projects.slice(0, 4).forEach(function(project) {
      var title = project.repoUrl ? '<a href="' + escapeHtml(project.repoUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(project.projectTitle) + '</a>' : escapeHtml(project.projectTitle);
      html += '<div class="employee-github-project">' +
        '<div><strong>' + title + '</strong><span>' + project.commitCount + ' Commits · ' + project.activeDays + ' aktive Tage</span></div>' +
        '<small>Letzte Aktivitaet: ' + escapeHtml(formatDateTime(project.lastCommitAt)) + '</small>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderGitHubPanel(employee, activity, canEditProfile) {
    var github = employee.github || {};
    var username = github.username || '';
    var syncState = githubSyncRequests[employee.id] ? 'syncing' : (github.syncStatus || (username ? 'idle' : 'unlinked'));
    var syncLabel = syncState === 'syncing' ? 'Sync laeuft...' : 'GitHub Sync';
    var profileLink = github.profileUrl || buildGitHubProfileUrl(username);
    var lastSyncLabel = activity && activity.fetchedAt ? formatDateTime(activity.fetchedAt) : (github.lastSyncedAt ? formatDateTime(github.lastSyncedAt) : 'noch nicht synchronisiert');
    var statusNote = '';

    if (!username) {
      statusNote = '<p class="employee-github-note">GitHub-Profillink oder Benutzername hinterlegen, um Aktivitaet projektscharf zuzuordnen.</p>';
    } else if (activity && activity.syncError) {
      statusNote = '<p class="employee-github-note is-error">Sync-Hinweis: ' + escapeHtml(activity.syncError) + '</p>';
    } else if (activity && activity.source === 'project-cache') {
      statusNote = '<p class="employee-github-note">Aktuell aus bereits synchronisierten Projekt-Commits abgeleitet. Fuer exaktere Daten pro Projekt GitHub Sync ausfuehren.</p>';
    }

    var disabledAttr = canEditProfile ? '' : ' disabled';

    return '<section class="employee-github-panel">' +
      '<div class="employee-github-head">' +
        '<div>' +
          '<div class="employee-github-title">GitHub Aktivitaet</div>' +
          '<div class="employee-github-subtitle">' + (username ? '@' + escapeHtml(username) : 'Kein Konto verknuepft') + '</div>' +
        '</div>' +
        '<div class="employee-github-actions">' +
          (profileLink ? '<a class="btn btn-secondary employee-github-link" href="' + escapeHtml(profileLink) + '" target="_blank" rel="noopener noreferrer">Profil</a>' : '') +
          '<button type="button" class="btn btn-secondary employee-github-token-btn" data-action="edit-github-token" data-emp-id="' + escapeHtml(employee.id) + '"' + disabledAttr + '>PAT hinterlegen</button>' +
          '<button type="button" class="btn btn-secondary employee-github-sync-btn" data-action="github-sync" data-emp-id="' + escapeHtml(employee.id) + '"' + (username && canEditProfile ? '' : ' disabled') + '>' + syncLabel + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="employee-github-stats">' +
        '<span><strong>' + (activity.totalCommits || 0) + '</strong> Commits / 12 Wochen</span>' +
        '<span><strong>' + (activity.activeDays || 0) + '</strong> aktive Tage</span>' +
        '<span><strong>' + ((activity.projectActivity || []).length || 0) + '</strong> Projekte</span>' +
        '<span><strong>' + escapeHtml(lastSyncLabel) + '</strong></span>' +
      '</div>' +
      statusNote +
      renderGitHubMatrix(activity) +
      renderGitHubProjectActivity(activity) +
    '</section>';
  }

  function buildGitHubRequestHeaders(token) {
    var headers = {
      'Accept': 'application/vnd.github+json'
    };
    var normalizedToken = String(token || '').trim();
    if (normalizedToken) {
      headers.Authorization = 'Bearer ' + normalizedToken;
    }
    return headers;
  }

  function fetchGitHubJsonWithMeta(url, token) {
    return fetch(url, { headers: buildGitHubRequestHeaders(token) }).then(function(response) {
      return response.json().catch(function() { return {}; }).then(function(body) {
        if (!response.ok) {
          throw new Error(body && body.message ? body.message : 'GitHub API HTTP ' + response.status);
        }
        return {
          body: body,
          headers: response.headers
        };
      });
    });
  }

  function fetchEmployeeCommitsForProject(project, username, sinceIso, page, collector, token) {
    var currentPage = page || 1;
    var allItems = collector || [];
    var url = 'https://api.github.com/repos/' + encodeURIComponent(project.github.owner) + '/' + encodeURIComponent(project.github.repo) + '/commits?author=' + encodeURIComponent(username) + '&since=' + encodeURIComponent(sinceIso) + '&per_page=100&page=' + currentPage;

    return fetchGitHubJsonWithMeta(url, token).then(function(result) {
      var items = Array.isArray(result.body) ? result.body : [];
      items.forEach(function(item) {
        var commit = item.commit || {};
        var author = commit.author || {};
        var committer = commit.committer || {};
        var githubAuthor = item.author || {};
        allItems.push({
          sha: item.sha || '',
          message: commit.message || '',
          author: author.name || githubAuthor.login || 'unknown',
          authorLogin: githubAuthor.login || username,
          authorProfileUrl: githubAuthor.html_url || buildGitHubProfileUrl(username),
          authorEmail: author.email || '',
          date: author.date || committer.date || new Date().toISOString(),
          url: item.html_url || '',
          projectId: project.id,
          projectTitle: project.title || project.name || 'Unbenanntes Projekt',
          repoUrl: project.github.url || ''
        });
      });

      if (items.length === 100 && currentPage < 3) {
        return fetchEmployeeCommitsForProject(project, username, sinceIso, currentPage + 1, allItems, token);
      }

      return allItems;
    });
  }

  function syncEmployeeGitHubActivity(employeeId) {
    if (!employeeId) return Promise.reject(new Error('Mitarbeiter-ID fehlt.'));
    if (!canEditEmployeeProfile(employeeId)) return Promise.reject(new Error('Nur das eigene Mitarbeiterprofil kann synchronisiert werden.'));
    if (githubSyncRequests[employeeId]) return githubSyncRequests[employeeId];

    var employee = getEmployees().find(function(item) { return item.id === employeeId; });
    if (!employee) return Promise.reject(new Error('Mitarbeiter nicht gefunden.'));
    if (!employee.github || !employee.github.username) return Promise.reject(new Error('GitHub-Konto ist nicht verknuepft.'));

    var username = employee.github.username;
    var githubToken = employee.github.privateAccessToken || '';
    var projects = getLinkedGitHubProjects();
    var sinceIso = new Date(Date.now() - GITHUB_ACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    employee.github.syncStatus = 'syncing';
    employee.github.syncError = '';
    persistEmployee(employee);

    if (!projects.length) {
      employee.github.syncStatus = 'idle';
      employee.github.syncError = 'Keine GitHub-verknuepften Projekte vorhanden.';
      persistEmployee(employee);
      renderEmployeeList('employee-list');
      return Promise.resolve(buildProjectCacheGitHubActivity(employee));
    }

    githubSyncRequests[employeeId] = Promise.all(projects.map(function(project) {
      return fetchEmployeeCommitsForProject(project, username, sinceIso, 1, [], githubToken).then(function(commits) {
        return { commits: commits, error: '' };
      }).catch(function(err) {
        return { commits: [], error: err && err.message ? err.message : String(err) };
      });
    })).then(function(results) {
      var allCommits = [];
      var errors = [];
      results.forEach(function(result) {
        allCommits = allCommits.concat(result.commits || []);
        if (result.error) errors.push(result.error);
      });

      var freshEmployee = getEmployees().find(function(item) { return item.id === employeeId; }) || employee;
      var activity = aggregateGitHubActivity(freshEmployee, allCommits, 'github-api', new Date().toISOString(), errors.join(' | '));
      var cache = getGitHubActivityCache();
      cache[employeeId] = activity;
      setGitHubActivityCache(cache);

      freshEmployee.github = normalizeGitHubProfile(Object.assign({}, freshEmployee.github, {
        lastSyncedAt: activity.fetchedAt,
        syncStatus: errors.length ? 'partial' : 'ok',
        syncError: activity.syncError || ''
      }), freshEmployee.name);
      persistEmployee(freshEmployee);

      createNotification('GitHub-Aktivitaet fuer ' + freshEmployee.name + ' wurde aktualisiert.');
      renderEmployeeList('employee-list');
      delete githubSyncRequests[employeeId];
      return activity;
    }).catch(function(err) {
      var freshEmployee = getEmployees().find(function(item) { return item.id === employeeId; }) || employee;
      freshEmployee.github = normalizeGitHubProfile(Object.assign({}, freshEmployee.github, {
        syncStatus: 'error',
        syncError: err && err.message ? err.message : String(err)
      }), freshEmployee.name);
      persistEmployee(freshEmployee);
      renderEmployeeList('employee-list');
      delete githubSyncRequests[employeeId];
      throw err;
    });

    return githubSyncRequests[employeeId];
  }

  function normalizeEmployee(raw) {
    var emp = raw && typeof raw === 'object' ? Object.assign({}, raw) : {};
    if (!emp.id) emp.id = generateId('emp');
    if (!emp.name) emp.name = 'Unbenannt';
    if (!emp.role) emp.role = 'Developer';
    if (!emp.availability) emp.availability = 'Verfügbar';
    if (typeof emp.currentActivity !== 'string') emp.currentActivity = '';

    var cap = Number(emp.capacityPoints);
    if (!isFinite(cap) || cap <= 0) cap = 8;
    emp.capacityPoints = Math.min(20, Math.max(2, Math.round(cap)));

    if (!Array.isArray(emp.focusAreas)) {
      if (typeof emp.focusAreas === 'string' && emp.focusAreas.trim()) {
        emp.focusAreas = emp.focusAreas.split(',').map(function(item) { return item.trim(); }).filter(Boolean);
      } else {
        emp.focusAreas = [];
      }
    }

    emp.github = normalizeGitHubProfile(emp.github, emp.name);
    if (getAuthManager() && typeof getAuthManager().normalizeEmployee === 'function') {
      emp = getAuthManager().normalizeEmployee(emp);
    }
    if (!emp.createdAt) emp.createdAt = new Date().toISOString();
    emp.updatedAt = new Date().toISOString();
    return emp;
  }

  function getEmployeeAccess(emp) {
    var auth = getAuthManager();
    if (auth && typeof auth.normalizeEmployee === 'function') {
      return auth.normalizeEmployee(emp).auth;
    }

    return {
      accessLevel: 'employee',
      login: {
        enabled: false,
        username: '',
        passwordHash: ''
      },
      permissions: {
        pages: ['dashboard', 'projects', 'kanban', 'calendar', 'quicktask', 'employees']
      }
    };
  }

  function buildPermissionOptionsHtml(scope, selectedPages, disabled) {
    var auth = getAuthManager();
    if (!auth || typeof auth.getPageOptions !== 'function') return '';

    var selected = Array.isArray(selectedPages) ? selectedPages : [];
    return auth.getPageOptions().map(function(option) {
      var checked = selected.indexOf(option.value) !== -1 ? ' checked' : '';
      var disabledAttr = disabled ? ' disabled' : '';
      return '<label class="employee-permission-option">' +
        '<input type="checkbox" data-field="page-permission" data-scope="' + escapeHtml(scope) + '" data-page="' + escapeHtml(option.value) + '"' + checked + disabledAttr + '>' +
        '<span>' + escapeHtml(option.label) + '</span>' +
      '</label>';
    }).join('');
  }

  function buildPermissionSummary(selectedPages) {
    var auth = getAuthManager();
    var pages = Array.isArray(selectedPages) ? selectedPages : [];
    var count = pages.length;
    if (auth && typeof auth.getPageOptions === 'function') {
      var labelsByValue = {};
      auth.getPageOptions().forEach(function(option) {
        labelsByValue[option.value] = option.label;
      });
      var preview = pages.slice(0, 3).map(function(page) {
        return labelsByValue[page] || page;
      }).filter(Boolean);
      if (preview.length) {
        return count + ' Bereiche · ' + preview.join(', ') + (count > preview.length ? ' +' + (count - preview.length) : '');
      }
    }
    return count ? count + ' Bereiche freigeschaltet' : 'Keine Bereiche freigeschaltet';
  }

  function buildPermissionEditorHtml(scope, selectedPages, disabled, openByDefault) {
    var pages = Array.isArray(selectedPages) ? selectedPages : [];
    return '' +
      '<details class="employee-permission-panel"' + (openByDefault ? ' open' : '') + '>' +
        '<summary class="employee-permission-summary">' +
          '<span class="employee-permission-summary-copy">' +
            '<span class="employee-permission-editor-title">Freigeschaltete Seiten</span>' +
            '<span class="employee-permission-summary-text">' + escapeHtml(buildPermissionSummary(pages)) + '</span>' +
          '</span>' +
          '<span class="employee-permission-summary-badge">' + pages.length + '</span>' +
        '</summary>' +
        '<div class="employee-permission-grid">' + buildPermissionOptionsHtml(scope, pages, disabled) + '</div>' +
      '</details>';
  }

  function buildAuthStatusPill(label, tone) {
    return '<span class="employee-auth-pill employee-auth-pill-' + escapeHtml(tone || 'neutral') + '">' + escapeHtml(label) + '</span>';
  }

  function normalizeEmployeeCollection(employees) {
    return (employees || []).map(normalizeEmployee);
  }

  function syncEmployeesToDataLayer(normalizedEmployees) {
    if (!hasDataLayer()) {
      storageWrite(LEGACY_EMPLOYEE_KEY, normalizedEmployees);
      return;
    }

    var current = (window.DataLayer.getEmployees() || []).slice();
    var nextById = {};
    normalizedEmployees.forEach(function(emp) { nextById[emp.id] = emp; });

    current.forEach(function(existing) {
      if (!nextById[existing.id] && typeof window.DataLayer.deleteEmployee === 'function') {
        window.DataLayer.deleteEmployee(existing.id);
      }
    });

    normalizedEmployees.forEach(function(emp) {
      var exists = current.find(function(item) { return item.id === emp.id; });
      if (exists) {
        window.DataLayer.updateEmployee(emp);
      } else {
        window.DataLayer.createEmployee(emp);
      }
    });
  }

  function getEmployees() {
    if (hasDataLayer()) {
      var source = window.DataLayer.getEmployees() || [];
      return normalizeEmployeeCollection(source);
    }
    return normalizeEmployeeCollection(storageRead(LEGACY_EMPLOYEE_KEY, []));
  }

  function setEmployees(employees) {
    var normalized = normalizeEmployeeCollection(employees || []);
    syncEmployeesToDataLayer(normalized);
  }

  function persistEmployee(employee) {
    if (!employee || !employee.id) return;
    var normalized = normalizeEmployee(employee);

    if (hasDataLayer()) {
      var existing = (window.DataLayer.getEmployees() || []).find(function(item) { return item.id === normalized.id; });
      if (!existing) return;
      window.DataLayer.updateEmployee(normalized);
      return;
    }

    var all = getEmployees();
    var idx = all.findIndex(function(item) { return item.id === normalized.id; });
    if (idx === -1) return;
    all[idx] = normalized;
    storageWrite(LEGACY_EMPLOYEE_KEY, all);
  }

  function getAssignments() {
    return storageRead(ASSIGNMENTS_KEY, []);
  }

  function setAssignments(assignments) {
    storageWrite(ASSIGNMENTS_KEY, assignments || []);
  }

  function getRoleColor(role) {
    return roleColors[role] || '#6b7280';
  }

  function getAvailColor(avail) {
    return availColors[avail] || '#6b7280';
  }

  function getProjects() {
    if (window.DataLayer && typeof window.DataLayer.getProjects === 'function') {
      return window.DataLayer.getProjects() || [];
    }
    return storageRead('pd_projects', []);
  }

  function getDataLayerTasks() {
    if (window.DataLayer && typeof window.DataLayer.getTasks === 'function') {
      return (window.DataLayer.getTasks() || []).slice();
    }
    return storageRead('pd_tasks', []);
  }

  function statusLabel(status) {
    switch (status) {
      case 'backlog': return 'Backlog';
      case 'todo': return 'To Do';
      case 'in-progress': return 'In Arbeit';
      case 'review': return 'Review';
      case 'done': return 'Done';
      default: return status || 'Offen';
    }
  }

  function statusClass(status) {
    if (status === 'done') return 'done';
    if (status === 'in-progress') return 'in-progress';
    if (status === 'review') return 'review';
    if (status === 'backlog') return 'backlog';
    return 'todo';
  }

  function buildUnifiedTaskCollection() {
    var tasks = [];
    var seenById = {};
    var projects = getProjects();

    (getDataLayerTasks() || []).forEach(function(task) {
      var normalizedTask = Object.assign({}, task);
      if (normalizedTask.id) seenById[normalizedTask.id] = true;
      tasks.push(normalizedTask);
    });

    (projects || []).forEach(function(project) {
      (project.tasks || []).forEach(function(task) {
        var taskCopy = Object.assign({}, task);
        taskCopy.projectId = taskCopy.projectId || project.id;
        taskCopy.projectName = taskCopy.projectName || project.title || project.name || '';

        if (taskCopy.id && seenById[taskCopy.id]) return;
        if (taskCopy.id) seenById[taskCopy.id] = true;
        tasks.push(taskCopy);
      });
    });

    var employeeByName = {};
    getEmployees().forEach(function(emp) {
      employeeByName[String(emp.name || '').trim().toLowerCase()] = emp.id;
    });

    tasks.forEach(function(task) {
      if (!task.assigneeId && task.employeeName) {
        var mappedId = employeeByName[String(task.employeeName).trim().toLowerCase()];
        if (mappedId) task.assigneeId = mappedId;
      }
    });

    var assignments = getAssignments();
    assignments.forEach(function(assignment) {
      var target = tasks.find(function(task) { return task.id === assignment.taskId; });
      if (target && !target.assigneeId) {
        target.assigneeId = assignment.employeeId;
      }
    });

    return tasks;
  }

  function priorityWeight(priority) {
    switch (priority) {
      case 'blocker': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 1.5;
    }
  }

  function statusFactor(status) {
    switch (status) {
      case 'done': return 0.2;
      case 'review': return 1.1;
      case 'in-progress': return 1.35;
      case 'todo': return 1.0;
      case 'backlog': return 0.8;
      default: return 1.0;
    }
  }

  function taskWeight(task) {
    var effort = Number(task.effortPoints);
    if (!isFinite(effort) || effort <= 0) {
      effort = priorityWeight(task.priority);
    }
    return effort * statusFactor(task.status);
  }

  function computeLoadBand(utilizationPercent) {
    if (utilizationPercent >= 115) return 'overload';
    if (utilizationPercent >= 85) return 'high';
    if (utilizationPercent >= 50) return 'balanced';
    return 'low';
  }

  function getEmployeeTasks(employee, allTasks) {
    var list = (allTasks || []).filter(function(task) {
      if (task.assigneeId === employee.id) return true;
      if (task.employeeName && String(task.employeeName).trim().toLowerCase() === String(employee.name).trim().toLowerCase()) return true;
      return false;
    });

    list.sort(function(a, b) {
      return taskWeight(b) - taskWeight(a);
    });

    return list;
  }

  function buildEmployeeViewModel(employee, allTasks) {
    var tasks = getEmployeeTasks(employee, allTasks);
    var activeTasks = tasks.filter(function(task) { return task.status !== 'done'; });
    var inProgress = activeTasks.filter(function(task) { return task.status === 'in-progress'; }).length;
    var done = tasks.filter(function(task) { return task.status === 'done'; }).length;
    var overdue = activeTasks.filter(function(task) {
      if (!task.dueDate) return false;
      var due = new Date(task.dueDate);
      return !isNaN(due.getTime()) && due.getTime() < Date.now();
    }).length;

    var rawLoad = activeTasks.reduce(function(sum, task) {
      return sum + taskWeight(task);
    }, 0);

    var utilization = Math.round((rawLoad / Math.max(1, employee.capacityPoints)) * 100);
    var loadBand = computeLoadBand(utilization);
    var githubActivity = getEmployeeGitHubActivity(employee);

    return {
      employee: employee,
      tasks: tasks,
      activeTasks: activeTasks,
      github: githubActivity,
      metrics: {
        rawLoad: rawLoad,
        utilization: utilization,
        loadBand: loadBand,
        activeCount: activeTasks.length,
        inProgressCount: inProgress,
        doneCount: done,
        overdueCount: overdue
      }
    };
  }

  function applyFilters(viewModels) {
    var filtered = (viewModels || []).filter(function(vm) {
      var searchHaystack = [
        vm.employee.name,
        vm.employee.role,
        vm.employee.currentActivity,
        vm.employee.github && vm.employee.github.username ? vm.employee.github.username : '',
        vm.tasks.slice(0, 5).map(function(task) { return task.title || ''; }).join(' ')
      ].join(' ').toLowerCase();

      var searchOk = !FILTER_STATE.search || searchHaystack.indexOf(FILTER_STATE.search.toLowerCase()) !== -1;
      var roleOk = !FILTER_STATE.role || vm.employee.role === FILTER_STATE.role;
      var availOk = !FILTER_STATE.availability || vm.employee.availability === FILTER_STATE.availability;
      var loadOk = FILTER_STATE.loadBand === 'all' || vm.metrics.loadBand === FILTER_STATE.loadBand;

      return searchOk && roleOk && availOk && loadOk;
    });

    filtered.sort(function(a, b) {
      if (FILTER_STATE.sort === 'name-asc') {
        return String(a.employee.name || '').localeCompare(String(b.employee.name || ''), 'de');
      }
      if (FILTER_STATE.sort === 'tasks-desc') {
        return b.metrics.activeCount - a.metrics.activeCount;
      }
      if (FILTER_STATE.sort === 'load-asc') {
        return a.metrics.utilization - b.metrics.utilization;
      }
      return b.metrics.utilization - a.metrics.utilization;
    });

    return filtered;
  }

  function renderRoleFilter(employees) {
    var roleSelect = document.getElementById('employee-filter-role');
    if (!roleSelect) return;

    var roles = {};
    (employees || []).forEach(function(emp) {
      if (emp.role) roles[emp.role] = true;
    });

    var current = roleSelect.value || FILTER_STATE.role;
    var options = ['<option value="">Alle Rollen</option>'];
    Object.keys(roles).sort(function(a, b) { return a.localeCompare(b, 'de'); }).forEach(function(role) {
      options.push('<option value="' + escapeHtml(role) + '">' + escapeHtml(role) + '</option>');
    });

    roleSelect.innerHTML = options.join('');
    if (current) roleSelect.value = current;
  }

  function renderOverviewKpis(viewModels, allTasks) {
    var totalLoad = viewModels.reduce(function(sum, vm) { return sum + vm.metrics.rawLoad; }, 0);
    var utilizationAvg = viewModels.length ? Math.round(viewModels.reduce(function(sum, vm) { return sum + vm.metrics.utilization; }, 0) / viewModels.length) : 0;
    var balancedCount = viewModels.filter(function(vm) {
      return vm.metrics.loadBand === 'balanced' || vm.metrics.loadBand === 'low';
    }).length;
    var overloadCount = viewModels.filter(function(vm) {
      return vm.metrics.loadBand === 'overload';
    }).length;
    var unassigned = (allTasks || []).filter(function(task) { return task.status !== 'done' && !task.assigneeId; }).length;

    var totalCard = document.getElementById('employee-kpi-total-load');
    if (totalCard) {
      totalCard.innerHTML =
        '<p class="employee-overview-label">Gesamtarbeitslast</p>' +
        '<div class="employee-overview-value">' + Math.round(totalLoad) + ' pts</div>' +
        '<p class="employee-overview-meta">Ø Auslastung ' + utilizationAvg + '%</p>';
    }

    var balancedCard = document.getElementById('employee-kpi-balanced');
    if (balancedCard) {
      balancedCard.innerHTML =
        '<p class="employee-overview-label">Ausgewogene Profile</p>' +
        '<div class="employee-overview-value">' + balancedCount + '</div>' +
        '<p class="employee-overview-meta">Teammitglieder im stabilen Bereich</p>';
    }

    var overloadCard = document.getElementById('employee-kpi-overload');
    if (overloadCard) {
      overloadCard.innerHTML =
        '<p class="employee-overview-label">Ueberlastung</p>' +
        '<div class="employee-overview-value">' + overloadCount + '</div>' +
        '<p class="employee-overview-meta">Kapazitaeten ueber 115%</p>';
    }

    var unassignedCard = document.getElementById('employee-kpi-unassigned');
    if (unassignedCard) {
      unassignedCard.innerHTML =
        '<p class="employee-overview-label">Unzugeordnete Aufgaben</p>' +
        '<div class="employee-overview-value">' + unassigned + '</div>' +
        '<p class="employee-overview-meta">Offene Tasks ohne Verantwortliche</p>';
    }
  }

  function renderLoadBars(viewModels) {
    var panel = document.getElementById('employee-load-bars');
    if (!panel) return;

    if (!viewModels.length) {
      panel.innerHTML = '<h3>Arbeitslast je Mitarbeiter</h3><p class="chart-empty">Keine Daten verfuegbar.</p>';
      return;
    }

    var html = '<h3>Arbeitslast je Mitarbeiter</h3><div class="employee-load-list">';
    viewModels.slice().sort(function(a, b) { return b.metrics.utilization - a.metrics.utilization; }).forEach(function(vm) {
      var band = loadBandConfig[vm.metrics.loadBand] || loadBandConfig.balanced;
      var width = Math.min(160, vm.metrics.utilization);
      html +=
        '<div class="employee-load-row">' +
          '<div class="employee-load-head"><span>' + escapeHtml(vm.employee.name) + '</span><strong>' + vm.metrics.utilization + '%</strong></div>' +
          '<div class="employee-load-track"><div class="employee-load-fill band-' + escapeHtml(vm.metrics.loadBand) + '" style="width:' + width + '%"></div></div>' +
          '<div class="employee-load-meta"><span style="color:' + band.color + '">' + band.label + '</span><span>' + vm.metrics.activeCount + ' aktiv</span></div>' +
        '</div>';
    });
    html += '</div>';
    panel.innerHTML = html;
  }

  function renderDistribution(viewModels) {
    var panel = document.getElementById('employee-distribution');
    if (!panel) return;

    if (!viewModels.length) {
      panel.innerHTML = '<h3>Aufgabenverteilung</h3><p class="chart-empty">Keine Daten verfuegbar.</p>';
      return;
    }

    var totalActive = viewModels.reduce(function(sum, vm) { return sum + vm.metrics.activeCount; }, 0);
    if (totalActive === 0) {
      panel.innerHTML = '<h3>Aufgabenverteilung</h3><p class="chart-empty">Aktuell keine aktiven Aufgaben.</p>';
      return;
    }

    var gradientParts = [];
    var cumulative = 0;
    viewModels.forEach(function(vm) {
      if (vm.metrics.activeCount <= 0) return;
      var part = (vm.metrics.activeCount / totalActive) * 100;
      gradientParts.push(getRoleColor(vm.employee.role) + ' ' + cumulative.toFixed(2) + '% ' + (cumulative + part).toFixed(2) + '%');
      cumulative += part;
    });

    var legend = viewModels.map(function(vm) {
      var pct = totalActive ? Math.round((vm.metrics.activeCount / totalActive) * 100) : 0;
      return '<div class="employee-distribution-item">' +
        '<span class="employee-distribution-dot" style="background:' + getRoleColor(vm.employee.role) + '"></span>' +
        '<span>' + escapeHtml(vm.employee.name) + '</span>' +
        '<strong>' + vm.metrics.activeCount + ' (' + pct + '%)</strong>' +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<h3>Aufgabenverteilung</h3>' +
      '<div class="employee-distribution-wrap">' +
        '<div class="employee-distribution-donut" style="background:conic-gradient(' + gradientParts.join(',') + ')"></div>' +
        '<div class="employee-distribution-legend">' + legend + '</div>' +
      '</div>';
  }

  function renderTaskList(vm) {
    if (!vm.activeTasks.length) {
      return '<li class="employee-task-empty">Keine aktiven Aufgaben.</li>';
    }

    var max = 4;
    var canReassign = canManageEmployees();
    var visible = vm.activeTasks.slice(0, max);
    var html = visible.map(function(task) {
      var taskId = task.id ? String(task.id) : '';
      var draggable = taskId && canReassign ? ' draggable="true"' : '';
      var attrTaskId = taskId ? ' data-task-id="' + escapeHtml(taskId) + '"' : '';
      var attrEmpId = ' data-source-emp-id="' + escapeHtml(vm.employee.id) + '"';
      return '<li class="employee-task-item"' + attrTaskId + attrEmpId + draggable + '>' +
        '<div class="employee-task-main">' +
          '<span class="employee-task-title">' + escapeHtml(task.title || 'Ohne Titel') + '</span>' +
          '<span class="badge employee-task-status status-' + statusClass(task.status) + '">' + escapeHtml(statusLabel(task.status)) + '</span>' +
        '</div>' +
        '<div class="employee-task-sub">' +
          '<span>' + escapeHtml(task.projectName || task.projectTitle || 'Ohne Projekt') + '</span>' +
          '<span>' + escapeHtml(task.priority || 'normal') + '</span>' +
        '</div>' +
      '</li>';
    }).join('');

    if (vm.activeTasks.length > max) {
      html += '<li class="employee-task-more">+' + (vm.activeTasks.length - max) + ' weitere Aufgaben</li>';
    }

    return html;
  }

  function renderEmployeeCards(viewModels, containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!viewModels.length) {
      container.innerHTML = '<div class="empty-state-panel"><p>Keine Mitarbeiter mit den gewaehlten Filtern gefunden.</p></div>';
      return;
    }

    var html = viewModels.map(function(vm) {
      var emp = vm.employee;
      var access = getEmployeeAccess(emp);
      var canEditProfile = canEditEmployeeProfile(emp.id);
      var canManageAccess = canManageEmployeeAccessFields();
      var canDeleteEmployee = canManageEmployees();
      var profileDisabledAttr = canEditProfile ? '' : ' disabled';
      var adminDisabledAttr = canManageAccess ? '' : ' disabled';
      var loadBand = loadBandConfig[vm.metrics.loadBand] || loadBandConfig.balanced;
      var utilizationWidth = Math.min(160, vm.metrics.utilization);
      var isOnline = !!(window.AuthManager && typeof window.AuthManager.isEmployeeDashboardOnline === 'function' && window.AuthManager.isEmployeeDashboardOnline(emp));
      var authPills = '' +
        buildAuthStatusPill(access.accessLevel === 'admin' ? 'Administrator' : 'Mitarbeiter', access.accessLevel === 'admin' ? 'accent' : 'neutral') +
        buildAuthStatusPill(access.login.enabled ? 'Login aktiv' : 'Ohne Login', access.login.enabled ? 'success' : 'muted');

      return '<article class="employee-card employee-card-frame employee-work-card">' +
        '<div class="employee-card-head">' +
          renderEmployeeAvatar(emp) +
          '<div class="employee-meta">' +
            '<div class="employee-name">' + escapeHtml(emp.name) + (isOnline ? '<span class="employee-presence" title="Online im Dashboard"><span class="profile-presence-dot" aria-hidden="true"></span><span>Online</span></span>' : '') + '</div>' +
            '<span class="badge employee-role-badge" style="background:' + getRoleColor(emp.role) + '">' + escapeHtml(emp.role) + '</span>' +
          '</div>' +
          '<span class="badge employee-status-badge" style="background:' + getAvailColor(emp.availability) + '">' + escapeHtml(emp.availability) + '</span>' +
        '</div>' +

        '<div class="employee-load-zone">' +
          '<div class="employee-load-zone-head"><span>Auslastung</span><strong>' + vm.metrics.utilization + '%</strong></div>' +
          '<div class="employee-load-track"><div class="employee-load-fill band-' + escapeHtml(vm.metrics.loadBand) + '" style="width:' + utilizationWidth + '%"></div></div>' +
          '<div class="employee-load-zone-meta"><span style="color:' + loadBand.color + '">' + loadBand.label + '</span><span>' + vm.metrics.rawLoad.toFixed(1) + ' / ' + emp.capacityPoints + ' pts</span></div>' +
        '</div>' +

        '<div class="employee-metrics">' +
          '<span><strong>' + vm.metrics.activeCount + '</strong> aktiv</span>' +
          '<span><strong>' + vm.metrics.inProgressCount + '</strong> in Arbeit</span>' +
          '<span><strong>' + vm.metrics.overdueCount + '</strong> ueberfaellig</span>' +
          '<span><strong>' + vm.metrics.doneCount + '</strong> abgeschlossen</span>' +
        '</div>' +

        '<label class="employee-form-field">Aktuelle Taetigkeit' +
          '<input type="text" data-field="activity" data-emp-id="' + escapeHtml(emp.id) + '" value="' + escapeHtml(emp.currentActivity || '') + '" placeholder="Woran arbeitet die Person gerade?"' + profileDisabledAttr + '>' +
        '</label>' +

        '<label class="employee-form-field">Fokusbereiche (Komma getrennt)' +
          '<input type="text" data-field="focus" data-emp-id="' + escapeHtml(emp.id) + '" value="' + escapeHtml((emp.focusAreas || []).join(', ')) + '" placeholder="API, UI, QA, Deployment ..."' + profileDisabledAttr + '>' +
        '</label>' +

        '<label class="employee-form-field">GitHub Profil' +
          '<input type="text" data-field="github-profile" data-emp-id="' + escapeHtml(emp.id) + '" value="' + escapeHtml(emp.github && emp.github.profileUrl ? emp.github.profileUrl : '') + '" placeholder="https://github.com/username oder @username"' + profileDisabledAttr + '>' +
        '</label>' +

        '<label class="employee-form-field">GitHub Aliase (optional, Komma getrennt)' +
          '<input type="text" data-field="github-aliases" data-emp-id="' + escapeHtml(emp.id) + '" value="' + escapeHtml(emp.github && emp.github.aliases ? emp.github.aliases.filter(function(alias) { return String(alias || '').trim().toLowerCase() !== String(emp.name || '').trim().toLowerCase() && String(alias || '').trim().toLowerCase() !== String((emp.github && emp.github.username) || '').trim().toLowerCase(); }).join(', ') : '') + '" placeholder="commit alias, bot-name, alter username"' + profileDisabledAttr + '>' +
        '</label>' +

        '<div class="employee-auth-card">' +
          '<div class="employee-auth-top">' +
            '<div class="employee-auth-copy">' +
              '<div class="employee-auth-head">Zugang & Menues</div>' +
              '<div class="employee-auth-subtitle">Login, Rolle und freigegebene Arbeitsbereiche zentral verwalten.</div>' +
            '</div>' +
            '<div class="employee-auth-pills">' + authPills + '</div>' +
          '</div>' +
          '<div class="employee-auth-grid">' +
          '<label class="employee-form-field">' +
            '<span class="employee-form-label">Zugriffsebene</span>' +
            '<select data-field="access-level" data-emp-id="' + escapeHtml(emp.id) + '" class="employee-inline-select"' + adminDisabledAttr + '>' +
              '<option value="employee"' + (access.accessLevel === 'employee' ? ' selected' : '') + '>Mitarbeiter</option>' +
              '<option value="admin"' + (access.accessLevel === 'admin' ? ' selected' : '') + '>Administrator</option>' +
            '</select>' +
          '</label>' +
          '<label class="employee-inline-checkbox">' +
            '<input type="checkbox" data-field="login-enabled" data-emp-id="' + escapeHtml(emp.id) + '"' + (access.login.enabled ? ' checked' : '') + adminDisabledAttr + '>' +
            '<span>Login aktivieren</span>' +
          '</label>' +
          '<label class="employee-form-field">' +
            '<span class="employee-form-label">Login-Name</span>' +
            '<input type="text" data-field="login-username" data-emp-id="' + escapeHtml(emp.id) + '" value="' + escapeHtml(access.login.username || '') + '" placeholder="max.mustermann"' + profileDisabledAttr + '>' +
          '</label>' +
          '<label class="employee-form-field">' +
            '<span class="employee-form-label">Passwort</span>' +
            '<span class="employee-form-hint">' + escapeHtml(access.login.passwordHash ? 'Leer lassen, um das bestehende Passwort beizubehalten.' : 'Passwort fuer den Mitarbeiter-Login setzen.') + '</span>' +
            '<input type="password" data-field="login-password" data-emp-id="' + escapeHtml(emp.id) + '" value="" placeholder="' + escapeHtml(access.login.passwordHash ? 'Neues Passwort setzen' : 'Passwort setzen') + '" autocomplete="new-password"' + profileDisabledAttr + '>' +
          '</label>' +
          '</div>' +
          '<div class="employee-permission-editor">' + buildPermissionEditorHtml(emp.id, access.permissions.pages || [], access.accessLevel === 'admin' || !canManageAccess, false) + '</div>' +
        '</div>' +

        '<label class="employee-form-field">Kapazitaet (Story-Points)' +
          '<div class="employee-capacity-row">' +
            '<input type="range" min="2" max="20" step="1" data-field="capacity" data-emp-id="' + escapeHtml(emp.id) + '" value="' + emp.capacityPoints + '"' + profileDisabledAttr + '>' +
            '<output id="employee-capacity-output-' + escapeHtml(emp.id) + '">' + emp.capacityPoints + '</output>' +
          '</div>' +
        '</label>' +

        '<div class="employee-actions">' +
          '<select data-field="availability" data-emp-id="' + escapeHtml(emp.id) + '" class="employee-inline-select"' + profileDisabledAttr + '>' +
            '<option value="Verfügbar"' + (emp.availability === 'Verfügbar' ? ' selected' : '') + '>Verfügbar</option>' +
            '<option value="Belastet"' + (emp.availability === 'Belastet' ? ' selected' : '') + '>Belastet</option>' +
            '<option value="Urlaub"' + (emp.availability === 'Urlaub' ? ' selected' : '') + '>Urlaub</option>' +
          '</select>' +
          '<button type="button" class="btn btn-secondary employee-task-btn" data-action="assign-task" data-emp-id="' + escapeHtml(emp.id) + '"' + adminDisabledAttr + '>+ Task</button>' +
          '<button type="button" class="btn btn-primary employee-save-btn" data-action="save-profile" data-emp-id="' + escapeHtml(emp.id) + '"' + profileDisabledAttr + '>Speichern</button>' +
          (canDeleteEmployee ? '<button type="button" class="btn btn-danger employee-remove-btn" data-action="remove-employee" data-emp-id="' + escapeHtml(emp.id) + '">Entfernen</button>' : '') +
        '</div>' +

        renderGitHubPanel(emp, vm.github, canEditProfile) +

        '<div class="employee-task-panel" data-emp-id="' + escapeHtml(emp.id) + '">' +
          '<div class="employee-task-panel-head">Aktuelle Aufgaben</div>' +
          '<ul class="employee-task-list" data-drop-emp-id="' + escapeHtml(emp.id) + '">' + renderTaskList(vm) + '</ul>' +
        '</div>' +
      '</article>';
    }).join('');

    container.innerHTML = html;
  }

  function createNotification(message) {
    try {
      if (window.DataLayer && typeof window.DataLayer.createNotification === 'function') {
        window.DataLayer.createNotification({
          id: generateId('notif'),
          message: message,
          timestamp: new Date().toISOString(),
          read: false
        });
      } else {
        var notifications = storageRead('EmployeeManager_notifications', []);
        notifications.unshift({
          id: generateId('notif'),
          message: message,
          timestamp: new Date().toISOString(),
          read: false
        });
        storageWrite('EmployeeManager_notifications', notifications);
      }
    } catch (e) {
      console.warn('[' + NAMESPACE + '] Notification failed', e);
    }
  }

  function renderEmployeeList(containerId) {
    var employees = getEmployees();
    var auth = getAuthManager();
    var mode = auth && typeof auth.getMode === 'function' ? auth.getMode() : '';
    var currentUser = getCurrentUser();

    // Migriere Legacy-Daten beim ersten Rendern in DataLayer.
    if (hasDataLayer()) {
      var legacy = storageRead(LEGACY_EMPLOYEE_KEY, []);
      if (legacy.length && !window.DataLayer.getEmployees().length) {
        setEmployees(legacy);
        storageWrite(LEGACY_EMPLOYEE_KEY, []);
        employees = getEmployees();
      }
    }

    var scopedEmployees = employees;
    if (mode === 'employee') {
      scopedEmployees = employees.filter(function(emp) {
        return !!(currentUser && String(emp.id || '') === String(currentUser.id || ''));
      });
    }

    renderRoleFilter(scopedEmployees);

    var addBtn = document.getElementById('add-employee-btn');
    if (addBtn) addBtn.disabled = !canManageEmployees();

    if (!scopedEmployees.length) {
      var target = document.getElementById(containerId || 'employee-list');
      if (target) {
        target.innerHTML = mode === 'employee'
          ? '<div class="empty-state-panel"><p>Dein Mitarbeiterprofil wurde nicht gefunden.</p></div>'
          : '<div class="empty-state-panel"><p>Keine Mitarbeiter vorhanden.</p><button class="btn btn-primary empty-state-action" id="empty-state-add-employee">Mitarbeiter hinzufuegen</button></div>';
      }
      renderOverviewKpis([], []);
      renderLoadBars([]);
      renderDistribution([]);
      return;
    }

    var allTasks = buildUnifiedTaskCollection();
    var models = scopedEmployees.map(function(emp) {
      return buildEmployeeViewModel(emp, allTasks);
    });

    var filtered = applyFilters(models);

    renderOverviewKpis(models, allTasks);
    renderEmployeeCards(filtered, containerId || 'employee-list');
    renderLoadBars(models);
    renderDistribution(models);
  }

  function updateAvailability(employeeId, status) {
    if (!employeeId || !status) return;
    if (!ensureCanEditEmployeeProfile(employeeId)) return;
    var employees = getEmployees();
    var target = employees.find(function(emp) { return emp.id === employeeId; });
    if (!target) return;

    target.availability = status;
    target.updatedAt = new Date().toISOString();
    persistEmployee(target);
    createNotification(target.name + ' hat Verfuegbarkeit auf "' + status + '" gesetzt.');
  }

  function updateEmployeeProfile(employeeId, patch) {
    if (!employeeId) return;
    if (!ensureCanEditEmployeeProfile(employeeId)) return;

    var employees = getEmployees();
    var target = employees.find(function(emp) { return emp.id === employeeId; });
    if (!target) return;
    var adminMode = canManageEmployees();

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'currentActivity')) {
      target.currentActivity = String(patch.currentActivity || '').trim();
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'focusAreas')) {
      target.focusAreas = (patch.focusAreas || []).filter(Boolean);
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'capacityPoints')) {
      var cap = Number(patch.capacityPoints);
      if (isFinite(cap)) target.capacityPoints = Math.max(2, Math.min(20, Math.round(cap)));
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'github')) {
      target.github = normalizeGitHubProfile(Object.assign({}, target.github || {}, patch.github || {}), target.name);
      target.github.syncStatus = target.github.username ? 'idle' : 'unlinked';
      if (!target.github.username) target.github.syncError = '';
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'auth') && patch.auth) {
      if (adminMode) {
        target.auth = patch.auth;
      } else {
        var currentAccess = getEmployeeAccess(target);
        var nextLogin = patch.auth && patch.auth.login ? patch.auth.login : {};
        if (Object.prototype.hasOwnProperty.call(nextLogin, 'username')) {
          currentAccess.login.username = String(nextLogin.username || '').trim();
        }
        if (Object.prototype.hasOwnProperty.call(nextLogin, 'passwordHash')) {
          var incomingHash = String(nextLogin.passwordHash || '').trim();
          if (incomingHash) currentAccess.login.passwordHash = incomingHash;
        }
        target.auth = currentAccess;
      }
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, 'customAvatarBase64')) {
      target.customAvatarBase64 = String(patch.customAvatarBase64 || '').trim();
    }

    target.updatedAt = new Date().toISOString();
    persistEmployee(target);
  }

  function removeEmployee(employeeId) {
    if (!employeeId) return false;
    if (!canManageEmployees()) {
      alert('Nur Administratoren koennen Mitarbeiter entfernen.');
      return false;
    }

    var employees = getEmployees();
    var target = employees.find(function(emp) { return emp.id === employeeId; });
    if (!target) {
      alert('Mitarbeiter nicht gefunden.');
      return false;
    }

    var currentUser = getCurrentUser();
    if (currentUser && String(currentUser.id || '') === String(employeeId || '')) {
      alert('Das eigene Benutzerkonto kann nicht entfernt werden.');
      return false;
    }

    setAssignments(getAssignments().filter(function(item) {
      return String(item.employeeId || '') !== String(employeeId || '');
    }));

    getDataLayerTasks().forEach(function(task) {
      var changed = false;

      if (String(task.assigneeId || '') === String(employeeId || '')) {
        task.assigneeId = '';
        changed = true;
      }

      if (String(task.employeeName || '').trim().toLowerCase() === String(target.name || '').trim().toLowerCase()) {
        task.employeeName = '';
        changed = true;
      }

      if (changed && window.DataLayer && typeof window.DataLayer.updateTask === 'function') {
        window.DataLayer.updateTask(task);
      }
    });

    getProjects().forEach(function(project) {
      var changed = false;

      (project.tasks || []).forEach(function(task) {
        if (String(task.assigneeId || '') === String(employeeId || '')) {
          task.assigneeId = '';
          changed = true;
        }

        if (String(task.employeeName || '').trim().toLowerCase() === String(target.name || '').trim().toLowerCase()) {
          task.employeeName = '';
          changed = true;
        }
      });

      if (changed && window.DataLayer && typeof window.DataLayer.updateProject === 'function') {
        window.DataLayer.updateProject(project);
      }
    });

    if (hasDataLayer() && window.DataLayer && typeof window.DataLayer.deleteEmployee === 'function') {
      window.DataLayer.deleteEmployee(employeeId);
    } else {
      setEmployees(employees.filter(function(emp) { return emp.id !== employeeId; }));
    }

    createNotification(target.name + ' wurde aus dem Team entfernt.');
    renderEmployeeList('employee-list');
    return true;
  }

  function confirmRemoveEmployee(employeeId) {
    if (!employeeId) return;
    if (!canManageEmployees()) {
      alert('Nur Administratoren koennen Mitarbeiter entfernen.');
      return;
    }

    var employee = getEmployees().find(function(item) { return item.id === employeeId; });
    if (!employee) {
      alert('Mitarbeiter nicht gefunden.');
      return;
    }

    showConfirmModal(
      'Mitarbeiter entfernen',
      '<div class="modal-form-stack">' +
        '<p>Der Mitarbeiter <strong>' + escapeHtml(employee.name || 'Unbenannt') + '</strong> wird entfernt.</p>' +
        '<p class="modal-hint"><small>Alle direkten Zuweisungen im Mitarbeiterbereich werden geloest. Diese Aktion kann nicht rueckgaengig gemacht werden.</small></p>' +
      '</div>',
      function() {
        if (removeEmployee(employeeId)) {
          closeModal();
        }
      },
      ['Entfernen', 'Abbrechen']
    );
  }

  function getTaskById(taskId) {
    if (!taskId) return null;
    if (window.DataLayer && typeof window.DataLayer.getTaskById === 'function') {
      return window.DataLayer.getTaskById(taskId);
    }
    return null;
  }

  function assignTaskToEmployee(taskId, employeeId) {
    if (!taskId || !employeeId) return false;
    if (!canManageEmployees()) {
      alert('Nur Administratoren koennen Aufgaben im Mitarbeiterbereich umverteilen.');
      return false;
    }

    var assignments = getAssignments();
    var idx = assignments.findIndex(function(item) { return item.taskId === taskId; });

    if (idx === -1) {
      assignments.push({
        id: generateId('assign'),
        employeeId: employeeId,
        taskId: taskId,
        assignedAt: new Date().toISOString()
      });
    } else {
      assignments[idx].employeeId = employeeId;
      assignments[idx].assignedAt = new Date().toISOString();
    }

    setAssignments(assignments);

    var employee = getEmployees().find(function(emp) { return emp.id === employeeId; });
    var task = getTaskById(taskId);

    if (task && window.DataLayer && typeof window.DataLayer.updateTask === 'function') {
      task.assigneeId = employeeId;
      task.employeeName = employee ? employee.name : (task.employeeName || '');
      window.DataLayer.updateTask(task);
    }

    var projects = getProjects();
    projects.forEach(function(project) {
      (project.tasks || []).forEach(function(projectTask) {
        if (projectTask.id === taskId) {
          projectTask.employeeName = employee ? employee.name : '';
          if (!projectTask.assigneeId) projectTask.assigneeId = employeeId;
        }
      });

      if (window.DataLayer && typeof window.DataLayer.updateProject === 'function') {
        window.DataLayer.updateProject(project);
      }
    });

    createNotification('Aufgabe wurde ' + (employee ? employee.name : 'dem Teammitglied') + ' zugewiesen.');
    return true;
  }

  function closeModal() {
    var overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    if (overlay._escHandler) {
      document.removeEventListener('keydown', overlay._escHandler);
    }

    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function showConfirmModal(title, contentHtml, onConfirm, buttons) {
    closeModal();

    var overlay = document.createElement('div');
    overlay.id = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--overlay-bg,rgba(0,0,0,0.5));z-index:9998;display:flex;align-items:center;justify-content:center;padding:1rem;';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card,#fff);color:var(--text-primary,#111);border:1px solid var(--border-color,#d1d5db);border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:84vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

    var btns = (buttons && buttons.length ? buttons.slice() : ['OK', 'Abbrechen']);
    if (btns.length === 1) btns.push('Abbrechen');

    modal.innerHTML = '<h3 style="margin:0 0 14px;">' + escapeHtml(title) + '</h3>' + contentHtml;

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;';

    btns.forEach(function(label, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = index === 0 ? 'btn btn-primary' : 'btn btn-secondary';
      btn.textContent = label;
      if (index === 0) {
        btn.addEventListener('click', function() { onConfirm(); });
      } else {
        btn.addEventListener('click', closeModal);
      }
      row.appendChild(btn);
    });

    modal.appendChild(row);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(event) {
      if (event.target === overlay) closeModal();
    });

    var onEsc = function(event) {
      if (event.key === 'Escape') closeModal();
    };

    overlay._escHandler = onEsc;
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(overlay);
  }

  function addEmployee() {
    if (!canManageEmployees()) {
      alert('Nur Administratoren koennen Mitarbeiter anlegen.');
      return;
    }

    var auth = getAuthManager();
    var defaultPages = ['dashboard', 'projects', 'kanban', 'calendar', 'quicktask'];
    showConfirmModal(
      'Neuen Mitarbeiter hinzufuegen',
      '<div class="modal-form-stack">' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Name<br>' +
          '<input id="emp_name" type="text" placeholder="Vorname Nachname" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;" required></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Rolle<br>' +
          '<select id="emp_role" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
            '<option value="">- Rolle waehlen -</option>' +
            '<option value="Project Lead">Project Lead</option>' +
            '<option value="Developer">Developer</option>' +
            '<option value="Designer">Designer</option>' +
            '<option value="DevOps">DevOps</option>' +
            '<option value="QA">QA</option>' +
            '<option value="Consultant">Consultant</option>' +
          '</select></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Zugriffsebene<br>' +
          '<select id="emp_access_level" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
            '<option value="employee" selected>Mitarbeiter</option>' +
            '<option value="admin">Administrator</option>' +
          '</select></label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--text-secondary);">' +
          '<input id="emp_login_enabled" type="checkbox"> Login aktivieren' +
        '</label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Login-Name<br>' +
          '<input id="emp_login_username" type="text" placeholder="z. B. max.mustermann" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Passwort<br>' +
          '<input id="emp_login_password" type="password" placeholder="Passwort fuer Login" autocomplete="new-password" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<div class="employee-permission-editor">' + buildPermissionEditorHtml('new-employee', defaultPages, false, true) + '</div>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Verfuegbarkeit<br>' +
          '<select id="emp_availability" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
            '<option value="Verfügbar">Verfuegbar</option>' +
            '<option value="Belastet">Belastet</option>' +
            '<option value="Urlaub">Urlaub</option>' +
          '</select></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Aktuelle Taetigkeit<br>' +
          '<input id="emp_activity" type="text" placeholder="z. B. API-Refactoring" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Kapazitaet (Story-Points)<br>' +
          '<input id="emp_capacity" type="number" min="2" max="20" step="1" value="8" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Fokusbereiche<br>' +
          '<input id="emp_focus" type="text" placeholder="API, UI, Testautomatisierung" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">GitHub Profil<br>' +
          '<input id="emp_github_profile" type="text" placeholder="https://github.com/username oder @username" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">GitHub Private Access Token (optional)<br>' +
          '<input id="emp_github_pat" type="password" placeholder="ghp_... oder fine-grained token" autocomplete="off" spellcheck="false" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">GitHub Aliase<br>' +
          '<input id="emp_github_aliases" type="text" placeholder="optional: alter username, Commit-Name" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
      '</div>',
      function() {
        var name = (document.getElementById('emp_name').value || '').trim();
        var role = (document.getElementById('emp_role').value || '').trim();
        var accessLevel = (document.getElementById('emp_access_level').value || 'employee').trim();
        var loginEnabled = !!document.getElementById('emp_login_enabled').checked;
        var loginUsername = (document.getElementById('emp_login_username').value || '').trim();
        var loginPassword = (document.getElementById('emp_login_password').value || '').trim();
        var selectedPages = Array.prototype.slice.call(document.querySelectorAll('input[data-field="page-permission"][data-scope="new-employee"]:checked')).map(function(input) {
          return input.getAttribute('data-page') || '';
        }).filter(Boolean);
        var availability = (document.getElementById('emp_availability').value || 'Verfügbar').trim();
        var activity = (document.getElementById('emp_activity').value || '').trim();
        var cap = Number(document.getElementById('emp_capacity').value || 8);
        var focus = (document.getElementById('emp_focus').value || '').split(',').map(function(item) { return item.trim(); }).filter(Boolean);
        var githubProfile = (document.getElementById('emp_github_profile').value || '').trim();
        var githubPat = (document.getElementById('emp_github_pat').value || '').trim();
        var githubAliases = (document.getElementById('emp_github_aliases').value || '').split(',').map(function(item) { return item.trim(); }).filter(Boolean);

        if (!name || !role) {
          alert('Name und Rolle sind erforderlich.');
          return;
        }

        var finalizeCreate = function(authData) {
          var employees = getEmployees();
          employees.push(normalizeEmployee({
            id: generateId('emp'),
            name: name,
            role: role,
            availability: availability,
            currentActivity: activity,
            capacityPoints: cap,
            focusAreas: focus,
            github: {
              profileUrl: githubProfile,
              privateAccessToken: githubPat,
              aliases: githubAliases
            },
            auth: authData || undefined,
            projectId: null
          }));

          setEmployees(employees);
          createNotification(name + ' wurde als neues Teammitglied erfasst.');
          closeModal();
          renderEmployeeList('employee-list');
        };

        if (auth && typeof auth.buildEmployeeAuth === 'function') {
          auth.buildEmployeeAuth({ name: name }, {
            accessLevel: accessLevel,
            loginEnabled: loginEnabled,
            username: loginUsername || name,
            password: loginPassword,
            pages: selectedPages
          }).then(finalizeCreate).catch(function(err) {
            alert(err && err.message ? err.message : 'Login konnte nicht gespeichert werden.');
          });
          return;
        }

        finalizeCreate(null);
      },
      ['Hinzufuegen']
    );
  }

  function showAssignTaskModal(employeeId, employeeName, employeeRole) {
    if (!canManageEmployees()) {
      alert('Nur Administratoren koennen Aufgaben zuweisen.');
      return;
    }

    var allTasks = buildUnifiedTaskCollection().filter(function(task) {
      return task.status !== 'done';
    });

    if (!allTasks.length) {
      alert('Keine offenen Aufgaben vorhanden.');
      return;
    }

    var taskOptions = allTasks.map(function(task) {
      var assigned = task.assigneeId ? ' [zugewiesen]' : '';
      return '<option value="' + escapeHtml(task.id || '') + '">' +
        escapeHtml(task.title || 'Ohne Titel') + ' [' + escapeHtml(statusLabel(task.status)) + ']' + assigned +
        (task.projectName ? ' - ' + escapeHtml(task.projectName) : '') +
      '</option>';
    }).join('');

    showConfirmModal(
      'Aufgabe zuweisen: ' + (employeeName || 'Mitarbeiter'),
      '<div class="modal-form-stack">' +
        '<p class="modal-hint"><small>Rolle: <strong>' + escapeHtml(employeeRole || '-') + '</strong></small></p>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Aufgabe<br>' +
          '<select id="assign_task" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
            '<option value="">- Aufgabe waehlen -</option>' + taskOptions +
          '</select>' +
        '</label>' +
      '</div>',
      function() {
        var taskId = document.getElementById('assign_task').value;
        if (!taskId) {
          alert('Bitte eine Aufgabe auswaehlen.');
          return;
        }

        assignTaskToEmployee(taskId, employeeId);
        closeModal();
        renderEmployeeList('employee-list');
      },
      ['Zuweisen']
    );
  }

  function showGitHubTokenModal(employeeId) {
    if (!ensureCanEditEmployeeProfile(employeeId)) return;

    var employee = getEmployees().find(function(item) { return item.id === employeeId; });
    if (!employee) {
      alert('Mitarbeiter nicht gefunden.');
      return;
    }

    var github = normalizeGitHubProfile(employee.github, employee.name);

    showConfirmModal(
      'GitHub Token hinterlegen: ' + (employee.name || 'Mitarbeiter'),
      '<div class="modal-form-stack">' +
        '<p class="modal-hint"><small>Optional fuer private Repositories und hoehere GitHub API Limits.</small></p>' +
        '<p class="modal-hint"><small>Empfohlene Berechtigungen: Fine-grained Token mit Repository <strong>Metadata: Read-only</strong> und <strong>Contents: Read-only</strong>; bei Classic Token fuer private Repos Scope <strong>repo</strong>.</small></p>' +
        '<p class="modal-hint"><small>Token erstellen: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained Token</a> oder <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">Classic Token</a>.</small></p>' +
        '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Private Access Token<br>' +
          '<input id="emp_github_pat_modal" type="password" value="' + escapeHtml(github.privateAccessToken || '') + '" placeholder="ghp_... oder fine-grained token" autocomplete="off" spellcheck="false" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-secondary);">' +
          '<input id="emp_github_pat_toggle" type="checkbox"> Token anzeigen' +
        '</label>' +
      '</div>',
      function() {
        var tokenInput = document.getElementById('emp_github_pat_modal');
        var token = tokenInput ? String(tokenInput.value || '').trim() : '';

        updateEmployeeProfile(employeeId, {
          github: {
            privateAccessToken: token
          }
        });

        createNotification('GitHub PAT wurde gespeichert.');
        closeModal();
        renderEmployeeList('employee-list');
      },
      ['Speichern']
    );

    var toggle = document.getElementById('emp_github_pat_toggle');
    var input = document.getElementById('emp_github_pat_modal');
    if (toggle && input) {
      toggle.addEventListener('change', function() {
        input.type = this.checked ? 'text' : 'password';
      });
    }
  }

  function getAvailableEmployees(role) {
    return getEmployees().filter(function(emp) {
      if (role && emp.role !== role) return false;
      if (emp.availability === 'Urlaub') return false;
      return true;
    });
  }

  function clearDropHighlights(page) {
    (page || document).querySelectorAll('.employee-task-list.drop-ready').forEach(function(node) {
      node.classList.remove('drop-ready');
    });
    (page || document).querySelectorAll('.employee-task-item.dragging-task').forEach(function(node) {
      node.classList.remove('dragging-task');
    });
  }

  function uploadEmployeeAvatar(employeeId) {
    if (!canEditEmployeeProfile(employeeId)) return;

    var employees = getEmployees();
    var employee = employees.find(function(emp) { return emp.id === employeeId; });
    if (!employee) return;

    var hasGitHubAvatar = !!(employee.github && (employee.github.username || employee.github.profileUrl));
    var hasCustomAvatar = !!(employee.customAvatarBase64 && String(employee.customAvatarBase64).trim());

    // If there's a custom avatar, offer to reset or change it
    if (hasCustomAvatar) {
      var options = [];
      options.push('Neues Bild hochladen');
      if (hasGitHubAvatar) {
        options.push('Zurück zu GitHub-Profil');
      }
      options.push('Abbrechen');

      var choice = window.confirm(
        hasGitHubAvatar 
          ? 'Neues Bild hochladen?\n\n(Drücke OK für neues Bild, oder ABBRECHEN um zu GitHub-Profil zurückzukehren)'
          : 'Neues Bild hochladen?'
      );

      if (!choice) {
        if (hasGitHubAvatar) {
          updateEmployeeProfile(employeeId, {
            customAvatarBase64: ''
          });
          createNotification('Avatar zurückgesetzt auf GitHub-Profil.');
          renderEmployeeList('employee-list');
        }
        return;
      }
    }

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', function(event) {
      var file = event.target.files[0];
      if (!file) return;

      // Validate file size (max 2MB)
      var maxSize = 2 * 1024 * 1024;
      if (file.size > maxSize) {
        alert('Datei ist zu groß. Maximale Größe: 2MB');
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Bitte wählen Sie eine Bilddatei aus.');
        return;
      }

      var reader = new FileReader();
      reader.onload = function(e) {
        var base64Data = e.target.result;
        updateEmployeeProfile(employeeId, {
          customAvatarBase64: base64Data
        });
        createNotification('Profilbild wurde aktualisiert.');
        renderEmployeeList('employee-list');
      };
      reader.onerror = function() {
        alert('Fehler beim Lesen der Datei.');
      };
      reader.readAsDataURL(file);
    });

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  function wireControls() {
    if (isWired) return;
    isWired = true;

    var page = document.getElementById('employees');
    if (!page) return;

    var addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
      addBtn.addEventListener('click', addEmployee);
    }

    var emptyStateAddHandler = function(event) {
      if (event.target && event.target.id === 'empty-state-add-employee') {
        addEmployee();
      }
    };
    page.addEventListener('click', emptyStateAddHandler);

    var searchInput = document.getElementById('employee-filter-search');
    var roleFilter = document.getElementById('employee-filter-role');
    var availFilter = document.getElementById('employee-filter-availability');
    var loadFilter = document.getElementById('employee-filter-load');
    var sortSelect = document.getElementById('employee-sort');

    function triggerRender() {
      renderEmployeeList('employee-list');
    }

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        FILTER_STATE.search = this.value || '';
        triggerRender();
      });
    }

    if (roleFilter) {
      roleFilter.addEventListener('change', function() {
        FILTER_STATE.role = this.value || '';
        triggerRender();
      });
    }

    if (availFilter) {
      availFilter.addEventListener('change', function() {
        FILTER_STATE.availability = this.value || '';
        triggerRender();
      });
    }

    if (loadFilter) {
      loadFilter.addEventListener('change', function() {
        FILTER_STATE.loadBand = this.value || 'all';
        triggerRender();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', function() {
        FILTER_STATE.sort = this.value || 'load-desc';
        triggerRender();
      });
    }

    page.addEventListener('input', function(event) {
      var target = event.target;
      if (!target || !target.dataset) return;

      if (target.dataset.field === 'capacity') {
        var output = document.getElementById('employee-capacity-output-' + target.dataset.empId);
        if (output) output.textContent = target.value;
      }
    });

    page.addEventListener('change', function(event) {
      var target = event.target;
      if (!target || !target.dataset) return;

      if (target.dataset.field === 'availability') {
        updateAvailability(target.dataset.empId, target.value);
        renderEmployeeList('employee-list');
        return;
      }

      if (target.dataset.field === 'access-level') {
        var panel = target.closest('.employee-auth-card');
        if (!panel) return;
        var isAdmin = target.value === 'admin';
        var permissionPanel = panel.querySelector('.employee-permission-panel');
        if (permissionPanel) permissionPanel.open = !isAdmin;
        panel.querySelectorAll('input[data-field="page-permission"]').forEach(function(input) {
          input.disabled = isAdmin;
        });
      }
    });

    page.addEventListener('dragstart', function(event) {
      if (!canManageEmployees()) return;
      var taskItem = event.target.closest('.employee-task-item[data-task-id]');
      if (!taskItem) return;

      DND_STATE.taskId = taskItem.dataset.taskId || '';
      DND_STATE.sourceEmployeeId = taskItem.dataset.sourceEmpId || '';
      taskItem.classList.add('dragging-task');

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', DND_STATE.taskId);
      }
    });

    page.addEventListener('dragend', function() {
      clearDropHighlights(page);
      DND_STATE.taskId = '';
      DND_STATE.sourceEmployeeId = '';
    });

    page.addEventListener('dragover', function(event) {
      if (!canManageEmployees()) return;
      var dropList = event.target.closest('.employee-task-list[data-drop-emp-id]');
      if (!dropList || !DND_STATE.taskId) return;
      event.preventDefault();
      clearDropHighlights(page);
      dropList.classList.add('drop-ready');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });

    page.addEventListener('dragleave', function(event) {
      var dropList = event.target.closest('.employee-task-list[data-drop-emp-id]');
      if (!dropList) return;

      if (event.relatedTarget && dropList.contains(event.relatedTarget)) return;
      dropList.classList.remove('drop-ready');
    });

    page.addEventListener('drop', function(event) {
      if (!canManageEmployees()) return;
      var dropList = event.target.closest('.employee-task-list[data-drop-emp-id]');
      if (!dropList || !DND_STATE.taskId) return;
      event.preventDefault();

      var targetEmployeeId = dropList.dataset.dropEmpId || '';
      var taskId = DND_STATE.taskId;
      var sourceEmployeeId = DND_STATE.sourceEmployeeId;

      clearDropHighlights(page);

      if (!targetEmployeeId || !taskId || targetEmployeeId === sourceEmployeeId) {
        DND_STATE.taskId = '';
        DND_STATE.sourceEmployeeId = '';
        return;
      }

      var success = assignTaskToEmployee(taskId, targetEmployeeId);
      if (success) {
        createNotification('Aufgabe wurde per Drag-and-Drop umverteilt.');
      }

      DND_STATE.taskId = '';
      DND_STATE.sourceEmployeeId = '';
      renderEmployeeList('employee-list');
    });

    page.addEventListener('click', function(event) {
      var trigger = event.target.closest('[data-action]');
      if (!trigger) return;

      var action = trigger.dataset.action;
      var empId = trigger.dataset.empId;

      if (action === 'upload-avatar') {
        uploadEmployeeAvatar(empId);
      }

      if (action === 'assign-task') {
        var employee = getEmployees().find(function(item) { return item.id === empId; });
        if (!employee) return;
        showAssignTaskModal(employee.id, employee.name, employee.role);
      }

      if (action === 'edit-github-token') {
        showGitHubTokenModal(empId);
      }

      if (action === 'remove-employee') {
        confirmRemoveEmployee(empId);
      }

      if (action === 'save-profile') {
        var activityInput = page.querySelector('input[data-field="activity"][data-emp-id="' + empId + '"]');
        var focusInput = page.querySelector('input[data-field="focus"][data-emp-id="' + empId + '"]');
        var capacityInput = page.querySelector('input[data-field="capacity"][data-emp-id="' + empId + '"]');
        var githubProfileInput = page.querySelector('input[data-field="github-profile"][data-emp-id="' + empId + '"]');
        var githubAliasesInput = page.querySelector('input[data-field="github-aliases"][data-emp-id="' + empId + '"]');
        var accessLevelInput = page.querySelector('select[data-field="access-level"][data-emp-id="' + empId + '"]');
        var loginEnabledInput = page.querySelector('input[data-field="login-enabled"][data-emp-id="' + empId + '"]');
        var loginUsernameInput = page.querySelector('input[data-field="login-username"][data-emp-id="' + empId + '"]');
        var loginPasswordInput = page.querySelector('input[data-field="login-password"][data-emp-id="' + empId + '"]');
        var selectedPages = Array.prototype.slice.call(page.querySelectorAll('input[data-field="page-permission"][data-scope="' + empId + '"]:checked')).map(function(input) {
          return input.getAttribute('data-page') || '';
        }).filter(Boolean);

        var finalizeSave = function(authData) {
          updateEmployeeProfile(empId, {
            currentActivity: activityInput ? activityInput.value : '',
            focusAreas: focusInput ? focusInput.value.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : [],
            capacityPoints: capacityInput ? capacityInput.value : 8,
            github: {
              profileUrl: githubProfileInput ? githubProfileInput.value : '',
              aliases: githubAliasesInput ? githubAliasesInput.value.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : []
            },
            auth: authData || undefined
          });

          createNotification('Mitarbeiterprofil wurde aktualisiert.');
          renderEmployeeList('employee-list');
        };

        var authManager = getAuthManager();
        var employee = getEmployees().find(function(item) { return item.id === empId; }) || { id: empId };
        if (authManager && typeof authManager.buildEmployeeAuth === 'function') {
          authManager.buildEmployeeAuth(employee, {
            accessLevel: accessLevelInput ? accessLevelInput.value : 'employee',
            loginEnabled: !!(loginEnabledInput && loginEnabledInput.checked),
            username: loginUsernameInput ? loginUsernameInput.value : '',
            password: loginPasswordInput ? loginPasswordInput.value : '',
            pages: selectedPages
          }).then(finalizeSave).catch(function(err) {
            alert(err && err.message ? err.message : 'Login konnte nicht gespeichert werden.');
          });
          return;
        }

        finalizeSave(null);
      }

      if (action === 'github-sync') {
        syncEmployeeGitHubActivity(empId).catch(function(err) {
          alert(err && err.message ? err.message : 'GitHub Sync fehlgeschlagen.');
        });
      }
    });

    if (window.DataLayer && typeof window.DataLayer.on === 'function') {
      window.DataLayer.on('dataChanged', function() {
        renderEmployeeList('employee-list');
      });
    }
  }

  function init() {
    wireControls();
    if (document.getElementById('employee-list')) {
      renderEmployeeList('employee-list');
    }
  }

  function exposeObjectNamespace() {
    var target = window.EmployeeManager || {};
    var methods = {
      renderEmployeeList: renderEmployeeList,
      addEmployee: addEmployee,
      updateAvailability: updateAvailability,
      showAssignTaskModal: showAssignTaskModal,
      assignTaskToEmployee: assignTaskToEmployee,
      getAvailableEmployees: getAvailableEmployees,
      closeModal: closeModal,
      escapeHtml: escapeHtml,
      updateEmployeeProfile: updateEmployeeProfile,
      removeEmployee: removeEmployee,
      syncGitHubActivity: syncEmployeeGitHubActivity
    };

    Object.keys(methods).forEach(function(name) {
      target[name] = methods[name];
      window[NAMESPACE + '.' + name] = methods[name];
    });

    window.EmployeeManager = target;
  }

  exposeObjectNamespace();

  window.EmployeesModule = {
    render: function() {
      renderEmployeeList('employee-list');
    },
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

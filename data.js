/* ========================================
   Projekt-Dashboard — Data Layer (data.js)
   localStorage Wrapper mit JSON-Speicherung
   LEERE Initialisierung — keine Demo-Daten
   ======================================== */

(function () {
  'use strict';

  /* ---------- Storage Keys ---------- */
  var KEYS = {
    projects:       'pd_projects',
    tasks:          'pd_tasks',
    employees:      'pd_employees',
    labels:         'pd_labels',
    templates:      'pd_templates',
    releases:       'pd_releases',
    notifications:  'pd_notifications',
    calendarEvents: 'pd_calendar_events'
  };

  var nativeStorageApi = {
    getItem: window.localStorage.getItem.bind(window.localStorage),
    setItem: window.localStorage.setItem.bind(window.localStorage),
    removeItem: window.localStorage.removeItem.bind(window.localStorage),
    clear: window.localStorage.clear.bind(window.localStorage),
    key: window.localStorage.key.bind(window.localStorage)
  };

  var memoryStorage = Object.create(null);
  var db = null;
  var dbReadyPromise = null;
  var AUTH_SESSION_KEYS = ['pd_auth_session_v1', 'pd_auth_session_persist_v1'];

  function isAuthSessionKey(key) {
    var normalizedKey = normalizeStorageKey(key);
    return AUTH_SESSION_KEYS.indexOf(normalizedKey) !== -1;
  }
  var dbFileHandle = null;
  var dbFileName = 'projekt-dashboard.sqlite';
  var dbReady = false;
  var sqlModule = null;
  var storagePatched = false;
  var durableFilePath = 'data/project-data.json';
  var durableFileCandidates = [
    'data/project-data.json',
    'data/projekt-dashboard.backup.json'
  ];
  var remoteKvPath = '/api/kv';
  var remoteKvFallbackPaths = [
    '/api/kv',
    'http://127.0.0.1:8766/api/kv',
    'http://localhost:8766/api/kv'
  ];
  var remoteKvEnabled = true;
  var REMOTE_ONLY_MODE = true;
  var remoteKvReachable = false;
  var remoteKvActivePath = '';
  var remoteKvLastCheckedAt = '';
  var remoteKvLastError = '';
  var remoteKvSnapshotEtag = '';
  var remoteKvGetInFlight = null;
  var startupReadyPromise = null;
  var remoteSyncTimer = null;
  var remoteSyncInFlight = false;
  var remoteStreamSource = null;
  var remoteStreamReconnectTimer = null;
  var remoteStreamEventQueued = false;
  var REMOTE_SYNC_INTERVAL_MS = 8000;
  var REMOTE_STREAM_RETRY_MS = 3000;
  var pendingLocalWritesCount = 0;
  var dirtyRemoteSyncKeys = Object.create(null);
  var DIRTY_REMOTE_SYNC_STATE_KEY = '__pd_remote_dirty_sync_v1';

  function beginLocalWrite() {
    pendingLocalWritesCount += 1;
  }

  function endLocalWrite() {
    pendingLocalWritesCount = Math.max(0, pendingLocalWritesCount - 1);
  }

  function hasPendingLocalWrites() {
    return pendingLocalWritesCount > 0;
  }

  function loadDirtyRemoteSyncState() {
    if (REMOTE_ONLY_MODE) return;
    try {
      var raw = nativeStorageApi.getItem(DIRTY_REMOTE_SYNC_STATE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(String(raw));
      if (!parsed || typeof parsed !== 'object') return;
      Object.keys(parsed).forEach(function (key) {
        var mode = parsed[key] === 'deleted' ? 'deleted' : 'set';
        dirtyRemoteSyncKeys[normalizeStorageKey(key)] = mode;
      });
    } catch (_err) {}
  }

  function persistDirtyRemoteSyncState() {
    if (REMOTE_ONLY_MODE) return;
    try {
      var keys = Object.keys(dirtyRemoteSyncKeys);
      if (keys.length === 0) {
        nativeStorageApi.removeItem(DIRTY_REMOTE_SYNC_STATE_KEY);
        return;
      }
      nativeStorageApi.setItem(DIRTY_REMOTE_SYNC_STATE_KEY, JSON.stringify(dirtyRemoteSyncKeys));
    } catch (_err) {}
  }

  function markKeyDirtyForRemoteSync(key, mode) {
    var normalizedKey = normalizeStorageKey(key);
    if (!normalizedKey || isAuthSessionKey(normalizedKey)) return;
    dirtyRemoteSyncKeys[normalizedKey] = mode === 'deleted' ? 'deleted' : 'set';
    persistDirtyRemoteSyncState();
  }

  function clearDirtyKeyForRemoteSync(key) {
    var normalizedKey = normalizeStorageKey(key);
    if (!normalizedKey) return;
    delete dirtyRemoteSyncKeys[normalizedKey];
    persistDirtyRemoteSyncState();
  }

  function markAllKeysDirtyForRemoteSync(mode) {
    Object.keys(memoryStorage).forEach(function (key) {
      if (isAuthSessionKey(key)) return;
      markKeyDirtyForRemoteSync(key, mode);
    });
  }

  function getStorageStatus() {
    return {
      remoteEnabled: remoteKvEnabled,
      remoteReachable: remoteKvReachable,
      remotePath: remoteKvActivePath || remoteKvPath,
      remoteOnly: REMOTE_ONLY_MODE,
      localMirror: !REMOTE_ONLY_MODE,
      fallbackActive: REMOTE_ONLY_MODE ? false : !remoteKvReachable,
      lastCheckedAt: remoteKvLastCheckedAt,
      lastError: remoteKvLastError
    };
  }

  function emitStorageStatusChanged() {
    emit('storageStatusChanged', getStorageStatus());
  }

  function getRemoteKvCandidates() {
    var list = [];
    if (remoteKvPath) list.push(remoteKvPath);

    var isLocalHost = false;
    try {
      var hostname = window.location && window.location.hostname ? String(window.location.hostname) : '';
      isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    } catch (_err) {
      isLocalHost = false;
    }

    if (isLocalHost) {
      remoteKvFallbackPaths.forEach(function (path) {
        if (path) list.push(path);
      });
    }

    if (window.location && window.location.origin) {
      list.push(window.location.origin.replace(/\/$/, '') + '/api/kv');
    }
    return list.filter(function (item, idx) {
      return !!item && list.indexOf(item) === idx;
    });
  }

  function getStoredAdminPin() {
    try {
      if (window.ProjektDashboardSecurity && typeof window.ProjektDashboardSecurity.readPin === 'function') {
        return String(window.ProjektDashboardSecurity.readPin() || '').trim();
      }
    } catch (_err) {}

    try {
      return String(window.sessionStorage.getItem('pd_admin_pin') || '').trim();
    } catch (_err2) {
      return '';
    }
  }

  function getRemoteKvStreamCandidates() {
    var candidates = getRemoteKvCandidates();
    return candidates.map(function (endpoint) {
      return String(endpoint || '').replace(/\/api\/kv$/, '/api/kv/stream');
    }).filter(function (item, idx, arr) {
      return !!item && arr.indexOf(item) === idx;
    });
  }

  function buildRemoteKvStreamUrl(baseUrl) {
    var endpoint = String(baseUrl || '');
    var pin = getStoredAdminPin();
    if (!pin) return endpoint;

    var separator = endpoint.indexOf('?') === -1 ? '?' : '&';
    return endpoint + separator + 'pin=' + encodeURIComponent(pin);
  }

  function fetchRemoteKv(method, payload) {
    if (!remoteKvEnabled || typeof fetch !== 'function') {
      return Promise.resolve({ ok: false, path: '', payload: null });
    }
    if (method === 'GET' && remoteKvGetInFlight) {
      return remoteKvGetInFlight;
    }

    var candidates = getRemoteKvCandidates();
    if (remoteKvActivePath) {
      candidates = [remoteKvActivePath].concat(candidates.filter(function (item) { return item !== remoteKvActivePath; }));
    }

    var requestOptions = {
      method: method,
      cache: 'no-store',
      headers: {}
    };
    var receivedEtag = '';
    if (method === 'GET' && remoteKvSnapshotEtag) {
      requestOptions.headers['If-None-Match'] = remoteKvSnapshotEtag;
    }
    if (payload !== undefined) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(payload);
    }

    function tryNext(index) {
      if (index >= candidates.length) {
        remoteKvLastCheckedAt = new Date().toISOString();
        remoteKvLastError = 'Kein KV-Endpunkt erreichbar';
        remoteKvReachable = false;
        emitStorageStatusChanged();
        return Promise.resolve({ ok: false, path: '', payload: null });
      }

      var endpoint = candidates[index];
      return fetch(endpoint, requestOptions)
        .then(function (res) {
          receivedEtag = res.headers && typeof res.headers.get === 'function'
            ? String(res.headers.get('ETag') || '')
            : '';
          if (res.status === 304) {
            return { __notModified: true };
          }
          if (res.status === 401 || res.status === 403) {
            return res.json().catch(function () { return {}; }).then(function (body) {
              return {
                __authError: true,
                message: body && body.error
                  ? String(body.error)
                  : 'Admin-PIN erforderlich oder ungueltig.'
              };
            });
          }
          if (!res.ok) return null;
          return res.json().catch(function () { return {}; });
        })
        .then(function (json) {
          if (json && json.__authError) {
            remoteKvLastCheckedAt = new Date().toISOString();
            remoteKvLastError = json.message || 'Admin-PIN erforderlich oder ungueltig.';
            remoteKvReachable = false;
            emitStorageStatusChanged();
            return { ok: false, path: endpoint, payload: null, authRequired: true };
          }

          if (json && json.__notModified) {
            remoteKvLastCheckedAt = new Date().toISOString();
            remoteKvLastError = '';
            remoteKvReachable = true;
            remoteKvActivePath = endpoint;
            emitStorageStatusChanged();
            return { ok: true, path: endpoint, payload: null, notModified: true };
          }

          if (json === null) return tryNext(index + 1);
          remoteKvLastCheckedAt = new Date().toISOString();
          remoteKvLastError = '';
          remoteKvReachable = true;
          remoteKvActivePath = endpoint;
          if (method === 'GET') {
            remoteKvSnapshotEtag = receivedEtag;
          }
          emitStorageStatusChanged();
          return { ok: true, path: endpoint, payload: json };
        })
        .catch(function () {
          return tryNext(index + 1);
        });
    }

    var requestPromise = tryNext(0);
    if (method !== 'GET') return requestPromise;

    remoteKvGetInFlight = requestPromise.finally(function () {
      remoteKvGetInFlight = null;
    });
    return remoteKvGetInFlight;
  }

  function listNativeManagedKeys() {
    var set = Object.create(null);
    Object.keys(KEYS).forEach(function (name) {
      if (!isAuthSessionKey(KEYS[name])) set[KEYS[name]] = true;
    });

    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && /^pd_/.test(key) && !isAuthSessionKey(key)) set[key] = true;
      }
    } catch (_e) {}

    return Object.keys(set);
  }

  function normalizeStorageKey(key) {
    return String(key || '');
  }

  function normalizeStorageValue(value) {
    if (value === undefined || value === null) return null;
    return String(value);
  }

  function isSensitiveStorageKey(key) {
    return key === KEYS.employees;
  }

  function sanitizeEmployeesForLocalStorageValue(value) {
    if (value === null || value === undefined) return null;

    try {
      var parsed = JSON.parse(String(value));
      if (!Array.isArray(parsed)) return String(value);

      var sanitized = parsed.map(function (employee) {
        var next = employee && typeof employee === 'object'
          ? JSON.parse(JSON.stringify(employee))
          : employee;

        if (!next || typeof next !== 'object') return next;
        if (!next.auth || typeof next.auth !== 'object') return next;
        if (!next.auth.login || typeof next.auth.login !== 'object') return next;

        var hash = String(next.auth.login.passwordHash || '').trim();
        next.auth.login.passwordSet = !!(hash || next.auth.login.passwordSet);
        next.auth.login.passwordHash = '';
        return next;
      });

      return JSON.stringify(sanitized);
    } catch (_err) {
      return String(value);
    }
  }

  function toLocalPersistValue(key, value) {
    if (value === null || value === undefined) return null;
    if (!isSensitiveStorageKey(key)) return String(value);
    return sanitizeEmployeesForLocalStorageValue(value);
  }

  function snapshotLegacyStorage() {
    if (REMOTE_ONLY_MODE) return;
    try {
      var legacyKeys = listNativeManagedKeys();
      for (var i = 0; i < window.localStorage.length; i++) {
        var key = window.localStorage.key(i);
        if (key && /^pd_/.test(key) && legacyKeys.indexOf(key) === -1) legacyKeys.push(key);
      }
      legacyKeys.forEach(function (key) {
        var value = nativeStorageApi.getItem(key);
        if (value !== null) {
          var normalizedKey = normalizeStorageKey(key);
          var localValue = toLocalPersistValue(normalizedKey, value);
          memoryStorage[normalizedKey] = localValue;
          if (localValue !== value) {
            try { nativeStorageApi.setItem(normalizedKey, localValue); } catch (_writeErr) {}
          }
        }
      });
    } catch (e) {
      console.warn('[DataLayer] Legacy storage migration failed:', e);
    }
  }

  function getStorageValue(key) {
    var normalizedKey = normalizeStorageKey(key);
    if (isAuthSessionKey(normalizedKey)) {
      try {
        return nativeStorageApi.getItem(normalizedKey);
      } catch (_e) {
        return null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(memoryStorage, normalizedKey)) {
      return memoryStorage[normalizedKey];
    }
    if (REMOTE_ONLY_MODE) {
      return null;
    }
    try {
      var nativeValue = nativeStorageApi.getItem(normalizedKey);
      if (nativeValue !== null && nativeValue !== undefined) {
        memoryStorage[normalizedKey] = nativeValue;
        return nativeValue;
      }
    } catch (_e) {}
    return null;
  }

  function setStorageValue(key, value) {
    var normalizedKey = normalizeStorageKey(key);
    if (isAuthSessionKey(normalizedKey)) {
      var authValue = value === null || value === undefined ? null : normalizeStorageValue(value);
      try {
        if (authValue === null) nativeStorageApi.removeItem(normalizedKey);
        else nativeStorageApi.setItem(normalizedKey, authValue);
      } catch (_e) {}
      return true;
    }
    var normalizedValue = normalizeStorageValue(value);
    memoryStorage[normalizedKey] = normalizedValue;
    markKeyDirtyForRemoteSync(normalizedKey, 'set');

    if (REMOTE_ONLY_MODE) {
      beginLocalWrite();
      persistRemoteValueAsync(normalizedKey, normalizedValue).then(function (remoteOk) {
        if (remoteOk) clearDirtyKeyForRemoteSync(normalizedKey);
      }).finally(function () {
        endLocalWrite();
      });
      return true;
    }

    var localPersistValue = toLocalPersistValue(normalizedKey, normalizedValue);
    try {
      if (localPersistValue === null) nativeStorageApi.removeItem(normalizedKey);
      else nativeStorageApi.setItem(normalizedKey, localPersistValue);
    } catch (_e) {}
    beginLocalWrite();
    ensureDatabaseReady().then(function () {
      return persistValueAsync(normalizedKey, normalizedValue);
    }).finally(function () {
      endLocalWrite();
    });
    return true;
  }

  function removeStorageValue(key) {
    var normalizedKey = normalizeStorageKey(key);
    if (isAuthSessionKey(normalizedKey)) {
      try { nativeStorageApi.removeItem(normalizedKey); } catch (_e) {}
      return true;
    }
    delete memoryStorage[normalizedKey];
    markKeyDirtyForRemoteSync(normalizedKey, 'deleted');

    if (REMOTE_ONLY_MODE) {
      beginLocalWrite();
      persistRemoteValueAsync(normalizedKey, null).then(function (remoteOk) {
        if (remoteOk) clearDirtyKeyForRemoteSync(normalizedKey);
      }).finally(function () {
        endLocalWrite();
      });
      return true;
    }

    try { nativeStorageApi.removeItem(normalizedKey); } catch (_e) {}
    beginLocalWrite();
    persistValueAsync(normalizedKey, null).finally(function () {
      endLocalWrite();
    });
    return true;
  }

  function getStoredValue(key, fallback) {
    var raw = getStorageValue(key);
    return raw === null || raw === undefined ? fallback : raw;
  }

  function setStoredValue(key, value) {
    return setStorageValue(key, value);
  }

  function deleteStoredValue(key) {
    return removeStorageValue(key);
  }

  function clearStorageValues() {
    beginLocalWrite();
    markAllKeysDirtyForRemoteSync('deleted');
    Object.keys(memoryStorage).forEach(function (key) {
      if (isAuthSessionKey(key)) return;
      delete memoryStorage[key];
    });
    listNativeManagedKeys().forEach(function (key) {
      if (isAuthSessionKey(key)) return;
      try { nativeStorageApi.removeItem(key); } catch (_e) {}
    });

    if (REMOTE_ONLY_MODE) {
      clearRemoteValuesAsync().then(function (remoteOk) {
        if (remoteOk) {
          dirtyRemoteSyncKeys = Object.create(null);
        }
      }).finally(function () {
        endLocalWrite();
      });
      return true;
    }

    clearDatabaseValuesAsync().finally(function () {
      endLocalWrite();
    });
    clearRemoteValuesAsync();
    return true;
  }

  function patchStorageApi() {
    if (storagePatched) return;
    storagePatched = true;

    if (window.Storage && window.Storage.prototype) {
      var proto = window.Storage.prototype;
      proto.getItem = function (key) {
        return getStorageValue(key);
      };
      proto.setItem = function (key, value) {
        return setStorageValue(key, value);
      };
      proto.removeItem = function (key) {
        return removeStorageValue(key);
      };
      proto.clear = function () {
        return clearStorageValues();
      };
    }

    if (window.localStorage) {
      window.localStorage.getItem = function (key) {
        return getStorageValue(key);
      };
      window.localStorage.setItem = function (key, value) {
        return setStorageValue(key, value);
      };
      window.localStorage.removeItem = function (key) {
        return removeStorageValue(key);
      };
      window.localStorage.clear = function () {
        return clearStorageValues();
      };
    }
  }

  function ensureSqlJs() {
    if (sqlModule) return Promise.resolve(sqlModule);
    if (!window.initSqlJs) {
      return Promise.reject(new Error('sql.js wurde nicht geladen.'));
    }
    return window.initSqlJs({
      locateFile: function (file) {
        return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + file;
      }
    }).then(function (SQL) {
      sqlModule = SQL;
      return sqlModule;
    });
  }

  function createDatabaseSchema() {
    if (!db) return;
    try {
      db.run('CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT NOT NULL)');
    } catch (e) {
      console.error('[DataLayer] Fehler beim Erstellen des SQLite-Schemas:', e);
    }
  }

  function hydrateFromDatabase() {
    if (!db) return Promise.resolve();
    try {
      var result = db.exec('SELECT key, value FROM kv_store');
      var rows = result && result[0] ? result[0].values : [];
      rows.forEach(function (row) {
        var key = row[0];
        var value = row[1];
        if (key !== undefined && value !== undefined) {
          memoryStorage[key] = value;
        }
      });
      return Promise.resolve();
    } catch (e) {
      console.error('[DataLayer] Fehler beim Laden aus SQLite:', e);
      return Promise.resolve();
    }
  }

  function persistValueAsync(key, value) {
    if (!key) return Promise.resolve(false);

    if (REMOTE_ONLY_MODE) {
      return persistRemoteValueAsync(key, value).then(function (remoteOk) {
        if (remoteOk) clearDirtyKeyForRemoteSync(key);
        return !!remoteOk;
      });
    }

    return ensureDatabaseReady().then(function () {
      if (!db) return false;
      var localPersistValue = toLocalPersistValue(key, value);
      try {
        if (localPersistValue === null) {
          db.run('DELETE FROM kv_store WHERE key = ?', [key]);
        } else {
          db.run('INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)', [key, localPersistValue, new Date().toISOString()]);
        }
        return true;
      } catch (e) {
        console.warn('[DataLayer] Fehler beim Persistieren von ' + key + ':', e);
        return false;
      }
    }).then(function (localOk) {
      return persistRemoteValueAsync(key, value).then(function (remoteOk) {
        if (remoteOk) clearDirtyKeyForRemoteSync(key);
        return !!(localOk || remoteOk);
      });
    });
  }

  function clearDatabaseValuesAsync() {
    if (!db) return Promise.resolve(false);
    try {
      db.run('DELETE FROM kv_store');
      return Promise.resolve(true);
    } catch (e) {
      console.warn('[DataLayer] Fehler beim Leeren der SQLite-Tabelle:', e);
      return Promise.resolve(false);
    }
  }

  function persistRemoteValueAsync(key, value) {
    return fetchRemoteKv('POST', { key: key, value: value }).then(function (result) {
      return !!result.ok;
    });
  }

  function clearRemoteValuesAsync() {
    return fetchRemoteKv('POST', { clear: true }).then(function (result) {
      if (result.ok) {
        dirtyRemoteSyncKeys = Object.create(null);
        persistDirtyRemoteSyncState();
      }
      return !!result.ok;
    });
  }

  function rebuildLocalDatabaseFromMemory() {
    if (!db) return;
    db.run('DELETE FROM kv_store');
    Object.keys(memoryStorage).forEach(function (key) {
      var localValue = toLocalPersistValue(key, memoryStorage[key]);
      if (localValue === null || localValue === undefined) return;
      db.run('INSERT OR REPLACE INTO kv_store(key, value, updatedAt) VALUES (?, ?, ?)', [key, String(localValue), new Date().toISOString()]);
    });
  }

  function createStorageFingerprint(storageObj) {
    var source = storageObj && typeof storageObj === 'object' ? storageObj : {};
    var keys = Object.keys(source).sort();
    var parts = [];

    keys.forEach(function (key) {
      var value = source[key];
      if (value === null || value === undefined) return;
      parts.push(key + '=' + String(value));
    });

    return parts.join('\n');
  }

  function applyRemoteSnapshotPayload(payload) {
    var nextStorage = Object.create(null);
    var currentStorage = memoryStorage;
    var previousFingerprint = createStorageFingerprint(memoryStorage);

    Object.keys(payload).forEach(function (key) {
      var normalizedKey = normalizeStorageKey(key);
      if (isAuthSessionKey(normalizedKey)) return;
      var value = payload[key];
      if (value === null || value === undefined) return;
      nextStorage[normalizedKey] = normalizeStorageValue(value);
    });

    // Keep unsynced local writes authoritative until remote persistence succeeds.
    Object.keys(dirtyRemoteSyncKeys).forEach(function (key) {
      var mode = dirtyRemoteSyncKeys[key];
      if (mode === 'deleted') {
        delete nextStorage[key];
        return;
      }
      if (Object.prototype.hasOwnProperty.call(currentStorage, key)) {
        nextStorage[key] = currentStorage[key];
      }
    });

    var nextFingerprint = createStorageFingerprint(nextStorage);
    var changed = previousFingerprint !== nextFingerprint;
    if (!changed) return false;

    memoryStorage = nextStorage;

    if (REMOTE_ONLY_MODE) {
      return true;
    }

    listNativeManagedKeys().forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(memoryStorage, key)) return;
      try { nativeStorageApi.removeItem(key); } catch (_removeErr) {}
    });

    Object.keys(memoryStorage).forEach(function (key) {
      if (isAuthSessionKey(key)) return;
      try {
        var localValue = toLocalPersistValue(key, memoryStorage[key]);
        if (localValue === null) nativeStorageApi.removeItem(key);
        else nativeStorageApi.setItem(key, localValue);
      } catch (_writeErr) {}
    });

    rebuildLocalDatabaseFromMemory();
    return true;
  }

  function loadRemoteSnapshot() {
    return fetchRemoteKv('GET').then(function (result) {
      if (result && result.ok && result.notModified) {
        remoteKvReachable = true;
        emitStorageStatusChanged();
        return { ok: true, changed: false, authRequired: false };
      }
      if (!result.ok || !result.payload || typeof result.payload !== 'object') {
        remoteKvReachable = false;
        emitStorageStatusChanged();
        return { ok: false, changed: false, authRequired: !!(result && result.authRequired) };
      }

      // While local writes are still being flushed, do not hydrate from remote
      // to avoid restoring stale server state over fresh local task changes.
      if (hasPendingLocalWrites()) {
        remoteKvReachable = true;
        emitStorageStatusChanged();
        return { ok: true, changed: false, deferred: true, authRequired: false };
      }

      var payload = result.payload;
      var changed = applyRemoteSnapshotPayload(payload);
      remoteKvReachable = true;
      emitStorageStatusChanged();
      return { ok: true, changed: changed, authRequired: false };
    }).catch(function () {
      remoteKvReachable = false;
      remoteKvLastCheckedAt = new Date().toISOString();
      remoteKvLastError = 'Snapshot-Ladevorgang fehlgeschlagen';
      emitStorageStatusChanged();
      return { ok: false, changed: false, authRequired: false };
    });
  }

  function runStartupHydration() {
    if (startupReadyPromise) return startupReadyPromise;

    startupReadyPromise = Promise.resolve().then(function () {
      if (!REMOTE_ONLY_MODE) {
        return ensureDatabaseReady();
      }
      return true;
    }).then(function () {
      return loadRemoteSnapshot().then(function (snapshotResult) {
        hydrateCollections();

        if (REMOTE_ONLY_MODE) {
          return !!(snapshotResult && snapshotResult.ok);
        }

        if (snapshotResult && snapshotResult.ok) {
          return true;
        }

        return bootstrapFromDurableFileIfEmpty().then(function () {
          hydrateCollections();
          return true;
        });
      });
    }).then(function (hydrated) {
      emitDataChanged('hydrate', 'all');
      return hydrated;
    }).catch(function (err) {
      console.error('[DataLayer] Startup hydration failed:', err);
      emitDataChanged('hydrate', 'all');
      return false;
    });

    return startupReadyPromise;
  }

  function checkStorageHealth() {
    return fetchRemoteKv('GET').then(function (result) {
      return {
        ok: !!result.ok,
        status: getStorageStatus()
      };
    }).catch(function () {
      return {
        ok: false,
        status: getStorageStatus()
      };
    });
  }

  function refreshFromRemote() {
    return loadRemoteSnapshot().then(function (snapshotResult) {
      if (!snapshotResult || !snapshotResult.ok) return false;
      if (!snapshotResult.changed) return false;
      hydrateCollections();
      emitDataChanged('hydrate', 'all');
      return true;
    });
  }

  function runRemoteSyncTick() {
    if (remoteSyncInFlight) {
      remoteStreamEventQueued = true;
      return Promise.resolve(false);
    }

    remoteSyncInFlight = true;
    return refreshFromRemote().catch(function () {
      return false;
    }).finally(function () {
      remoteSyncInFlight = false;
      if (remoteStreamEventQueued) {
        remoteStreamEventQueued = false;
        runRemoteSyncTick();
      }
    });
  }

  function closeRemoteKvStream() {
    if (!remoteStreamSource) return;
    try {
      remoteStreamSource.close();
    } catch (_err) {}
    remoteStreamSource = null;
  }

  function scheduleRemoteKvStreamReconnect() {
    if (remoteStreamReconnectTimer) return;
    remoteStreamReconnectTimer = window.setTimeout(function () {
      remoteStreamReconnectTimer = null;
      startRemoteKvStream();
    }, REMOTE_STREAM_RETRY_MS);
  }

  function startRemoteKvStream() {
    if (!remoteKvEnabled || typeof window.EventSource !== 'function') return;
    if (remoteStreamSource) return;

    var pin = getStoredAdminPin();
    if (!pin) {
      scheduleRemoteKvStreamReconnect();
      return;
    }

    var streamCandidates = getRemoteKvStreamCandidates();
    if (!streamCandidates.length) {
      scheduleRemoteKvStreamReconnect();
      return;
    }

    var source = new window.EventSource(buildRemoteKvStreamUrl(streamCandidates[0]));
    remoteStreamSource = source;

    function handleKvEvent() {
      runRemoteSyncTick();
    }

    source.addEventListener('ready', handleKvEvent);
    source.addEventListener('kv-update', handleKvEvent);

    source.onerror = function () {
      closeRemoteKvStream();
      scheduleRemoteKvStreamReconnect();
    };
  }

  function startRemoteSyncLoop() {
    if (remoteSyncTimer) return;

    remoteSyncTimer = window.setInterval(function () {
      if (document.hidden) return;
      runRemoteSyncTick();
    }, REMOTE_SYNC_INTERVAL_MS);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) runRemoteSyncTick();
    });

    window.addEventListener('focus', runRemoteSyncTick);
    window.addEventListener('beforeunload', closeRemoteKvStream);
  }

  function removeValueAsync(key) {
    if (!db) return Promise.resolve(false);
    try {
      db.run('DELETE FROM kv_store WHERE key = ?', [key]);
      return Promise.resolve(true);
    } catch (e) {
      console.warn('[DataLayer] Fehler beim Löschen von ' + key + ':', e);
      return Promise.resolve(false);
    }
  }

  function persistDurableFile() {
    try {
      var isApiTarget = durableFilePath && (
        durableFilePath.indexOf('/api/') === 0 ||
        durableFilePath.indexOf('http://') === 0 ||
        durableFilePath.indexOf('https://') === 0
      );
      if (!isApiTarget) return false;

      var payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        projects: projects,
        tasks: tasks,
        employees: employees,
        labels: labels,
        templates: templates,
        releases: releases,
        notifications: notifications,
        calendarEvents: calendarEvents
      };
      var request = new XMLHttpRequest();
      request.open('POST', durableFilePath, false);
      request.setRequestHeader('Content-Type', 'application/json');
      request.send(JSON.stringify(payload));
      return request.status >= 200 && request.status < 300;
    } catch (e) {
      console.warn('[DataLayer] Durable file write failed:', e);
      return false;
    }
  }

  function ensureDatabaseReady() {
    if (dbReadyPromise) return dbReadyPromise;

    dbReadyPromise = ensureSqlJs()
      .then(function (SQL) {
        if (!db) {
          db = new SQL.Database();
        }
        createDatabaseSchema();
        return hydrateFromDatabase();
      })
      .then(function () {
        dbReady = true;
        return true;
      })
      .catch(function (err) {
        dbReady = false;
        console.error('[DataLayer] SQLite-Initialisierung fehlgeschlagen:', err);
        return false;
      });

    return dbReadyPromise;
  }

  function ensureDatabaseFile() {
    return ensureDatabaseReady().then(function () {
      if (dbFileHandle) return true;
      if (window.showSaveFilePicker) {
        return window.showSaveFilePicker({
          suggestedName: dbFileName,
          types: [{ description: 'SQLite-Datei', accept: { 'application/x-sqlite3': ['.sqlite', '.db', '.sqlite3'] } }]
        }).then(function (handle) {
          dbFileHandle = handle;
          return true;
        }).catch(function () {
          return false;
        });
      }
      return true;
    });
  }

  function downloadDatabaseFile(binary) {
    var blob = new Blob([binary], { type: 'application/x-sqlite3' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = dbFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }

  function persistDatabaseFile() {
    return ensureDatabaseReady().then(function () {
      if (!db) return false;
      if (!dbFileHandle && window.showSaveFilePicker) {
        return ensureDatabaseFile();
      }

      var binary = db.export();
      if (dbFileHandle && dbFileHandle.createWritable) {
        return dbFileHandle.createWritable().then(function (writable) {
          return writable.write(binary).then(function () {
            return writable.close();
          });
        }).then(function () {
          return true;
        }).catch(function (err) {
          console.error('[DataLayer] Fehler beim Speichern der SQLite-Datei:', err);
          return false;
        });
      }

      return downloadDatabaseFile(binary);
    });
  }

  function loadDatabaseFile(handle) {
    if (!handle) return Promise.reject(new Error('Keine Datei ausgewählt.'));
    return ensureSqlJs().then(function (SQL) {
      var filePromise = handle.getFile ? handle.getFile() : Promise.resolve(handle);
      return filePromise.then(function (file) {
        return file.arrayBuffer ? file.arrayBuffer() : file;
      }).then(function (buffer) {
        var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
        db = new SQL.Database(bytes);
        dbFileHandle = handle;
        dbFileName = (handle.name || handle.displayName || dbFileName);
        createDatabaseSchema();
        return hydrateFromDatabase();
      }).then(function () {
        dbReady = true;
        hydrateCollections();
        return true;
      });
    }).catch(function (err) {
      console.error('[DataLayer] Fehler beim Laden der SQLite-Datei:', err);
      throw err;
    });
  }

  function openDatabaseFile() {
    if (window.showOpenFilePicker) {
      return window.showOpenFilePicker({
        types: [{ description: 'SQLite-Datei', accept: { 'application/x-sqlite3': ['.sqlite', '.db', '.sqlite3'] } }]
      }).then(function (handles) {
        return loadDatabaseFile(handles[0]);
      });
    }

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sqlite,.db,.sqlite3';
    input.style.display = 'none';
    document.body.appendChild(input);

    return new Promise(function (resolve, reject) {
      input.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        document.body.removeChild(input);
        if (!file) {
          reject(new Error('Keine Datei ausgewählt.'));
          return;
        }
        loadDatabaseFile(file).then(resolve).catch(reject);
      }, { once: true });
      input.click();
    });
  }

  function newDatabaseFile() {
    db = null;
    dbReadyPromise = null;
    dbReady = false;
    dbFileHandle = null;
    memoryStorage = Object.create(null);
    return ensureDatabaseReady().then(function () {
      hydrateCollections();
      return true;
    });
  }

  /* ---------- Generic CRUD ---------- */

  /**
   * Lese Daten aus dem Storage.
   * Gibt parseResult zurück oder fallback (defaultVal).
   */
  function read(key, defaultVal) {
    try {
      var raw = getStorageValue(key);
      if (!raw) return defaultVal !== undefined ? defaultVal : [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : (defaultVal !== undefined ? defaultVal : []);
    } catch (e) {
      console.error('[DataLayer] Fehler beim Lesen von ' + key + ':', e);
      return defaultVal !== undefined ? defaultVal : [];
    }
  }

  /**
   * Schreibe Daten in den Storage.
   */
  function write(key, data) {
    try {
      setStorageValue(key, JSON.stringify(data));
      persistDurableFile();
      return true;
    } catch (e) {
      console.error('[DataLayer] Fehler beim Schreiben von ' + key + ':', e);
      return false;
    }
  }

  /**
   * Generiere eine eindeutige ID.
   */
  function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
  }

  /* ---------- Data Structures (leere Arrays) ---------- */

  /** @type {Project[]} — Projekt-Daten */
  var projects = [];

  /** @type {Task[]} — Task/Datenbank */
  var tasks = [];

  /** @type {Employee[]} — Mitarbeiter */
  var employees = [];

  /** @type {Label[]} — Labels */
  var labels = [];

  /** @type {Template[]} — Vorlagen */
  var templates = [];

  /** @type {Release[]} — Releases */
  var releases = [];

  /** @type {Notification[]} — Benachrichtigungen */
  var notifications = [];

  /** @type {CalendarEvent[]} — Kalenderereignisse */
  var calendarEvents = [];

  function hydrateCollections() {
    replaceArray(projects, read(KEYS.projects, []));
    replaceArray(tasks, read(KEYS.tasks, []));
    replaceArray(employees, read(KEYS.employees, []));
    replaceArray(labels, read(KEYS.labels, []));
    replaceArray(templates, read(KEYS.templates, []));
    replaceArray(releases, read(KEYS.releases, []));
    replaceArray(notifications, read(KEYS.notifications, []));
    replaceArray(calendarEvents, read(KEYS.calendarEvents, []));
    var commitsCompacted = normalizeProjectsCollection();
    normalizeTasksCollection();
    if (reconcileTaskDependencies()) saveTasks();
    if (syncAllTaskCalendarEvents()) saveCalendarEvents();
    if (commitsCompacted) saveProjects();
  }

  function hasCoreData() {
    return (
      projects.length > 0 ||
      tasks.length > 0 ||
      employees.length > 0 ||
      labels.length > 0 ||
      templates.length > 0 ||
      releases.length > 0 ||
      notifications.length > 0 ||
      calendarEvents.length > 0
    );
  }

  function applySnapshotPayload(data) {
    if (!data || typeof data !== 'object') return false;

    if (Array.isArray(data.projects)) replaceArray(projects, data.projects);
    if (Array.isArray(data.tasks)) replaceArray(tasks, data.tasks);
    if (Array.isArray(data.employees)) replaceArray(employees, data.employees);
    if (Array.isArray(data.labels)) replaceArray(labels, data.labels);
    if (Array.isArray(data.templates)) replaceArray(templates, data.templates);
    if (Array.isArray(data.releases)) replaceArray(releases, data.releases);
    if (Array.isArray(data.notifications)) replaceArray(notifications, data.notifications);
    if (Array.isArray(data.calendarEvents)) replaceArray(calendarEvents, data.calendarEvents);

    normalizeProjectsCollection();
    normalizeTasksCollection();
    reconcileTaskDependencies();
    syncAllTaskCalendarEvents();

    saveProjects();
    saveTasks();
    saveEmployees();
    saveLabels();
    saveTemplates();
    saveReleases();
    saveNotifications();
    saveCalendarEvents();

    emitDataChanged('seed', 'all');
    return true;
  }

  function applyKvBackupPayload(data) {
    if (!data || typeof data !== 'object' || !data.data || typeof data.data !== 'object') return false;

    memoryStorage = Object.create(null);
    Object.keys(data.data).forEach(function (key) {
      var value = data.data[key];
      if (value === null || value === undefined) return;
      memoryStorage[normalizeStorageKey(key)] = normalizeStorageValue(value);
    });

    rebuildLocalDatabaseFromMemory();
    hydrateCollections();
    emitDataChanged('seed', 'all');
    return true;
  }

  function bootstrapFromDurableFileIfEmpty() {
    if (REMOTE_ONLY_MODE) return Promise.resolve(false);
    if (hasCoreData()) return Promise.resolve(false);
    if (typeof fetch !== 'function') return Promise.resolve(false);

    var candidates = Array.isArray(durableFileCandidates) ? durableFileCandidates.slice() : [durableFilePath];

    function tryNext(index) {
      if (index >= candidates.length) return Promise.resolve(false);
      var path = candidates[index];
      return fetch(path, { cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json().catch(function () { return null; });
        })
        .then(function (payload) {
          if (!payload) return tryNext(index + 1);
          if (applySnapshotPayload(payload)) return true;
          if (applyKvBackupPayload(payload)) return true;
          return tryNext(index + 1);
        })
        .catch(function () {
          return tryNext(index + 1);
        });
    }

    return tryNext(0);
  }

  snapshotLegacyStorage();
  loadDirtyRemoteSyncState();
  patchStorageApi();
  runStartupHydration().finally(function () {
    startRemoteSyncLoop();
    startRemoteKvStream();
  });

  /* ---------- Save Helpers ---------- */

  function saveProjects()  { write(KEYS.projects, projects); }
  function saveTasks()     { write(KEYS.tasks, tasks); }
  function saveEmployees() { write(KEYS.employees, employees); }
  function saveLabels()    { write(KEYS.labels, labels); }
  function saveTemplates() { write(KEYS.templates, templates); }
  function saveReleases()  { write(KEYS.releases, releases); }
  function saveNotifications() { write(KEYS.notifications, notifications); }
  function saveCalendarEvents() { write(KEYS.calendarEvents, calendarEvents); }

  function emitDataChanged(action, entity) {
    emit('dataChanged', {
      action: action,
      entity: entity,
      timestamp: new Date().toISOString()
    });
  }

  function replaceArray(target, source) {
    target.length = 0;
    Array.prototype.push.apply(target, Array.isArray(source) ? source : []);
  }

  function normalizeProjectInfoHub(project) {
    if (!project.infoHub || typeof project.infoHub !== 'object') project.infoHub = {};
    if (!Array.isArray(project.infoHub.attachments)) project.infoHub.attachments = [];
    if (!Array.isArray(project.infoHub.notes)) project.infoHub.notes = [];
    if (!Array.isArray(project.infoHub.links)) project.infoHub.links = [];
    if (!Array.isArray(project.infoHub.secrets)) project.infoHub.secrets = [];
    if (typeof project.infoHub.scratchpad !== 'string') project.infoHub.scratchpad = '';
    if (typeof project.infoHub.envText !== 'string') project.infoHub.envText = '';
  }

  function normalizeProjectAiKnowledge(project) {
    if (!project.aiKnowledge || typeof project.aiKnowledge !== 'object') project.aiKnowledge = {};
    if (typeof project.aiKnowledge.preferredModel !== 'string' || !project.aiKnowledge.preferredModel.trim()) {
      project.aiKnowledge.preferredModel = 'hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:Q4_K_M';
    }
    if (typeof project.aiKnowledge.lastStatus !== 'string') project.aiKnowledge.lastStatus = 'idle';
    if (typeof project.aiKnowledge.lastGeneratedAt !== 'string') project.aiKnowledge.lastGeneratedAt = '';
    if (typeof project.aiKnowledge.filePath !== 'string') project.aiKnowledge.filePath = '';
    if (typeof project.aiKnowledge.lastError !== 'string') project.aiKnowledge.lastError = '';
    if (typeof project.aiKnowledge.lastModel !== 'string') project.aiKnowledge.lastModel = '';
    if (typeof project.aiKnowledge.sourceCommitSha !== 'string') project.aiKnowledge.sourceCommitSha = '';
    if (typeof project.aiKnowledge.lastKnowledgeSize !== 'number') project.aiKnowledge.lastKnowledgeSize = 0;
  }

  function normalizeProjectTeamMembers(project) {
    var source = [];
    if (Array.isArray(project.teamMembers)) {
      source = project.teamMembers;
    } else if (Array.isArray(project.assignees)) {
      source = project.assignees;
    }

    var normalized = [];
    var seen = {};
    source.forEach(function (member) {
      if (!member || typeof member !== 'object') return;

      var employeeId = String(member.employeeId || member.id || '').trim();
      if (!employeeId || seen[employeeId]) return;
      seen[employeeId] = true;

      normalized.push({
        id: member.id || generateId(),
        employeeId: employeeId,
        role: typeof member.role === 'string' ? member.role.trim() : '',
        assignedAt: member.assignedAt || new Date().toISOString()
      });
    });

    project.teamMembers = normalized;
  }

  function normalizeExecutionPlanEvent(entry) {
    if (!entry || typeof entry !== 'object') entry = {};
    return {
      id: entry.id || generateId(),
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      date: typeof entry.date === 'string' ? entry.date : '',
      startTime: typeof entry.startTime === 'string' ? entry.startTime : '',
      endTime: typeof entry.endTime === 'string' ? entry.endTime : '',
      type: typeof entry.type === 'string' && entry.type ? entry.type : 'meeting',
      source: typeof entry.source === 'string' && entry.source ? entry.source : 'ai'
    };
  }

  function normalizeExecutionPlanTask(entry) {
    if (!entry || typeof entry !== 'object') entry = {};
    return {
      id: entry.id || generateId(),
      title: typeof entry.title === 'string' ? entry.title.trim() : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      priority: typeof entry.priority === 'string' ? entry.priority : 'medium',
      urgency: typeof entry.urgency === 'string' ? entry.urgency : 'normal',
      effortHours: typeof entry.effortHours === 'number' && !isNaN(entry.effortHours) ? entry.effortHours : 0,
      labels: Array.isArray(entry.labels) ? entry.labels.filter(Boolean) : [],
      schedule: entry.schedule && typeof entry.schedule === 'object' ? entry.schedule : { mode: 'none', deadline: '', fixedAt: '', rangeStart: '', rangeEnd: '' },
      sequenceIndex: normalizeTaskSequenceIndex(entry.sequenceIndex),
      dependsOnPrevious: !!entry.dependsOnPrevious,
      chainWithPrevious: !!entry.chainWithPrevious,
      externalDependencyTaskId: typeof entry.externalDependencyTaskId === 'string' ? entry.externalDependencyTaskId : '',
      subtasks: Array.isArray(entry.subtasks) ? entry.subtasks.filter(Boolean) : [],
      notes: Array.isArray(entry.notes) ? entry.notes : [],
      assigneeId: typeof entry.assigneeId === 'string' ? entry.assigneeId : ''
    };
  }

  function normalizeProjectExecutionPlan(project) {
    if (!project || typeof project !== 'object') return;
    if (!project.executionPlanDraft || typeof project.executionPlanDraft !== 'object') {
      project.executionPlanDraft = {};
    }
    var draft = project.executionPlanDraft;
    if (typeof draft.status !== 'string' || !draft.status) draft.status = 'empty';
    if (typeof draft.generatedAt !== 'string') draft.generatedAt = '';
    if (typeof draft.updatedAt !== 'string') draft.updatedAt = '';
    if (!Array.isArray(draft.queuedTasks)) draft.queuedTasks = [];
    if (!Array.isArray(draft.queuedEvents)) draft.queuedEvents = [];
    draft.queuedTasks = draft.queuedTasks.map(normalizeExecutionPlanTask).filter(function (task) {
      return !!task.title;
    });
    draft.queuedEvents = draft.queuedEvents.map(normalizeExecutionPlanEvent).filter(function (eventItem) {
      return !!eventItem.title;
    });

    if (!draft.milestoneDraft || typeof draft.milestoneDraft !== 'object') {
      draft.milestoneDraft = {};
    }
    if (typeof draft.milestoneDraft.status !== 'string') draft.milestoneDraft.status = 'idle';
    if (typeof draft.milestoneDraft.generatedAt !== 'string') draft.milestoneDraft.generatedAt = '';
    if (typeof draft.milestoneDraft.summaryMarkdown !== 'string') draft.milestoneDraft.summaryMarkdown = '';
    if (!Array.isArray(draft.milestoneDraft.items)) draft.milestoneDraft.items = [];
    draft.milestoneDraft.items = draft.milestoneDraft.items.map(normalizeExecutionPlanEvent).filter(function (eventItem) {
      return !!eventItem.title;
    });
  }

  function normalizeProjectProgress(project) {
    var fallback = String(project.status || '').toLowerCase() === 'done' ? 100 : 0;
    var progress = Number(project.progress);
    if (!isFinite(progress)) progress = fallback;
    progress = Math.round(progress);
    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;
    project.progress = progress;
  }

  function compactProjectGithubCommits(project) {
    var commits = Array.isArray(project.githubCommits) ? project.githubCommits : [];
    var changed = false;

    project.githubCommits = commits.map(function (commit, index) {
      if (index < 25 || !commit || typeof commit !== 'object') return commit;
      var keys = Object.keys(commit);
      if (keys.length === 1 && keys[0] === 'date') return commit;
      changed = true;
      return { date: typeof commit.date === 'string' ? commit.date : '' };
    });

    return changed;
  }

  function normalizeProject(project) {
    if (!project || typeof project !== 'object') project = {};
    if (!project.id) project.id = generateId();
    if (!project.createdAt) project.createdAt = new Date().toISOString();
    if (!project.title && project.name) project.title = project.name;
    if (!Array.isArray(project.githubCommits)) project.githubCommits = [];
    compactProjectGithubCommits(project);
    normalizeProjectTeamMembers(project);
    normalizeProjectInfoHub(project);
    normalizeProjectAiKnowledge(project);
    normalizeProjectExecutionPlan(project);
    normalizeProjectProgress(project);
    project.blocked = !!project.blocked || project.status === 'blocked';
    if (project.blocked && project.status !== 'done') project.status = 'blocked';
    if (typeof project.blockedReason !== 'string') project.blockedReason = '';
    if (typeof project.blockerTaskId !== 'string' || !project.blockerTaskId.trim()) project.blockerTaskId = null;
    if (typeof project.blockedAt !== 'string') project.blockedAt = '';
    if (typeof project.blockedUntil !== 'string') project.blockedUntil = '';
    if (typeof project.blockedUpdatedAt !== 'string') project.blockedUpdatedAt = '';
    project.blockerHistory = normalizeBlockerHistoryList(project.blockerHistory);
    if (project.blocked && !project.blockedAt) {
      project.blockedAt = project.blockedUpdatedAt || project.createdAt || new Date().toISOString();
    }
    if (project.blocked && !findOpenBlockerEntry(project.blockerHistory)) {
      appendOpenBlockerEntry(project, {
        at: project.blockedAt,
        reason: project.blockedReason || '',
        blockerTaskId: project.blockerTaskId || '',
        targetType: 'project',
        targetId: project.id,
        targetTitle: project.title || project.name || 'Projekt'
      });
    }
    return project;
  }

  function normalizeProjectsCollection() {
    var commitsCompacted = false;
    projects.forEach(function (project, index) {
      if (compactProjectGithubCommits(project)) commitsCompacted = true;
      projects[index] = normalizeProject(project);
    });
    return commitsCompacted;
  }

  function normalizeSubtask(subtask) {
    if (!subtask || typeof subtask !== 'object') subtask = {};
    if (!subtask.id) subtask.id = generateId();
    if (typeof subtask.title !== 'string') subtask.title = '';
    subtask.title = subtask.title.trim();
    subtask.completed = !!subtask.completed;
    if (!subtask.createdAt) subtask.createdAt = new Date().toISOString();
    return subtask;
  }

  function normalizeTaskNote(note) {
    if (!note || typeof note !== 'object') note = {};
    if (!note.id) note.id = generateId();
    if (typeof note.text !== 'string') note.text = '';
    note.text = note.text.trim();
    if (!note.createdAt) note.createdAt = new Date().toISOString();
    return note;
  }

  function normalizeTaskAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') attachment = {};
    if (!attachment.id) attachment.id = generateId();
    if (typeof attachment.name !== 'string') attachment.name = '';
    if (typeof attachment.url !== 'string') attachment.url = '';
    if (typeof attachment.dataUrl !== 'string') attachment.dataUrl = '';
    if (typeof attachment.type !== 'string') attachment.type = 'link';
    if (typeof attachment.size !== 'number') attachment.size = 0;
    if (!attachment.addedAt) attachment.addedAt = new Date().toISOString();
    return attachment;
  }

  function normalizeBlockerHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') entry = {};
    return {
      id: entry.id || generateId(),
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      from: typeof entry.from === 'string' && entry.from ? entry.from : new Date().toISOString(),
      until: typeof entry.until === 'string' ? entry.until : '',
      blockerTaskId: typeof entry.blockerTaskId === 'string' ? entry.blockerTaskId : '',
      blockerTitle: typeof entry.blockerTitle === 'string' ? entry.blockerTitle : '',
      targetType: typeof entry.targetType === 'string' ? entry.targetType : '',
      targetId: typeof entry.targetId === 'string' ? entry.targetId : '',
      targetTitle: typeof entry.targetTitle === 'string' ? entry.targetTitle : '',
      resolution: typeof entry.resolution === 'string' ? entry.resolution : ''
    };
  }

  function normalizeBlockerHistoryList(history) {
    var source = Array.isArray(history) ? history : [];
    var normalized = source.map(normalizeBlockerHistoryEntry);
    normalized.sort(function (a, b) {
      return String(a.from || '').localeCompare(String(b.from || ''));
    });
    return normalized.slice(-200);
  }

  function findOpenBlockerEntry(history) {
    var list = Array.isArray(history) ? history : [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (!list[i].until) return list[i];
    }
    return null;
  }

  function appendOpenBlockerEntry(entity, details) {
    if (!entity) return;
    var at = details && details.at ? details.at : new Date().toISOString();
    entity.blockerHistory = normalizeBlockerHistoryList(entity.blockerHistory);

    var open = findOpenBlockerEntry(entity.blockerHistory);
    if (open && open.blockerTaskId === String((details && details.blockerTaskId) || '')) {
      open.reason = typeof details.reason === 'string' ? details.reason : open.reason;
      open.blockerTitle = typeof details.blockerTitle === 'string' ? details.blockerTitle : open.blockerTitle;
      open.targetType = typeof details.targetType === 'string' ? details.targetType : open.targetType;
      open.targetId = typeof details.targetId === 'string' ? details.targetId : open.targetId;
      open.targetTitle = typeof details.targetTitle === 'string' ? details.targetTitle : open.targetTitle;
      if (!open.from) open.from = at;
      return;
    }

    if (open && !open.until) {
      open.until = at;
      if (!open.resolution) open.resolution = 'Automatisch geschlossen (neuer Blocker)';
    }

    entity.blockerHistory.push(normalizeBlockerHistoryEntry({
      reason: details && details.reason ? details.reason : '',
      from: at,
      until: '',
      blockerTaskId: details && details.blockerTaskId ? details.blockerTaskId : '',
      blockerTitle: details && details.blockerTitle ? details.blockerTitle : '',
      targetType: details && details.targetType ? details.targetType : '',
      targetId: details && details.targetId ? details.targetId : '',
      targetTitle: details && details.targetTitle ? details.targetTitle : ''
    }));
    entity.blockerHistory = normalizeBlockerHistoryList(entity.blockerHistory);
  }

  function closeOpenBlockerEntries(entity, details) {
    if (!entity) return false;
    var changed = false;
    var at = details && details.at ? details.at : new Date().toISOString();
    var resolution = details && typeof details.resolution === 'string' ? details.resolution : '';
    entity.blockerHistory = normalizeBlockerHistoryList(entity.blockerHistory);

    entity.blockerHistory.forEach(function (entry) {
      if (entry.until) return;
      entry.until = at;
      if (resolution) entry.resolution = resolution;
      changed = true;
    });

    return changed;
  }

  function normalizeTaskSchedule(task) {
    var schedule = task && task.schedule && typeof task.schedule === 'object' ? task.schedule : {};
    var mode = schedule.mode;

    if (!mode) {
      if (task.dueDate) mode = 'deadline';
      else if (task.fixedAt) mode = 'fixed';
      else if (task.rangeStart || task.rangeEnd) mode = 'range';
      else if (task.immediate || task.asap) mode = 'asap';
      else mode = 'none';
    }

    task.schedule = {
      mode: mode,
      deadline: schedule.deadline || task.dueDate || '',
      fixedAt: schedule.fixedAt || task.fixedAt || '',
      rangeStart: schedule.rangeStart || task.rangeStart || '',
      rangeEnd: schedule.rangeEnd || task.rangeEnd || ''
    };

    // Legacy compatibility for old modules.
    task.dueDate = task.schedule.deadline || '';
  }

  function normalizeTaskTimeTracking(task) {
    var tracking = task && task.timeTracking && typeof task.timeTracking === 'object' ? task.timeTracking : {};
    var minutesByDate = tracking.minutesByDate && typeof tracking.minutesByDate === 'object' ? tracking.minutesByDate : {};
    var pauseHistory = Array.isArray(tracking.pauseHistory) ? tracking.pauseHistory : [];

    task.timeTracking = {
      totalMinutes: typeof tracking.totalMinutes === 'number' && !isNaN(tracking.totalMinutes) ? tracking.totalMinutes : 0,
      activeStartedAt: typeof tracking.activeStartedAt === 'string' ? tracking.activeStartedAt : '',
      inProgressConfirmedAt: typeof tracking.inProgressConfirmedAt === 'string' ? tracking.inProgressConfirmedAt : '',
      isPaused: !!tracking.isPaused,
      pausedAt: typeof tracking.pausedAt === 'string' ? tracking.pausedAt : '',
      pauseReasonPending: !!tracking.pauseReasonPending,
      lastPauseReason: typeof tracking.lastPauseReason === 'string' ? tracking.lastPauseReason : '',
      minutesByDate: minutesByDate,
      pauseHistory: pauseHistory.map(function (entry) {
        return {
          id: entry && entry.id ? entry.id : generateId(),
          pausedAt: entry && typeof entry.pausedAt === 'string' ? entry.pausedAt : '',
          resumedAt: entry && typeof entry.resumedAt === 'string' ? entry.resumedAt : '',
          reason: entry && typeof entry.reason === 'string' ? entry.reason : '',
          notedLater: !!(entry && entry.notedLater)
        };
      })
    };
  }

  function normalizeTaskSequenceIndex(value) {
    var parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }

  function normalizeTaskDependencyIds(task) {
    var source = [];
    if (task && Array.isArray(task.dependencyTaskIds)) source = source.concat(task.dependencyTaskIds);
    if (task && typeof task.blockerTaskId === 'string' && task.blockerTaskId.trim()) source.push(task.blockerTaskId.trim());

    var unique = [];
    source.forEach(function (id) {
      var text = String(id || '').trim();
      if (!text) return;
      if (task && task.id && text === String(task.id)) return;
      if (unique.indexOf(text) === -1) unique.push(text);
    });
    return unique;
  }

  function refreshTaskDependencyState(task) {
    if (!task) return task;

    var dependencyIds = normalizeTaskDependencyIds(task);
    task.dependencyTaskIds = dependencyIds;
    task.sequenceIndex = normalizeTaskSequenceIndex(task.sequenceIndex);
    task.dependsOnPrevious = !!task.dependsOnPrevious;

    var unresolved = [];
    dependencyIds.forEach(function (dependencyId) {
      var dependencyTask = getTaskById(dependencyId);
      if (!dependencyTask || dependencyTask.status !== 'done') unresolved.push(dependencyTask || { id: dependencyId, title: dependencyId });
    });

    task.dependencyBlocked = unresolved.length > 0;
    task.dependencyBlockReason = task.dependencyBlocked
      ? 'Abhängig von: ' + unresolved.map(function (dependencyTask) {
          return dependencyTask && dependencyTask.title ? dependencyTask.title : String(dependencyTask.id || 'Unbekannt');
        }).join(', ')
      : '';

    return task;
  }

  function reconcileTaskDependencies() {
    var changed = false;
    tasks.forEach(function (task) {
      var beforeBlocked = !!task.dependencyBlocked;
      var beforeReason = task.dependencyBlockReason || '';
      refreshTaskDependencyState(task);
      if (beforeBlocked !== !!task.dependencyBlocked || beforeReason !== (task.dependencyBlockReason || '')) changed = true;
    });
    return changed;
  }

  function clampTaskProgressValue(value) {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function normalizeTaskHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') entry = {};
    return {
      id: entry.id || generateId(),
      type: typeof entry.type === 'string' && entry.type ? entry.type : 'updated',
      at: typeof entry.at === 'string' && entry.at ? entry.at : new Date().toISOString(),
      status: typeof entry.status === 'string' && entry.status ? entry.status : 'todo',
      progress: clampTaskProgressValue(entry.progress),
      assigneeId: typeof entry.assigneeId === 'string' ? entry.assigneeId : '',
      actorId: typeof entry.actorId === 'string' ? entry.actorId : ''
    };
  }

  function getCurrentTaskHistoryActorId() {
    var auth = window.AuthManager;
    var user = auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
    return user && user.id ? String(user.id) : '';
  }

  function buildSeedTaskHistory(task) {
    var createdAt = task.createdAt || new Date().toISOString();
    var updatedAt = task.updatedAt || createdAt;
    var history = [normalizeTaskHistoryEntry({
      type: 'created',
      at: createdAt,
      status: task.status || 'todo',
      progress: task.progress,
      assigneeId: task.assigneeId || ''
    })];

    if (updatedAt !== createdAt) {
      history.push(normalizeTaskHistoryEntry({
        type: task.status === 'done' ? 'completed' : 'updated',
        at: updatedAt,
        status: task.status || 'todo',
        progress: task.progress,
        assigneeId: task.assigneeId || ''
      }));
    }

    return history;
  }

  function normalizeTaskHistory(task) {
    var history = Array.isArray(task.history)
      ? task.history.map(normalizeTaskHistoryEntry)
      : [];

    if (!history.length) history = buildSeedTaskHistory(task);

    history.sort(function (a, b) {
      return String(a.at || '').localeCompare(String(b.at || ''));
    });

    return history.slice(-200);
  }

  function getLatestTaskHistorySnapshot(task) {
    var history = task && Array.isArray(task.history) ? task.history : [];
    if (!history.length) return null;
    var latest = history[history.length - 1];
    return {
      status: latest.status || 'todo',
      progress: clampTaskProgressValue(latest.progress),
      assigneeId: latest.assigneeId || ''
    };
  }

  function appendTaskHistoryEntry(task, entry) {
    if (!task) return;
    if (!Array.isArray(task.history)) task.history = [];
    task.history.push(normalizeTaskHistoryEntry(entry));
    task.history.sort(function (a, b) {
      return String(a.at || '').localeCompare(String(b.at || ''));
    });
    if (task.history.length > 200) task.history = task.history.slice(-200);
  }

  function appendTaskHistoryUpdate(task) {
    if (!task) return;

    var previous = getLatestTaskHistorySnapshot(task);
    var nextStatus = task.status || 'todo';
    var nextProgress = clampTaskProgressValue(task.progress);
    var nextAssigneeId = task.assigneeId || '';
    var type = 'updated';

    if (previous) {
      if (previous.status !== nextStatus) {
        if (nextStatus === 'done') type = 'completed';
        else if (nextStatus === 'in-progress') type = 'started';
        else type = 'status-change';
      } else if (previous.progress !== nextProgress) {
        type = 'progress';
      } else if (previous.assigneeId !== nextAssigneeId) {
        type = 'reassigned';
      }
    } else if (nextStatus === 'done') {
      type = 'completed';
    }

    appendTaskHistoryEntry(task, {
      type: type,
      at: task.updatedAt || new Date().toISOString(),
      status: nextStatus,
      progress: nextProgress,
      assigneeId: nextAssigneeId,
      actorId: getCurrentTaskHistoryActorId()
    });
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object') task = {};
    if (!task.id) task.id = generateId();
    if (!task.createdAt) task.createdAt = new Date().toISOString();
    if (typeof task.updatedAt !== 'string' || !task.updatedAt.trim()) task.updatedAt = task.createdAt;
    if (typeof task.title !== 'string') task.title = '';
    if (typeof task.description !== 'string') task.description = '';
    if (!task.status) task.status = 'todo';
    if (!task.priority) task.priority = 'medium';
    if (!task.urgency) task.urgency = 'normal';
    if (typeof task.projectId !== 'string' || !task.projectId.trim()) task.projectId = null;
    if (typeof task.assigneeId !== 'string' || !task.assigneeId.trim()) task.assigneeId = null;
    if (!Array.isArray(task.labels)) task.labels = [];
    if (typeof task.effortHours !== 'number' || isNaN(task.effortHours)) task.effortHours = 0;
    task.sequenceIndex = normalizeTaskSequenceIndex(task.sequenceIndex);
    task.dependsOnPrevious = !!task.dependsOnPrevious;
    task.dependencyTaskIds = normalizeTaskDependencyIds(task);
    if (typeof task.progress !== 'number' || isNaN(task.progress)) {
      task.progress = 0;
    }
    task.progress = clampTaskProgressValue(task.progress);

    task.isBlocker = !!task.isBlocker;
    task.blocked = !!task.blocked;
    if (!task.blocked && task.status === 'blocked') task.status = 'todo';
    if (typeof task.blockedReason !== 'string') task.blockedReason = '';
    if (typeof task.blockerReason !== 'string') task.blockerReason = '';
    if (!task.blockedReason && task.blockerReason) task.blockedReason = task.blockerReason;
    if (typeof task.blockerTaskId !== 'string' || !task.blockerTaskId.trim()) task.blockerTaskId = null;
    if (typeof task.blockedAt !== 'string') task.blockedAt = '';
    if (typeof task.blockedUntil !== 'string') task.blockedUntil = '';
    if (typeof task.blockedUpdatedAt !== 'string') task.blockedUpdatedAt = '';
    if (typeof task.blockedTargetType !== 'string') task.blockedTargetType = '';
    if (typeof task.blockedTargetId !== 'string') task.blockedTargetId = '';
    if (typeof task.blockedTargetTitle !== 'string') task.blockedTargetTitle = '';
    if (typeof task.blockerResolvedAt !== 'string') task.blockerResolvedAt = '';
    if (typeof task.blockerResolution !== 'string') task.blockerResolution = '';
    task.blockerHistory = normalizeBlockerHistoryList(task.blockerHistory);
    if (task.blocked && !task.blockedAt) {
      task.blockedAt = task.blockedUpdatedAt || task.updatedAt || task.createdAt || new Date().toISOString();
    }
    if (task.blocked && !findOpenBlockerEntry(task.blockerHistory) && !task.isBlocker) {
      appendOpenBlockerEntry(task, {
        at: task.blockedAt,
        reason: task.blockedReason || '',
        blockerTaskId: task.blockerTaskId || '',
        targetType: 'task',
        targetId: task.id,
        targetTitle: task.title || 'Aufgabe'
      });
    }

    normalizeTaskSchedule(task);
    normalizeTaskTimeTracking(task);
    task.history = normalizeTaskHistory(task);
    refreshTaskDependencyState(task);

    if (!Array.isArray(task.subtasks)) task.subtasks = [];
    task.subtasks = task.subtasks.map(normalizeSubtask).filter(function (st) { return !!st.title; });

    if (!Array.isArray(task.notes)) task.notes = [];
    task.notes = task.notes.map(normalizeTaskNote).filter(function (note) { return !!note.text; });

    if (!Array.isArray(task.attachments)) task.attachments = [];
    task.attachments = task.attachments.map(normalizeTaskAttachment).filter(function (attachment) {
      return !!attachment.name || !!attachment.url || !!attachment.dataUrl;
    });

    return task;
  }

  function normalizeTasksCollection() {
    tasks.forEach(function (task, index) {
      tasks[index] = normalizeTask(task);
    });
  }

  function markTaskBlocked(taskId, details) {
    var task = getTaskById(taskId);
    if (!task) return null;

    var at = details && details.at ? details.at : new Date().toISOString();
    var next = Object.assign({}, task);
    next.blocked = true;
    next.blockedReason = (details && details.reason) || next.blockedReason || '';
    next.blockerTaskId = (details && details.blockerTaskId) || next.blockerTaskId || null;
    next.blockedAt = at;
    next.blockedUntil = '';
    next.blockedUpdatedAt = at;

    appendOpenBlockerEntry(next, {
      at: at,
      reason: next.blockedReason,
      blockerTaskId: next.blockerTaskId || '',
      blockerTitle: details && details.blockerTitle ? details.blockerTitle : '',
      targetType: 'task',
      targetId: next.id,
      targetTitle: next.title || 'Aufgabe'
    });

    updateTask(next);
    return getTaskById(taskId);
  }

  function markProjectBlocked(projectId, details) {
    var project = getProjectById(projectId);
    if (!project) return null;

    var at = details && details.at ? details.at : new Date().toISOString();
    var next = Object.assign({}, project);
    next.blocked = true;
    next.blockedReason = (details && details.reason) || next.blockedReason || '';
    next.blockerTaskId = (details && details.blockerTaskId) || next.blockerTaskId || null;
    next.blockedAt = at;
    next.blockedUntil = '';
    next.blockedUpdatedAt = at;
    if (next.status !== 'done') next.status = 'blocked';

    appendOpenBlockerEntry(next, {
      at: at,
      reason: next.blockedReason,
      blockerTaskId: next.blockerTaskId || '',
      blockerTitle: details && details.blockerTitle ? details.blockerTitle : '',
      targetType: 'project',
      targetId: next.id,
      targetTitle: next.title || next.name || 'Projekt'
    });

    updateProject(next);
    return getProjectById(projectId);
  }

  function resolveBlockerTask(blockerTaskId, details) {
    if (!blockerTaskId) return null;
    var blocker = getTaskById(blockerTaskId);
    if (!blocker) return null;

    var at = details && details.at ? details.at : new Date().toISOString();
    var resolution = details && details.resolution ? details.resolution : '';
    var next = Object.assign({}, blocker);
    next.blocked = false;
    next.blockedUntil = at;
    next.blockedUpdatedAt = at;
    next.blockerResolvedAt = at;
    next.blockerResolution = resolution;
    if (next.status !== 'done') next.status = 'done';
    closeOpenBlockerEntries(next, { at: at, resolution: resolution });

    if (resolution) {
      var notes = Array.isArray(next.notes) ? next.notes.slice() : [];
      notes.push({
        id: generateId(),
        text: 'Blocker geloest: ' + resolution,
        createdAt: at
      });
      next.notes = notes;
    }

    updateTask(next);
    return getTaskById(blockerTaskId);
  }

  function resolveAuthContext() {
    var auth = window.AuthManager || null;
    var mode = auth && typeof auth.getMode === 'function' ? auth.getMode() : '';
    var user = auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
    var isAdmin = mode === 'setup' || mode === 'admin';
    return {
      auth: auth,
      mode: mode,
      user: user,
      isAdmin: isAdmin
    };
  }

  function getOpenBlockerEntryForEntity(entity) {
    if (!entity) return null;
    var history = Array.isArray(entity.blockerHistory) ? entity.blockerHistory : [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (!history[i].until) return history[i];
    }
    return null;
  }

  function findBlockerTaskIdForTarget(targetType, targetId) {
    if (targetType === 'task') {
      var task = getTaskById(targetId);
      if (!task) return '';
      if (task.blockerTaskId) return String(task.blockerTaskId);
      var taskEntry = getOpenBlockerEntryForEntity(task);
      return taskEntry && taskEntry.blockerTaskId ? String(taskEntry.blockerTaskId) : '';
    }

    if (targetType === 'project') {
      var project = getProjectById(targetId);
      if (!project) return '';
      if (project.blockerTaskId) return String(project.blockerTaskId);
      var projectEntry = getOpenBlockerEntryForEntity(project);
      return projectEntry && projectEntry.blockerTaskId ? String(projectEntry.blockerTaskId) : '';
    }

    return '';
  }

  function canResolveBlocker(details) {
    if (!details || !details.targetType || !details.targetId) return false;

    var context = resolveAuthContext();
    if (context.isAdmin) return true;
    if (!context.user || !context.user.id) return false;

    var blockerTaskId = details.blockerTaskId || findBlockerTaskIdForTarget(String(details.targetType), String(details.targetId));
    if (!blockerTaskId) return false;

    var blockerTask = getTaskById(String(blockerTaskId));
    if (!blockerTask) return false;

    return String(blockerTask.createdByEmployeeId || '') === String(context.user.id || '');
  }

  function resolveTaskBlock(taskId, details) {
    var task = getTaskById(taskId);
    if (!task) return null;

    var at = details && details.at ? details.at : new Date().toISOString();
    var resolution = details && details.resolution ? details.resolution : '';
    var blockerTaskId = (details && details.blockerTaskId) || task.blockerTaskId || '';
    if (!canResolveBlocker({ targetType: 'task', targetId: taskId, blockerTaskId: blockerTaskId })) {
      return null;
    }
    var next = Object.assign({}, task);

    next.blocked = false;
    next.blockedUntil = at;
    next.blockedUpdatedAt = at;
    closeOpenBlockerEntries(next, { at: at, resolution: resolution });
    next.blockedReason = '';
    next.blockerTaskId = null;
    next.status = 'todo';

    updateTask(next);
    if (blockerTaskId) resolveBlockerTask(blockerTaskId, { at: at, resolution: resolution });
    return getTaskById(taskId);
  }

  function resolveProjectBlock(projectId, details) {
    var project = getProjectById(projectId);
    if (!project) return null;

    var at = details && details.at ? details.at : new Date().toISOString();
    var resolution = details && details.resolution ? details.resolution : '';
    var blockerTaskId = (details && details.blockerTaskId) || project.blockerTaskId || '';
    if (!canResolveBlocker({ targetType: 'project', targetId: projectId, blockerTaskId: blockerTaskId })) {
      return null;
    }
    var next = Object.assign({}, project);

    next.blocked = false;
    next.blockedUntil = at;
    next.blockedUpdatedAt = at;
    closeOpenBlockerEntries(next, { at: at, resolution: resolution });
    next.blockedReason = '';
    next.blockerTaskId = null;
    if (next.status === 'blocked') next.status = 'active';

    updateProject(next);
    if (blockerTaskId) resolveBlockerTask(blockerTaskId, { at: at, resolution: resolution });
    return getProjectById(projectId);
  }

  function linkBlockerToTarget(details) {
    if (!details || !details.targetType || !details.targetId || !details.blockerTaskId) return false;
    var targetType = String(details.targetType);
    var at = details.at || new Date().toISOString();

    var blockerTask = getTaskById(details.blockerTaskId);
    if (blockerTask) {
      var blockerNext = Object.assign({}, blockerTask, {
        isBlocker: true,
        blocked: true,
        blockedAt: blockerTask.blockedAt || at,
        blockedUntil: '',
        blockedUpdatedAt: at,
        blockerReason: details.reason || blockerTask.blockerReason || '',
        blockedTargetType: targetType,
        blockedTargetId: String(details.targetId),
        blockedTargetTitle: details.targetTitle || blockerTask.blockedTargetTitle || '',
        blockerResolvedAt: '',
        blockerResolution: ''
      });
      updateTask(blockerNext);
    }

    if (targetType === 'task') {
      return !!markTaskBlocked(details.targetId, {
        at: at,
        reason: details.reason || '',
        blockerTaskId: details.blockerTaskId,
        blockerTitle: details.blockerTitle || ''
      });
    }
    if (targetType === 'project') {
      return !!markProjectBlocked(details.targetId, {
        at: at,
        reason: details.reason || '',
        blockerTaskId: details.blockerTaskId,
        blockerTitle: details.blockerTitle || ''
      });
    }
    return false;
  }

  function resolveBlocker(details) {
    if (!details || !details.targetType || !details.targetId) return false;
    if (!canResolveBlocker(details)) return false;
    var targetType = String(details.targetType);
    var payload = {
      at: details.at || new Date().toISOString(),
      resolution: details.resolution || ''
    };

    if (targetType === 'task') return !!resolveTaskBlock(details.targetId, payload);
    if (targetType === 'project') return !!resolveProjectBlock(details.targetId, payload);
    return false;
  }

  function getTaskCalendarLinkPrefix(taskId) {
    return 'task-' + String(taskId || '');
  }

  function taskEventDateOnly(value) {
    if (!value || typeof value !== 'string') return '';
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  function getTaskScheduleDates(task) {
    if (!task || !task.schedule) return [];
    var schedule = task.schedule;
    var mode = schedule.mode || 'none';
    var list = [];

    if (mode === 'deadline' && schedule.deadline) {
      list.push({ suffix: 'deadline', date: schedule.deadline, title: 'Deadline' });
    } else if (mode === 'fixed' && schedule.fixedAt) {
      list.push({ suffix: 'fixed', date: schedule.fixedAt, title: 'Termin' });
    } else if (mode === 'range') {
      if (schedule.rangeStart) list.push({ suffix: 'range-start', date: schedule.rangeStart, title: 'Start' });
      if (schedule.rangeEnd) list.push({ suffix: 'range-end', date: schedule.rangeEnd, title: 'Ende' });
    } else if (mode === 'asap') {
      list.push({ suffix: 'asap', date: new Date().toISOString().slice(0, 10), title: 'Sofort' });
    }

    return list;
  }

  function syncTaskCalendarEvents(task) {
    if (!task || !task.id) return false;

    var prefix = getTaskCalendarLinkPrefix(task.id);
    var desired = getTaskScheduleDates(task);
    var seenIds = Object.create(null);
    var changed = false;

    desired.forEach(function (entry) {
      var eventId = prefix + '-' + entry.suffix;
      var normalizedDate = taskEventDateOnly(entry.date);
      if (!normalizedDate) return;
      seenIds[eventId] = true;

      var current = calendarEvents.find(function (evt) { return evt.id === eventId; });
      var nextPayload = {
        id: eventId,
        title: entry.title + ': ' + (task.title || 'Aufgabe'),
        date: normalizedDate,
        startDate: normalizedDate,
        type: 'task',
        projectId: task.projectId || null,
        taskId: task.id,
        source: 'task',
        createdAt: current && current.createdAt ? current.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (!current) {
        calendarEvents.push(nextPayload);
        changed = true;
      } else {
        var currentSerialized = JSON.stringify({
          title: current.title,
          date: current.date,
          startDate: current.startDate,
          type: current.type,
          projectId: current.projectId,
          taskId: current.taskId,
          source: current.source
        });
        var nextSerialized = JSON.stringify({
          title: nextPayload.title,
          date: nextPayload.date,
          startDate: nextPayload.startDate,
          type: nextPayload.type,
          projectId: nextPayload.projectId,
          taskId: nextPayload.taskId,
          source: nextPayload.source
        });

        if (currentSerialized !== nextSerialized) {
          current.title = nextPayload.title;
          current.date = nextPayload.date;
          current.startDate = nextPayload.startDate;
          current.type = nextPayload.type;
          current.projectId = nextPayload.projectId;
          current.taskId = nextPayload.taskId;
          current.source = nextPayload.source;
          current.updatedAt = nextPayload.updatedAt;
          changed = true;
        }
      }
    });

    var beforeLength = calendarEvents.length;
    for (var i = calendarEvents.length - 1; i >= 0; i--) {
      var ev = calendarEvents[i];
      if (!ev || !ev.id) continue;
      if (String(ev.id).indexOf(prefix + '-') === 0 && !seenIds[ev.id]) {
        calendarEvents.splice(i, 1);
      }
    }
    if (calendarEvents.length !== beforeLength) changed = true;

    return changed;
  }

  function removeTaskCalendarEvents(taskId) {
    if (!taskId) return false;
    var prefix = getTaskCalendarLinkPrefix(taskId) + '-';
    var beforeLength = calendarEvents.length;
    for (var i = calendarEvents.length - 1; i >= 0; i--) {
      var ev = calendarEvents[i];
      if (!ev || !ev.id) continue;
      if (String(ev.id).indexOf(prefix) === 0 || String(ev.taskId || '') === String(taskId)) {
        calendarEvents.splice(i, 1);
      }
    }
    return beforeLength !== calendarEvents.length;
  }

  function syncAllTaskCalendarEvents() {
    var changed = false;
    tasks.forEach(function (task) {
      if (syncTaskCalendarEvents(task)) changed = true;
    });
    return changed;
  }

  /* ---------- Projects CRUD ---------- */

  /** @returns {Project[]} */
  function getProjects()   { return projects; }

  /** @param {Project} project */
  function createProject(project) {
    project = normalizeProject(project);
    projects.push(project);
    saveProjects();
    emitDataChanged('create', 'projects');
    return project;
  }

  /** @param {string} id */
  function getProjectById(id) {
    return projects.find(function (p) { return p.id === id; }) || null;
  }

  /** @param {Project} project */
  function updateProject(project) {
    project = normalizeProject(project);
    var idx = projects.findIndex(function (p) { return p.id === project.id; });
    if (idx !== -1) {
      projects[idx] = project;
      saveProjects();
      emitDataChanged('update', 'projects');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteProject(id) {
    var idx = projects.findIndex(function (p) { return p.id === id; });
    if (idx !== -1) {
      projects.splice(idx, 1);
      saveProjects();
      emitDataChanged('delete', 'projects');
      return true;
    }
    return false;
  }

  /* ---------- Tasks CRUD ---------- */

  /** @returns {Task[]} */
  function getTasks()       { return tasks; }

  /**
   * Tasks mit optionalen Filtern.
   * filter: { projectId?, status?, labelIds?[], assigneeId?[] }
   */
  function getTasksFiltered(filter) {
    var result = tasks.slice();

    if (filter && filter.projectId) {
      result = result.filter(function (t) { return t.projectId === filter.projectId; });
    }
    if (filter && filter.status) {
      result = result.filter(function (t) { return t.status === filter.status; });
    }
    if (filter && filter.labelIds && filter.labelIds.length > 0) {
      result = result.filter(function (t) {
        return t.labels && Array.isArray(t.labels) &&
               t.labels.some(function (l) { return filter.labelIds.indexOf(l) !== -1; });
      });
    }
    if (filter && filter.assigneeId && filter.assigneeId.length > 0) {
      result = result.filter(function (t) {
        return t.assigneeId && filter.assigneeId.indexOf(t.assigneeId) !== -1;
      });
    }

    // Sort: sequenced tasks first, then highest priority, then by createdAt desc
    var prioOrder = { blocker: 4, high: 3, medium: 2, low: 1 };
    result.sort(function (a, b) {
      var aSeq = typeof a.sequenceIndex === 'number' && a.sequenceIndex > 0 ? a.sequenceIndex : 0;
      var bSeq = typeof b.sequenceIndex === 'number' && b.sequenceIndex > 0 ? b.sequenceIndex : 0;
      if (aSeq || bSeq) {
        if (aSeq && !bSeq) return -1;
        if (!aSeq && bSeq) return 1;
        var seqDelta = aSeq - bSeq;
        if (seqDelta !== 0) return seqDelta;
      }
      var prioDelta = (prioOrder[b.priority] || 0) - (prioOrder[a.priority] || 0);
      if (prioDelta !== 0) return prioDelta;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    return result;
  }

  /** @param {Task} task */
  function createTask(task) {
    var nowIso = new Date().toISOString();
    if (!task.createdAt) task.createdAt = nowIso;
    if (!task.updatedAt) task.updatedAt = task.createdAt;
    task = normalizeTask(task);
    tasks.push(task);
    reconcileTaskDependencies();
    var calendarChanged = syncTaskCalendarEvents(task);
    saveTasks();
    if (calendarChanged) saveCalendarEvents();
    emitDataChanged('create', 'tasks');
    if (calendarChanged) emitDataChanged('sync', 'calendarEvents');
    return task;
  }

  /** @param {string} id */
  function getTaskById(id) {
    return tasks.find(function (t) { return t.id === id; }) || null;
  }

  /** @param {Task} task */
  function updateTask(task) {
    var idx = tasks.findIndex(function (t) { return t.id === task.id; });
    if (idx !== -1) {
      task.updatedAt = new Date().toISOString();
      task = normalizeTask(task);
      appendTaskHistoryUpdate(task);
      tasks[idx] = task;
      reconcileTaskDependencies();
      var calendarChanged = syncTaskCalendarEvents(task);
      saveTasks();
      if (calendarChanged) saveCalendarEvents();
      emitDataChanged('update', 'tasks');
      if (calendarChanged) emitDataChanged('sync', 'calendarEvents');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteTask(id) {
    var idx = tasks.findIndex(function (t) { return t.id === id; });
    if (idx !== -1) {
      tasks.splice(idx, 1);
      reconcileTaskDependencies();
      var calendarChanged = removeTaskCalendarEvents(id);
      saveTasks();
      if (calendarChanged) saveCalendarEvents();
      emitDataChanged('delete', 'tasks');
      if (calendarChanged) emitDataChanged('sync', 'calendarEvents');
      return true;
    }
    return false;
  }

  /* ---------- Employees CRUD ---------- */

  /** @returns {Employee[]} */
  function getEmployees()   { return employees; }

  /** @param {Employee} employee */
  function createEmployee(employee) {
    if (!employee.id) employee.id = generateId();
    if (!employee.createdAt) employee.createdAt = new Date().toISOString();
    employees.push(employee);
    saveEmployees();
    emitDataChanged('create', 'employees');
    return employee;
  }

  /** @param {string} id */
  function getEmployeeById(id) {
    return employees.find(function (e) { return e.id === id; }) || null;
  }

  /** @param {Employee} employee */
  function updateEmployee(employee) {
    var idx = employees.findIndex(function (e) { return e.id === employee.id; });
    if (idx !== -1) {
      employees[idx] = employee;
      saveEmployees();
      emitDataChanged('update', 'employees');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteEmployee(id) {
    var idx = employees.findIndex(function (e) { return e.id === id; });
    if (idx !== -1) {
      employees.splice(idx, 1);
      saveEmployees();
      emitDataChanged('delete', 'employees');
      return true;
    }
    return false;
  }

  /* ---------- Labels CRUD ---------- */

  /** @returns {Label[]} */
  function getLabels()      { return labels; }

  /** @param {Label} label */
  function createLabel(label) {
    if (!label.id) label.id = generateId();
    label.color = label.color || '#4a9eff';
    labels.push(label);
    saveLabels();
    emitDataChanged('create', 'labels');
    return label;
  }

  /** @param {string} id */
  function getLabelById(id) {
    return labels.find(function (l) { return l.id === id; }) || null;
  }

  /** @param {Label} label */
  function updateLabel(label) {
    var idx = labels.findIndex(function (l) { return l.id === label.id; });
    if (idx !== -1) {
      labels[idx] = label;
      saveLabels();
      emitDataChanged('update', 'labels');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteLabel(id) {
    var idx = labels.findIndex(function (l) { return l.id === id; });
    if (idx !== -1) {
      labels.splice(idx, 1);
      saveLabels();
      emitDataChanged('delete', 'labels');
      return true;
    }
    return false;
  }

  /* ---------- Templates CRUD ---------- */

  /** @returns {Template[]} */
  function getTemplates()   { return templates; }

  /** @param {Template} template */
  function createTemplate(template) {
    if (!template.id) template.id = generateId();
    if (!template.createdAt) template.createdAt = new Date().toISOString();
    templates.push(template);
    saveTemplates();
    emitDataChanged('create', 'templates');
    return template;
  }

  /** @param {string} id */
  function getTemplateById(id) {
    return templates.find(function (t) { return t.id === id; }) || null;
  }

  /** @param {Template} template */
  function updateTemplate(template) {
    var idx = templates.findIndex(function (t) { return t.id === template.id; });
    if (idx !== -1) {
      templates[idx] = template;
      saveTemplates();
      emitDataChanged('update', 'templates');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteTemplate(id) {
    var idx = templates.findIndex(function (t) { return t.id === id; });
    if (idx !== -1) {
      templates.splice(idx, 1);
      saveTemplates();
      emitDataChanged('delete', 'templates');
      return true;
    }
    return false;
  }

  /* ---------- Releases CRUD ---------- */

  /** @returns {Release[]} */
  function getReleases()    { return releases; }

  /** @param {Release} release */
  function createRelease(release) {
    if (!release.id) release.id = generateId();
    if (!release.createdAt) release.createdAt = new Date().toISOString();
    release.status = release.status || 'draft';
    releases.push(release);
    saveReleases();
    emitDataChanged('create', 'releases');
    return release;
  }

  /** @param {string} id */
  function getReleaseById(id) {
    return releases.find(function (r) { return r.id === id; }) || null;
  }

  /** @param {Release} release */
  function updateRelease(release) {
    var idx = releases.findIndex(function (r) { return r.id === release.id; });
    if (idx !== -1) {
      releases[idx] = release;
      saveReleases();
      emitDataChanged('update', 'releases');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteRelease(id) {
    var idx = releases.findIndex(function (r) { return r.id === id; });
    if (idx !== -1) {
      releases.splice(idx, 1);
      saveReleases();
      emitDataChanged('delete', 'releases');
      return true;
    }
    return false;
  }

  /* ---------- Notifications CRUD ---------- */

  /** @returns {Notification[]} */
  function getNotifications()   { return notifications; }

  /** @param {Notification} notification */
  function createNotification(notification) {
    if (!notification.id) notification.id = generateId();
    notification.createdAt = new Date().toISOString();
    notification.read = false;
    notifications.unshift(notification);
    saveNotifications();
    emitDataChanged('create', 'notifications');
    return notification;
  }

  /** @param {string} id */
  function markNotificationRead(id) {
    var n = notifications.find(function (n) { return n.id === id; });
    if (n) {
      n.read = true;
      saveNotifications();
      emitDataChanged('update', 'notifications');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteNotification(id) {
    var idx = notifications.findIndex(function (n) { return n.id === id; });
    if (idx !== -1) {
      notifications.splice(idx, 1);
      saveNotifications();
      emitDataChanged('delete', 'notifications');
      return true;
    }
    return false;
  }

  /* ---------- Calendar Events CRUD ---------- */

  /** @returns {CalendarEvent[]} */
  function getCalendarEvents()   { return calendarEvents; }

  /** @param {CalendarEvent} event */
  function createCalendarEvent(event) {
    if (!event.id) event.id = generateId();
    if (!event.createdAt) event.createdAt = new Date().toISOString();
    calendarEvents.push(event);
    saveCalendarEvents();
    emitDataChanged('create', 'calendarEvents');
    return event;
  }

  /** @param {string} id */
  function getCalendarEventById(id) {
    return calendarEvents.find(function (e) { return e.id === id; }) || null;
  }

  /** @param {CalendarEvent} event */
  function updateCalendarEvent(event) {
    var idx = calendarEvents.findIndex(function (e) { return e.id === event.id; });
    if (idx !== -1) {
      calendarEvents[idx] = event;
      saveCalendarEvents();
      emitDataChanged('update', 'calendarEvents');
      return true;
    }
    return false;
  }

  /** @param {string} id */
  function deleteCalendarEvent(id) {
    var idx = calendarEvents.findIndex(function (e) { return e.id === id; });
    if (idx !== -1) {
      calendarEvents.splice(idx, 1);
      saveCalendarEvents();
      emitDataChanged('delete', 'calendarEvents');
      return true;
    }
    return false;
  }

  /* ---------- Import / Export ---------- */

  /**
   * Daten als JSON-Datei herunterladen.
   */
  function exportJSON() {
    var data = {
      version:        '1.0',
      exportedAt:     new Date().toISOString(),
      projects:       projects,
      tasks:          tasks,
      employees:      employees,
      labels:         labels,
      templates:      templates,
      releases:       releases,
      notifications:  notifications,
      calendarEvents: calendarEvents
    };

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'projekt-dashboard-export-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  }

  /**
   * JSON-Daten aus einer Datei importieren.
   * @param {File} file — JSON-Datei
   * @returns {Promise<boolean>}
   */
  function importJSON(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);

          if (data.projects && Array.isArray(data.projects))   replaceArray(projects, data.projects);
          if (data.tasks     && Array.isArray(data.tasks))     replaceArray(tasks, data.tasks);
          if (data.employees && Array.isArray(data.employees)) replaceArray(employees, data.employees);
          if (data.labels    && Array.isArray(data.labels))    replaceArray(labels, data.labels);
          if (data.templates && Array.isArray(data.templates)) replaceArray(templates, data.templates);
          if (data.releases  && Array.isArray(data.releases))  replaceArray(releases, data.releases);
          if (data.notifications  && Array.isArray(data.notifications))  replaceArray(notifications, data.notifications);
          if (data.calendarEvents && Array.isArray(data.calendarEvents)) replaceArray(calendarEvents, data.calendarEvents);

          normalizeProjectsCollection();
          normalizeTasksCollection();
          syncAllTaskCalendarEvents();

          saveProjects();
          saveTasks();
          saveEmployees();
          saveLabels();
          saveTemplates();
          saveReleases();
          saveNotifications();
          saveCalendarEvents();

          emitDataChanged('import', 'all');

          resolve(true);
        } catch (err) {
          console.error('[DataLayer] Fehler beim Import:', err);
          reject(err);
        }
      };

      reader.onerror = function () {
        reject(new Error('Datei konnte nicht gelesen werden.'));
      };

      reader.readAsText(file);
    });
  }

  /**
   * Alle Daten zurücksetzen (leeren).
   */
  function resetAll() {
    replaceArray(projects, []);
    replaceArray(tasks, []);
    replaceArray(employees, []);
    replaceArray(labels, []);
    replaceArray(templates, []);
    replaceArray(releases, []);
    replaceArray(notifications, []);
    replaceArray(calendarEvents, []);

    saveProjects();
    saveTasks();
    saveEmployees();
    saveLabels();
    saveTemplates();
    saveReleases();
    saveNotifications();
    saveCalendarEvents();
    emitDataChanged('reset', 'all');
  }

  /* ---------- Event Bus (simple publish/subscribe) ---------- */
  var _eventListeners = {};

  function on(event, callback) {
    if (!_eventListeners[event]) _eventListeners[event] = [];
    _eventListeners[event].push(callback);
  }

  function emit(event) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (_eventListeners[event]) {
      _eventListeners[event].forEach(function (cb) { cb.apply(null, args); });
    }
  }

  /* ---------- Export to Global Scope ---------- */
  window.DataLayer = {
    // Raw data arrays
    projects:       projects,
    tasks:          tasks,
    employees:      employees,
    labels:         labels,
    templates:      templates,
    releases:       releases,
    notifications:  notifications,
    calendarEvents: calendarEvents,

    // Projects CRUD
    getProjects:     getProjects,
    createProject:   createProject,
    getProjectById:  getProjectById,
    updateProject:   updateProject,
    deleteProject:   deleteProject,
    markProjectBlocked: markProjectBlocked,
    resolveProjectBlock: resolveProjectBlock,

    // Tasks CRUD
    getTasks:           getTasks,
    getTasksFiltered:   getTasksFiltered,
    createTask:         createTask,
    getTaskById:        getTaskById,
    updateTask:         updateTask,
    deleteTask:         deleteTask,
    markTaskBlocked:    markTaskBlocked,
    resolveTaskBlock:   resolveTaskBlock,

    // Employees CRUD
    getEmployees:     getEmployees,
    createEmployee:   createEmployee,
    getEmployeeById:  getEmployeeById,
    updateEmployee:   updateEmployee,
    deleteEmployee:   deleteEmployee,

    // Labels CRUD
    getLabels:      getLabels,
    createLabel:    createLabel,
    getLabelById:   getLabelById,
    updateLabel:    updateLabel,
    deleteLabel:    deleteLabel,

    // Templates CRUD
    getTemplates:     getTemplates,
    createTemplate:   createTemplate,
    getTemplateById:  getTemplateById,
    updateTemplate:   updateTemplate,
    deleteTemplate:   deleteTemplate,

    // Releases CRUD
    getReleases:      getReleases,
    createRelease:    createRelease,
    getReleaseById:   getReleaseById,
    updateRelease:    updateRelease,
    deleteRelease:    deleteRelease,

    // Notifications CRUD
    getNotifications:     getNotifications,
    createNotification:   createNotification,
    markNotificationRead: markNotificationRead,
    deleteNotification:   deleteNotification,

    // Calendar Events CRUD
    getCalendarEvents:      getCalendarEvents,
    createCalendarEvent:    createCalendarEvent,
    getCalendarEventById:   getCalendarEventById,
    updateCalendarEvent:    updateCalendarEvent,
    deleteCalendarEvent:    deleteCalendarEvent,

    // Blocker orchestration
    linkBlockerToTarget: linkBlockerToTarget,
    resolveBlocker:      resolveBlocker,
    canResolveBlocker:   canResolveBlocker,

    // Import / Export
    exportJSON:  exportJSON,
    importJSON:  importJSON,
    resetAll:    resetAll,

    // SQLite database file
    openDatabaseFile: openDatabaseFile,
    saveDatabaseFile: persistDatabaseFile,
    newDatabaseFile: newDatabaseFile,
    getStoredValue: getStoredValue,
    setStoredValue: setStoredValue,
    deleteStoredValue: deleteStoredValue,
    getDatabaseStatus: function () {
      return {
        ready: dbReady,
        hasFile: !!dbFileHandle,
        fileName: dbFileName,
        remoteKvReachable: remoteKvReachable,
        remoteKvPath: remoteKvActivePath || remoteKvPath
      };
    },
    getStorageStatus: getStorageStatus,
    checkStorageHealth: checkStorageHealth,
    refreshFromRemote: refreshFromRemote,
    hasData: hasCoreData,

    // Event Bus
    on:    on,
    emit:  emit,

    // Utility
    generateId: generateId
  };

  window.DataLayer.ready = runStartupHydration();

})();

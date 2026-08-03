(function() {
  'use strict';

  var NAMESPACE = 'App';

  // --- Page-Sidebar Mapping ---
  var PAGE_MAP = {
    dashboard:      'dashboard',
    kanban:         'kanban',
    calendar:       'calendar',
    analytics:      'analytics',
    employees:      'employees',
    labels:         'labels',
    healthcheck:    'healthcheck',
    releases:       'releases',
    standup:        'standup',
    documentation:  'documentation',
    notifications:  'notifications',
    templates:      'templates',
    sharing:        'sharing',
    integrations:   'integrations'
  };

  // --- Current Page State ---
  var currentPage = null;

  /* ============================================================
     ROUTER — Switch zwischen Seiten per Hash oder Nav-Klick
     ============================================================ */
  function navigateTo(page) {
    page = page || 'dashboard';

    if (!PAGE_MAP[page]) {
      console.warn('[' + NAMESPACE + '] Unknown page: ' + page);
      return;
    }

    // Hash setzen (ohne Neuladen)
    window.location.hash = 'page=' + page;

    // Alte Seite ausblenden, neue zeigen
    var oldPage = document.getElementById(currentPage);
    if (oldPage) {
      oldPage.classList.remove('active');
    }

    var newSection = document.getElementById(page);
    if (!newSection) {
      console.warn('[' + NAMESPACE + '] Section #"' + page + '" nicht gefunden.');
      return;
    }
    newSection.classList.add('active');

    currentPage = page;

    // Nav-Links aktualisieren
    var navLinks = document.querySelectorAll('.nav-menu a[data-page]');
    navLinks.forEach(function(link) {
      if (link.dataset.page === page) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Seite-spezifische Module nachladen/initialisieren
    loadPageModule(page);
  }

  function loadPageModule(page) {
    try {
      switch (page) {
        case 'kanban':
          // Kanban-Modul ist bereits als Script geladen, einfach neu rendern
          if (window.KanbanBoard && typeof window.KanbanBoard.renderAllColumns === 'function') {
            window.KanbanBoard.renderAllColumns();
          }
          break;

        case 'dashboard':
          // Dashboard-Module ist bereits als Script geladen, einfach neu rendern
          if (window.DashboardManager && typeof window.DashboardManager.refresh === 'function') {
            window.DashboardManager.refresh();
          }
          break;

        case 'calendar':
          initCalendar();
          break;

        default:
          break;
      }
    } catch(e) { console.error('[' + NAMESPACE + '] loadPageModule error:', e); }
  }

  /* ============================================================
     NAVIGATION — Nav-Item Klicks abfangen
     ============================================================ */
  function setupNavigation() {
    var navLinks = document.querySelectorAll('.nav-menu a[data-page]');
    navLinks.forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        navigateTo(this.dataset.page);
      });
    });

    // Browser-Back/Forward (Hash-Change)
    window.addEventListener('hashchange', function() {
      var hash = window.location.hash;
      if (hash.indexOf('page=') === 0) {
        var page = hash.substring(5);
        navigateTo(page);
      }
    });

    // Initiale Seite aus Hash oder default 'dashboard'
    var initialHash = window.location.hash;
    if (initialHash && initialHash.indexOf('page=') === 0) {
      navigateTo(initialHash.substring(5));
    } else {
      navigateTo('dashboard');
    }
  }

  /* ============================================================
     THEME TOGGLE — Dark/Light Mode umschalten
     ============================================================ */
  function setupThemeToggle() {
    var themeBtn = document.getElementById('theme-toggle');
    if (!themeBtn) return;

    // Gespeicherten Theme-Lookup aus localStorage
    var savedTheme = localStorage.getItem(NAMESPACE + '_theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      themeBtn.textContent = '\u2601\uFE0F'; // Cloud
    } else {
      themeBtn.textContent = '\uD83C\uDF13';  // Moon
    }

    themeBtn.addEventListener('click', function() {
      document.body.classList.toggle('light-mode');
      var isLight = document.body.classList.contains('light-mode');
      localStorage.setItem(NAMESPACE + '_theme', isLight ? 'light' : 'dark');
      this.textContent = isLight ? '\u2601\uFE0F' : '\uD83C\uDF13';

      // Bestehende Module über Theme-Wechsel informieren (falls nötig)
      if (window.KanbanBoard && typeof window.KanbanBoard.renderAllColumns === 'function') {
        window.KanbanBoard.renderAllColumns();
      }
    });
  }

  /* ============================================================
     EXPORT / IMPORT — JSON Daten exportieren/importieren
     ============================================================ */
  function setupExportImport() {
    var exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        try {
          window.DataLayer.exportJSON();
        } catch(e) {
          console.error('[' + NAMESPACE + '] Export error:', e);
          alert('Export fehlgeschlagen: ' + e.message);
        }
      });
    }

    var importBtn = document.getElementById('import-btn');
    if (importBtn) {
      importBtn.addEventListener('click', function() {
        // Hidden file input erstellen für Import
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';

        input.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (!file) return;

          // Datei auf JSON-Validität prüfen
          if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
            alert('Bitte eine .json-Datei auswählen.');
            return;
          }

          try {
            window.DataLayer.importJSON(file).then(function() {
              // Alle Module über Datenänderung informieren
              window.DataLayer.emit('dataChanged');
              // Aktuelle Seite neu rendern
              if (currentPage) loadPageModule(currentPage);
              alert('Daten erfolgreich importiert!');
            }).catch(function(err) {
              console.error('[' + NAMESPACE + '] Import error:', err);
              alert('Import fehlgeschlagen: ' + err.message);
            });
          } catch(e) {
            console.error('[' + NAMESPACE + '] Import setup error:', e);
            alert('Import fehlgeschlagen.');
          }
        });

        input.click();
      });
    }
  }

  /* ============================================================
     KALENDER — Minimaler Kalender für die calendar page
     ============================================================ */
  var _calState = { year: null, month: null };

  function initCalendar() {
    try {
      var grid = document.getElementById('calendar-grid');
      if (!grid) return;

      // Falls keine Daten, initialisiere auf aktuellen Monat
      if (!_calState.year || !_calState.month) {
        _calState.year = new Date().getFullYear();
        _calState.month = new Date().getMonth();
      }

      renderCalendar(_calState.year, _calState.month);
    } catch(e) { console.error('[' + NAMESPACE + '] initCalendar error:', e); }
  }

  function renderCalendar(year, month) {
    var grid = document.getElementById('calendar-grid');
    if (!grid) return;

    var currentMonthLabel = document.getElementById('cal-current-month');
    if (currentMonthLabel) {
      currentMonthLabel.textContent = new Date(year, month).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    }

    _calState.year = year;
    _calState.month = month;

    // Kalender-Grid rendern (vereinfacht)
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    // Montag als ersten Wochentag (DE-Format)
    var startOffset = firstDay === 0 ? 6 : firstDay - 1;

    var html = '';
    // Wochentage-Kopf
    ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(function(d) {
      html += '<div class="calendar-day-header">' + d + '</div>';
    });

    // Leere Zellen vor dem 1. des Monats
    for (var i = 0; i < startOffset; i++) {
      html += '<div class="calendar-cell calendar-empty"></div>';
    }

    // Tage des Monats
    var today = new Date();
    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month, day);
      var isToday = cellDate.toDateString() === today.toDateString();
      html += '<div class="calendar-cell' + (isToday ? ' calendar-today' : '') + '">' + day + '</div>';
    }

    grid.innerHTML = html;
  }

  function setupCalendarControls() {
    var prevBtn = document.getElementById('cal-prev-month');
    if (prevBtn) {
      prevBtn.addEventListener('click', function() {
        _calState.month--;
        if (_calState.month < 0) {
          _calState.month = 11;
          _calState.year--;
        }
        renderCalendar(_calState.year, _calState.month);
      });
    }

    var nextBtn = document.getElementById('cal-next-month');
    if (nextBtn) {
      nextBtn.addEventListener('click', function() {
        _calState.month++;
        if (_calState.month > 11) {
          _calState.month = 0;
          _calState.year++;
        }
        renderCalendar(_calState.year, _calState.month);
      });
    }
  }

  /* ============================================================
     DYNAMIC SCRIPT LOADER — Module nachladen wenn nötig
     ============================================================ */
  var _loadedModules = {};

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      if (_loadedModules[src]) { resolve(); return; }

      // Prüfe ob das Script bereits geladen wurde (als Script-Tag im DOM)
      if (document.querySelector('script[src="' + src + '"]')) {
        _loadedModules[src] = true;
        resolve();
        return;
      }

      var script = document.createElement('script');
      script.src = src;
      script.onload = function() {
        _loadedModules[src] = true;
        resolve();
      };
      script.onerror = function() { reject(new Error('Script konnte nicht geladen werden: ' + src)); };
      document.head.appendChild(script);
    });
  }

  // --- Module-Liste für dynamisches Laden ---
  var MODULE_SCRIPTS = {
    kanban:       './modules/kanban.js',
    dashboard:    './modules/dashboard.js',
    employees:    './modules/employees.js',
    labels:       './modules/labels.js',
    healthcheck:  './modules/healthcheck.js',
    releases:     './modules/releases.js',
    standup:      './modules/standup.js',
    documentation:null,   // keine separate Datei nötig
    notifications:'./modules/notification-manager.js', // optional
    templates:    './modules/templates.js',
    sharing:      null,
    integrations: null,
    calendar:     null  // Inline in app.js
  };

  /* ============================================================
     INIT — Hauptinitialisierung
     ============================================================ */
  function init() {
    try {
        // Legacy aliases for modules that still call unqualified function names.
        if (typeof window.renderLabelList !== 'function' && typeof window['LabelManager.renderLabelList'] === 'function') {
          window.renderLabelList = function(containerId) {
            return window['LabelManager.renderLabelList'](containerId);
          };
        }
        if (typeof window.renderTemplateList !== 'function' && typeof window['TemplateManager.renderTemplateList'] === 'function') {
          window.renderTemplateList = function(containerId) {
            return window['TemplateManager.renderTemplateList'](containerId);
          };
        }
        if (typeof window.getRollingReleaseView !== 'function' && typeof window['ReleaseManager.getRollingReleaseView'] === 'function') {
          window.getRollingReleaseView = function(containerId, projectId) {
            return window['ReleaseManager.getRollingReleaseView'](containerId, projectId);
          };
        }
        if (typeof window.createRelease !== 'function' && typeof window['ReleaseManager.createRelease'] === 'function') {
          window.createRelease = function(projectId, version, description) {
            return window['ReleaseManager.createRelease'](projectId, version, description);
          };
        }
        if (typeof window.generateChangelog !== 'function' && typeof window['ReleaseManager.generateChangelog'] === 'function') {
          window.generateChangelog = function(releaseId) {
            return window['ReleaseManager.generateChangelog'](releaseId);
          };
        }

      setupNavigation();
      setupThemeToggle();
      setupExportImport();
      setupCalendarControls();

      console.log('[' + NAMESPACE + '] App initialisiert.');
    } catch(e) {
      console.error('[' + NAMESPACE + '] Init error:', e);
    }
  }

  // Starte die App wenn DOM ready oder sofort wenn bereits geladen
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

// Feature 8 — Suche & Filter
(function() {
    'use strict';

    var NAMESPACE = 'SearchManager';

    // --- Hilfsfunktionen ---
    function loadData(key, fallback) {
        try {
            if (window.DataLayer) {
                if (key === 'projects' && window.DataLayer.getProjects) return window.DataLayer.getProjects() || (fallback || []);
                if (key === 'tasks' && window.DataLayer.getTasks) return window.DataLayer.getTasks() || (fallback || []);
                if (key === 'employees' && window.DataLayer.getEmployees) return window.DataLayer.getEmployees() || (fallback || []);
                if (key === 'labels' && window.DataLayer.getLabels) return window.DataLayer.getLabels() || (fallback || []);
                if (key === 'templates' && window.DataLayer.getTemplates) return window.DataLayer.getTemplates() || (fallback || []);
                if (key === 'releases' && window.DataLayer.getReleases) return window.DataLayer.getReleases() || (fallback || []);
                if (key === 'notifications' && window.DataLayer.getNotifications) return window.DataLayer.getNotifications() || (fallback || []);
                if (key === 'calendarEvents' && window.DataLayer.getCalendarEvents) return window.DataLayer.getCalendarEvents() || (fallback || []);
            }
            var raw = localStorage.getItem(NAMESPACE + '_' + key);
            return raw ? JSON.parse(raw) : (fallback || []);
        } catch (e) {
            console.warn('[' + NAMESPACE + '] Load error for ' + key, e);
            return fallback || [];
        }
    }

    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // --- fullTextSearch(query) — Volltextsuche über alle Projekte/Tasks ---
    window[NAMESPACE + '.fullTextSearch'] = function(query) {
        try {
            if (!query || typeof query !== 'string') return [];

            var q = query.toLowerCase().trim();
            if (q.length < 2) return [];

            var results = [];
            var projects = loadData('projects', []);
            var employees = loadData('employees', []);
            var tasks = loadData('tasks', []);

            // Suche in Projekten
            (projects || []).forEach(function(proj) {
                var textToSearch = '';
                if (proj.name) textToSearch += proj.name + ' ';
                if (proj.description) textToSearch += proj.description + ' ';
                if (proj.status) textToSearch += proj.status + ' ';

                if (textToSearch.toLowerCase().indexOf(q) !== -1) {
                    results.push({
                        type: 'project',
                        id: proj.id,
                        title: proj.name || 'Projekt',
                        description: proj.description || '',
                        score: calculateRelevance(textToSearch, q),
                        url: '#project-' + proj.id
                    });
                }

                // Suche in Tasks des Projekts
                var projectTasks = (tasks || []).filter(function(task) {
                    return task.projectId === proj.id;
                });
                projectTasks.forEach(function(task) {
                    var taskText = '';
                    if (task.title) taskText += task.title + ' ';
                    if (task.description) taskText += task.description + ' ';
                    if (task.comments) {
                        Array.isArray(task.comments) && task.comments.forEach(function(c) {
                            if (c.text || c.message) taskText += c.text || c.message + ' ';
                        });
                    }

                    if (taskText.toLowerCase().indexOf(q) !== -1) {
                        results.push({
                            type: 'task',
                            id: task.id,
                            title: task.title || 'Aufgabe',
                            description: task.description || '',
                            projectId: proj.id,
                            projectName: proj.name,
                            score: calculateRelevance(taskText, q),
                            url: '#project-' + (proj.id) + '-task-' + task.id
                        });
                    }
                });

                // Suche in Projekt-Dokumentation
                if (proj.documentation && typeof proj.documentation === 'object') {
                    var docContent = JSON.stringify(proj.documentation).toLowerCase();
                    if (docContent.indexOf(q) !== -1) {
                        results.push({
                            type: 'documentation',
                            id: proj.id,
                            title: proj.name + ' — Dokumentation',
                            description: 'Projekt-Dokumentation enthält Suchbegriff.',
                            score: calculateRelevance(docContent, q),
                            url: '#project-' + proj.id + '-docs'
                        });
                    }
                }
            });

            // Suche in globalen Tasks (falls vorhanden)
            (tasks || []).forEach(function(task) {
                var taskText = '';
                if (task.title) taskText += task.title + ' ';
                if (task.description) taskText += task.description + ' ';
                if (task.comments && Array.isArray(task.comments)) {
                    task.comments.forEach(function(c) {
                        if (c.text || c.message) taskText += c.text || c.message + ' ';
                    });
                }

                if (taskText.toLowerCase().indexOf(q) !== -1) {
                    results.push({
                        type: 'global-task',
                        id: task.id,
                        title: task.title || 'Aufgabe',
                        description: task.description || '',
                        score: calculateRelevance(taskText, q),
                        url: '#task-' + task.id
                    });
                }
            });

            // Suche in Mitarbeiternamen/Rollen
            (employees || []).forEach(function(emp) {
                var empText = (emp.name + ' ' + emp.role).toLowerCase();
                if (empText.indexOf(q) !== -1) {
                    results.push({
                        type: 'employee',
                        id: emp.id,
                        title: emp.name,
                        description: emp.role || '',
                        score: calculateRelevance(empText, q),
                        url: '#employee-' + emp.id
                    });
                }
            });

            // Nach Relevanz sortieren (höchster Score zuerst) und Limit auf 50
            results.sort(function(a, b) { return b.score - a.score; });
            return results.slice(0, 50);
        } catch (e) {
            console.error('[' + NAMESPACE + '] fullTextSearch error:', e);
            return [];
        }
    };

    function calculateRelevance(text, query) {
        var score = 0;
        var textLower = text.toLowerCase();
        var qLower = query.toLowerCase();

        if (textLower === qLower) score += 100;
        if (textLower.indexOf(qLower) === 0) score += 50; // beginnt mit dem Suchbegriff
        score += (textLower.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length * 10;

        return Math.min(score, 100);
    }

    // --- filterProjects(criteria) — Filter nach verschiedenen Kriterien ---
    window[NAMESPACE + '.filterProjects'] = function(criteria) {
        try {
            if (!criteria) criteria = {};
            var projects = loadData('projects', []);

            return (projects || []).filter(function(proj) {
                // Status-Filter
                if (criteria.status && proj.status !== criteria.status) return false;

                // Mitarbeiter-Filter (über Tasks/Assignments)
                if (criteria.employeeId) {
                    var assignments = loadData('assignments', []);
                    var empTasks = assignments.filter(function(a) { return a.employeeId === criteria.employeeId; });
                    var taskIds = empTasks.map(function(a) { return a.taskId; });

                    var hasMatch = false;
                    (proj.tasks || []).forEach(function(t) {
                        if (taskIds.indexOf(t.id) !== -1) hasMatch = true;
                    });
                    if (!hasMatch) return false;
                }

                // Abteilung/Department-Filter
                if (criteria.department && proj.department) {
                    if (proj.department.toLowerCase() !== criteria.department.toLowerCase()) return false;
                }

                // Prioritäts-Filter
                if (criteria.priority && proj.priority) {
                    var prioMatch = { 'Hoch': 'Hoch', 'Normal': 'Normal', 'Niedrig': 'Niedrig' };
                    if (prioMatch[criteria.priority] !== proj.priority) return false;
                }

                // DateRange-Filter
                if (criteria.dateFrom && proj.createdAt) {
                    var from = new Date(criteria.dateFrom);
                    if (new Date(proj.createdAt) < from) return false;
                }
                if (criteria.dateTo && proj.updatedAt) {
                    var to = new Date(criteria.dateTo);
                    if (new Date(proj.updatedAt) > to) return false;
                }

                // Projekt-Name Filter (Teilstring)
                if (criteria.name) {
                    if ((proj.name || '').toLowerCase().indexOf((criteria.name || '').toLowerCase()) === -1) return false;
                }

                return true;
            });
        } catch (e) {
            console.error('[' + NAMESPACE + '] filterProjects error:', e);
            return [];
        }
    };

    // --- renderSearchResults(results) — Ergebnisse anzeigen mit Highlighting ---
    window[NAMESPACE + '.renderSearchResults'] = function(results, containerId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) { console.warn('[' + NAMESPACE + '] Container #' + containerId + ' nicht gefunden'); return; }

            results = results || [];

            if (results.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:32px;color:#9ca3af;">' +
                    '<p>Keine Ergebnisse gefunden.</p></div>';
                return;
            }

            var html = '<div class="search-results" style="display:flex;flex-direction:column;gap:8px;">';

            results.forEach(function(r) {
                // Highlighting: Suchbegriff fett hervorheben
                var highlightedTitle = highlightText(r.title, window[NAMESPACE + '.lastQuery'] || '');
                var highlightedDesc = r.description ? highlightText(r.description, window[NAMESPACE + '.lastQuery'] || '') : '';

                html += '<div class="search-result-item" style="padding:12px 16px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;" ' +
                    'onclick="' + NAMESPACE + '.navigateToResult(\'' + (r.url || '#') + '\')" >' +
                    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
                        '<span class="badge" style="padding:2px 6px;border-radius:4px;font-size:10px;background:#f3f4f6;color:#6b7280;text-transform:uppercase;">' + r.type + '</span>' +
                        '<strong style="color:#1f2937;font-size:14px;">' + highlightedTitle + '</strong>';

                if (r.score) {
                    html += '<span style="margin-left:auto;font-size:11px;color:#6b7280;">Relevanz: ' + Math.round(r.score) + '%</span>';
                }
                html += '</div>';

                if (highlightedDesc) {
                    html += '<p style="margin:0 0 4px;font-size:13px;color:#6b7280;line-height:1.4;">' + highlightedDesc + '</p>';
                }
                if (r.projectName) {
                    html += '<small style="color:#9ca3af;">Projekt: ' + escapeHtml(r.projectName) + '</small>';
                }
                html += '</div>';
            });

            html += '</div>';
            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] renderSearchResults error:', e);
        }
    };

    function highlightText(text, query) {
        if (!query || !text) return escapeHtml(text || '');
        var escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        try {
            var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
            return escaped.replace(regex, '<mark style="background:#fef08a;padding:1px 2px;border-radius:2px;">$1</mark>');
        } catch (e) {
            return escaped;
        }
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // --- navigateToResult(url) — Zur Ergebnis-Navigation ---
    window[NAMESPACE + '.navigateToResult'] = function(url) {
        try {
            if (url && url !== '#') {
                var sectionId = url.replace('#', '');
                var target = document.getElementById(sectionId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                } else {
                    window.location.hash = url;
                }
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] navigateToResult error:', e);
        }
    };

    // --- getFilterUI() — Filterleiste generieren ---
    window[NAMESPACE + '.getFilterUI'] = function(containerId, onApply) {
        try {
            var container = document.getElementById(containerId);
            if (!container) return;

            // Lade Daten für Dropdowns
            var projects = loadData('projects', []);
            var employees = loadData('employees', [] || []);

            var statusOptions = ['Alle', 'Geplant', 'In Arbeit', 'In Prüfung', 'Abgeschlossen', 'Storniert'];
            var priorityOptions = ['Alle', 'Hoch', 'Normal', 'Niedrig'];

            var html = '<div class="filter-bar" style="display:flex;flex-wrap:wrap;gap:10px;padding:16px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:16px;">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<label style="font-size:13px;font-weight:500;color:#374151;">Status:</label>' +
                    '<select id="filter_status" data-filter-key="status" ' +
                        'style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;">';

            statusOptions.forEach(function(opt) {
                html += '<option value="' + (opt === 'Alle' ? '' : opt) + '">' + escapeHtml(opt) + '</option>';
            });

            html += '</select></div>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<label style="font-size:13px;font-weight:500;color:#374151;">Priorität:</label>' +
                    '<select id="filter_priority" data-filter-key="priority" ' +
                        'style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;">';

            priorityOptions.forEach(function(opt) {
                html += '<option value="' + (opt === 'Alle' ? '' : opt) + '">' + escapeHtml(opt) + '</option>';
            });

            html += '</select></div>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<label style="font-size:13px;font-weight:500;color:#374151;">Mitarbeiter:</label>' +
                    '<select id="filter_employee" data-filter-key="employeeId" ' +
                        'style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;">' +
                            '<option value="">Alle</option>';

            (employees || []).forEach(function(emp) {
                html += '<option value="' + emp.id + '">' + escapeHtml(emp.name) + '</option>';
            });

            html += '</select></div>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<label style="font-size:13px;font-weight:500;color:#374151;">Von:</label>' +
                    '<input type="date" id="filter_dateFrom" data-filter-key="dateFrom" ' +
                        'style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;"></div>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<label style="font-size:13px;font-weight:500;color:#374151;">Bis:</label>' +
                    '<input type="date" id="filter_dateTo" data-filter-key="dateTo" ' +
                        'style="padding:6px 10px;border-radius:6px;border:1px solid #d1d5db;font-size:13px;"></div>';

            html += '<div style="display:flex;gap:8px;margin-left:auto;">' +
                '<button onclick="' + NAMESPACE + '.applyFilters(\'filter-container\')" ' +
                    'style="padding:7px 14px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;font-size:13px;">Filter anwenden</button>' +
                '<button onclick="' + NAMESPACE + '.clearFilters()" ' +
                    'style="padding:7px 14px;border-radius:6px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:13px;">Filter löschen</button>' +
            '</div></div>';

            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] getFilterUI error:', e);
        }
    };

    // --- applyFilters(containerId) — Filter anwenden ---
    window[NAMESPACE + '.applyFilters'] = function(containerId) {
        try {
            var criteria = {};

            var statusEl = document.getElementById('filter_status');
            if (statusEl && statusEl.value) criteria.status = statusEl.value;

            var priorityEl = document.getElementById('filter_priority');
            if (priorityEl && priorityEl.value) criteria.priority = priorityEl.value;

            var empEl = document.getElementById('filter_employee');
            if (empEl && empEl.value) criteria.employeeId = empEl.value;

            var dateFromEl = document.getElementById('filter_dateFrom');
            if (dateFromEl && dateFromEl.value) criteria.dateFrom = dateFromEl.value;

            var dateToEl = document.getElementById('filter_dateTo');
            if (dateToEl && dateToEl.value) criteria.dateTo = dateToEl.value;

            // Rufe den Callback auf, wenn übergeben
            if (window[NAMESPACE + '.onFilterApplied']) {
                window[NAMESPACE + '.onFilterApplied'](criteria);
            }

            // Alternativ: filterProjects direkt aufrufen und rendern
            var filtered = window[NAMESPACE + '.filterProjects'](criteria);
            window[NAMESPACE + '.renderSearchResults'](filtered, 'search-results');
        } catch (e) {
            console.error('[' + NAMESPACE + '] applyFilters error:', e);
        }
    };

    // --- clearFilters() — Filter zurücksetzen ---
    window[NAMESPACE + '.clearFilters'] = function() {
        try {
            ['filter_status', 'filter_priority', 'filter_employee', 'filter_dateFrom', 'filter_dateTo'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });

            // Zeige alle Projekte
            var projects = window[NAMESPACE + '.filterProjects']({});
            window[NAMESPACE + '.renderSearchResults'](projects, 'search-results');
        } catch (e) {
            console.error('[' + NAMESPACE + '] clearFilters error:', e);
        }
    };

    // --- escapeHtml ---
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    window[NAMESPACE + '.escapeHtml'] = escapeHtml;

    // Compatibility bridge: supports inline handlers using SearchManager.method().
    (function exposeObjectNamespace() {
        var target = window.SearchManager || {};
        [
            'fullTextSearch',
            'filterProjects',
            'renderSearchResults',
            'navigateToResult',
            'buildAdvancedFilterUI',
            'applyFilters',
            'clearFilters',
            'escapeHtml'
        ].forEach(function(method) {
            target[method] = function() {
                var fn = window[NAMESPACE + '.' + method];
                if (typeof fn === 'function') {
                    return fn.apply(null, arguments);
                }
            };
        });
        window.SearchManager = target;
    })();

    window.SearchModule = {
        render: function() {
            // Search hat aktuell keine feste Seite mit Initial-Render,
            // die API bleibt für den globalen Refresh-Hook erhalten.
        }
    };

})();

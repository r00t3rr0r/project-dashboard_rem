// Feature 17 — Standup-Generator
(function() {
    'use strict';

    var NAMESPACE = 'StandupManager';

    // --- Daten-Layer ---
    function loadData(key, fallback) {
        try {
            if (window.DataLayer) {
                if (key === 'employees' && window.DataLayer.getEmployees) return window.DataLayer.getEmployees() || (fallback || []);
                if (key === 'projects' && window.DataLayer.getProjects) return window.DataLayer.getProjects() || (fallback || []);
                if (key === 'tasks' && window.DataLayer.getTasks) return window.DataLayer.getTasks() || (fallback || []);
            }
            var raw = localStorage.getItem(NAMESPACE + '_' + key);
            return raw ? JSON.parse(raw) : (fallback || []);
        } catch (e) {
            console.warn('[' + NAMESPACE + '] Load error for ' + key, e);
            return fallback || [];
        }
    }

    function saveData(key, data) {
        try {
            localStorage.setItem(NAMESPACE + '_' + key, JSON.stringify(data));
        } catch (e) {
            console.warn('[' + NAMESPACE + '] Save error for ' + key, e);
        }
    }

    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    function getLastStandupDate(empId) {
        return window[NAMESPACE + '.getLastStandupDate'](empId);
    }

    function generateStandupForEmployee(empId) {
        return window[NAMESPACE + '.generateStandupForEmployee'](empId);
    }

    // --- getLastStandupDate(empId) — Datum des letzten Standups ---
    window[NAMESPACE + '.getLastStandupDate'] = function(empId) {
        try {
            if (!empId) return null;
            var standups = getStandups();
            var empStandups = standups.filter(function(s) { return s.employeeId === empId; });
            empStandups.sort(function(a, b) { return new Date(b.date).getTime() - new Date(a.date).getTime(); });

            if (empStandups.length > 0) {
                var lastDate = new Date(empStandups[0].date);
                // Nur Datum zurückgeben
                return {
                    date: lastDate,
                    formatted: lastDate.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })
                };
            }
            return null;
        } catch (e) {
            console.error('[' + NAMESPACE + '] getLastStandupDate error:', e);
            return null;
        }
    };

    // --- generateStandupForEmployee(empId) — Generiert Standup für einen Mitarbeiter ---
    window[NAMESPACE + '.generateStandupForEmployee'] = function(empId) {
        try {
            if (!empId) return null;

            var employees = loadData('employees', [] || []);
            var emp = (employees || []).find(function(e) { return e.id === empId; });
            if (!emp) return null;

            // Finde letztes Standup-Datum
            var lastStandupInfo = getLastStandupDate(empId);
            var sinceLastStandup = lastStandupInfo ? new Date(lastStandupInfo.date) : getDaysAgo(7); // Default: letzte 7 Tage

            var standup = {
                id: generateId('standup'),
                employeeId: emp.id,
                employeeName: emp.name,
                generatedAt: new Date().toISOString(),
                sinceDate: sinceLastStandup.toISOString()
            };

            // --- "Was hast du gestern gemacht?" (Tasks abgeschlossen seit letztem Standup) ---
            var completedSince = [];
            collectCompletedTasks(sinceLastStandup, function(task, projName) {
                completedSince.push({
                    title: task.title || 'Unbenannte Aufgabe',
                    project: projName,
                    completedAt: task.completedAt || new Date().toISOString(),
                    priority: task.priority || ''
                });
            });

            standup.done = completedSince;

            // --- "Was machst du heute?" (In-Progress-Tasks) ---
            var inProgressTasks = [];
            collectInProgressTasks(function(task, projName) {
                if (task.assigneeId === emp.id || task.employeeName === emp.name || !task.assigneeId) {
                    inProgressTasks.push({
                        title: task.title || 'Unbenannte Aufgabe',
                        project: projName,
                        priority: task.priority || '',
                        status: task.status || ''
                    });
                }
            });

            standup.today = inProgressTasks;

            // --- "Blocker?" (Offene Blocker auflisten) ---
            var blockers = [];
            collectAllProjects(function(proj) {
                ((proj.tasks || []) || []).forEach(function(task) {
                    if (task.status === 'Blockiert' || task.blocked || (task.priority === 'Hoch' && !task.assigneeId)) {
                        blockers.push({
                            title: task.title || 'Unbenannte Aufgabe',
                            project: proj.name,
                            description: task.description || '',
                            priority: task.priority || ''
                        });
                    }
                });
            });

            standup.blockers = blockers;

            // Speichere Standup
            var standups = getStandups();
            standups.push({
                id: standup.id,
                employeeId: emp.id,
                date: new Date().toISOString(),
                doneCount: completedSince.length,
                todayCount: inProgressTasks.length,
                blockerCount: blockers.length
            });
            setStandups(standups);

            return standup;
        } catch (e) {
            console.error('[' + NAMESPACE + '] generateStandupForEmployee error:', e);
            return null;
        }
    };

    function getDaysAgo(days) {
        var d = new Date();
        d.setDate(d.getDate() - days);
        return d;
    }

    // --- generateTeamStandup() — Alle Mitarbeiter auf einmal ---
    window[NAMESPACE + '.generateTeamStandup'] = function() {
        try {
            var employees = loadData('employees', [] || []);
            if (!employees.length) return null;

            var teamStandup = {
                id: generateId('team-standup'),
                generatedAt: new Date().toISOString(),
                employeeCount: 0,
                totalDone: 0,
                totalInProgress: 0,
                totalBlockers: 0,
                employees: []
            };

            (employees || []).forEach(function(emp) {
                var standup = generateStandupForEmployee(emp.id);
                if (standup) {
                    teamStandup.employees.push({
                        name: emp.name,
                        role: emp.role,
                        doneCount: standup.done.length,
                        todayCount: standup.today.length,
                        blockerCount: standup.blockers.length,
                        blockers: standup.blockers,
                        todayTasks: standup.today
                    });

                    teamStandup.employeeCount++;
                    teamStandup.totalDone += standup.done.length;
                    teamStandup.totalInProgress += standup.today.length;
                    teamStandup.totalBlockers += standup.blockers.length;
                }
            });

            return teamStandup;
        } catch (e) {
            console.error('[' + NAMESPACE + '] generateTeamStandup error:', e);
            return null;
        }
    };

    // --- exportStandup(text, format: 'text'|'markdown') — Export als Text/Markdown ---
    window[NAMESPACE + '.exportStandup'] = function(standupData, format) {
        try {
            if (!standupData) return '';

            var output = '';

            if (format === 'markdown') {
                // Markdown Format
                output += '# 📋 Daily Standup\n\n';
                output += '**Datum:** ' + new Date().toLocaleDateString('de-DE') + '\n\n';

                standupData.employees.forEach(function(emp) {
                    output += '## 👤 ' + emp.name + ' (' + emp.role + ')\n\n';

                    output += '### ✅ Was wurde erledigt?\n\n';
                    if (emp.doneCount > 0) {
                        // Finde die Details aus dem Standup
                        var empStandup = standupData.employees.find(function(e) { return e.name === emp.name; });
                        // Zeige Summary
                        output += '- ' + emp.todayCount + ' Aufgabe(n) heute geplant\n';
                    } else {
                        output += '*Keine abgeschlossenen Aufgaben seit letztem Standup.*\n';
                    }

                    output += '\n### 📌 Was wird heute gemacht?\n\n';
                    if (emp.todayTasks && emp.todayTasks.length > 0) {
                        emp.todayTasks.forEach(function(t) {
                            output += '- ' + escapeHtml(t.title) + '\n';
                        });
                    } else {
                        output += '*Keine aktiven Aufgaben.*\n';
                    }

                    output += '\n### 🚧 Blocker?\n\n';
                    if (emp.blockers && emp.blockers.length > 0) {
                        emp.blockers.forEach(function(b) {
                            output += '- **' + escapeHtml(b.title) + '** — ' + escapeHtml(b.project || '') + '\n';
                            if (b.description) output += '  - ' + escapeHtml(b.description) + '\n';
                        });
                    } else {
                        output += '*Keine Blocker.*\n';
                    }

                    output += '\n---\n\n';
                });
            } else {
                // Plain Text Format
                output += '==================================================\n';
                output += '  DAILY STANDUP REPORT\n';
                output += '  Datum: ' + new Date().toLocaleDateString('de-DE') + '\n';
                output += '  Mitarbeiter: ' + standupData.employeeCount + '\n';
                output += '==================================================\n\n';

                standupData.employees.forEach(function(emp) {
                    output += '--------------------------------------------------\n';
                    output += '  ' + emp.name + ' (' + emp.role + ')\n';
                    output += '--------------------------------------------------\n\n';

                    output += '✅ ERLEDIGT:\n';
                    if (emp.doneCount > 0) {
                        output += '   ' + emp.todayCount + ' Aufgabe(n) geplant für heute\n';
                    } else {
                        output += '   Keine abgeschlossenen Aufgaben.\n';
                    }

                    output += '\n📌 HEUTE:\n';
                    if (emp.todayTasks && emp.todayTasks.length > 0) {
                        emp.todayTasks.forEach(function(t) {
                            output += '   • ' + t.title + '\n';
                        });
                    } else {
                        output += '   Keine aktiven Aufgaben.\n';
                    }

                    output += '\n🚧 BLOCKER:\n';
                    if (emp.blockers && emp.blockers.length > 0) {
                        emp.blockers.forEach(function(b) {
                            output += '   ⚠️ ' + b.title + ' (' + (b.project || '') + ')\n';
                            if (b.description) output += '      ' + b.description + '\n';
                        });
                    } else {
                        output += '   Keine Blocker.\n';
                    }

                    output += '\n\n';
                });

                output += '==================================================\n';
            }

            return output;
        } catch (e) {
            console.error('[' + NAMESPACE + '] exportStandup error:', e);
            return '';
        }
    };

    // --- renderStandup(empId, containerId) — Standup im Container anzeigen ---
    window[NAMESPACE + '.renderStandup'] = function(empId, containerId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) return;

            var standup = generateStandupForEmployee(empId);
            if (!standup) {
                container.innerHTML = '<div class="standup-empty-state">Kein Standup verfuegbar.</div>';
                return;
            }

            // Finde Mitarbeiter-Info
            var employees = loadData('employees', [] || []);
            var emp = (employees || []).find(function(e) { return e.id === empId; });
            if (!emp) return;

            function formatDate(isoStr) {
                try { return new Date(isoStr).toLocaleDateString('de-DE'); } catch(e) { return ''; }
            }

            var html = '<div class="standup-report-stack">' +
                '<div class="standup-report-card standup-report-card-done">' +
                    '<h3>Was wurde erledigt?</h3>';

            if (standup.done.length > 0) {
                html += '<ul class="standup-report-list">';
                standup.done.forEach(function(item) {
                    html += '<li>' + escapeHtml(item.title);
                    if (item.project) html += ' <small>(' + escapeHtml(item.project) + ')</small>';
                    html += '</li>';
                });
                html += '</ul>';
            } else {
                html += '<p class="standup-report-empty">Keine abgeschlossenen Aufgaben seit letztem Standup.</p>';
            }

            html += '</div>' +
                '<div class="standup-report-card standup-report-card-today">' +
                    '<h3>Was wird heute gemacht?</h3>';

            if (standup.today.length > 0) {
                html += '<ul class="standup-report-list">';
                standup.today.forEach(function(item) {
                    html += '<li>' + escapeHtml(item.title);
                    if (item.project) html += ' <small>(' + escapeHtml(item.project) + ')</small>';
                    html += '</li>';
                });
                html += '</ul>';
            } else {
                html += '<p class="standup-report-empty">Keine aktiven Aufgaben.</p>';
            }

            html += '</div>' +
                '<div class="standup-report-card ' + (standup.blockers.length > 0 ? 'standup-report-card-blockers' : 'standup-report-card-clear') + '">' +
                    '<h3>Blocker?</h3>';

            if (standup.blockers.length > 0) {
                html += '<ul class="standup-report-list">';
                standup.blockers.forEach(function(item) {
                    html += '<li>' + escapeHtml(item.title);
                    if (item.project) html += ' <small>(' + escapeHtml(item.project) + ')</small>';
                    html += '</li>';
                });
                html += '</ul>';
            } else {
                html += '<p class="standup-report-clear">Keine Blocker. Team kann ohne Hindernisse weiterarbeiten.</p>';
            }

            html += '</div></div>' +
                '<div class="standup-report-actions">' +
                    '<button onclick="' + NAMESPACE + '.exportAndDownload(\'' + empId + '\', \'markdown\')" ' +
                        'class="btn btn-primary">' +
                        'Als Markdown exportieren</button>' +
                    '<button onclick="' + NAMESPACE + '.exportAndDownload(\'' + empId + '\', \'text\')" ' +
                        'class="btn btn-secondary">' +
                        'Als Text exportieren</button>' +
                '</div>';

            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] renderStandup error:', e);
        }
    };

    // --- Helper: exportAndDownload für die Buttons ---
    window[NAMESPACE + '.exportAndDownload'] = function(empId, format) {
        try {
            var standup = generateStandupForEmployee(empId);
            if (!standup) return alert('Kein Standup verfügbar.');

            // Erstelle Team-Standup für Export (enthält alle Mitarbeiter)
            var teamStandalone = { employees: [{ name: 'Mitarbeiter', role: '', doneCount: standup.done.length, todayTasks: standup.today, blockers: standup.blockers }] };
            var exportData = window[NAMESPACE + '.exportStandup'](teamStandalone, format);

            // Download als Datei
            var blob = new Blob([exportData], { type: 'text/plain;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'standup-' + empId + '-' + new Date().toISOString().slice(0, 10) + '.' + (format === 'markdown' ? 'md' : 'txt');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[' + NAMESPACE + '] exportAndDownload error:', e);
        }
    };

    // --- Hilfsfunktionen für Tasksammlung ---
    function collectAllProjects(callback) {
        var projects = loadData('projects', [] || []);
        var tasks = loadData('tasks', []);
        (projects || []).forEach(function(proj) {
            var projTasks = (tasks || []).filter(function(t) { return t.projectId === proj.id; });
            callback({
                id: proj.id,
                name: proj.name || proj.title || 'Projekt',
                tasks: projTasks
            });
        });
    }

    function collectCompletedTasks(sinceDate, callback) {
        collectAllProjects(function(proj) {
            ((proj.tasks || []) || []).forEach(function(task) {
                if (task.status === 'done' || task.status === 'Done' || task.status === 'Abgeschlossen') {
                    var completed = new Date(task.completedAt || task.updatedAt || task.createdAt);
                    if (!isNaN(completed.getTime()) && completed >= sinceDate) {
                        callback(task, proj.name);
                    }
                }
            });
        });
    }

    function collectInProgressTasks(callback) {
        collectAllProjects(function(proj) {
            ((proj.tasks || []) || []).forEach(function(task) {
                if (task.status === 'in-progress' || task.status === 'In Arbeit' || task.status === 'In Progress') {
                    callback(task, proj.name);
                }
            });
        });
    }

    function renderStandupPage() {
        var formContainer = document.getElementById('standup-form');
        var entriesContainer = document.getElementById('standup-entries');
        if (!formContainer || !entriesContainer) return;

        var employees = loadData('employees', []);
        if (!employees.length) {
            formContainer.innerHTML = '<p class="standup-empty-state">Keine Mitarbeiter vorhanden.</p>';
            entriesContainer.innerHTML = '';
            return;
        }

        var options = employees.map(function(emp) {
            return '<option value="' + emp.id + '">' + escapeHtml(emp.name || 'Mitarbeiter') + '</option>';
        }).join('');

        formContainer.innerHTML = '<div class="standup-control-bar">' +
            '<label for="standup-employee">Mitarbeiter</label>' +
            '<select id="standup-employee">' + options + '</select>' +
            '<button id="standup-generate-btn" class="btn btn-primary">Standup generieren</button>' +
            '<button id="standup-team-btn" class="btn btn-secondary">Team-Uebersicht</button>' +
            '</div>';

        var defaultEmpId = employees[0].id;
        window[NAMESPACE + '.renderStandup'](defaultEmpId, 'standup-entries');

        document.getElementById('standup-generate-btn').addEventListener('click', function() {
            var selected = document.getElementById('standup-employee').value;
            window[NAMESPACE + '.renderStandup'](selected, 'standup-entries');
        });

        document.getElementById('standup-team-btn').addEventListener('click', function() {
            var team = window[NAMESPACE + '.generateTeamStandup']();
            if (!team) return;
            var html = '<div class="stat-card standup-team-card">' +
                '<h3>Team Standup</h3>' +
                '<p>Mitarbeiter: ' + team.employeeCount + '</p>' +
                '<p>Erledigt: ' + team.totalDone + '</p>' +
                '<p>Heute aktiv: ' + team.totalInProgress + '</p>' +
                '<p>Blocker: ' + team.totalBlockers + '</p>' +
                '</div>';
            entriesContainer.innerHTML = html;
        });
    }

    // --- Standup-Storage ---
    function getStandups() { return loadData('standups', []); }
    function setStandups(arr) { saveData('standups', arr); }

    // --- escapeHtml ---
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    window[NAMESPACE + '.escapeHtml'] = escapeHtml;

    // Compatibility bridge: supports inline handlers using StandupManager.method().
    (function exposeObjectNamespace() {
        var target = window.StandupManager || {};
        [
            'getLastStandupDate',
            'generateStandupForEmployee',
            'saveStandupEntry',
            'generateTeamStandup',
            'renderStandup',
            'exportAndDownload',
            'escapeHtml'
        ].forEach(function(method) {
            target[method] = function() {
                var fn = window[NAMESPACE + '.' + method];
                if (typeof fn === 'function') {
                    return fn.apply(null, arguments);
                }
            };
        });
        window.StandupManager = target;
    })();

    window.StandupModule = {
        render: renderStandupPage,
        init: renderStandupPage
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderStandupPage);
    } else {
        renderStandupPage();
    }

})();

// Feature 15 — Projekt-Gesundheits-Check
(function() {
    'use strict';

    var NAMESPACE = 'HealthCheckManager';

    // --- Daten-Layer ---
    function loadData(key, fallback) {
        try {
            if (window.DataLayer) {
                if (key === 'projects' && window.DataLayer.getProjects) return window.DataLayer.getProjects() || (fallback || []);
                if (key === 'tasks' && window.DataLayer.getTasks) return window.DataLayer.getTasks() || (fallback || []);
                if (key === 'employees' && window.DataLayer.getEmployees) return window.DataLayer.getEmployees() || (fallback || []);
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

    // --- calculateHealthScore(projectId) — Berechnet Score + Begründung pro Kriterium ---
    window[NAMESPACE + '.calculateHealthScore'] = function(projectId) {
        try {
            if (!projectId) return null;

            var projects = loadData('projects', [] || []);
            var project = (projects || []).find(function(p) { return p.id === projectId; });
            if (!project) return null;

            var allTasks = loadData('tasks', []);
            var projectTasks = (allTasks || []).filter(function(t) { return t.projectId === projectId; });
            if (projectTasks.length > 0) {
                var copy = {};
                for (var k in project) copy[k] = project[k];
                copy.tasks = projectTasks;
                project = copy;
            }

            var result = {
                projectId: projectId,
                projectName: project.name,
                overallScore: 0,
                timestamp: new Date().toISOString(),
                criteria: []
            };

            // Kriterium 1: Fortschritt vs Zeitplan (25%)
            var progressResult = calculateProgressScore(project);
            result.criteria.push({
                name: 'Fortschritt vs Zeitplan',
                weight: 0.25,
                score: Math.round(progressResult.score),
                detail: progressResult.detail || ''
            });

            // Kriterium 2: Offene Blocker (25%)
            var blockerResult = calculateBlockerScore(project);
            result.criteria.push({
                name: 'Offene Blocker',
                weight: 0.25,
                score: Math.round(blockerResult.score),
                detail: blockerResult.detail || ''
            });

            // Kriterium 3: Sprint Completion Rate (25%)
            var sprintResult = calculateSprintCompletionScore(project);
            result.criteria.push({
                name: 'Sprint Completion Rate',
                weight: 0.25,
                score: Math.round(sprintResult.score),
                detail: sprintResult.detail || ''
            });

            // Kriterium 4: Team-Auslastung (25%)
            var workloadResult = calculateWorkloadScore(project);
            result.criteria.push({
                name: 'Team-Auslastung',
                weight: 0.25,
                score: Math.round(workloadResult.score),
                detail: workloadResult.detail || ''
            });

            // Gesamtscore berechnen (gewichteter Durchschnitt)
            var totalScore = result.criteria.reduce(function(sum, c) {
                return sum + c.score * c.weight;
            }, 0);
            result.overallScore = Math.round(totalScore);

            // Historie speichern
            saveHealthHistory(projectId, result);

            return result;
        } catch (e) {
            console.error('[' + NAMESPACE + '] calculateHealthScore error:', e);
            return null;
        }
    };

    function calculateProgressScore(project) {
        var tasks = project.tasks || [];
        if (!tasks.length) return { score: 100, detail: 'Keine Aufgaben vorhanden.' };

        var completedTasks = tasks.filter(function(t) { return t.status === 'Abgeschlossen' || t.status === 'Done'; }).length;
        var progressPercent = (completedTasks / tasks.length) * 100;

        // Checke Zeitplan
        if (!project.startDate || !project.endDate) {
            return { score: Math.round(progressPercent), detail: 'Fortschritt: ' + Math.round(progressPercent) + '% abgeschlossen.' };
        }

        var startDate = new Date(project.startDate);
        var endDate = new Date(project.endDate);
        var now = new Date();

        if (now < startDate) {
            return { score: 100, detail: 'Projekt ist noch nicht gestartet.' };
        }

        var totalDuration = endDate.getTime() - startDate.getTime();
        var elapsedDuration = now.getTime() - startDate.getTime();
        var timeProgress = Math.min((elapsedDuration / totalDuration) * 100, 100);

        // Wenn Fortschritt hinter Zeitplan zurückfällt
        if (progressPercent < timeProgress * 0.7) {
            return { score: Math.round(progressPercent * 0.6), detail: '⚠️ Fortschritt (' + Math.round(progressPercent) + '%) weit hinter Zeitplan (' + Math.round(timeProgress) + '%).' };
        } else if (progressPercent < timeProgress) {
            return { score: Math.round((progressPercent + timeProgress) / 2 * 0.8), detail: 'Fortschritt (' + Math.round(progressPercent) + '%) leicht hinter Zeitplan (' + Math.round(timeProgress) + '%).' };
        } else {
            return { score: Math.min(Math.round(progressPercent), 100), detail: '✓ Fortschritt (' + Math.round(progressPercent) + '%) entspricht Zeitplan.' };
        }
    }

    function calculateBlockerScore(project) {
        var tasks = project.tasks || [];
        if (!tasks.length) return { score: 100, detail: 'Keine Aufgaben vorhanden.' };

        var blockers = tasks.filter(function(t) { return t.status === 'Blockiert' || (t.blocked && t.blocked !== false); });
        var criticalTasks = tasks.filter(function(t) { return t.priority === 'Hoch'; });

        if (blockers.length === 0) return { score: 100, detail: 'Keine Blocker vorhanden.' };

        var blockerRatio = blockers.length / tasks.length;
        var score = Math.max(0, Math.round((1 - blockerRatio * 5) * 100)); // Je mehr Blocker, desto weniger Score

        var criticalBlockers = blockers.filter(function(b) { return b.priority === 'Hoch'; });
        var detail = '🔴 ' + blockers.length + ' Blocker gefunden.';
        if (criticalBlockers.length > 0) detail += ' (' + criticalBlockers.length + ' davon Hoch-Priorität).';

        return { score: score, detail: detail };
    }

    function calculateSprintCompletionScore(project) {
        var tasks = project.tasks || [];
        if (!tasks.length) return { score: 100, detail: 'Keine Aufgaben vorhanden.' };

        // Finde Sprints im Projekt
        var sprints = (project.sprints || []);

        if (sprints.length === 0) {
            // Fallback: verwende Task-Status als Proxy
            var completedTasks = tasks.filter(function(t) { return t.status === 'Abgeschlossen' || t.status === 'Done'; }).length;
            var inProgressTasks = tasks.filter(function(t) {
                return t.status === 'In Arbeit' || t.status === 'In Progress';
            }).length;

            if (completedTasks + inProgressTasks === 0) return { score: 50, detail: 'Keine Sprints definiert.' };

            var completionRate = completedTasks / tasks.length * 100;
            return { score: Math.round(completionRate), detail: 'Sprint Completion Rate: ' + Math.round(completionRate) + '% (Fortschritt basierend auf Task-Status).' };
        }

        // Evaluiere Sprints
        var completedSprints = sprints.filter(function(s) { return s.status === 'Abgeschlossen'; }).length;
        var totalSprints = sprints.length;

        if (totalSprints === 0) return { score: 50, detail: 'Keine Sprints definiert.' };

        var completionRate = (completedSprints / totalSprints) * 100;

        // Prüfe aktiven Sprint
        var activeSprint = sprints.find(function(s) { return s.status === 'In Progress' || s.status === 'Laufend'; });
        if (!activeSprint && totalSprints > completedSprints) {
            return { score: Math.round(completionRate), detail: completedSprints + '/' + totalSprints + ' Sprints abgeschlossen (' + Math.round(completionRate) + '%).' };
        }

        // Aktiver Sprint hat weniger Score wenn er noch läuft aber Zeit abläuft
        if (activeSprint && activeSprint.endDate) {
            var now = new Date();
            if (now > new Date(activeSprint.endDate)) {
                return { score: Math.max(0, Math.round(completionRate - 20)), detail: '⚠️ Aktueller Sprint läuft über! ' + completedSprints + '/' + totalSprints + ' Sprints abgeschlossen.' };
            }
        }

        return { score: Math.round(completionRate), detail: completedSprints + '/' + totalSprints + ' Sprints abgeschlossen (' + Math.round(completionRate) + '%).' };
    }

    function calculateWorkloadScore(project) {
        var tasks = project.tasks || [];
        if (!tasks.length) return { score: 100, detail: 'Keine Aufgaben vorhanden.' };

        // Zähle Tasks pro Status
        var openTasks = tasks.filter(function(t) { return t.status === 'Offen' || !t.status; }).length;
        var inProgressTasks = tasks.filter(function(t) {
            return t.status === 'In Arbeit' || t.status === 'In Progress';
        }).length;

        // Hohe Auslastung wenn viele Tasks offen + aktiv
        var totalActive = openTasks + inProgressTasks;

        if (totalActive > 20) {
            return { score: Math.max(10, Math.round(40 - totalActive)), detail: '🔴 Sehr hohe Auslastung: ' + totalActive + ' aktive Tasks.' };
        } else if (totalActive > 10) {
            return { score: Math.round(65 - totalActive), detail: '⚠️ Hohe Auslastung: ' + totalActive + ' aktive Tasks.' };
        } else if (totalActive === 0) {
            return { score: 10, detail: 'Keine aktiven Tasks — Team ist ungenutzt.' };
        } else {
            return { score: Math.round(85 - totalActive * 2), detail: 'Normale Auslastung: ' + openTasks + ' offen, ' + inProgressTasks + ' aktiv.' };
        }
    }

    // --- renderHealthCards() — Ampel-Karten mit Trend-Pfeil ---
    window[NAMESPACE + '.renderHealthCards'] = function(containerId, projectId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) { console.warn('[' + NAMESPACE + '] Container #' + containerId + ' nicht gefunden'); return; }

            var healthData = window[NAMESPACE + '.calculateHealthScore'](projectId);
            if (!healthData) {
                container.innerHTML = '<div style="text-align:center;padding:32px;color:#9ca3af;">Keine Daten für dieses Projekt.</div>';
                return;
            }

            // Trend berechnen (aktueller Score vs. letzter historischer Score)
            var history = window[NAMESPACE + '.getHealthHistory'](projectId);
            var trend = calculateTrend(history, healthData.overallScore);

            function colorForScore(score) {
                if (score >= 70) return '#22c55e'; // Grün
                if (score >= 40) return '#f59e0b'; // Orange
                return '#ef4444'; // Rot
            }

            function trendArrow(trendVal) {
                if (trendVal > 5) return '📈';
                if (trendVal < -5) return '📉';
                return '➡️';
            }

            var html = '<div class="health-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">' +
                // Gesamtkarte
                '<div class="health-card overall" style="border-radius:16px;padding:24px;text-align:center;' +
                    'background:' + colorForScore(healthData.overallScore) + ';color:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.1);">' +
                    '<div style="font-size:13px;font-weight:600;text-transform:uppercase;opacity:0.9;margin-bottom:8px;">Gesundheits-Score</div>' +
                    '<div style="font-size:48px;font-weight:bold;line-height:1;">' + healthData.overallScore + '</div>' +
                    '<div style="margin-top:8px;font-size:13px;opacity:0.9;display:flex;align-items:center;justify-content:center;gap:4px;">' +
                        trendArrow(trend) + ' ' + (trend > 5 ? 'Verbessert' : trend < -5 ? 'Verschlechtert' : 'Ungleich') + '</div>' +
                '</div>';

            // Detail-Karten
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;">';
            healthData.criteria.forEach(function(c) {
                var scoreColor = colorForScore(c.score);
                html += '<div class="health-card" style="border-radius:12px;padding:18px;border:1px solid #e5e7eb;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.06);">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
                    '<span style="font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;">' + escapeHtml(c.name) + '</span>' +
                    '<div style="display:flex;align-items:center;gap:4px;">' +
                        '<div class="score-bar" style="width:48px;height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;">' +
                            '<div style="height:100%;width:' + c.score + '%;background:' + scoreColor + ';border-radius:3px;"></div>' +
                        '</div></div></div>';

                html += '<div style="font-size:28px;font-weight:bold;color:' + scoreColor + ';margin-bottom:6px;">' + c.score + '/100</div>';
                html += '<p style="font-size:12px;color:#6b7280;margin:0;line-height:1.4;">' + escapeHtml(c.detail) + '</p>';
                html += '</div>';
            });

            html += '</div></div>';
            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] renderHealthCards error:', e);
        }
    };

    function calculateTrend(history, currentScore) {
        if (!history || history.length < 2) return 0;
        var last = history[history.length - 1];
        var prev = history.length >= 3 ? history[history.length - 2] : null;

        if (prev && currentScore > prev.score + 5) return currentScore - prev.score;
        if (currentScore < last.score - 5) return currentScore - last.score;
        return 0;
    }

    // --- getHealthHistory(projectId) — Historie der Scores ---
    window[NAMESPACE + '.getHealthHistory'] = function(projectId) {
        try {
            if (!projectId) return [];
            var historyKey = NAMESPACE + '_history_' + projectId;
            var raw = localStorage.getItem(historyKey);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('[' + NAMESPACE + '] getHealthHistory error:', e);
            return [];
        }
    };

    function saveHealthHistory(projectId, healthData) {
        try {
            var historyKey = NAMESPACE + '_history_' + projectId;
            var raw = localStorage.getItem(historyKey);
            var history = raw ? JSON.parse(raw) : [];

            // Maximale Historie: 20 Einträge
            if (history.length >= 20) history.shift();

            history.push({
                score: healthData.overallScore,
                criteria: healthData.criteria.map(function(c) { return { name: c.name, score: c.score }; }),
                timestamp: healthData.timestamp
            });

            localStorage.setItem(historyKey, JSON.stringify(history));
        } catch (e) {
            console.error('[' + NAMESPACE + '] saveHealthHistory error:', e);
        }
    }

    // --- getScoreColor() — Ampelfarbe für Score ---
    window[NAMESPACE + '.getScoreColor'] = function(score) {
        if (score >= 70) return '#22c55e';
        if (score >= 40) return '#f59e0b';
        return '#ef4444';
    };

    // --- escapeHtml ---
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    window[NAMESPACE + '.escapeHtml'] = escapeHtml;

    function renderDefaultHealthcheck() {
        var projects = loadData('projects', []);
        var container = document.getElementById('health-results');
        if (!container) return;

        if (!projects || projects.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:32px;color:#9ca3af;">Keine Projekte vorhanden.</div>';
            return;
        }

        window[NAMESPACE + '.renderHealthCards']('health-results', projects[0].id);
    }

    function initHealthcheck() {
        var btn = document.getElementById('run-healthcheck-btn');
        if (btn && !btn.dataset.boundHealthcheck) {
            btn.addEventListener('click', function() {
                renderDefaultHealthcheck();
            });
            btn.dataset.boundHealthcheck = '1';
        }

        renderDefaultHealthcheck();

        if (window.DataLayer && window.DataLayer.on) {
            window.DataLayer.on('dataChanged', renderDefaultHealthcheck);
        }
    }

    window.HealthCheckModule = {
        render: renderDefaultHealthcheck,
        init: initHealthcheck
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initHealthcheck);
    } else {
        initHealthcheck();
    }

})();

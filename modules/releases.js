// Feature 16 — Release-Trunk & Versionierung
(function() {
    'use strict';

    var NAMESPACE = 'ReleaseManager';

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

    function getReleases() {
        try {
            var raw = localStorage.getItem('pd_releases');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}
        return loadData('releases', []);
    }

    function setReleases(arr) {
        var safe = Array.isArray(arr) ? arr : [];
        saveData('releases', safe);
        try {
            localStorage.setItem('pd_releases', JSON.stringify(safe));
        } catch (e) {}

        if (window.DataLayer && window.DataLayer.getReleases) {
            var target = window.DataLayer.getReleases();
            if (Array.isArray(target)) {
                target.length = 0;
                Array.prototype.push.apply(target, safe);
            }
            if (window.DataLayer.emit) {
                window.DataLayer.emit('dataChanged', { action: 'update', entity: 'releases' });
            }
        }
    }
    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // --- createRelease(version, description) — Release anlegen ---
    window[NAMESPACE + '.createRelease'] = function(projectId, version, description) {
        try {
            if (!version) return null;

            var normalizedProjectId = projectId || '';

            var releases = getReleases();

            // Prüfe ob Version schon existiert
            var exists = releases.find(function(r) { return r.version === version && r.projectId === normalizedProjectId; });
            if (exists) return alert('Release-Version "' + version + '" existiert bereits für dieses Projekt.');

            var release = {
                id: generateId('rel'),
                projectId: normalizedProjectId,
                version: version,
                description: description || '',
                date: new Date().toISOString(),
                status: 'Draft', // Draft | RC | Released
                changelog: [],
                tasks: []
            };

            releases.push(release);
            setReleases(releases);

            return release;
        } catch (e) {
            console.error('[' + NAMESPACE + '] createRelease error:', e);
            return null;
        }
    };

    // --- generateChangelog(releaseId) — Changelog aus abgeschlossenen Tasks generieren ---
    window[NAMESPACE + '.generateChangelog'] = function(releaseId) {
        try {
            var releases = getReleases();
            var release = releases.find(function(r) { return r.id === releaseId; });
            if (!release) return null;

            // Lade Tasks aus dem Projekt
            var allTasks = loadData('tasks', []);
            var projectTasks = (allTasks || []).filter(function(t) {
                if (!release.projectId) return true;
                return t.projectId === release.projectId;
            });

            if (!projectTasks.length) {
                release.changelog = ['Keine Aufgaben gefunden.'];
                release.tasks = [];
                setReleases(releases);
                return release;
            }

            // Sammle abgeschlossene Tasks als Changelog-Einträge
            var completedTasks = projectTasks.filter(function(t) {
                return t.status === 'done' || t.status === 'Done' || t.status === 'Abgeschlossen';
            });

            if (completedTasks.length === 0) {
                release.changelog = ['Keine abgeschlossenen Aufgaben für diesen Release gefunden.'];
            } else {
                release.changelog = completedTasks.map(function(t, i) {
                    var category = '';
                    // Kategorisiere basierend auf Labels oder Titel
                    if (t.labels && t.labels.length > 0) {
                        var labelIds = t.labels;
                        // Finde Label-Namen falls vorhanden
                    }

                    return {
                        id: generateId('changelog'),
                        taskTitle: t.title || 'Unbenannte Aufgabe',
                        taskId: t.id,
                        category: categorizeTask(t),
                        description: t.description || '',
                        completedAt: new Date().toISOString()
                    };
                });

                // tasks Referenz speichern
                release.tasks = completedTasks.map(function(t) { return t.id; });
            }

            setReleases(releases);
            return release;
        } catch (e) {
            console.error('[' + NAMESPACE + '] generateChangelog error:', e);
            return null;
        }
    };

    function categorizeTask(task) {
        var title = (task.title || '').toLowerCase();
        if (/fix|bug|fehler|repair/i.test(title)) return 'Bugfix';
        if (/feat|feature|hinzufügen|add|new/i.test(title)) return 'Neue Funktion';
        if (/improv|verbessern|optimize|refactor/i.test(title)) return 'Verbesserung';
        if (/docs|documentation|dokumentation|readme/i.test(title)) return 'Dokumentation';
        if (/test/i.test(title)) return 'Testing';
        if (/dep|dependencies|dependency/i.test(title)) return 'Dependency';
        if (/style|css|design|ui/i.test(title)) return 'UI/Design';
        if (/perf|performance|speed|schnell/i.test(title)) return 'Performance';
        return 'Sonstiges';
    }

    // --- markAsReleaseCandidate(version) — RC markieren ---
    window[NAMESPACE + '.markAsReleaseCandidate'] = function(releaseId) {
        try {
            var releases = getReleases();
            var release = releases.find(function(r) { return r.id === releaseId; });
            if (!release) return alert('Release nicht gefunden.');

            // Changelog generieren wenn noch nicht vorhanden
            if (!release.changelog || release.changelog.length === 0) {
                window[NAMESPACE + '.generateChangelog'](releaseId);
            }

            release.status = 'RC';
            setReleases(releases);
        } catch (e) {
            console.error('[' + NAMESPACE + '] markAsReleaseCandidate error:', e);
        }
    };

    // --- getRollingReleaseView() — Übersicht aller Releases mit enthaltenen Tasks ---
    window[NAMESPACE + '.getRollingReleaseView'] = function(containerId, projectId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) { console.warn('[' + NAMESPACE + '] Container #' + containerId + ' nicht gefunden'); return; }

            var releases = getReleases();
            if (projectId) {
                releases = releases.filter(function(r) { return r.projectId === projectId; });
            }

            // Sortiere nach Datum (neueste zuerst)
            releases.sort(function(a, b) {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });

            if (releases.length === 0) {
                container.innerHTML = '<div class="release-empty-state">' +
                    '<p>Keine Releases vorhanden.</p>' +
                    '<button onclick="' + NAMESPACE + '.showCreateReleaseModal(\'' + (projectId || '') + '\')" ' +
                        'class="btn btn-primary mt-2">' +
                        'Erstes Release erstellen</button></div>';
                return;
            }

            var html = '<div class="release-stack">';

            releases.forEach(function(release) {
                var statusColors = { 'Draft': '#f59e0b', 'RC': '#8b5cf6', 'Released': '#22c55e' };
                var statusIcons = { 'Draft': '📝', 'RC': '🔬', 'Released': '✅' };

                html += '<div class="release-card release-card-detailed">' +
                    '<div class="release-head-row">' +
                        '<div class="release-head-title">' +
                            '<span class="badge" style="padding:3px 10px;border-radius:9999px;font-size:12px;background:' + (statusColors[release.status] || '#6b7280') + ';color:#fff;">' +
                                statusIcons[release.status] + ' ' + escapeHtml(release.status) + '</span>' +
                            '<h4 class="release-version-title">Version ' + escapeHtml(release.version) + '</h4>' +
                        '</div>';

                html += '<span class="release-date">' + formatDate(release.date) + '</span></div>';

                if (release.description) {
                    html += '<p class="release-description">' + escapeHtml(release.description) + '</p>';
                }

                // Changelog anzeigen
                if (release.changelog && release.changelog.length > 0) {
                    html += '<div class="release-changelog">';
                    html += '<h5>Changelog (' + release.changelog.length + ' Eintraege):</h5>';

                    // Nach Kategorie gruppieren
                    var grouped = {};
                    release.changelog.forEach(function(entry) {
                        var cat = entry.category || 'Sonstiges';
                        if (!grouped[cat]) grouped[cat] = [];
                        grouped[cat].push(entry);
                    });

                    Object.keys(grouped).forEach(function(cat) {
                        html += '<div class="release-changelog-group">' +
                            '<details><summary>' + escapeHtml(cat) + ' (' + grouped[cat].length + ')</summary>' +
                            '<div class="release-changelog-items">';
                        grouped[cat].forEach(function(entry) {
                            html += '<div class="release-changelog-item">' +
                                '• ' + escapeHtml(entry.taskTitle || entry.title || 'Aufgabe') + '</div>';
                        });
                        html += '</div></details></div>';
                    });

                    html += '</div>';
                } else {
                    html += '<p class="release-no-changelog">Kein Changelog vorhanden. Klicke zum Generieren.</p>' +
                        '<button onclick="' + NAMESPACE + '.generateChangelog(\'' + release.id + '\');' + NAMESPACE + '.getRollingReleaseView(\'' + containerId + '\',\'' + (projectId || '') + '\')" ' +
                            'class="btn btn-secondary">' +
                            'Changelog generieren</button>';
                }

                html += '</div>';
            });

            html += '</div>';
            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] getRollingReleaseView error:', e);
        }
    };

    // --- releaseVersion(projectId, version) — Version freigeben ---
    window[NAMESPACE + '.releaseVersion'] = function(projectId, version, description) {
        try {
            var releases = getReleases();

            // Suche existierendes Draft/RC für diese Version
            var existing = releases.find(function(r) { return r.version === version && r.projectId === projectId; });
            if (!existing) {
                existing = window[NAMESPACE + '.createRelease'](projectId, version, description);
            }

            if (existing) {
                // Changelog generieren bevor Release
                window[NAMESPACE + '.generateChangelog'](existing.id);
                releases = getReleases();
                var persisted = releases.find(function(r) { return r.id === existing.id; });
                if (persisted) {
                    persisted.status = 'Released';
                    setReleases(releases);
                    return persisted;
                }
                return existing;
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] releaseVersion error:', e);
        }
    };

    // --- showCreateReleaseModal(projectId) — Modal zum Erstellen eines Releases ---
    window[NAMESPACE + '.showCreateReleaseModal'] = function(projectId) {
        try {
            showConfirmModal(
                'Neues Release erstellen',
                '<div style="display:flex;flex-direction:column;gap:14px;">' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Version<br>' +
                        '<input id="rel_version" type="text" placeholder="z.B. 1.0.0 oder v2.1.0" ' +
                            'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;" required></label>' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Beschreibung<br>' +
                        '<textarea id="rel_desc" rows="3" placeholder="Beschreibe die Änderungen..." ' +
                            'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;resize:vertical;"></textarea></label>' +
                    '<p style="font-size:12px;color:var(--text-muted);margin:0;">Status wird auf "Draft" gesetzt. Changelog wird beim Freigeben automatisch generiert.</p>' +
                '</div>',
                function() {
                    var version = document.getElementById('rel_version').value.trim();
                    var desc = document.getElementById('rel_desc').value.trim();

                    if (!version) return alert('Version ist erforderlich.');

                    var release = window[NAMESPACE + '.createRelease'](projectId, version, desc);
                    if (release) {
                        closeModal();
                        window[NAMESPACE + '.getRollingReleaseView']('release-list', projectId);
                    }
                },
                ['Erstellen']
            );
        } catch (e) {
            console.error('[' + NAMESPACE + '] showCreateReleaseModal error:', e);
        }
    };

    // --- Hilfsfunktionen ---
    function formatDate(dateStr) {
        try {
            var d = new Date(dateStr);
            return d.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' });
        } catch (e) {
            return dateStr || '';
        }
    }

    function showConfirmModal(title, contentHtml, onConfirm, buttons) {
        closeModal();

        var overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--overlay-bg,rgba(0,0,0,0.5));z-index:9998;display:flex;align-items:center;justify-content:center;';

        var modalContent = document.createElement('div');
        modalContent.style.cssText = 'background:var(--bg-card,#fff);color:var(--text-primary,#111);border:1px solid var(--border-color,#d1d5db);border-radius:12px;padding:24px;max-width:500px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

        var btns = (buttons && buttons.length ? buttons.slice() : ['OK', 'Abbrechen']);
        if (btns.length === 1) btns.push('Abbrechen');
        modalContent.innerHTML = '<h3 style="margin:0 0 16px;color:var(--text-primary);">' + escapeHtml(title) + '</h3>' + contentHtml;

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;';

        btns.forEach(function(label, i) {
            var btn = document.createElement('button');
            btn.textContent = label;
            btn.className = i === 0 ? 'btn btn-primary' : 'btn btn-secondary';
            if (i === 0) {
                btn.onclick = function() { onConfirm(); };
            } else {
                btn.onclick = closeModal;
            }
            btnRow.appendChild(btn);
        });

        modalContent.appendChild(btnRow);
        overlay.appendChild(modalContent);

        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal();
        });

        var escHandler = function(e) {
            if (e.key === 'Escape') closeModal();
        };
        overlay._escHandler = escHandler;
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(overlay);
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
    window[NAMESPACE + '.closeModal'] = closeModal;

    // --- escapeHtml ---
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
    window[NAMESPACE + '.escapeHtml'] = escapeHtml;

    function init() {
        try {
            var addBtn = document.getElementById('add-release-btn');
            if (addBtn && !addBtn.dataset.boundReleaseManager) {
                addBtn.addEventListener('click', function() {
                    window[NAMESPACE + '.showCreateReleaseModal']('');
                });
                addBtn.dataset.boundReleaseManager = '1';
            }

            if (document.getElementById('release-list')) {
                window[NAMESPACE + '.getRollingReleaseView']('release-list');
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] init error:', e);
        }
    }

    // Compatibility bridge: supports inline handlers using ReleaseManager.method().
    (function exposeObjectNamespace() {
        var target = window.ReleaseManager || {};
        [
            'createRelease',
            'generateChangelog',
            'markAsReleaseCandidate',
            'scoreReleaseRisk',
            'getRollingReleaseView',
            'showCreateReleaseModal',
            'closeModal',
            'escapeHtml'
        ].forEach(function(method) {
            target[method] = function() {
                var fn = window[NAMESPACE + '.' + method];
                if (typeof fn === 'function') {
                    return fn.apply(null, arguments);
                }
            };
        });
        window.ReleaseManager = target;
    })();

    window.ReleasesModule = {
        render: function() {
            window[NAMESPACE + '.getRollingReleaseView']('release-list');
        },
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

// Feature 14 — Labels & Kategorien-System
(function() {
    'use strict';

    var NAMESPACE = 'LabelManager';

    // --- Daten-Layer ---
    function loadData(key, fallback) {
        try {
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

    function getLabels() { return loadData('labels', []); }
    function setLabels(arr) { saveData('labels', arr); }
    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // --- renderLabelList() — Alle Labels mit Farbvorschau ---
    window[NAMESPACE + '.renderLabelList'] = function(containerId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) { console.warn('[' + NAMESPACE + '] Container #' + containerId + ' nicht gefunden'); return; }

            var labels = getLabels();

            if (labels.length === 0) {
                container.innerHTML = '<div class="empty-state-panel">' +
                    '<p>Keine Labels vorhanden.</p>' +
                    '<button onclick="' + NAMESPACE + '.createLabel()" class="btn btn-primary empty-state-action">Label erstellen</button></div>';
                return;
            }

            var html = '<div class="labels-cloud">';
            labels.forEach(function(lbl) {
                html += '<span class="label-badge" ' +
                    'style="background:' + escapeHtml(lbl.color) + ';">' +
                    '<span class="label-badge-name">' + escapeHtml(lbl.name) + '</span>' +
                    '<small class="label-badge-count">(' + (lbl.usageCount || 0) + ')</small>' +
                    '<button onclick="' + NAMESPACE + '.deleteLabel(\'' + lbl.id + '\')" ' +
                        'class="label-badge-remove" ' +
                        'onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">✕</button>' +
                    '</span>';
            });
            html += '</div>';

            // Co-Occurrence Analyse
            var coData = window[NAMESPACE + '.labelCoOccurrenceAnalysis']();
            if (coData.length > 0) {
                html += '<h4 class="cooc-title">Label-Co-Occurrence</h4>';
                html += '<div class="cooc-list">';
                coData.forEach(function(pair) {
                    html += '<div class="cooc-item">' +
                        escapeHtml(pair.labelA) + ' <span class="cooc-divider">×</span> ' +
                        escapeHtml(pair.labelB) +
                        '<span class="cooc-count">(gemeinsam ' + pair.count + ' mal)</span>' +
                    '</div>';
                });
                html += '</div>';
            }

            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] renderLabelList error:', e);
        }
    };

    // --- createLabel(name, color) — Label erstellen (Farbpicker) ---
    window[NAMESPACE + '.createLabel'] = function() {
        try {
            var colors = [
                '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
                '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
                '#d946ef', '#ec4899', '#6b7280'
            ];

            var colorOptions = colors.map(function(c) {
                return '<div class="color-pick" style="width:32px;height:32px;border-radius:50%;background:' + c + ';cursor:pointer;' +
                    'border:3px solid transparent;" onclick="document.getElementById(\'label_color\').value=\'' + c + '\';' +
                    'document.querySelectorAll(\'.color-pick\').forEach(function(el){el.style.borderColor=\'transparent\'});this.style.borderColor=\'var(--text-primary)\'"></div>';
            }).join('');

            showConfirmModal(
                'Neues Label erstellen',
                '<div class="modal-form-stack">' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Name<br>' +
                        '<input id="label_name" type="text" placeholder="z.B. Backend, UI-Design, Bug..." ' +
                            'style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Farbe<br>' +
                        '<input id="label_color" type="color" value="#3b82f6" ' +
                            'style="width:48px;height:36px;border:none;padding:0;cursor:pointer;"></label>' +
                    '<div class="color-swatch-grid" style="display:flex;flex-wrap:wrap;gap:6px;">' + colorOptions + '</div>' +
                '</div>',
                function() {
                    var name = document.getElementById('label_name').value.trim();
                    var color = document.getElementById('label_color').value;

                    if (!name) return alert('Name ist erforderlich.');

                    var labels = getLabels();
                    // Prüfe auf Duplikat-Namen
                    var exists = labels.find(function(l) { return l.name.toLowerCase() === name.toLowerCase(); });
                    if (exists) return alert('Ein Label mit diesem Namen existiert bereits.');

                    labels.push({
                        id: generateId('label'),
                        name: name,
                        color: color || '#3b82f6',
                        usageCount: 0
                    });
                    setLabels(labels);
                    closeModal();
                    window[NAMESPACE + '.renderLabelList']('label-list');
                },
                ['Erstellen']
            );
        } catch (e) {
            console.error('[' + NAMESPACE + '] createLabel error:', e);
        }
    };

    // --- deleteLabel(id) — Label löschen (Tasks entfernen) ---
    window[NAMESPACE + '.deleteLabel'] = function(id) {
        try {
            if (!confirm('Label wirklich löschen? Alle Task-Zuweisungen werden entfernt.')) return;

            var labels = getLabels();
            var labelIdx = labels.findIndex(function(l) { return l.id === id; });
            if (labelIdx === -1) return;

            var removedName = labels[labelIdx].name;
            labels.splice(labelIdx, 1);
            setLabels(labels);

            // Labels aus allen Projekten/Tasks entfernen
            var projects = loadData('projects', [] || []);
            (projects || []).forEach(function(proj) {
                ((proj.tasks) || []).forEach(function(task) {
                    if (task.labels && Array.isArray(task.labels)) {
                        task.labels = task.labels.filter(function(lid) { return lid !== id; });
                    }
                });
                // Falls Projekt-Level Labels existieren
                if (proj.labels && Array.isArray(proj.labels)) {
                    proj.labels = proj.labels.filter(function(lid) { return lid !== id; });
                }
            });

            // Speichere Projects zurück, wenn Daten-Name verfügbar
            try { saveData('projects', projects); } catch(e2) { localStorage.setItem('projects', JSON.stringify(projects)); }

            alert('Label "' + removedName + '" wurde gelöscht.');
        } catch (e) {
            console.error('[' + NAMESPACE + '] deleteLabel error:', e);
        }
    };

    // --- labelCoOccurrenceAnalysis() — Welche Labels tauchen häufig zusammen auf? ---
    window[NAMESPACE + '.labelCoOccurrenceAnalysis'] = function() {
        try {
            var pairs = {};
            var projects = loadData('projects', [] || []);

            (projects || []).forEach(function(proj) {
                // Projekt-Level Labels
                if (proj.labels && Array.isArray(proj.labels)) {
                    addToPairs(proj.labels, pairs);
                }

                // Task-Level Labels
                (proj.tasks || []).forEach(function(task) {
                    if (task.labels && Array.isArray(task.labels) && task.labels.length >= 2) {
                        addToPairs(task.labels, pairs);
                    }
                });
            });

            var coOccurrence = Object.keys(pairs).map(function(key) {
                return { pair: key, count: pairs[key] };
            }).sort(function(a, b) { return b.count - a.count; });

            // Format in lesbare Paare umwandeln
            var labelMap = {};
            (getLabels() || []).forEach(function(l) { labelMap[l.id] = l.name; });

            return coOccurrence.slice(0, 15).map(function(item) {
                var parts = item.pair.split('|||');
                return {
                    labelA: escapeHtml(labelMap[parts[0]] || parts[0]),
                    labelB: escapeHtml(labelMap[parts[1]] || parts[1]),
                    count: item.count
                };
            });
        } catch (e) {
            console.error('[' + NAMESPACE + '] labelCoOccurrenceAnalysis error:', e);
            return [];
        }
    };

    function addToPairs(ids, pairs) {
        for (var i = 0; i < ids.length; i++) {
            for (var j = i + 1; j < ids.length; j++) {
                var key = [ids[i], ids[j]].sort().join('|||');
                pairs[key] = (pairs[key] || 0) + 1;
            }
        }
    }

    // --- getLabelsForProject(projectId) — Labels eines Projekts zurückgeben ---
    window[NAMESPACE + '.getLabelsForProject'] = function(projectId) {
        try {
            if (!projectId) return [];
            var projects = loadData('projects', [] || []);
            var proj = (projects || []).find(function(p) { return p.id === projectId; });

            if (!proj) return [];

            // Sammle alle Labels aus Projekt und Tasks
            var labelIds = new Set();
            if (proj.labels && Array.isArray(proj.labels)) {
                proj.labels.forEach(function(id) { labelIds.add(id); });
            }
            ((proj.tasks || []) || []).forEach(function(task) {
                if (task.labels && Array.isArray(task.labels)) {
                    task.labels.forEach(function(id) { labelIds.add(id); });
                }
            });

            var allLabels = getLabels();
            return Array.from(labelIds).map(function(id) {
                return allLabels.find(function(l) { return l.id === id; }) || null;
            }).filter(Boolean);
        } catch (e) {
            console.error('[' + NAMESPACE + '] getLabelsForProject error:', e);
            return [];
        }
    };

    // --- addLabelToTask(taskId, labelId) — Label einer Aufgabe hinzufügen ---
    window[NAMESPACE + '.addLabelToTask'] = function(taskId, labelId) {
        try {
            var projects = loadData('projects', [] || []);
            (projects || []).forEach(function(proj) {
                ((proj.tasks) || []).forEach(function(task) {
                    if (task.id === taskId) {
                        if (!task.labels) task.labels = [];
                        if (task.labels.indexOf(labelId) === -1) {
                            task.labels.push(labelId);

                            // usageCount erhöhen
                            var labels = getLabels();
                            var lbl = labels.find(function(l) { return l.id === labelId; });
                            if (lbl) { lbl.usageCount = (lbl.usageCount || 0) + 1; }
                            setLabels(labels);
                        }
                    }
                });
            });

            saveData('projects', projects);
        } catch (e) {
            console.error('[' + NAMESPACE + '] addLabelToTask error:', e);
        }
    };

    // --- Hilfsfunktion: Modal anzeigen ---
    function showConfirmModal(title, contentHtml, onConfirm, buttons) {
        closeModal();

        var overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--overlay-bg,rgba(0,0,0,0.5));z-index:9998;display:flex;align-items:center;justify-content:center;';

        var modalContent = document.createElement('div');
        modalContent.style.cssText = 'background:var(--bg-card,#fff);color:var(--text-primary,#111);border:1px solid var(--border-color,#d1d5db);border-radius:12px;padding:24px;max-width:450px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

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
            var addBtn = document.getElementById('add-label-btn');
            if (addBtn && !addBtn.dataset.boundLabelManager) {
                addBtn.addEventListener('click', function() {
                    window[NAMESPACE + '.createLabel']();
                });
                addBtn.dataset.boundLabelManager = '1';
            }

            if (document.getElementById('label-list')) {
                window[NAMESPACE + '.renderLabelList']('label-list');
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] init error:', e);
        }
    }

    // Compatibility bridge: supports inline handlers using LabelManager.method().
    (function exposeObjectNamespace() {
        var target = window.LabelManager || {};
        [
            'renderLabelList',
            'createLabel',
            'deleteLabel',
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
        window.LabelManager = target;
    })();

    window.LabelsModule = {
        render: function() {
            window[NAMESPACE + '.renderLabelList']('label-list');
        },
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

// Feature 7 — Vorlagen-System
(function() {
    'use strict';

    var NAMESPACE = 'TemplateManager';

    function getDataLayer() {
        return window.DataLayer || null;
    }

    // --- Daten-Layer ---
    function loadData(key, fallback) {
        var dataLayer = getDataLayer();
        try {
            if (dataLayer) {
                if (key === 'templates' && typeof dataLayer.getTemplates === 'function') return dataLayer.getTemplates() || (fallback || []);
                if (key === 'projects' && typeof dataLayer.getProjects === 'function') return dataLayer.getProjects() || (fallback || []);
                if (key === 'tasks' && typeof dataLayer.getTasks === 'function') return dataLayer.getTasks() || (fallback || []);
            }
        } catch (e) {
            console.warn('[' + NAMESPACE + '] DataLayer load error for ' + key, e);
        }
        try {
            var raw = localStorage.getItem(NAMESPACE + '_' + key);
            return raw ? JSON.parse(raw) : (fallback || []);
        } catch (e) {
            console.warn('[' + NAMESPACE + '] Load error for ' + key, e);
            return fallback || [];
        }
    }

    function saveData(key, data) {
        var dataLayer = getDataLayer();
        try {
            if (dataLayer) {
                if (key === 'templates') {
                    var existingTemplates = typeof dataLayer.getTemplates === 'function' ? dataLayer.getTemplates().slice() : [];
                    var nextTemplates = Array.isArray(data) ? data : [];
                    var existingById = {};
                    existingTemplates.forEach(function(item) {
                        if (item && item.id) existingById[item.id] = item;
                    });

                    existingTemplates.forEach(function(item) {
                        if (!item || !item.id) return;
                        var stillExists = nextTemplates.some(function(nextItem) {
                            return nextItem && nextItem.id === item.id;
                        });
                        if (!stillExists && typeof dataLayer.deleteTemplate === 'function') {
                            dataLayer.deleteTemplate(item.id);
                        }
                    });

                    nextTemplates.forEach(function(item) {
                        if (!item) return;
                        if (item.id && existingById[item.id] && typeof dataLayer.updateTemplate === 'function') {
                            dataLayer.updateTemplate(item);
                            return;
                        }
                        if (typeof dataLayer.createTemplate === 'function') dataLayer.createTemplate(item);
                    });
                    return;
                }
            }
        } catch (e) {
            console.warn('[' + NAMESPACE + '] DataLayer save error for ' + key, e);
        }
        try {
            localStorage.setItem(NAMESPACE + '_' + key, JSON.stringify(data));
        } catch (e) {
            console.warn('[' + NAMESPACE + '] Save error for ' + key, e);
        }
    }

    function getTemplates() { return loadData('templates', []); }
    function setTemplates(arr) { saveData('templates', arr); }
    function generateId(prefix) {
        return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // --- renderTemplateList() — Alle Templates anzeigen (Karten) ---
    window[NAMESPACE + '.renderTemplateList'] = function(containerId) {
        try {
            var container = document.getElementById(containerId);
            if (!container) { console.warn('[' + NAMESPACE + '] Container #' + containerId + ' nicht gefunden'); return; }

            var templates = getTemplates();

            if (templates.length === 0) {
                container.innerHTML = '<div class="empty-state-panel">' +
                    '<p>Keine Vorlagen vorhanden.</p>' +
                    '<button onclick="' + NAMESPACE + '.createTemplate()" class="btn btn-primary empty-state-action">Vorlage erstellen</button></div>';
                return;
            }

            var html = '<div class="template-grid">';

            templates.forEach(function(tpl) {
                html += '<div class="template-card template-card-frame">' +
                    '<div class="template-card-head">' +
                        '<h4 class="template-card-title">' + escapeHtml(tpl.name) + '</h4>' +
                        '<span class="badge template-type-badge" style="background:' + tplColor(tpl.type) + ';">' + escapeHtml(tpl.type) + '</span>';

                html += '</div><p class="template-description">';
                if (tpl.description) {
                    html += escapeHtml(tpl.description);
                } else if (tpl.fields && tpl.fields.length > 0) {
                    html += tpl.fields.map(function(f) { return f.label || ''; }).filter(Boolean).join(', ');
                }
                html += '</p>';

                html += '<div class="template-actions">' +
                    '<button onclick="' + NAMESPACE + '.applyTemplate(\'' + tpl.id + '\')" ' +
                        'class="btn btn-primary template-apply-btn">Anwenden</button>' +
                    '<button onclick="' + NAMESPACE + '.deleteTemplate(\'' + tpl.id + '\')" ' +
                        'class="btn template-delete-btn">Löschen</button>' +
                '</div></div>';
            });

            html += '</div>';
            container.innerHTML = html;
        } catch (e) {
            console.error('[' + NAMESPACE + '] renderTemplateList error:', e);
        }
    };

    function tplColor(type) {
        if (type === 'Projekt') return '#8b5cf6';
        if (type === 'Sprint') return '#3b82f6';
        if (type === 'Release') return '#10b981';
        return '#6b7280';
    }

    // --- createTemplate(name, type, fields) — Template erstellen mit JSON-Formularfeldern ---
    window[NAMESPACE + '.createTemplate'] = function() {
        try {
            showConfirmModal(
                'Neue Vorlage erstellen',
                '<div class="modal-form-stack">' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Name<br>' +
                        '<input id="tpl_name" type="text" placeholder="z.B. Agile Projekt Vorlage" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;"></label>' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Typ<br>' +
                        '<select id="tpl_type" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;">' +
                            '<option value="Projekt">Projekt</option>' +
                            '<option value="Sprint">Sprint</option>' +
                            '<option value="Release">Release</option>' +
                        '</select></label>' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Beschreibung (optional)<br>' +
                        '<textarea id="tpl_desc" rows="2" placeholder="Kurze Beschreibung der Vorlage..." style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:14px;resize:vertical;"></textarea></label>' +
                    '<label style="font-size:13px;font-weight:500;color:var(--text-secondary);">Formularfelder (JSON-Array, optional)<br>' +
                        '<small style="color:var(--text-muted);">z.B. [{"name":"Startdatum","type":"date"},{"name":"Budget","type":"number"}]</small><br>' +
                        '<textarea id="tpl_fields" rows="4" placeholder="[]" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:13px;font-family:var(--font-mono);resize:vertical;">[]</textarea></label>' +
                '</div>',
                function() {
                    var name = document.getElementById('tpl_name').value.trim();
                    var type = document.getElementById('tpl_type').value;
                    var desc = document.getElementById('tpl_desc').value.trim();

                    if (!name) return alert('Name ist erforderlich.');

                    var fields = [];
                    try {
                        fields = JSON.parse(document.getElementById('tpl_fields').value || '[]');
                    } catch (e) {
                        console.warn('[' + NAMESPACE + '] Invalid fields JSON, using empty array');
                        fields = [];
                    }

                    var templates = getTemplates();
                    templates.push({
                        id: generateId('tpl'),
                        name: name,
                        type: type,
                        description: desc || '',
                        fields: fields,
                        content: {},
                        createdAt: new Date().toISOString()
                    });
                    setTemplates(templates);
                    closeModal();
                    window[NAMESPACE + '.renderTemplateList']('template-list');
                },
                ['Erstellen']
            );
        } catch (e) {
            console.error('[' + NAMESPACE + '] createTemplate error:', e);
        }
    };

    // --- deleteTemplate(id) — Template löschen ---
    window[NAMESPACE + '.deleteTemplate'] = function(id) {
        try {
            if (!confirm('Vorlage wirklich löschen?')) return;

            var templates = getTemplates();
            var idx = templates.findIndex(function(t) { return t.id === id; });
            if (idx !== -1) {
                templates.splice(idx, 1);
                setTemplates(templates);
                window[NAMESPACE + '.renderTemplateList']('template-list');
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] deleteTemplate error:', e);
        }
    };

    // --- applyTemplate(templateId) — Leert-Projekt/Task aus Template erstellen ---
    window[NAMESPACE + '.applyTemplate'] = function(templateId) {
        try {
            var templates = getTemplates();
            var tpl = templates.find(function(t) { return t.id === templateId; });
            if (!tpl) return alert('Vorlage nicht gefunden.');

            var dataLayer = getDataLayer();
            var nowIso = new Date().toISOString();

            var newProject = {
                id: generateId('proj'),
                name: tpl.name + ' (Kopie)',
                description: tpl.description || '',
                status: 'planning',
                priority: 'medium',
                createdAt: nowIso,
                updatedAt: nowIso
            };

            if (tpl.content && Object.keys(tpl.content).length > 0) {
                newProject.documentation = tpl.content;
            }

            if (dataLayer && typeof dataLayer.createProject === 'function') {
                newProject = dataLayer.createProject(newProject);
            } else {
                var projects = loadData('projects', []);
                projects.push(newProject);
                saveData('projects', projects);
            }

            // Falls Template Felder hat, lege sie als echte Tasks im DataLayer an.
            if (tpl.fields && tpl.fields.length > 0) {
                tpl.fields.forEach(function(f) {
                    var taskPayload = {
                        id: generateId('task'),
                        title: f.label || f.name || 'Aufgabe',
                        description: f.description || '',
                        projectId: newProject.id,
                        status: 'backlog',
                        priority: 'medium',
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        assigneeId: ''
                    };

                    if (dataLayer && typeof dataLayer.createTask === 'function') {
                        dataLayer.createTask(taskPayload);
                    } else {
                        var tasks = loadData('tasks', []);
                        tasks.push(taskPayload);
                        saveData('tasks', tasks);
                    }
                });
            }

            alert('Projekt aus Vorlage "' + escapeHtml(tpl.name) + '" erstellt!');
        } catch (e) {
            console.error('[' + NAMESPACE + '] applyTemplate error:', e);
        }
    };

    // --- saveCustomTemplate(name, type, templateData) — Eigene Templates speichern ---
    window[NAMESPACE + '.saveCustomTemplate'] = function(name, type, templateData) {
        try {
            var templates = getTemplates();
            templates.push({
                id: generateId('tpl'),
                name: name || 'Benutzerdefinierte Vorlage',
                type: type || 'Projekt',
                description: (templateData && templateData.description) || '',
                fields: (templateData && templateData.fields) || [],
                content: (templateData && templateData.content) || {},
                createdAt: new Date().toISOString()
            });
            setTemplates(templates);
        } catch (e) {
            console.error('[' + NAMESPACE + '] saveCustomTemplate error:', e);
        }
    };

    // --- Hilfsfunktion: Modal anzeigen ---
    function showConfirmModal(title, contentHtml, onConfirm, buttons) {
        closeModal();

        var overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:var(--overlay-bg,rgba(0,0,0,0.5));z-index:9998;display:flex;align-items:center;justify-content:center;';

        var modalContent = document.createElement('div');
        modalContent.style.cssText = 'background:var(--bg-card,#fff);color:var(--text-primary,#111);border:1px solid var(--border-color,#d1d5db);border-radius:12px;padding:24px;max-width:550px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

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
            var addBtn = document.getElementById('add-template-btn');
            if (addBtn && !addBtn.dataset.boundTemplateManager) {
                addBtn.addEventListener('click', function() {
                    window[NAMESPACE + '.createTemplate']();
                });
                addBtn.dataset.boundTemplateManager = '1';
            }

            if (document.getElementById('template-list')) {
                window[NAMESPACE + '.renderTemplateList']('template-list');
            }
        } catch (e) {
            console.error('[' + NAMESPACE + '] init error:', e);
        }
    }

    // Compatibility bridge: supports inline handlers using TemplateManager.method().
    (function exposeObjectNamespace() {
        var target = window.TemplateManager || {};
        [
            'renderTemplateList',
            'createTemplate',
            'applyTemplate',
            'deleteTemplate',
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
        window.TemplateManager = target;
    })();

    window.TemplatesModule = {
        render: function() {
            window[NAMESPACE + '.renderTemplateList']('template-list');
        },
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

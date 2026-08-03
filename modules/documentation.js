/* ========================================
   Projektdokumentation (Feature 3)
   ======================================== */
(function(){
  'use strict';

  function escapeHtml(value) {
    if (!value) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(value)));
    return div.innerHTML;
  }

  function getProject(projectId) {
    return (window.DataLayer.getProjects() || []).find(function(p) {
      return p.id === projectId;
    }) || null;
  }

  function getTasks(projectId) {
    return (window.DataLayer.getTasks() || []).filter(function(t) {
      return t.projectId === projectId;
    });
  }

  function renderDocumentation() {
    var container = document.getElementById('doc-list');
    if (!container) return;

    var projects = window.DataLayer.getProjects() || [];
    if (projects.length === 0) {
      container.textContent = 'Keine Projekte vorhanden. Dokumentationen werden automatisch generiert.';
      return;
    }

    var html = '';
    projects.forEach(function(project) {
      html += '<div class="stat-card" style="margin-bottom:8px;padding:1rem;">';
      html += '<h3>' + escapeHtml(project.title || project.name || 'Projekt') + '</h3>';
      html += '<div style="display:flex;gap:8px;margin-top:8px;">';
      html += '<button class="btn btn-secondary" onclick="generateProjectReport(\'' + project.id + '\')">Projekt-Start</button>';
      html += '<button class="btn btn-secondary" onclick="generateStatusReport(\'' + project.id + '\')">Statusbericht</button>';
      html += '<button class="btn btn-secondary" onclick="exportMarkdown(\'' + project.id + '\')">Markdown Export</button>';
      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;
  }

  function openTextPreview(title, text) {
    var w = window.open('', '_blank');
    if (!w) return;
    var body = '<h1>' + escapeHtml(title) + '</h1><pre style="white-space:pre-wrap;line-height:1.5;">' + escapeHtml(text) + '</pre>';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title></head><body>' + body + '</body></html>');
  }

  window.generateProjectReport = function(projectId) {
    var project = getProject(projectId);
    if (!project) return;

    var tasks = getTasks(projectId);
    var report = 'Projekt: ' + (project.title || project.name || 'Projekt') + '\n';
    report += 'Datum: ' + new Date().toLocaleDateString('de-DE') + '\n';
    report += 'Tasks gesamt: ' + tasks.length + '\n';
    openTextPreview('Projekt-Start', report);
  };

  window.generateStatusReport = function(projectId) {
    var project = getProject(projectId);
    if (!project) return;

    var tasks = getTasks(projectId);
    var done = tasks.filter(function(t) { return t.status === 'done'; }).length;
    var report = 'Statusbericht: ' + (project.title || project.name || 'Projekt') + '\n';
    report += 'Abgeschlossen: ' + done + '/' + tasks.length + '\n';
    openTextPreview('Statusbericht', report);
  };

  window.exportMarkdown = function(projectId) {
    var project = getProject(projectId);
    if (!project) return;

    var tasks = getTasks(projectId);
    var md = '# ' + (project.title || project.name || 'Projekt') + '\n\n';
    md += '*Generiert am: ' + new Date().toLocaleDateString('de-DE') + '*\n\n';
    md += '## Tasks\n\n';
    tasks.forEach(function(task) {
      md += '- ' + (task.title || 'Aufgabe') + ' (' + (task.status || 'unknown') + ')\n';
    });

    var blob = new Blob([md], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (project.title || 'projekt') + '-doc.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  document.addEventListener('DOMContentLoaded', renderDocumentation);
  window.DocumentationModule = { render: renderDocumentation };
})();

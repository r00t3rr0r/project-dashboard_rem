/**
 * Videokonferenz-Termine: Themen, Einstellungen und VDO.Ninja-kompatible Links
 * ueber https://1nj3ct0r.com/vide0link/ (Parameter gemaess docs.vdo.ninja/advanced-settings).
 */
(function () {
  'use strict';

  var BASE_URL = 'https://1nj3ct0r.com/vide0link/';

  // key, Label, URL-Parameter (ohne fuehrendes &), Warnhinweis
  var OPTIONS = [
    { key: 'proAudio', label: 'Pro-audio mode', param: 's', warn: true },
    { key: 'hideAudioOnly', label: 'Hide audio-only sources', param: 'st' },
    { key: 'remote', label: 'Remote Monitoring', param: 'remote' },
    { key: 'sticky', label: 'Invite saved to cookie', param: 'sticky' },
    { key: 'askName', label: 'Ask for display name', param: 'l' },
    { key: 'showNames', label: 'Show display names', param: 'sl' },
    { key: 'activeSpeaker', label: 'Show active speakers', param: 'sas' },
    { key: 'welcome', label: 'Show welcome message', param: 'welcome' },
    { key: 'fullscreen', label: 'Show fullscreen button', param: 'fsb' },
    { key: 'hd1080', label: '1080p60 Video if Available', param: 'q', warn: true },
    { key: 'defaultMic', label: 'Auto-select default microphone', param: 'ad' },
    { key: 'defaultCamera', label: 'Auto-select default camera', param: 'vd' },
    { key: 'compat', label: 'Compatibility mode', param: 'safemode' },
    { key: 'hideSettings', label: 'Hide settings button', param: 'ns' },
    { key: 'hideFileShare', label: 'Hide file sharing', param: 'nofileshare' },
    { key: 'hideScreenshare', label: 'Hide Screenshare Option', param: 'hidescreenshare' },
    { key: 'avatar', label: 'Can select an Avatar image', param: 'avatar' },
    { key: 'effects', label: 'Virtual backgrounds', param: 'effects', warn: true },
    { key: 'noAnimations', label: 'Disable animations', param: 'animate=0' },
    { key: 'chunked', label: 'P2P Chunked-mode', param: 'chunked=500', warn: true },
    { key: 'guestsHd', label: 'Guests see HD video', param: 'trb=2000', warn: true },
    { key: 'noSelfPreview', label: 'Disable self-preview', param: 'np' },
    { key: 'raiseHand', label: "Display 'raise-hand' button", param: 'hand' },
    { key: 'compressor', label: 'Enable audio compressor', param: 'comp' },
    { key: 'equalizer', label: 'Enable equalizer as option', param: 'eq' },
    { key: 'tips', label: 'Show guest setup tips', param: 'tips' },
    { key: 'prefixScreenshare', label: 'Prefix screenshare IDs', param: 'ssid' },
    { key: 'sharperScreen', label: 'Sharper screen share', param: 'sharperscreen' },
    { key: 'ssBitrate', label: 'Screen share bitrate (kbps)', param: 'screensharebitrate', numeric: 3500 },
    { key: 'ss30fps', label: '30 FPS screen share', param: 'screensharefps=30' },
    { key: 'ssOnly', label: 'Screen share only', param: 'screensharevideoonly' },
    { key: 'meshcast', label: 'Stream via server', param: 'meshcast', warn: true },
    { key: 'miniPreview', label: 'Mini self-preview', param: 'mini' },
    { key: 'grid', label: 'Show rule-of-thirds grid', param: 'grid' },
    { key: 'directorOnly', label: 'Director-only guests', param: 'directoronly' },
    { key: 'broadcast', label: "Only see the director's feed", param: 'broadcast' },
    { key: 'mutedGuest', label: 'Muted; guest can unmute', param: 'm' },
    { key: 'mutedDirector', label: 'Muted; director can unmute', param: 'g=0' },
    { key: 'micOnlyOption', label: 'Mic-only option', param: 'miconlyoption' },
    { key: 'cameraMuted', label: 'Camera muted on join', param: 'videomute' },
    { key: 'noCamera', label: 'Guest joins with no camera', param: 'vd=0' },
    { key: 'autostart', label: 'Autostart (ohne Setup-Dialog beitreten)', param: 'autostart' },
    { key: 'obfuscate', label: 'Obfuscate link and parameters', param: null }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function randomToken(length) {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var buf = new Uint32Array(length);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < length; i++) out += chars.charAt(buf[i] % chars.length);
    return out;
  }

  function sanitizeToken(value) {
    return String(value || '').replace(/[^A-Za-z0-9_]/g, '');
  }

  function defaultConfig() {
    return {
      room: 'dash' + randomToken(12),
      password: '',
      topics: [],
      options: { defaultMic: true, defaultCamera: true, askName: true, showNames: true }
    };
  }

  function parseTopics(text) {
    return String(text || '').split(/\r?\n/).map(function (line) {
      return line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim();
    }).filter(Boolean);
  }

  function toBase64Url(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function buildGuestQuery(cfg) {
    var opts = cfg.options || {};
    var parts = [];
    OPTIONS.forEach(function (opt) {
      if (!opt.param || !opts[opt.key]) return;
      if (opt.key === 'defaultCamera' && opts.noCamera) return;
      if (opt.numeric) {
        var n = parseInt(opts[opt.key + 'Value'], 10);
        parts.push(opt.param + '=' + (n > 0 ? n : opt.numeric));
        return;
      }
      parts.push(opt.param);
    });
    return parts;
  }

  function finalizeLink(params, cfg) {
    var query = params.join('&');
    if (cfg.options && cfg.options.obfuscate) return BASE_URL + '?o=' + toBase64Url(query);
    return BASE_URL + '?' + query;
  }

  /** @returns {{director: string, invite: string}|null} */
  function buildLinks(cfg) {
    var room = cfg && sanitizeToken(cfg.room);
    if (!room) return null;
    var pw = cfg.password ? 'password=' + encodeURIComponent(cfg.password) : '';
    var directorParams = ['director=' + encodeURIComponent(room)];
    var guestParams = ['room=' + encodeURIComponent(room)];
    if (pw) {
      directorParams.push(pw);
      guestParams.push(pw);
    }
    return {
      director: finalizeLink(directorParams, cfg),
      invite: finalizeLink(guestParams.concat(buildGuestQuery(cfg)), cfg)
    };
  }

  function buildEditorHtml(event) {
    var cfg = (event && event.videoconf) || defaultConfig();
    var opts = cfg.options || {};
    var checkboxes = OPTIONS.map(function (opt) {
      var checked = opts[opt.key] ? ' checked' : '';
      var warn = opt.warn ? '<span class="text-muted" title="Kann Leistung/Qualitaet beeintraechtigen"> \u26a0</span>' : '';
      var extra = opt.numeric
        ? ' <input type="number" min="100" step="100" class="vc-opt-num" data-vc-num="' + opt.key + '" value="' + escapeHtml(opts[opt.key + 'Value'] || opt.numeric) + '" style="width:6em">'
        : '';
      return '<label class="vc-option" style="display:block;margin:2px 0"><input type="checkbox" data-vc-opt="' + opt.key + '"' + checked + '> ' +
        escapeHtml(opt.label) + warn + '</label>' + extra;
    }).join('');

    return '' +
      '<div class="form-group" id="evt-vc-group" data-vc-room="' + escapeHtml(cfg.room) + '">' +
      '<label for="evt-vc-topics">Themen (ein Thema pro Zeile)</label>' +
      '<textarea id="evt-vc-topics" rows="4" placeholder="z. B. Statusupdate&#10;Planung naechster Sprint">' + escapeHtml((cfg.topics || []).join('\n')) + '</textarea>' +
      '<label for="evt-vc-password" style="margin-top:8px;display:block">Passwort (optional)</label>' +
      '<input type="text" id="evt-vc-password" autocomplete="off" value="' + escapeHtml(cfg.password || '') + '">' +
      '<details style="margin-top:8px"><summary>Videokonferenz-Einstellungen</summary>' +
      '<div class="vc-options" style="max-height:260px;overflow:auto;padding:6px 0">' + checkboxes + '</div></details>' +
      '<small class="text-muted">Der Link wird automatisch erzeugt: Control Room fuer dich, Einladungslink fuer Teilnehmer.</small>' +
      '</div>';
  }

  /** Liest die Editor-Felder; behaelt den bestehenden Raum bei. */
  function readEditor() {
    var group = document.getElementById('evt-vc-group');
    if (!group) return null;
    var options = {};
    Array.prototype.forEach.call(group.querySelectorAll('[data-vc-opt]'), function (cb) {
      if (cb.checked) options[cb.getAttribute('data-vc-opt')] = true;
    });
    Array.prototype.forEach.call(group.querySelectorAll('[data-vc-num]'), function (input) {
      options[input.getAttribute('data-vc-num') + 'Value'] = input.value;
    });
    return {
      room: sanitizeToken(group.getAttribute('data-vc-room')) || defaultConfig().room,
      password: (document.getElementById('evt-vc-password').value || '').trim(),
      topics: parseTopics(document.getElementById('evt-vc-topics').value),
      options: options
    };
  }

  function buildTopicsHtml(evt) {
    var topics = evt && evt.videoconf && evt.videoconf.topics || [];
    if (!topics.length) return '';
    return '<div class="calendar-detail-description"><h3>Themen</h3><ol>' +
      topics.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ol></div>';
  }

  /** Control-Room-Link nur fuer den Ersteller, Einladungslink fuer alle. */
  function buildLinksHtml(evt, isCreator) {
    var links = evt && evt.videoconf ? buildLinks(evt.videoconf) : null;
    if (!links) return '';
    function row(label, url, hint) {
      return '<div class="calendar-detail-item"><span class="calendar-detail-label">' + escapeHtml(label) + '</span>' +
        '<span class="calendar-detail-value"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a> ' +
        '<button type="button" class="btn btn-secondary btn-compact" data-vc-copy="' + escapeHtml(url) + '">Kopieren</button>' +
        (hint ? '<br><small class="text-muted">' + escapeHtml(hint) + '</small>' : '') + '</span></div>';
    }
    return '<div class="calendar-detail-grid">' +
      (isCreator ? row('Control Room', links.director, 'Nur fuer dich als Ersteller sichtbar.') : '') +
      row('Einladungslink', links.invite, '') +
      '</div>';
  }

  function bindCopyButtons(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-vc-copy]'), function (btn) {
      btn.addEventListener('click', function () {
        var url = btn.getAttribute('data-vc-copy');
        var done = function () { btn.textContent = 'Kopiert'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
        else window.prompt('Link kopieren:', url);
      });
    });
  }

  window.VideoConf = {
    TYPE: 'videoconference',
    OPTIONS: OPTIONS,
    buildLinks: buildLinks,
    parseTopics: parseTopics,
    buildEditorHtml: buildEditorHtml,
    readEditor: readEditor,
    buildTopicsHtml: buildTopicsHtml,
    buildLinksHtml: buildLinksHtml,
    bindCopyButtons: bindCopyButtons
  };
})();

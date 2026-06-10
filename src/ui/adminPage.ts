/** Self-contained admin SPA (no external assets, no build step). Talks to /admin/* JSON API. */
export function adminPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmallTV Admin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui,-apple-system,Segoe UI,sans-serif; background:#0b0f1a; color:#e8edf5; }
  header { display:flex; align-items:center; justify-content:space-between; padding:14px 22px;
    background:#101725; border-bottom:1px solid #1e2940; position:sticky; top:0; z-index:5; }
  header h1 { font-size:16px; margin:0; letter-spacing:.3px; }
  header a { color:#9fb2cf; text-decoration:none; font-size:13px; border:1px solid #2b3a57; padding:6px 12px; border-radius:8px; }
  header a:hover { background:#0c1422; }
  main { max-width:1100px; margin:0 auto; padding:22px; display:grid; gap:26px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.6px; color:#7f93b5; margin:0 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; }
  .card { background:#121a2b; border:1px solid #1f2b44; border-radius:12px; padding:14px; }
  .card h3 { margin:0 0 4px; font-size:15px; }
  .card .meta { color:#7f93b5; font-size:12px; margin-bottom:8px; word-break:break-word; }
  .card img { width:120px; height:120px; border-radius:8px; background:#000; display:block; margin:8px auto; border:1px solid #1f2b44; }
  .tag { display:inline-block; background:#1b2740; color:#9fc0ff; font-size:11px; padding:2px 7px; border-radius:6px; margin:2px 2px 0 0; }
  button, .btn { border:0; border-radius:8px; padding:7px 12px; font-size:13px; font-weight:600; cursor:pointer; }
  .danger { background:#3a1620; color:#ffb4bf; border:1px solid #7a2230; }
  .danger:hover { background:#4a1c28; }
  .primary { background:#3f6fd6; color:#fff; }
  .primary:hover { background:#3461c4; }
  details { background:#0e1626; border:1px solid #1f2b44; border-radius:12px; padding:6px 14px; margin-top:14px; }
  summary { cursor:pointer; padding:8px 0; color:#cfe0ff; font-size:14px; }
  form { display:grid; gap:10px; padding:10px 0 16px; }
  label { font-size:12px; color:#9fb2cf; display:grid; gap:5px; }
  input, select, textarea { background:#0c1422; color:#e8edf5; border:1px solid #2b3a57; border-radius:8px; padding:9px 11px; font-size:13px; font-family:inherit; }
  textarea { min-height:80px; resize:vertical; }
  .row { display:flex; gap:8px; align-items:center; }
  .row > * { flex:1; }
  .row button { flex:0 0 auto; }
  .msg { font-size:13px; min-height:16px; }
  .msg.ok { color:#7fe0a0; } .msg.err { color:#ffb4bf; }
  .assign-row { display:flex; gap:8px; align-items:center; }
  .form-mode { display:flex; align-items:center; justify-content:space-between; }
  .form-mode span { font-size:13px; color:#cfe0ff; font-weight:600; }
  .config-head { display:flex; align-items:center; justify-content:space-between; margin-top:2px; }
  .config-head > span { font-size:12px; color:#7f93b5; text-transform:uppercase; letter-spacing:.4px; }
  .rawtoggle { display:flex; flex-direction:row; align-items:center; gap:6px; font-size:12px; color:#9fb2cf; }
  .rawtoggle input { width:auto; }
  #config-fields { display:grid; gap:10px; }
  .field { display:grid; gap:4px; }
  .field-label { font-size:12px; color:#9fb2cf; }
  .field-hint { font-size:11px; color:#5e7193; }
  .field-bool { display:flex; flex-direction:row; align-items:center; gap:8px; flex-wrap:wrap; }
  .field-bool input { width:auto; }
  .field-bool .field-label { font-size:13px; color:#e8edf5; }
  .field-bool .field-hint { flex-basis:100%; }
  .loc-wrap { position:relative; }
  .loc-drop { position:absolute; top:calc(100% + 3px); left:0; right:0; background:#101825; border:1px solid #2b3a57; border-radius:8px; z-index:20; max-height:192px; overflow-y:auto; display:none; box-shadow:0 8px 24px rgba(0,0,0,.6); }
  .loc-drop.open { display:block; }
  .loc-item { padding:9px 12px; cursor:pointer; border-bottom:1px solid #1a2540; }
  .loc-item:last-child { border-bottom:0; }
  .loc-item:hover { background:#162036; }
  .loc-name { font-size:13px; color:#e8edf5; font-weight:600; }
  .loc-sub { font-size:11px; color:#5e7193; margin-top:2px; }
  .hint { font-size:12px; color:#5e7193; padding:6px 0; }
  .logs { background:#0a0f18; border:1px solid #1f2b44; border-radius:10px; padding:8px; max-height:340px; overflow:auto; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }
  .log-row { display:flex; gap:8px; padding:3px 4px; border-bottom:1px solid #131c2e; }
  .log-row:last-child { border-bottom:0; }
  .log-ts { color:#5e7193; flex:0 0 auto; }
  .log-lvl { flex:0 0 52px; font-weight:700; text-transform:uppercase; }
  .log-src { color:#7f93b5; flex:0 0 auto; }
  .log-msg { flex:1; word-break:break-word; }
  .lvl-debug{color:#6b7a90}.lvl-info{color:#7fb0ff}.lvl-warn{color:#e0a000}.lvl-error{color:#ff6b7d}
  .log-empty{color:#5e7193;padding:8px}
  .logbar { display:flex; gap:8px; align-items:center; margin-bottom:10px; }
  .logbar select, .logbar input { flex:0 0 auto; }
  .logbar input { flex:1; }
  .log-status { flex:0 0 auto; font-size:12px; display:inline-flex; align-items:center; gap:5px; padding:0 6px; }
  .log-status::before { content:'●'; }
  .log-status.live { color:#7fe0a0; }
  .log-status.connecting { color:#e0a000; }
  .log-status.reconnecting { color:#ff6b7d; }
</style></head>
<body>
  <header>
    <h1>SmallTV Admin</h1>
    <a href="/logout">Sign out</a>
  </header>
  <main>
    <section>
      <h2>Devices</h2>
      <div id="device-list" class="grid"></div>
      <details>
        <summary>Add / edit device</summary>
        <form id="device-form">
          <div class="form-mode"><span id="device-mode">New device</span><button type="button" class="btn" id="device-new">New</button></div>
          <div class="row">
            <label>Name<input name="name" required placeholder="Kitchen"></label>
            <label>Poll interval (s)<input name="poll" type="number" step="0.1" value="5" required></label>
            <label>Device theme<select name="theme" class="theme-select"></select></label>
          </div>
          <div>
            <div class="meta">Rotation (dashboards shown in order)</div>
            <div id="assignments"></div>
            <button type="button" class="btn" id="add-assign">+ Add slot</button>
          </div>
          <div class="row"><button class="primary" type="submit">Save device</button><span class="msg" id="device-msg"></span></div>
        </form>
      </details>
    </section>

    <section>
      <h2>Dashboards</h2>
      <div id="dashboard-list" class="grid"></div>
      <details>
        <summary>Add / edit dashboard</summary>
        <form id="dashboard-form">
          <div class="form-mode"><span id="dashboard-mode">New dashboard</span><button type="button" class="btn" id="dashboard-new">New</button></div>
          <label>Name<input name="name" required placeholder="Paris Clock"></label>
          <div class="row">
            <label>Plugin<select name="pluginId" id="plugin-select"></select></label>
            <label>Display duration (s)<input name="duration" type="number" step="0.1" value="10" required></label>
            <label>Theme override<select name="theme" class="theme-select" data-inherit="Inherit from device/default"></select></label>
          </div>
          <div class="config-head">
            <span>Configuration</span>
            <label class="rawtoggle"><input type="checkbox" id="config-json-toggle"> Raw JSON</label>
          </div>
          <div id="config-fields"></div>
          <textarea name="config" id="config-text" style="display:none">{}</textarea>
          <div class="row"><button class="primary" type="submit">Save dashboard</button><span class="msg" id="dashboard-msg"></span></div>
        </form>
      </details>
    </section>

    <section>
      <h2>Plugins</h2>
      <div id="plugin-list" class="grid"></div>
    </section>

    <section>
      <h2>Logs</h2>
      <div class="logbar">
        <span id="log-status" class="log-status connecting">connecting…</span>
        <select id="log-level">
          <option value="">all levels</option>
          <option value="debug">debug+</option>
          <option value="info">info+</option>
          <option value="warn" selected>warn+</option>
          <option value="error">error</option>
        </select>
        <input id="log-filter" placeholder="filter by dashboard id (blank = all)">
        <button class="btn" id="log-refresh" type="button">Refresh</button>
        <button class="danger" id="log-clear" type="button">Clear</button>
      </div>
      <div id="log-list" class="logs"></div>
    </section>
  </main>
<script>
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else e.setAttribute(k, props[k]);
    }
    (kids || []).forEach(function (c) { if (c == null) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  // Access a named form control safely (form.id/form.name resolve to element props, not controls).
  function fld(form, name) { return form.elements.namedItem(name); }
  function msToSeconds(ms) { return Number(ms) / 1000; }
  function secondsToMs(seconds) { return Math.round(Number(seconds) * 1000); }
  function fmtSeconds(ms) {
    var sec = msToSeconds(ms);
    if (!Number.isFinite(sec)) return '0';
    return (Math.round(sec * 1000) / 1000).toString();
  }
  function authed(r) { if (r.status === 401) { location.href = '/login'; throw new Error('auth'); } return r; }
  function jget(u) { return fetch(u).then(authed).then(function (r) { return r.json(); }); }
  function jsend(method, u, body) {
    return fetch(u, { method: method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(authed);
  }

  var state = { plugins: [], dashboards: [], devices: [], config: { defaultTheme: 'dark', themes: ['dark', 'black', 'light', 'terminal'] } };
  var editingDashboardId = null, editingDeviceId = null;
  var configMode = 'form'; // 'form' | 'json'

  function bust(u) { return u + '?t=' + Date.now(); }
  function pluginById(id) { return state.plugins.find(function (p) { return p.id === id; }); }
  function dashboardById(id) { return state.dashboards.find(function (d) { return d.id === id; }); }
  function durationForDashboard(id) { var d = dashboardById(id); return d ? d.displayDurationMs : 10000; }
  function themeLabel(t) {
    if (t === 'dark') return 'Dark';
    if (t === 'black') return 'Black (AMOLED)';
    if (t === 'light') return 'Light';
    if (t === 'terminal') return 'Terminal';
    return t || 'Inherited';
  }
  function deviceTheme(t) { return t || state.config.defaultTheme || 'dark'; }
  function dashboardTheme(t) { return t ? themeLabel(t) : 'Inherit'; }
  function fillThemeSelect(sel, inheritLabel, value) {
    sel.innerHTML = '';
    if (inheritLabel) sel.appendChild(el('option', { value: '' }, [inheritLabel]));
    (state.config.themes || []).forEach(function (t) { sel.appendChild(el('option', { value: t }, [themeLabel(t)])); });
    sel.value = value || '';
  }
  function fillThemeSelects() {
    Array.prototype.forEach.call(document.querySelectorAll('.theme-select'), function (sel) {
      var inherit = sel.getAttribute('data-inherit');
      fillThemeSelect(sel, inherit, sel.value || (inherit ? '' : state.config.defaultTheme));
    });
  }
  function dashboardForm() { return document.getElementById('dashboard-form'); }
  function deviceForm() { return document.getElementById('device-form'); }
  function openForm(form) { var d = form.closest('details'); if (d) d.open = true; }

  // ---------- Plugins ----------
  function renderPlugins() {
    var list = document.getElementById('plugin-list'); list.innerHTML = '';
    state.plugins.forEach(function (p) {
      var tags = (p.dataSources || []).map(function (d) { return el('span', { class: 'tag' }, ['data: ' + d.id]); });
      list.appendChild(el('div', { class: 'card' }, [
        el('h3', null, [p.name]),
        el('div', { class: 'meta' }, ['default ' + fmtSeconds(p.defaultDisplayDurationMs) + 's'])
      ].concat(tags)));
    });
    var sel = document.getElementById('plugin-select');
    var prev = sel.value;
    sel.innerHTML = '';
    state.plugins.forEach(function (p) { sel.appendChild(el('option', { value: p.id }, [p.name])); });
    if (prev && state.plugins.some(function (p) { return p.id === prev; })) sel.value = prev;
    // On first load (new dashboard, empty form), seed the friendly config from defaults.
    if (!editingDashboardId && document.getElementById('config-fields').children.length === 0) onPluginChange();
  }

  // ---------- Config form (friendly view + JSON toggle) ----------
  function pluginConfigFields(pluginId) { var p = pluginById(pluginId); return (p && p.configFields) || []; }
  function defaultConfigFor(pluginId) {
    var cfg = {};
    pluginConfigFields(pluginId).forEach(function (f) { if (f.default !== undefined) cfg[f.key] = f.default; });
    return cfg;
  }
  function makeLocationWidget(f, cityVal, latVal, lonVal) {
    var wrap = document.createElement('div'); wrap.className = 'loc-wrap';
    var search = el('input', { type: 'text', 'data-key': f.key, 'data-type': 'string',
      placeholder: f.placeholder || 'Search for a city…',
      value: cityVal == null ? '' : String(cityVal) });
    search.style.width = '100%';
    var latInp = el('input', { type: 'hidden', 'data-key': f.latKey || 'lat', 'data-type': 'number',
      value: latVal != null ? String(latVal) : '' });
    var lonInp = el('input', { type: 'hidden', 'data-key': f.lonKey || 'lon', 'data-type': 'number',
      value: lonVal != null ? String(lonVal) : '' });
    var drop = el('div', { class: 'loc-drop' });
    wrap.appendChild(search); wrap.appendChild(latInp); wrap.appendChild(lonInp); wrap.appendChild(drop);
    var timer;
    function showResults(results) {
      drop.innerHTML = '';
      if (!results.length) {
        drop.appendChild(el('div', { class: 'loc-item' }, [el('div', { class: 'loc-name' }, ['No results'])]));
      } else {
        results.forEach(function(r) {
          var sub = [r.admin1, r.country].filter(Boolean).join(', ');
          var item = el('div', { class: 'loc-item' }, [
            el('div', { class: 'loc-name' }, [r.name]),
            el('div', { class: 'loc-sub' }, [sub]),
          ]);
          item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            search.value = r.name;
            latInp.value = String(r.latitude);
            lonInp.value = String(r.longitude);
            drop.classList.remove('open'); drop.innerHTML = '';
          });
          drop.appendChild(item);
        });
      }
      drop.classList.add('open');
    }
    search.addEventListener('input', function() {
      clearTimeout(timer);
      var q = search.value.trim();
      if (q.length < 2) { drop.classList.remove('open'); drop.innerHTML = ''; return; }
      timer = setTimeout(function() {
        fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=6&language=en&format=json')
          .then(function(r) { return r.json(); })
          .then(function(d) { showResults(d.results || []); })
          .catch(function() { drop.classList.remove('open'); });
      }, 300);
    });
    search.addEventListener('blur', function() { setTimeout(function() { drop.classList.remove('open'); }, 150); });
    return wrap;
  }
  function makeInput(f, val) {
    var input;
    if (f.type === 'boolean') { input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!val; }
    else if (f.type === 'select') {
      input = document.createElement('select');
      (f.options || []).forEach(function (o) {
        var opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label;
        if (String(val) === o.value) opt.selected = true;
        input.appendChild(opt);
      });
    } else if (f.type === 'text') { input = document.createElement('textarea'); input.value = val == null ? '' : String(val); if (f.placeholder) input.placeholder = f.placeholder; }
    else if (f.type === 'number') { input = document.createElement('input'); input.type = 'number'; if (f.min != null) input.min = f.min; if (f.max != null) input.max = f.max; if (f.step != null) input.step = f.step; input.value = val == null ? '' : String(val); }
    else if (f.type === 'color') { input = document.createElement('input'); input.type = 'color'; input.value = val || '#000000'; }
    else { input = document.createElement('input'); input.type = 'text'; input.value = val == null ? '' : String(val); if (f.placeholder) input.placeholder = f.placeholder; }
    input.setAttribute('data-key', f.key);
    input.setAttribute('data-type', f.type === 'number' ? 'number' : (f.type === 'boolean' ? 'boolean' : 'string'));
    return input;
  }
  function renderConfigForm(pluginId, values) {
    var fields = pluginConfigFields(pluginId);
    var c = document.getElementById('config-fields'); c.innerHTML = '';
    if (!fields.length) { c.appendChild(el('div', { class: 'hint' }, ['This plugin has no field schema — use Raw JSON.'])); return; }
    // Keys managed (hidden) by a location widget — don't render them as standalone fields.
    var managed = {};
    fields.forEach(function(f) { if (f.type === 'location') { if (f.latKey) managed[f.latKey] = true; if (f.lonKey) managed[f.lonKey] = true; } });
    fields.forEach(function (f) {
      if (managed[f.key]) return;
      var val = values && values[f.key] !== undefined ? values[f.key] : f.default;
      if (f.type === 'location') {
        // Resolve lat/lon from current values, falling back to their field defaults.
        var latField = f.latKey && fields.find(function(x) { return x.key === f.latKey; });
        var lonField = f.lonKey && fields.find(function(x) { return x.key === f.lonKey; });
        var latVal = values && f.latKey && values[f.latKey] !== undefined ? values[f.latKey] : (latField ? latField.default : undefined);
        var lonVal = values && f.lonKey && values[f.lonKey] !== undefined ? values[f.lonKey] : (lonField ? lonField.default : undefined);
        var widget = makeLocationWidget(f, val, latVal, lonVal);
        var wrap = el('div', { class: 'field' }, [el('span', { class: 'field-label' }, [f.label + (f.required ? ' *' : '')])]);
        wrap.appendChild(widget);
        if (f.description) wrap.appendChild(el('span', { class: 'field-hint' }, [f.description]));
        c.appendChild(wrap); return;
      }
      var input = makeInput(f, val);
      if (f.type === 'boolean') {
        var b = el('label', { class: 'field field-bool' }, [input, el('span', { class: 'field-label' }, [f.label])]);
        if (f.description) b.appendChild(el('span', { class: 'field-hint' }, [f.description]));
        c.appendChild(b); return;
      }
      var lbl = el('label', { class: 'field' }, [el('span', { class: 'field-label' }, [f.label + (f.required ? ' *' : '')])]);
      lbl.appendChild(input);
      if (f.description) lbl.appendChild(el('span', { class: 'field-hint' }, [f.description]));
      c.appendChild(lbl);
    });
  }
  function collectConfigForm() {
    var cfg = {};
    Array.prototype.forEach.call(document.querySelectorAll('#config-fields [data-key]'), function (input) {
      var key = input.getAttribute('data-key'), type = input.getAttribute('data-type');
      if (type === 'boolean') cfg[key] = input.checked;
      else if (type === 'number') { var s = input.value.trim(); if (s !== '') cfg[key] = Number(s); }
      else cfg[key] = input.value;
    });
    return cfg;
  }
  function setConfigMode(mode) {
    configMode = mode;
    document.getElementById('config-json-toggle').checked = (mode === 'json');
    document.getElementById('config-fields').style.display = mode === 'json' ? 'none' : '';
    document.getElementById('config-text').style.display = mode === 'json' ? '' : 'none';
  }
  function currentConfig() {
    if (configMode === 'json') return JSON.parse(document.getElementById('config-text').value || '{}');
    return collectConfigForm();
  }
  function onPluginChange() {
    var pid = fld(dashboardForm(), 'pluginId').value;
    var defaults = defaultConfigFor(pid);
    renderConfigForm(pid, defaults);
    document.getElementById('config-text').value = JSON.stringify(defaults, null, 2);
    var p = pluginById(pid), dur = fld(dashboardForm(), 'duration');
    if (p && p.defaultDisplayDurationMs) dur.value = fmtSeconds(p.defaultDisplayDurationMs);
    setConfigMode(pluginConfigFields(pid).length ? 'form' : 'json');
  }

  // ---------- Dashboards ----------
  function renderDashboards() {
    var list = document.getElementById('dashboard-list'); list.innerHTML = '';
    state.dashboards.forEach(function (d) {
      var pname = (pluginById(d.pluginId) || {}).name || d.pluginId;
      list.appendChild(el('div', { class: 'card' }, [
        el('h3', null, [d.name]),
        el('div', { class: 'meta' }, [pname + ' · ' + fmtSeconds(d.displayDurationMs) + 's · theme ' + dashboardTheme(d.theme)]),
        el('img', { src: bust('/admin/dashboards/' + d.id + '/preview.jpg'), alt: d.name }),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn', onclick: function () { editDashboard(d); } }, ['Edit']),
          el('button', { class: 'btn', onclick: function () { showLogsFor(d.id); } }, ['Logs']),
          el('button', { class: 'danger', onclick: function () { delDashboard(d.id, d.name); } }, ['Delete'])
        ])
      ]));
    });
  }
  function editDashboard(d) {
    var f = dashboardForm();
    editingDashboardId = d.id;
    document.getElementById('dashboard-mode').textContent = 'Editing: ' + d.name;
    openForm(f);
    fld(f, 'name').value = d.name;
    fld(f, 'pluginId').value = d.pluginId;
    fld(f, 'duration').value = fmtSeconds(d.displayDurationMs);
    fld(f, 'theme').value = d.theme || '';
    renderConfigForm(d.pluginId, d.config || {});
    document.getElementById('config-text').value = JSON.stringify(d.config || {}, null, 2);
    setConfigMode(pluginConfigFields(d.pluginId).length ? 'form' : 'json');
    f.scrollIntoView({ behavior: 'smooth' });
  }
  function newDashboard() {
    var f = dashboardForm();
    editingDashboardId = null;
    document.getElementById('dashboard-mode').textContent = 'New dashboard';
    fld(f, 'name').value = '';
    fld(f, 'theme').value = '';
    onPluginChange();
    openForm(f);
  }
  function delDashboard(id, name) { if (confirm('Delete dashboard "' + (name || id) + '"?')) jsend('DELETE', '/admin/dashboards/' + id).then(function () { if (editingDashboardId === id) newDashboard(); load(); }); }

  // ---------- Devices ----------
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) { prompt('Copy this URL:', text); }
  }
  function copyDeviceLink(id, btn) {
    var url = location.origin + '/devices/' + id + '/screen.jpg';
    var flash = function () { if (!btn) return; btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy link'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(flash, function () { fallbackCopy(url); flash(); });
    else { fallbackCopy(url); flash(); }
  }
  function renderDevices() {
    var list = document.getElementById('device-list'); list.innerHTML = '';
    state.devices.forEach(function (dev) {
      var slots = (dev.assignments || []).map(function (a) {
        var dn = (state.dashboards.find(function (x) { return x.id === a.dashboardId; }) || {}).name || a.dashboardId;
        return el('span', { class: 'tag' }, [dn + ' (' + fmtSeconds(a.displayDurationMs) + 's)']);
      });
      list.appendChild(el('div', { class: 'card' }, [
        el('h3', null, [dev.name]),
        el('div', { class: 'meta' }, ['polls every ' + fmtSeconds(dev.pollIntervalMs) + 's · theme ' + themeLabel(deviceTheme(dev.theme))]),
        el('img', { src: bust('/devices/' + dev.id + '/screen.jpg'), alt: dev.name, 'data-dev': dev.id }),
        el('div', null, slots),
        el('div', { class: 'row', style: 'margin-top:10px' }, [
          el('button', { class: 'btn', onclick: function () { editDevice(dev); } }, ['Edit']),
          el('button', { class: 'btn', onclick: function (e) { copyDeviceLink(dev.id, e.currentTarget); } }, ['Copy link']),
          el('button', { class: 'danger', onclick: function () { delDevice(dev.id, dev.name); } }, ['Delete'])
        ])
      ]));
    });
  }
  function dashboardOptions(selected) {
    var sel = el('select', { class: 'assign-dash' });
    state.dashboards.forEach(function (d) {
      var o = el('option', { value: d.id }, [d.name]);
      if (d.id === selected) o.setAttribute('selected', 'selected');
      sel.appendChild(o);
    });
    return sel;
  }
  function assignRow(dashboardId, duration) {
    var row = el('div', { class: 'assign-row' }, []);
    var sel = dashboardOptions(dashboardId);
    var dur = el('input', { type: 'number', value: fmtSeconds(duration || durationForDashboard(sel.value)), class: 'assign-dur', step: '0.1', title: 'Duration (s)', placeholder: 'duration (s)' });
    sel.addEventListener('change', function () { dur.value = fmtSeconds(durationForDashboard(sel.value)); });
    var rm = el('button', { type: 'button', class: 'danger', onclick: function () { row.remove(); } }, ['×']);
    row.appendChild(sel); row.appendChild(dur); row.appendChild(rm);
    return row;
  }
  function addAssign(dashboardId, duration) { document.getElementById('assignments').appendChild(assignRow(dashboardId, duration)); }
  function editDevice(dev) {
    var f = deviceForm();
    editingDeviceId = dev.id;
    document.getElementById('device-mode').textContent = 'Editing: ' + dev.name;
    openForm(f);
    fld(f, 'name').value = dev.name;
    fld(f, 'poll').value = fmtSeconds(dev.pollIntervalMs);
    fld(f, 'theme').value = deviceTheme(dev.theme);
    document.getElementById('assignments').innerHTML = '';
    (dev.assignments || []).forEach(function (a) { addAssign(a.dashboardId, a.displayDurationMs); });
    f.scrollIntoView({ behavior: 'smooth' });
  }
  function newDevice() {
    var f = deviceForm();
    editingDeviceId = null;
    document.getElementById('device-mode').textContent = 'New device';
    fld(f, 'name').value = '';
    fld(f, 'poll').value = 5;
    fld(f, 'theme').value = state.config.defaultTheme || 'dark';
    document.getElementById('assignments').innerHTML = '';
    openForm(f);
  }
  function delDevice(id, name) { if (confirm('Delete device "' + (name || id) + '"?')) jsend('DELETE', '/admin/devices/' + id).then(function () { if (editingDeviceId === id) newDevice(); load(); }); }

  // ---------- Logs (live over WebSocket) ----------
  var LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
  var logEntries = [];
  function fmtTime(ts) { return new Date(ts).toTimeString().slice(0, 8); }
  function renderLogs() {
    var level = document.getElementById('log-level').value;
    var dash = document.getElementById('log-filter').value.trim();
    var min = level ? LEVEL_ORDER[level] : 0;
    var rows = logEntries.filter(function (e) { return LEVEL_ORDER[e.level] >= min && (!dash || e.dashboardId === dash); }).slice().reverse();
    var list = document.getElementById('log-list'); list.innerHTML = '';
    if (!rows.length) { list.appendChild(el('div', { class: 'log-empty' }, ['No logs match.'])); return; }
    rows.forEach(function (e) {
      var msg = e.message + (e.meta ? ' ' + JSON.stringify(e.meta) : '');
      list.appendChild(el('div', { class: 'log-row' }, [
        el('span', { class: 'log-ts' }, [fmtTime(e.ts)]),
        el('span', { class: 'log-lvl lvl-' + e.level }, [e.level]),
        el('span', { class: 'log-src' }, [e.source + (e.dashboardId ? '/' + e.dashboardId : '')]),
        el('span', { class: 'log-msg' }, [msg]),
      ]));
    });
  }
  function setLogStatus(state) {
    var elx = document.getElementById('log-status');
    elx.className = 'log-status ' + state;
    elx.textContent = state === 'live' ? 'live' : state === 'connecting' ? 'connecting…' : 'reconnecting…';
  }
  function connectLogs() {
    setLogStatus('connecting');
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws;
    try { ws = new WebSocket(proto + '//' + location.host + '/admin/logs/stream'); }
    catch (e) { setLogStatus('reconnecting'); setTimeout(connectLogs, 2000); return; }
    ws.onopen = function () { setLogStatus('live'); };
    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'backlog') logEntries = msg.entries.slice();
      else if (msg.type === 'entry') { logEntries.push(msg.entry); if (logEntries.length > 500) logEntries.splice(0, logEntries.length - 500); }
      renderLogs();
    };
    ws.onclose = function () { setLogStatus('reconnecting'); setTimeout(connectLogs, 2000); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function showLogsFor(id) {
    document.getElementById('log-filter').value = id;
    document.getElementById('log-level').value = '';
    renderLogs();
    document.querySelector('#log-list').scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- Wiring ----------
  function wireForms() {
    document.getElementById('add-assign').addEventListener('click', function () { addAssign(); });
    document.getElementById('device-new').addEventListener('click', newDevice);
    document.getElementById('dashboard-new').addEventListener('click', newDashboard);
    document.getElementById('plugin-select').addEventListener('change', onPluginChange);

    document.getElementById('config-json-toggle').addEventListener('change', function () {
      var msg = document.getElementById('dashboard-msg');
      if (this.checked) { document.getElementById('config-text').value = JSON.stringify(collectConfigForm(), null, 2); setConfigMode('json'); }
      else {
        var cfg; try { cfg = JSON.parse(document.getElementById('config-text').value || '{}'); }
        catch (e) { msg.className = 'msg err'; msg.textContent = 'Invalid JSON — fix it before switching back.'; this.checked = true; return; }
        renderConfigForm(fld(dashboardForm(), 'pluginId').value, cfg); setConfigMode('form');
      }
    });

    document.getElementById('device-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, msg = document.getElementById('device-msg');
      var assignments = Array.prototype.map.call(document.querySelectorAll('#assignments .assign-row'), function (row) {
        return {
          dashboardId: row.querySelector('.assign-dash').value,
          displayDurationMs: secondsToMs(row.querySelector('.assign-dur').value),
        };
      });
      var body = { name: fld(f, 'name').value.trim(), theme: fld(f, 'theme').value, pollIntervalMs: secondsToMs(fld(f, 'poll').value), assignments: assignments };
      if (editingDeviceId) body.id = editingDeviceId;
      jsend('POST', '/admin/devices', body).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (!o.r.ok) { msg.className = 'msg err'; msg.textContent = o.j.error || 'Error'; return; }
          load().then(function () {
            if (o.j.device) editDevice(o.j.device); // stay on the saved device
            msg.className = 'msg ok';
            msg.textContent = 'Saved.' + ((o.j.warnings && o.j.warnings.length) ? ' ⚠ ' + o.j.warnings.join(' ') : '');
          });
        });
    });

    document.getElementById('dashboard-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, msg = document.getElementById('dashboard-msg');
      var config;
      try { config = currentConfig(); }
      catch (err) { msg.className = 'msg err'; msg.textContent = 'Config is not valid JSON'; return; }
      var body = {
        name: fld(f, 'name').value.trim(),
        pluginId: fld(f, 'pluginId').value,
        config: config,
        displayDurationMs: secondsToMs(fld(f, 'duration').value),
      };
      if (fld(f, 'theme').value) body.theme = fld(f, 'theme').value;
      if (editingDashboardId) body.id = editingDashboardId;
      jsend('POST', '/admin/dashboards', body).then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
        .then(function (o) {
          if (!o.r.ok) { msg.className = 'msg err'; msg.textContent = o.j.error || 'Error'; return; }
          load().then(function () {
            if (o.j.dashboard) editDashboard(o.j.dashboard); // stay on the saved dashboard
            msg.className = 'msg ok'; msg.textContent = 'Saved.';
          });
        });
    });

    document.getElementById('log-refresh').addEventListener('click', renderLogs);
    document.getElementById('log-clear').addEventListener('click', function () {
      jsend('DELETE', '/admin/logs').then(function () { logEntries = []; renderLogs(); });
    });
    document.getElementById('log-level').addEventListener('change', renderLogs);
    var lf = document.getElementById('log-filter'), lt;
    lf.addEventListener('input', function () { clearTimeout(lt); lt = setTimeout(renderLogs, 300); });
  }

  function load() {
    return Promise.all([jget('/admin/plugins'), jget('/admin/dashboards'), jget('/admin/devices'), jget('/admin/config')])
      .then(function (res) {
        state.plugins = res[0]; state.dashboards = res[1]; state.devices = res[2]; state.config = res[3];
        fillThemeSelects();
        renderPlugins(); renderDashboards(); renderDevices();
      });
  }

  setInterval(function () {
    document.querySelectorAll('img[data-dev]').forEach(function (img) { img.src = bust('/devices/' + img.getAttribute('data-dev') + '/screen.jpg'); });
  }, 5000);

  wireForms();
  load();
  connectLogs();
</script>
</body></html>`;
}

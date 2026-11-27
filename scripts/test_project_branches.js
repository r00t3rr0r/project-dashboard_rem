const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function makeHarness(fetch) {
  const stored = new Map();
  const requests = [];
  const window = {
    location: {origin: 'http://localhost'},
    sessionStorage: {getItem: () => null, setItem() {}, removeItem() {}},
    DataLayer: {
      getStoredValue: key => stored.get(key) || '',
      getProjectById: () => null
    },
    addEventListener() {}
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById: () => null,
    createTextNode: value => String(value),
    createElement: () => ({
      innerHTML: '',
      appendChild(value) {
        this.innerHTML = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
    })
  };
  const sandbox = {window, document, console, URL, fetch: async (url, options) => {
    requests.push({url, options});
    return fetch(url, options);
  }};
  let source = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8');
  source = source.replace(
    'var projectPageWasActive=false;',
    'window.projectBranchesTest={renderProjectBranches,ensureProjectBranches,cache:PROJECT_BRANCH_CACHE};\nvar projectPageWasActive=false;'
  );
  vm.runInNewContext(source, sandbox);
  return {api: window.projectBranchesTest, requests, stored};
}

test('project cards show a few branch badges and expand larger branch sets', () => {
  const harness = makeHarness(async () => ({ok: true, json: async () => []}));
  const project = {
    id: 'project-1',
    github: {owner: 'acme', repo: 'app', url: 'https://github.com/acme/app', defaultBranch: 'main'}
  };
  harness.api.cache['acme/app'] = {
    branches: ['main', 'develop', 'feature/a', 'feature/b', 'release/1'],
    status: 'loaded',
    error: '',
    checkedAt: Date.now(),
    promise: null
  };

  const html = harness.api.renderProjectBranches(project);
  assert.match(html, /main/);
  assert.match(html, /Standardbranch/);
  assert.match(html, /<details class="project-branches-more">/);
  assert.match(html, /aria-label="2 weitere Branches anzeigen"/);
  assert.match(html, /feature\/b/);
  assert.match(html, /release\/1/);
  assert.doesNotMatch(html, /<details class="project-branches-more" open/);

  harness.api.cache['acme/app'].branches = ['main', 'feature/a'];
  const compactHtml = harness.api.renderProjectBranches(project);
  assert.doesNotMatch(compactHtml, /project-branches-more/);
  assert.match(compactHtml, /feature\/a/);
});

test('branch loading follows all API pages and sorts the default branch first', async () => {
  const firstPage = Array.from({length: 100}, (_, index) => ({name: 'branch-' + index}));
  firstPage[10] = {name: 'main'};
  const harness = makeHarness(async url => {
    const page = new URL(url, 'http://localhost').searchParams.get('page');
    return {ok: true, json: async () => page === '1' ? firstPage : [{name: 'last-branch'}]};
  });
  const project = {
    id: 'project-2',
    github: {owner: 'acme', repo: 'app', url: 'https://github.com/acme/app', defaultBranch: 'main'}
  };

  const state = await harness.api.ensureProjectBranches(project, false);
  assert.equal(state.status, 'loaded');
  assert.equal(state.branches.length, 101);
  assert.equal(state.branches[0], 'main');
  assert.ok(state.branches.includes('last-branch'));
  assert.equal(harness.requests.length, 2);
  assert.match(harness.requests[0].url, /page=1/);
  assert.match(harness.requests[1].url, /page=2/);
});

test('branch loading errors are shown with a retry action', async () => {
  const harness = makeHarness(async () => ({
    ok: false,
    status: 403,
    json: async () => ({message: 'Rate limit exceeded'})
  }));
  const project = {
    id: 'project-3',
    github: {owner: 'acme', repo: 'private', url: 'https://github.com/acme/private'}
  };

  const state = await harness.api.ensureProjectBranches(project, false);
  assert.equal(state.status, 'error');
  assert.match(state.error, /Rate limit exceeded/);
  const html = harness.api.renderProjectBranches(project);
  assert.match(html, /Branches nicht verfügbar/);
  assert.match(html, /data-action="load-project-branches"/);
  assert.match(html, /Erneut laden/);
});

test('a failed refresh keeps cached branches visible and reports the error', async () => {
  const harness = makeHarness(async () => ({
    ok: false,
    status: 403,
    json: async () => ({message: 'Rate limit exceeded'})
  }));
  const project = {
    id: 'project-4',
    github: {owner: 'acme', repo: 'app', url: 'https://github.com/acme/app'}
  };
  harness.api.cache['acme/app'] = {
    branches: ['main', 'feature/cached'],
    status: 'loaded',
    error: '',
    checkedAt: Date.now(),
    promise: null
  };

  const state = await harness.api.ensureProjectBranches(project, true);
  const html = harness.api.renderProjectBranches(project);
  assert.equal(state.status, 'error');
  assert.match(html, /feature\/cached/);
  assert.match(html, /Aktualisierung fehlgeschlagen/);
  assert.match(html, /Erneut laden/);
});

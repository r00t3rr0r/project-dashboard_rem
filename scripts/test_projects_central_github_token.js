const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function makeHarness(options) {
  const config = options || {};
  const stored = new Map();
  const sessionStore = new Map();
  const projects = config.projects || [];
  const toasts = [];
  const requests = [];
  const deletedKeys = [];

  const window = {
    location: {origin: 'http://localhost:8766', hostname: 'localhost'},
    sessionStorage: {
      getItem: key => sessionStore.get(key) ?? null,
      setItem: (key, value) => sessionStore.set(key, String(value)),
      removeItem: key => sessionStore.delete(key)
    },
    DataLayer: {
      getProjects: () => projects,
      getProjectById: id => projects.find(project => project.id === id) || null,
      updateProject: () => {},
      createNotification: () => {},
      generateId: () => 'gen-id',
      getStoredValue: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
      setStoredValue: (key, value) => stored.set(key, String(value)),
      deleteStoredValue: key => { stored.delete(key); deletedKeys.push(key); }
    },
    AuthManager: {
      getCurrentUser: () => config.currentUser || null
    },
    QuickTaskModule: {showToast: (message, isError) => toasts.push({message, isError})}
  };

  const sandbox = {
    window,
    console,
    alert: () => {},
    document: {readyState: 'loading', addEventListener() {}, getElementById: () => null},
    fetch: async (url, fetchOptions) => {
      requests.push({url, options: fetchOptions || {}});
      if (config.fetch) return config.fetch(url, fetchOptions || {});
      return {ok: false, status: 404, json: async () => ({message: 'Not Found'})};
    }
  };

  let source = fs.readFileSync(path.join(__dirname, '../modules/projects.js'), 'utf8');
  source = source.replace(
    /createProjectFromZip:createProjectFromZip\r?\n};/,
    'createProjectFromZip:createProjectFromZip,\n  getGitHubApiToken:getGitHubApiToken\n};'
  );
  vm.runInNewContext(source, sandbox);

  return {api: window.ProjectsModule, stored, sessionStore, projects, toasts, requests, deletedKeys};
}

const CENTRAL_KEY = 'pd_github_central_token_v1';

test('central token is used as fallback when no other token source exists', () => {
  const harness = makeHarness();
  harness.stored.set(CENTRAL_KEY, 'central-token');
  assert.equal(harness.api.getGitHubApiToken(), 'central-token');
});

test('token of the logged-in employee wins over the central token', () => {
  const harness = makeHarness({currentUser: {github: {privateAccessToken: 'user-token'}}});
  harness.stored.set(CENTRAL_KEY, 'central-token');
  assert.equal(harness.api.getGitHubApiToken(), 'user-token');
});

test('setCentralGitHubToken stores trimmed token and clears it on empty value', () => {
  const harness = makeHarness();
  harness.api.setCentralGitHubToken('  ghp_abc  ');
  assert.equal(harness.stored.get(CENTRAL_KEY), 'ghp_abc');
  assert.equal(harness.api.getCentralGitHubToken(), 'ghp_abc');

  harness.api.setCentralGitHubToken('');
  assert.equal(harness.stored.has(CENTRAL_KEY), false);
  assert.deepEqual(harness.deletedKeys, [CENTRAL_KEY]);
  assert.equal(harness.api.getCentralGitHubToken(), '');
});

function commitItem(sha, date) {
  return {
    sha,
    html_url: 'https://github.com/x/y/commit/' + sha,
    commit: {message: 'Change ' + sha, author: {name: 'Dev', date}},
    author: {login: 'r3vm4y'}
  };
}

test('syncAllRepositories fetches commits for every linked repo with the central token and tolerates failures', async () => {
  const projects = [
    {id: 'p1', title: 'Alpha', github: {owner: 'acme', repo: 'app', url: 'https://github.com/acme/app'}},
    {id: 'p2', title: 'Beta', github: {owner: 'broken', repo: 'lib', url: 'https://github.com/broken/lib'}},
    {id: 'p3', title: 'Ohne Repo', github: null}
  ];
  const harness = makeHarness({
    projects,
    fetch: async url => {
      if (url.includes('owner=acme') && url.includes('/api/github/commits')) {
        return {ok: true, json: async () => [commitItem('a1', '2026-11-24T10:00:00Z'), commitItem('a2', '2026-11-23T10:00:00Z')]};
      }
      // "broken" repo fails via backend proxy and direct GitHub API alike
      return {ok: false, status: 404, json: async () => ({message: 'Not Found'})};
    }
  });
  harness.stored.set(CENTRAL_KEY, 'central-token');

  const result = await harness.api.syncAllRepositories();

  assert.equal(result.synced, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Beta/);

  assert.equal(projects[0].githubCommits.length, 2);
  assert.equal(projects[0].githubMetrics.totalCommits, 2);
  assert.ok(projects[0].github.lastSyncAt);
  assert.equal(projects[1].githubCommits, undefined);

  const commitRequest = harness.requests.find(request => request.url.includes('owner=acme') && request.url.includes('/api/github/commits'));
  assert.ok(commitRequest, 'backend commits endpoint was called');
  assert.equal(commitRequest.options.headers['X-GitHub-Token'], 'central-token');
});

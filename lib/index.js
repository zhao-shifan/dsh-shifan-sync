// dsh-shifan-sync — account-level state sync plugin (Host half).
// Zero harness-package imports on purpose: the bundle installs as a pnpm link
// to this workspace directory, so peer dependencies such as
// @deepseek-ai/dsh-tools are not resolvable from here. Tool registration uses
// the raw definition object (tools.register validates it), and settings live
// in a plugin-owned file instead of a schemastery Config schema.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  applyFromFolder,
  applyFromRepo,
  authenticatedUrl,
  defaultRoots,
  deviceName,
  dshHomeDir,
  ensureRepo,
  gitAsync,
  mirrorToRepo,
  profileDir,
  readLocalManifest,
  readManifestFromFolder,
  readManifestFromRepo,
  repoState,
} from "./sync-core.js";

const SETTINGS_DIR = () => path.join(dshHomeDir(), ".dsh-shifan-sync");
const SETTINGS_FILE = () => path.join(SETTINGS_DIR(), "settings.json");
const REPO_DIR = () => path.join(SETTINGS_DIR(), "repo");
const BACKUP_ROOT = () => path.join(SETTINGS_DIR(), "backup");
const STATE_FILE = () => path.join(SETTINGS_DIR(), "state.json");

const TOKEN_REF = "DSH_SHIFAN_SYNC_TOKEN";
const PASSPHRASE_REF = "DSH_SHIFAN_SYNC_PASSPHRASE";

const DEFAULT_SETTINGS = {
  repoUrl: "",
  branch: "main",
  syncDir: "",
  autoPush: true,
  autoPushDebounceMs: 60_000,
  autoPullMinutes: 10,
  encryptCredentials: true,
  maxFileBytes: 20 * 1024 * 1024,
  maxFiles: 200_000,
  rootsOverride: [],
};

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), "utf8"));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  await fsp.mkdir(SETTINGS_DIR(), { recursive: true });
  await fsp.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
  } catch {
    return { lastPush: null, lastPull: null, lastError: null };
  }
}

async function writeState(state) {
  await fsp.mkdir(SETTINGS_DIR(), { recursive: true });
  await fsp.writeFile(STATE_FILE(), JSON.stringify(state, null, 2));
}

function log(log_, level, message) {
  const sink = log_?.[level] ?? log_?.info ?? console;
  if (typeof sink === "function") sink.call(console, `[shifan-sync] ${message}`);
}

function limitsOf(settings) {
  return { maxFileBytes: settings.maxFileBytes, maxFiles: settings.maxFiles, truncated: false };
}

function rootsOf(settings) {
  const override = Array.isArray(settings.rootsOverride) && settings.rootsOverride.length > 0 ? settings.rootsOverride : null;
  if (override) return override.map((root) => ({ area: String(root.area), base: String(root.base) }));
  return defaultRoots(dshHomeDir(), profileDir());
}

async function resolveSecret(ctx, ref) {
  const credentials = ctx.get?.("credentials");
  if (!credentials) return null;
  try {
    return (await credentials.resolve(ref))?.value ?? null;
  } catch {
    return null;
  }
}

function requireRepoUrl(settings) {
  const repoUrl = String(settings.repoUrl ?? "").trim();
  if (!repoUrl) {
    throw new Error('repository is not configured - run sync_setup with repoUrl first (or edit ~/.dsh/.dsh-shifan-sync/settings.json)');
  }
  return repoUrl;
}

// ---- operations behind the tools ----
async function opSetup(ctx, args) {
  const settings = loadSettings();
  const repoUrl = String(args?.repoUrl ?? settings.repoUrl ?? "").trim();
  if (!repoUrl) throw new Error("repoUrl is required (private Git repository, HTTPS recommended)");
  settings.repoUrl = repoUrl;
  settings.syncDir = "";
  if (args?.branch) settings.branch = String(args.branch);
  if (typeof args?.autoPush === "boolean") settings.autoPush = args.autoPush;
  if (typeof args?.autoPullMinutes === "number") settings.autoPullMinutes = args.autoPullMinutes;
  if (typeof args?.encryptCredentials === "boolean") settings.encryptCredentials = args.encryptCredentials;
  const token = String(args?.token ?? "").trim();
  const passphrase = String(args?.passphrase ?? "").trim();
  const stored = [];
  const credentials = ctx.get?.("credentials");
  if (credentials) {
    if (token) {
      await credentials.set(TOKEN_REF, token);
      stored.push(TOKEN_REF);
    }
    if (passphrase) {
      await credentials.set(PASSPHRASE_REF, passphrase);
      stored.push(PASSPHRASE_REF);
    }
  } else if (token || passphrase) {
    throw new Error("credentials service unavailable - cannot store the token; add it to the credential center (~/.dsh/.credentials.yaml) manually");
  }
  await saveSettings(settings);
  if (settings.repoUrl && settings.autoPush !== false) startAutomation(ctx);
  return { ok: true, settings: { ...settings, rootsOverride: undefined }, storedCredentials: stored };
}

// ---- folder backend: data mirrored into a user-chosen folder (e.g. inside
// OneDrive/百度网盘/坚果云 sync directories). No Git, no token needed. ----
function backendMode(settings) {
  if (String(settings.repoUrl ?? "").trim()) return "git";
  if (String(settings.syncDir ?? "").trim()) return "folder";
  return "none";
}

async function opFolderSetup(ctx, args) {
  const settings = loadSettings();
  const syncDir = String(args?.syncDir ?? "").trim();
  if (!syncDir) throw new Error("syncDir is required (a folder path; put it inside a cloud-drive sync directory for cross-machine sync)");
  await fsp.mkdir(syncDir, { recursive: true });
  settings.syncDir = syncDir;
  settings.repoUrl = "";
  if (typeof args?.encryptCredentials === "boolean") settings.encryptCredentials = args.encryptCredentials;
  if (typeof args?.autoPush === "boolean") settings.autoPush = args.autoPush;
  if (typeof args?.autoPullMinutes === "number") settings.autoPullMinutes = args.autoPullMinutes;
  const passphrase = String(args?.passphrase ?? "").trim();
  const stored = [];
  const credentials = ctx.get?.("credentials");
  if (credentials && passphrase) {
    await credentials.set(PASSPHRASE_REF, passphrase);
    stored.push(PASSPHRASE_REF);
  }
  await saveSettings(settings);
  startAutomation(ctx);
  return { ok: true, mode: "folder", syncDir, storedCredentials: stored };
}

async function opFolderPush(ctx, settings = loadSettings()) {
  const syncDir = String(settings.syncDir ?? "").trim();
  if (!syncDir) throw new Error('folder backend is not configured - set a sync folder first');
  await fsp.mkdir(syncDir, { recursive: true });
  const passphrase = settings.encryptCredentials ? await resolveSecret(ctx, PASSPHRASE_REF) : null;
  const manifest = await readManifestFromFolder(syncDir);
  manifest.files = manifest.files ?? {};
  const counts = await mirrorToRepo({
    repoDir: syncDir,
    roots: rootsOf(settings),
    manifest,
    passphrase,
    limits: limitsOf(settings),
  });
  const state = readState();
  state.lastPush = { at: new Date().toISOString(), counts, mode: "folder" };
  await writeState(state);
  return { ok: true, mode: "folder", counts, pushed: counts.updated + counts.added + counts.removed > 0 };
}

async function opFolderPull(ctx, settings = loadSettings()) {
  const syncDir = String(settings.syncDir ?? "").trim();
  if (!syncDir) throw new Error('folder backend is not configured - set a sync folder first');
  const passphrase = settings.encryptCredentials ? await resolveSecret(ctx, PASSPHRASE_REF) : null;
  const remoteManifest = await readManifestFromFolder(syncDir);
  if (Object.keys(remoteManifest.files ?? {}).length === 0) {
    return { ok: true, upToDate: true, restored: 0, note: "sync folder has no snapshot yet" };
  }
  const localManifest = await readLocalManifest(syncDir);
  const report = await applyFromFolder({
    folderDir: syncDir,
    roots: rootsOf(settings),
    remoteManifest,
    localManifest,
    passphrase,
    backupDir: path.join(BACKUP_ROOT(), new Date().toISOString().replace(/[:.]/g, "-")),
  });
  const state = readState();
  state.lastPull = { at: new Date().toISOString(), upToDate: false, mode: "folder", ...report };
  await writeState(state);
  return { ok: true, upToDate: false, ...report, restartRecommended: report.restored > 0 };
}

async function opPickDirectory(ctx) {
  const picker = ctx.get?.("directoryPicker");
  const capability = picker?.capability?.() ?? picker;
  if (!capability || typeof capability.pick !== "function") {
    throw new Error('directory picker unavailable in this environment - type the folder path manually');
  }
  const picked = await capability.pick();
  return { ok: true, path: picked ?? null };
}

async function opPush(ctx, { commitMessage } = {}) {
  const preliminary = loadSettings();
  if (!String(preliminary.repoUrl ?? "").trim() && String(preliminary.syncDir ?? "").trim()) {
    return opFolderPush(ctx, preliminary);
  }
  const settings = loadSettings();
  const repoUrl = requireRepoUrl(settings);
  const branch = settings.branch || "main";
  await ensureRepo(REPO_DIR(), repoUrl, branch);
  const token = await resolveSecret(ctx, TOKEN_REF);
  const passphrase = settings.encryptCredentials ? await resolveSecret(ctx, PASSPHRASE_REF) : null;
  const manifest = await readLocalManifest(REPO_DIR());
  manifest.files = manifest.files ?? {};
  const counts = await mirrorToRepo({
    repoDir: REPO_DIR(),
    roots: rootsOf(settings),
    manifest,
    passphrase,
    limits: limitsOf(settings),
  });
  const status = await gitAsync(["status", "--porcelain"], { cwd: REPO_DIR() });
  let commit = null;
  if (status.length > 0) {
    await gitAsync(["add", "-A"], { cwd: REPO_DIR() });
    await gitAsync(["commit", "-m", commitMessage ?? `sync from ${deviceName()} at ${new Date().toISOString()}`], { cwd: REPO_DIR() });
    commit = (await gitAsync(["rev-parse", "--short", "HEAD"], { cwd: REPO_DIR() })) || null;
    const url = authenticatedUrl(repoUrl, token);
    try {
      await gitAsync(["push", url, `HEAD:refs/heads/${branch}`, "--force-with-lease"], { cwd: REPO_DIR(), timeoutMs: 180_000 });
    } catch (firstError) {
      // First push to an empty remote, or a non-fast-forward after a remote rewrite.
      try {
        await gitAsync(["push", "-u", url, `HEAD:refs/heads/${branch}`], { cwd: REPO_DIR(), timeoutMs: 180_000 });
      } catch (error) {
        throw new Error(`push failed: ${error.message} (first attempt: ${firstError.message})`);
      }
    }
  }
  const state = readState();
  state.lastPush = { at: new Date().toISOString(), commit, counts };
  await writeState(state);
  return { ok: true, commit, counts, pushed: commit !== null };
}

async function opPull(ctx) {
  const preliminary = loadSettings();
  if (!String(preliminary.repoUrl ?? "").trim() && String(preliminary.syncDir ?? "").trim()) {
    return opFolderPull(ctx, preliminary);
  }
  const settings = loadSettings();
  const repoUrl = requireRepoUrl(settings);
  const branch = settings.branch || "main";
  await ensureRepo(REPO_DIR(), repoUrl, branch);
  const token = await resolveSecret(ctx, TOKEN_REF);
  const passphrase = settings.encryptCredentials ? await resolveSecret(ctx, PASSPHRASE_REF) : null;
  const url = authenticatedUrl(repoUrl, token);
  const before = await repoState(REPO_DIR());
  await gitAsync(["fetch", url, `refs/heads/${branch}`], { cwd: REPO_DIR(), timeoutMs: 180_000 });
  const remoteHead = await gitAsync(["rev-parse", "FETCH_HEAD"], { cwd: REPO_DIR() });
  if (before.head && remoteHead === before.head) {
    const state = readState();
    state.lastPull = { at: new Date().toISOString(), upToDate: true };
    await writeState(state);
    return { ok: true, upToDate: true, restored: 0 };
  }
  const remoteManifest = await readManifestFromRepo(REPO_DIR(), "FETCH_HEAD");
  const localManifest = await readLocalManifest(REPO_DIR());
  const report = await applyFromRepo({
    repoDir: REPO_DIR(),
    roots: rootsOf(settings),
    remoteManifest,
    localManifest,
    passphrase,
    backupDir: path.join(BACKUP_ROOT(), new Date().toISOString().replace(/[:.]/g, "-")),
  });
  await gitAsync(["reset", "--hard", "FETCH_HEAD"], { cwd: REPO_DIR() });
  const state = readState();
  state.lastPull = { at: new Date().toISOString(), upToDate: false, ...report };
  await writeState(state);
  return { ok: true, upToDate: false, remoteHead: remoteHead.slice(0, 12), ...report, restartRecommended: report.restored > 0 };
}

async function opStatus(ctx) {
  const settings = loadSettings();
  const repoUrl = String(settings.repoUrl ?? "").trim();
  const state = readState();
  const base = {
    configured: repoUrl !== "" || String(settings.syncDir ?? "").trim() !== "",
    mode: backendMode(settings),
    repoUrl,
    syncDir: String(settings.syncDir ?? "").trim(),
    branch: settings.branch || "main",
    device: deviceName(),
    profileDir: profileDir(),
    dshHome: dshHomeDir(),
    autoPush: settings.autoPush !== false,
    autoPullMinutes: settings.autoPullMinutes,
    encryptCredentials: settings.encryptCredentials !== false,
    lastPush: state.lastPush,
    lastPull: state.lastPull,
    lastError: state.lastError,
  };
  if (!base.configured) return base;
  if (base.mode === "folder") {
    base.folder = { exists: fs.existsSync(base.syncDir) };
    return base;
  }
  try {
    await ensureRepo(repoUrl, repoUrl, settings.branch || "main");
    base.repo = await repoState(REPO_DIR());
  } catch (error) {
    base.repoError = error.message;
  }
  return base;
}

// ---- tool registration ----
const inject = ["tools", "connection"];

function registerBridge(ctx) {
  ctx.inject(["connection"], (bctx) => {
    ctx.effect(() => {
      const connection = bctx.get?.("connection") ?? bctx.connection;
      if (!connection?.fetch?.register) return;
      const dispose = connection.fetch.register({
        path: "/api/dsh-shifan-sync/bridge",
        methods: ["POST"],
        requestBody: "streaming",
        fetch: async (request) => {
          let body = {};
          try {
            body = JSON.parse(await request.text());
          } catch {}
          const action = String(body.action ?? "");
          try {
            switch (action) {
              case "status":
                return json(await opStatus(ctx));
              case "push":
                return json(await opPush(ctx, { commitMessage: `UI push from ${deviceName()} at ${new Date().toISOString()}` }));
              case "pull":
                return json(await opPull(ctx));
              case "setup":
                return json(await opSetup(ctx, body));
              case "folderSetup":
                return json(await opFolderSetup(ctx, body));
              case "pickDirectory":
                return json(await opPickDirectory(ctx));
              case "settings":
                return json({ ok: true, settings: loadSettings() });
              case "usage":
                return json({ ok: true, ...(await computeUsage()) });
              case "cleanup":
                return json(await cleanup(body.target));
              default:
                return json({ ok: false, error: `unknown action "${action}"` }, 400);
            }
          } catch (error) {
            return json({ ok: false, error: error.message }, 200);
          }
        },
      });
      return () => dispose?.();
    });
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function dirSizeBytes(dir) {
  let total = 0;
  let count = 0;
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        try {
          total += (await fsp.stat(child)).size;
          count += 1;
        } catch {}
      }
    }
  }
  await walk(dir);
  return { bytes: total, files: count };
}

async function computeUsage() {
  const settings = loadSettings();
  const areas = [];
  for (const root of rootsOf(settings)) {
    const size = await dirSizeBytes(root.base);
    areas.push({ area: root.area, base: root.base, ...size });
  }
  const backup = await dirSizeBytes(BACKUP_ROOT());
  const mirror = await dirSizeBytes(REPO_DIR());
  return { areas, backup, mirror };
}

async function cleanup(target) {
  if (target === "backups") {
    await fsp.rm(BACKUP_ROOT(), { recursive: true, force: true });
    return { ok: true, cleared: "backups" };
  }
  if (target === "mirror") {
    await fsp.rm(REPO_DIR(), { recursive: true, force: true });
    const settings = loadSettings();
    if (String(settings.repoUrl ?? "").trim()) await ensureRepo(REPO_DIR(), settings.repoUrl, settings.branch || "main");
    return { ok: true, cleared: "mirror" };
  }
  if (target === "state") {
    await writeState({ lastPush: null, lastPull: null, lastError: null });
    return { ok: true, cleared: "state" };
  }
  throw new Error(`unknown cleanup target "${target}"`);
}

function registerTools(ctx) {
  ctx.inject(["tools"], (sctx) => {
    sctx.effect(() => {
      const renderJson = () => ({
        schema: { type: "object" },
        render(args, value) {
          return [{ type: "text", text: `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` }];
        },
      });
      const defs = [
        {
          name: "sync_setup",
          description: "Configure dsh-shifan-sync: set the private Git repository URL (and optionally store a PAT token / encryption passphrase in the credential center). Required once per machine before any sync.",
          parameters: {
            repoUrl: { type: "string", description: "Private Git repository URL, e.g. https://github.com/user/dsh-sync-state.git" },
            branch: { type: "string", description: "Branch name, default main" },
            token: { type: "string", description: "Optional Git access token (PAT) with repository read/write scope; stored as credential DSH_SHIFAN_SYNC_TOKEN" },
            passphrase: { type: "string", description: "Optional encryption passphrase for credentials.yaml; stored as credential DSH_SHIFAN_SYNC_PASSPHRASE" },
            autoPush: { type: "boolean", description: "Watch local changes and push automatically (default true)" },
            autoPullMinutes: { type: "number", description: "Silent periodic pull interval in minutes (default 10, 0 disables)" },
            encryptCredentials: { type: "boolean", description: "Encrypt credentials.yaml in the repository (default true)" },
          },
          async execute(args) {
            return opSetup(ctx, args);
          },
          output: renderJson(),
        },
        {
          name: "sync_push",
          description: "dsh-shifan-sync: snapshot profile config, installed plugins, skills, storages, and sessions from this machine into the private Git repository and push. Use after finishing meaningful local changes.",
          parameters: {},
          async execute() {
            return opPush(ctx);
          },
          output: renderJson(),
        },
        {
          name: "sync_pull",
          description: "dsh-shifan-sync: fetch the latest state from the private Git repository and apply it locally with last-writer-wins merge (newer files win; overwritten files are backed up locally). Profile/plugin changes need a DSH restart to take effect.",
          parameters: {},
          async execute() {
            return opPull(ctx);
          },
          output: renderJson(),
        },
        {
          name: "sync_status",
          description: "dsh-shifan-sync: report repository configuration, last push/pull times, and Git worktree state.",
          parameters: {},
          async execute() {
            return opStatus(ctx);
          },
          output: renderJson(),
        },
      ];
      const disposers = defs.map((def) => sctx.tools.register(def));
      return () => disposers.forEach((dispose) => dispose());
    });
  });
}

// ---- background automation ----
let watchTimer = null;
let pullTimer = null;
let pushQueued = false;
let syncing = false;
let automationCtx = null;
let automationLog = null;
const watchers = [];

function queueAutoPush() {
  if (pushQueued || syncing || !automationCtx) return;
  pushQueued = true;
  const settings = loadSettings();
  const delay = Math.max(5_000, Number(settings.autoPushDebounceMs) || 60_000);
  setTimeout(async () => {
    pushQueued = false;
    if (syncing) return;
    syncing = true;
    try {
      await opPush(automationCtx, { commitMessage: `auto-push from ${deviceName()} at ${new Date().toISOString()}` });
      log(automationLog, "info", "auto-push completed");
    } catch (error) {
      const state = readState();
      state.lastError = { at: new Date().toISOString(), op: "auto-push", message: error.message };
      await writeState(state).catch(() => {});
      log(automationLog, "warn", `auto-push failed: ${error.message}`);
    } finally {
      syncing = false;
    }
  }, delay).unref?.();
}

async function autoPullOnce() {
  if (syncing || !automationCtx) return;
  syncing = true;
  try {
    const result = await opPull(automationCtx);
    if (!result.upToDate) log(automationLog, "info", `auto-pull applied ${result.restored} file(s); restart DSH to load profile/plugin changes`);
  } catch (error) {
    const state = readState();
    state.lastError = { at: new Date().toISOString(), op: "auto-pull", message: error.message };
    await writeState(state).catch(() => {});
    log(automationLog, "warn", `auto-pull failed: ${error.message}`);
  } finally {
    syncing = false;
  }
}

function startAutomation(ctx) {
  stopAutomation();
  automationCtx = ctx;
  const settings = loadSettings();
  if (!String(settings.repoUrl ?? "").trim()) return;
  if (settings.autoPush !== false) {
    for (const root of rootsOf(settings)) {
      try {
        const watcher = fs.watch(root.base, { recursive: true }, () => queueAutoPush());
        watchers.push(watcher);
      } catch (error) {
        log(automationLog, "warn", `watch ${root.base} failed: ${error.message}`);
      }
    }
    // Safety net: directory watches can miss rename storms or permission hiccups.
    watchTimer = setInterval(queueAutoPush, 5 * 60_000);
    watchTimer.unref?.();
  }
  const pullMinutes = Number(settings.autoPullMinutes) || 0;
  if (pullMinutes > 0) {
    pullTimer = setInterval(autoPullOnce, pullMinutes * 60_000);
    pullTimer.unref?.();
  }
  log(automationLog, "info", `sync automation active for ${settings.repoUrl}`);
}

function stopAutomation() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  if (pullTimer) {
    clearInterval(pullTimer);
    pullTimer = null;
  }
  for (const handle of watchers.splice(0)) {
    try {
      handle.close();
    } catch {}
  }
  automationCtx = null;
}

export function apply(ctx, config) {
  automationLog = ctx.logger ?? ctx.log ?? console;
  registerTools(ctx);
  registerBridge(ctx);
  ctx.effect(() => {
    startAutomation(ctx);
    return () => stopAutomation();
  });
}

export default apply;

// dsh-shifan-sync core engine: snapshot, git transport, LWW merge, backup, encryption.
// Plain Node ESM, no third-party runtime dependencies.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

export const MANIFEST_NAME = "manifest.json";
const BACKUP_AREA = ".dsh-shifan-sync";

export function dshHomeDir() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
}

export function profileDir() {
  return process.env.DSH_PROFILE_DIR ?? path.join(dshHomeDir(), "profiles", process.env.DSH_PROFILE ?? "default");
}

export function deviceName() {
  return os.hostname();
}

/** Default sync roots: profile + DSH-home data areas. Each root has an area prefix in the repo. */
export function defaultRoots(home = dshHomeDir(), profile = profileDir()) {
  return [
    { area: "profile", base: profile },
    { area: "skills", base: path.join(home, "skills") },
    { area: "skills-manager", base: path.join(home, "skills-manager") },
    { area: "storages", base: path.join(home, "storages") },
    { area: "data", base: path.join(home, "data") },
    { area: "sessions", base: path.join(home, "sessions") },
  ];
}

const GLOBAL_EXCLUDES = [
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])cache([/\\]|$)/,
  /(^|[/\\])logs([/\\]|$)/,
  /(^|[/\\])\.dsh-shifan-sync([/\\]|$)/,
  /(^|[/\\])\.plugin-manager([/\\])tmp([/\\]|$)/,
  /(^|[/\\])repository-cache([/\\]|$)/,
  /\.tmp$/,
  /\.lock$/,
];

/** Never leave the repo; never upload plaintext credentials. */
const SECRET_FILES = [/^profile[/\\]credentials\.yaml$/];
const SECRET_PLAIN_BASENAMES = new Set(["credentials.yaml"]);

export function isExcluded(rel) {
  const norm = rel.replaceAll("\\", "/");
  if (SECRET_FILES.some((re) => re.test(norm))) return true;
  return GLOBAL_EXCLUDES.some((re) => re.test(norm));
}

export function isSecretBaseName(name) {
  return SECRET_PLAIN_BASENAMES.has(name.toLowerCase());
}

async function walk(base, prefix, out, limits) {
  let entries;
  try {
    entries = await fsp.readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limits.maxFiles) return;
    const abs = path.join(base, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "cache" || entry.name === "logs") continue;
      await walk(abs, rel, out, limits);
    } else if (entry.isFile()) {
      let stat;
      try {
        stat = await fsp.stat(abs);
      } catch {
        continue;
      }
      if (stat.size > limits.maxFileBytes) continue;
      out.push({ abs, rel, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
}

export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---- AES-256-GCM envelope for secret files ----
export function encryptText(passphrase, text) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm-scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}

export function decryptText(passphrase, blob) {
  const env = JSON.parse(blob);
  if (env.alg !== "aes-256-gcm-scrypt") throw new Error(`unsupported encryption ${env.alg}`);
  const key = crypto.scryptSync(passphrase, Buffer.from(env.salt, "base64"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]).toString("utf8");
}

// ---- git plumbing ----
function gitAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: opts.cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...opts.env } },
      (error, stdout, stderr) => {
        const out = opts.binary ? stdout : String(stdout);
        if (error) {
          const err = new Error(`git ${args[0]} failed: ${(stderr || out || error.message).toString().trim()}`);
          err.code = error.code;
          reject(err);
        } else {
          resolve(opts.binary ? out : String(out).trim());
        }
      },
    );
  });
}

/** Build an authenticated URL without persisting the token anywhere on disk. */
export function authenticatedUrl(repoUrl, token) {
  if (!token) return repoUrl;
  const match = /^(https?:\/\/)(.+)$/i.exec(repoUrl);
  if (!match) return repoUrl; // ssh or local path: assume the user's own credentials work
  return `${match[1]}x-shifan-token:${encodeURIComponent(token)}@${match[2]}`;
}

export async function ensureRepo(repoDir, repoUrl, branch) {
  await fsp.mkdir(repoDir, { recursive: true });
  const gitDir = path.join(repoDir, ".git");
  if (!fs.existsSync(gitDir)) {
    await gitAsync(["init", "-b", branch], { cwd: repoDir });
    await gitAsync(["remote", "add", "origin", repoUrl], { cwd: repoDir });
    await gitAsync(["config", "user.name", "dsh-shifan-sync"], { cwd: repoDir });
    await gitAsync(["config", "user.email", "shifan-sync@local"], { cwd: repoDir });
    await gitAsync(["config", "core.autocrlf", "false"], { cwd: repoDir });
  }
}

export async function repoState(repoDir) {
  const state = { branch: null, head: null, dirty: false };
  try {
    state.branch = (await gitAsync(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir })) || null;
  } catch {}
  try {
    state.head = (await gitAsync(["rev-parse", "HEAD"], { cwd: repoDir })) || null;
  } catch {}
  try {
    const out = await gitAsync(["status", "--porcelain"], { cwd: repoDir });
    state.dirty = out.length > 0;
  } catch {}
  return state;
}

/** Snapshot live files into the repo worktree. Returns { added, updated, removed, encrypted } counts. */
export async function mirrorToRepo({ repoDir, roots, manifest, passphrase, limits }) {
  const files = [];
  for (const root of roots) {
    const list = [];
    await walk(root.base, "", list, limits);
    for (const item of list) files.push({ ...item, area: root.area });
  }
  const counts = { scanned: files.length, added: 0, updated: 0, removed: 0, encrypted: 0, skippedLarge: limits.truncated };
  const seen = new Set();
  for (const file of files) {
    const rel = `${file.area}/${file.rel}`;
    seen.add(rel);
    const target = path.join(repoDir, ...rel.split("/"));
    let buf;
    try {
      buf = await fsp.readFile(file.abs);
    } catch {
      continue;
    }
    let content = buf;
    let encrypted = false;
    if (passphrase && isSecretBaseName(path.basename(file.abs))) {
      content = Buffer.from(encryptText(passphrase, buf.toString("utf8")), "utf8");
      encrypted = true;
    }
    const hash = sha256(content);
    const prev = manifest.files?.[rel];
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let write = true;
    if (fs.existsSync(target)) {
      const existing = await fsp.readFile(target);
      write = sha256(existing) !== hash;
    }
    if (write) {
      await fsp.writeFile(target, content);
      if (prev) counts.updated += 1;
      else counts.added += 1;
    }
    if (encrypted) counts.encrypted += 1;
    manifest.files[rel] = { sha256: hash, mtime: file.mtimeMs, size: content.length };
  }
  // Prune files deleted on this device.
  for (const rel of Object.keys(manifest.files)) {
    if (seen.has(rel)) continue;
    const target = path.join(repoDir, ...rel.split("/"));
    const prev = manifest.files[rel];
    if (prev?.sha256) {
      // Only prune when the worktree copy still matches the manifest (otherwise we
      // would delete an un-pushed local edit from the mirror).
      try {
        const existing = await fsp.readFile(target);
        if (sha256(existing) === prev.sha256) {
          await fsp.rm(target, { force: true });
          counts.removed += 1;
        }
      } catch {}
    }
    delete manifest.files[rel];
  }
  manifest.device = deviceName();
  manifest.updatedAt = new Date().toISOString();
  manifest.version = 1;
  await fsp.writeFile(path.join(repoDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
  return counts;
}

async function backupFile(backupDir, liveAbs, rel) {
  const target = path.join(backupDir, ...rel.split("/"));
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(liveAbs, target).catch(() => {});
}

function livePathFor(rel, rootsByArea) {
  const slash = rel.indexOf("/");
  if (slash <= 0) return null;
  const area = rel.slice(0, slash);
  const rest = rel.slice(slash + 1);
  const root = rootsByArea.get(area);
  if (!root) return null;
  return { abs: path.join(root.base, ...rest.split("/")), rest, area };
}

/**
 * Apply remote state to live files with last-writer-wins semantics.
 * Returns a report of restored / kept-local / deleted files plus whether a restart is advisable.
 */
export async function applyFromRepo({ repoDir, roots, remoteManifest, localManifest, passphrase, backupDir }) {
  const rootsByArea = new Map(roots.map((root) => [root.area, root]));
  const report = { restored: 0, keptLocal: 0, deleted: 0, conflictsLww: 0, decrypted: 0, missingPassphrase: 0, errors: [] };
  for (const [rel, remote] of Object.entries(remoteManifest.files ?? {})) {
    const live = livePathFor(rel, rootsByArea);
    if (!live) continue;
    const local = localManifest.files?.[rel];
    let liveMtime = null;
    try {
      liveMtime = (await fsp.stat(live.abs)).mtimeMs;
    } catch {}
    if (liveMtime !== null && local && liveMtime > local.mtime + 1) {
      // Local file is newer than what this device last synced: last writer wins locally.
      report.keptLocal += 1;
      report.conflictsLww += 1;
      continue;
    }
    let buf = await gitAsync(["show", `FETCH_HEAD:${rel.replaceAll("\\", "/")}`], { cwd: repoDir, timeoutMs: 60_000, binary: true }).catch((error) => {
      report.errors.push(`${rel}: ${error.message}`);
      return null;
    });
    if (buf === null) continue;
    const secret = isSecretBaseName(path.basename(live.abs));
    if (secret) {
      if (!passphrase) {
        report.missingPassphrase += 1;
        continue;
      }
      try {
        buf = Buffer.from(decryptText(passphrase, buf.toString("utf8")), "utf8");
        report.decrypted += 1;
      } catch (error) {
        report.errors.push(`${rel}: decrypt failed (${error.message})`);
        continue;
      }
    }
    if (liveMtime !== null) await backupFile(backupDir, live.abs, rel);
    await fsp.mkdir(path.dirname(live.abs), { recursive: true });
    await fsp.writeFile(live.abs, buf);
    report.restored += 1;
  }
  // Remote deletions: file existed locally per old manifest but is absent remotely.
  for (const rel of Object.keys(localManifest.files ?? {})) {
    if (remoteManifest.files?.[rel]) continue;
    const live = livePathFor(rel, rootsByArea);
    if (!live) continue;
    try {
      const local = localManifest.files[rel];
      const liveMtime = (await fsp.stat(live.abs)).mtimeMs;
      if (local && liveMtime > local.mtime + 1) {
        report.keptLocal += 1; // local newer edit: keep, it will be pushed later
        continue;
      }
      await backupFile(backupDir, live.abs, rel);
      await fsp.rm(live.abs, { force: true });
      report.deleted += 1;
    } catch {}
  }
  return report;
}

export async function readManifestFromRepo(repoDir, ref = "HEAD") {
  const text = await gitAsync(["show", `${ref}:${MANIFEST_NAME}`], { cwd: repoDir });
  return JSON.parse(text);
}

export async function readLocalManifest(repoDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(repoDir, MANIFEST_NAME), "utf8"));
  } catch {
    return { version: 1, device: deviceName(), files: {} };
  }
}

/**
 * Folder-backend variant of applyFromRepo: remote content lives in a plain
 * directory (e.g. inside a cloud-drive sync folder) instead of a git repo.
 */
export async function applyFromFolder({ folderDir, roots, remoteManifest, localManifest, passphrase, backupDir }) {
  const rootsByArea = new Map(roots.map((root) => [root.area, root]));
  const report = { restored: 0, keptLocal: 0, deleted: 0, conflictsLww: 0, decrypted: 0, missingPassphrase: 0, errors: [] };
  for (const [rel, remote] of Object.entries(remoteManifest.files ?? {})) {
    const live = livePathFor(rel, rootsByArea);
    if (!live) continue;
    const local = localManifest.files?.[rel];
    let liveMtime = null;
    try {
      liveMtime = (await fsp.stat(live.abs)).mtimeMs;
    } catch {}
    if (liveMtime !== null && local && liveMtime > local.mtime + 1) {
      report.keptLocal += 1;
      report.conflictsLww += 1;
      continue;
    }
    let buf;
    try {
      buf = await fsp.readFile(path.join(folderDir, ...rel.split("/")));
    } catch (error) {
      report.errors.push(`${rel}: ${error.message}`);
      continue;
    }
    const secret = isSecretBaseName(path.basename(live.abs));
    if (secret) {
      if (!passphrase) {
        report.missingPassphrase += 1;
        continue;
      }
      try {
        buf = Buffer.from(decryptText(passphrase, buf.toString("utf8")), "utf8");
        report.decrypted += 1;
      } catch (error) {
        report.errors.push(`${rel}: decrypt failed (${error.message})`);
        continue;
      }
    }
    if (liveMtime !== null) await backupFile(backupDir, live.abs, rel);
    await fsp.mkdir(path.dirname(live.abs), { recursive: true });
    await fsp.writeFile(live.abs, buf);
    report.restored += 1;
  }
  for (const rel of Object.keys(localManifest.files ?? {})) {
    if (remoteManifest.files?.[rel]) continue;
    const live = livePathFor(rel, rootsByArea);
    if (!live) continue;
    try {
      const local = localManifest.files[rel];
      const liveMtime = (await fsp.stat(live.abs)).mtimeMs;
      if (local && liveMtime > local.mtime + 1) {
        report.keptLocal += 1;
        continue;
      }
      await backupFile(backupDir, live.abs, rel);
      await fsp.rm(live.abs, { force: true });
      report.deleted += 1;
    } catch {}
  }
  return report;
}

export async function readManifestFromFolder(folderDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(folderDir, MANIFEST_NAME), "utf8"));
  } catch {
    return { version: 1, device: deviceName(), files: {} };
  }
}

export { gitAsync };

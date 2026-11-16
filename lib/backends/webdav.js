// Minimal WebDAV client (坚果云 / Nextcloud / NAS) for the folder-over-WebDAV backend.
// Only the five verbs the sync engine needs: MKCOL (recursive), PUT, GET, DELETE, GET of manifest.
import path from "node:path";

function joinUrl(base, rel) {
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  return cleanBase + rel.split("/").map(encodeURIComponent).join("/");
}

export function createWebdavClient({ url, username, password }) {
  if (!url) throw new Error("WebDAV 地址未配置");
  const auth = username ? `Basic ${Buffer.from(`${username}:${password ?? ""}`).toString("base64")}` : undefined;
  const headers = auth ? { authorization: auth } : {};

  async function request(method, path, body) {
    const response = await fetch(joinUrl(url, path), {
      method,
      headers: { ...headers, ...(body ? { "content-type": "application/octet-stream" } : {}) },
      body: body ?? undefined,
    });
    return response;
  }

  async function mkcolDeep(relDir) {
    const parts = relDir.split("/").filter(Boolean);
    let made = "";
    for (const part of parts) {
      made = made ? `${made}/${part}` : part;
      const response = await request("MKCOL", `${made}/`);
      // 405 = already exists; other failures propagate.
      if (!response.ok && response.status !== 405) {
        // Some servers answer 409 when parents were just created in the same loop; retry once.
        const retry = await request("MKCOL", `${made}/`);
        if (!retry.ok && retry.status !== 405) throw new Error(`WebDAV MKCOL ${made} → HTTP ${response.status}`);
      }
    }
  }

  return {
    async put(relPath, data) {
      const dir = path.dirname(relPath);
      if (dir && dir !== "." && dir !== "/") await mkcolDeep(dir.replaceAll("\\", "/"));
      const response = await request("PUT", relPath.replaceAll("\\", "/"), data);
      if (!response.ok) throw new Error(`WebDAV PUT ${relPath} → HTTP ${response.status}`);
    },
    async get(relPath) {
      const response = await request("GET", relPath.replaceAll("\\", "/"));
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    },
    async remove(relPath) {
      const response = await request("DELETE", relPath.replaceAll("\\", "/"));
      return response.ok || response.status === 404;
    },
    async test() {
      const response = await request("PROPFIND", "", '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
      if (response.status === 401) throw new Error("WebDAV 认证失败(401):检查账号与密码/应用密码");
      if (response.status === 404) {
        await mkcolDeep("dsh-shifan-sync");
        return { ok: true, created: true };
      }
      if (!response.ok && response.status !== 207) throw new Error(`WebDAV 连接失败: HTTP ${response.status}`);
      return { ok: true };
    },
  };
}

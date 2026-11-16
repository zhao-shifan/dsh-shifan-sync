// GitHub device-flow authorization + private repository bootstrap.
// The user only clicks "Authorize" on github.com/login/device; we handle the rest.
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`GitHub ${url} → HTTP ${response.status}`);
  return response.json();
}

/** Step 1: ask GitHub for a device + user code. */
export async function startDeviceFlow(clientId, scope = "repo") {
  const data = await postJson(DEVICE_CODE_URL, { client_id: clientId, scope });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? "https://github.com/login/device",
    expiresIn: data.expires_in ?? 900,
    interval: Math.max(5, data.interval ?? 5),
  };
}

/** Step 2: poll for the token. Returns { status: 'pending' } | { status: 'done', token }. */
export async function pollDeviceFlow(clientId, deviceCode) {
  const data = await postJson(TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (data.access_token) return { status: "done", token: data.access_token };
  const error = data.error ?? "unknown";
  if (error === "authorization_pending" || error === "slow_down") return { status: "pending", retryAfter: error === "slow_down" ? 10 : 5 };
  throw new Error(error === "expired_token" ? "授权已过期,请重新开始" : `GitHub 授权失败: ${error}`);
}

async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "dsh-shifan-sync",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

/** Current login name, used to build the repository URL. */
export async function getLogin(token) {
  const result = await api(token, "GET", "/user");
  if (!result.ok) throw new Error(`读取 GitHub 账号失败: HTTP ${result.status}`);
  return result.data.login;
}

/** Create a private sync repository; if the name exists, try numbered variants. */
export async function ensurePrivateRepo(token, preferredName = "dsh-sync-state") {
  const login = await getLogin(token);
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = attempt === 0 ? preferredName : `${preferredName}-${attempt + 1}`;
    const result = await api(token, "POST", "/user/repos", {
      name,
      private: true,
      description: "dsh-shifan-sync state (auto-created)",
      has_issues: false,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    });
    if (result.ok) return { login, name, url: `https://github.com/${login}/${name}.git`, created: true };
    if (result.status !== 422) throw new Error(`创建仓库失败: HTTP ${result.status} ${JSON.stringify(result.data) ?? ""}`);
    // 422: name already exists on this account — verify it is ours and reuse it.
    const existing = await api(token, "GET", `/repos/${login}/${name}`);
    if (existing.ok && existing.data.private === true && existing.data.owner?.login === login) {
      return { login, name, url: `https://github.com/${login}/${name}.git`, created: false };
    }
  }
  throw new Error("无法创建或找到可用的私有仓库名");
}

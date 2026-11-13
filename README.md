# dsh-shifan-sync

**DeepSeek Harness 账号级状态同步插件:配置、插件、技能、记忆、会话,多台电脑一键同步。**

[中文](#中文) · [English](#english)

---

## 中文

### 这是什么

`dsh-shifan-sync` 把本机 DeepSeek Harness (DSH) 的账号状态——profile 配置、已安装插件、技能、存储数据、**全部会话记录**——同步到 **你自己的私有 Git 仓库**。换电脑、重装系统、多机办公时,新机器上装好本插件、配置一次仓库,拉取后即恢复到最新状态。

### 谁需要它

如果你:

- 在 **两台及以上电脑** 使用 DSH,希望插件/技能/配置/记忆完全一致
- 准备 **换电脑或重装系统**,不想丢失所有会话记录和个性化配置
- 希望工作区里的"记忆"、定时任务、技能仓库跟着账号走

这个插件就是来解决这些问题的:一次配置,所有设备自动保持同步。

### 特性

- **全量同步** —— profile(`cordis.yml` / `cordis.patch.yml` / 已装 bundle)、`skills`、`skills-manager`、`storages`、`data`、`sessions` 全部纳入;自动排除 `node_modules`、`cache`、`logs`、`.git`、临时文件等可重建内容
- **自动化** —— 文件监听 + 防抖(默认 60 秒)自动推送;定时静默拉取(默认 10 分钟);也可以手动触发
- **凭据保护** —— `credentials.yaml`(API key 等)默认用你设置的口令做 **AES-256-GCM 加密** 后才入库,明文永不离开本机;口令存 DSH 凭据中心,不进仓库、不进配置文件
- **多设备冲突处理** —— 最后写入优先(LWW):同一文件以修改时间较新的一端为准;被覆盖的版本自动备份到本地 `~/.dsh/.dsh-shifan-sync/backup/`,不会静默丢失
- **零依赖** —— 纯 Node 标准库实现,只需本机装有 `git`

### 安装(三种方式任选)

> 前置:已安装 DeepSeek Harness;本机装有 git 并在 PATH 中。

**方式 1:下载 ZIP(最简单)**

1. 打开本仓库页面 → 绿色 `Code` 按钮 → `Download ZIP`
2. 解压到任意目录(如 `D:\tools\dsh-shifan-sync`)
3. DSH 网页 → 左侧「插件」页 → 安装插件 → 选择该目录

**方式 2:git clone**

```bash
git clone https://github.com/<你的用户名>/dsh-shifan-sync.git
```

然后同样在「插件」页选择 clone 出来的目录安装。

**方式 3:Release 附件**

打开本仓库 `Releases` 页面,下载最新版本的附件 ZIP,解压后按方式 1 第 3 步安装。

安装后插件行显示「时帆同步 / Shifan sync」即成功。

### 快速开始

1. 在 GitHub/Gitee 建一个 **私有(Private)** 空仓库,并生成一个只授权该仓库 Contents 读写的访问令牌(PAT)
2. 在 DSH 里让 AI 执行 `sync_setup`(填仓库地址 + 令牌;想把 API key 等凭据一并同步,再设一个加密口令),然后 `sync_push` 完成首次推送
3. 新电脑:安装本插件 → 同样 `sync_setup` → `sync_pull` → 重启 DSH,即恢复到最新状态;之后改动自动推送、定期自动拉取

### 工具

| 工具 | 作用 |
|---|---|
| `sync_setup` | 配置仓库/令牌/口令 |
| `sync_push` | 推送本机状态到云端 |
| `sync_pull` | 拉取云端最新状态(LWW 合并,需重启 DSH 生效) |
| `sync_status` | 查看配置与上次推/拉时间 |

### 配置说明

设置保存在 `~/.dsh/.dsh-shifan-sync/settings.json`,可手动编辑:

| 字段 | 默认 | 说明 |
|---|---|---|
| `repoUrl` | `""` | 私有 Git 仓库地址,空 = 同步关闭 |
| `branch` | `"main"` | 分支名 |
| `autoPush` | `true` | 文件变更自动推送 |
| `autoPushDebounceMs` | `60000` | 推送防抖毫秒数 |
| `autoPullMinutes` | `10` | 定时拉取间隔(分钟),`0` 关闭 |
| `encryptCredentials` | `true` | `credentials.yaml` 加密入库 |
| `maxFileBytes` | `20971520` | 单文件同步上限(20MB) |
| `maxFiles` | `200000` | 文件总数上限 |
| `rootsOverride` | `[]` | 自定义同步清单,如 `[{"area":"profile","base":"C:/path"}]` |

凭据存放在 DSH 凭据中心(`~/.dsh/.credentials.yaml`):

- `DSH_SHIFAN_SYNC_TOKEN` —— Git 访问令牌(PAT)
- `DSH_SHIFAN_SYNC_PASSPHRASE` —— 凭据加密口令

### 常见问题

**Q: 拉取后为什么有些改动没生效?**
配置文件和插件需要重启 DSH 才加载。工具结果里 `restartRecommended: true` 时重启即可。

**Q: 两台电脑同时改了同一个文件会怎样?**
以修改时间较新的一端为准(LWW);被覆盖的一端会先把旧版本备份到 `~/.dsh/.dsh-shifan-sync/backup/<时间戳>/`。

**Q: 首次推送到空仓库报错?**
插件会自动重试普通的首次推送;若仓库已有历史且提示 non-fast-forward,先 `sync_pull` 合并再推。

**Q: 会话记录太大,仓库塞不下?**
在 `settings.json` 调小 `maxFileBytes`,或用 `rootsOverride` 把 `sessions` 移出同步清单。

**Q: 忘记加密口令了?**
新电脑将无法解密 `credentials.yaml`(其他文件不受影响)。凭据需要在新电脑重新填写。

**Q: 推送时提示鉴权失败?**
检查 PAT 是否过期、是否只授权了正确的仓库与 Contents 读写权限;重新 `sync_setup` 换新令牌即可。

### 隐私与安全

- 同步数据只存在于 **你自己的仓库**,插件不含任何第三方服务
- 建议仓库设为 Private、令牌设置过期时间并最小授权
- 插件读取凭据中心令牌时不会把它写入任何仓库或配置文件

### 许可

MIT

---

## English

### What is this

`dsh-shifan-sync` mirrors your DeepSeek Harness (DSH) account state — profile config, installed plugins, skills, storages, and **all session records** — to **your own private Git repository**. On a new computer, install the plugin, configure the repository once, pull, and everything is back to the latest state.

### Features

- **Full sync** — profile (`cordis.yml` / `cordis.patch.yml` / installed bundles), `skills`, `skills-manager`, `storages`, `data`, `sessions`; automatically excludes `node_modules`, `cache`, `logs`, `.git`, and temp files
- **Automatic** — debounced auto-push on file changes (default 60s) plus periodic silent pulls (default 10 minutes); manual tools included
- **Credential protection** — `credentials.yaml` is encrypted with AES-256-GCM using your passphrase before it ever leaves the machine; the passphrase lives in the DSH credential center, never in the repository
- **Last-writer-wins merge** — the newer mtime wins on conflicts; overwritten files are backed up locally under `~/.dsh/.dsh-shifan-sync/backup/`
- **Zero dependencies** — plain Node standard library; only requires `git` on PATH

### Install (pick one)

1. **Download ZIP** — `Code → Download ZIP`, unzip, then in the DSH web UI open Plugins → install → select the folder.
2. **git clone** — `git clone https://github.com/<you>/dsh-shifan-sync.git`, install the cloned folder the same way.
3. **Release asset** — download the ZIP from the Releases page, unzip, install the folder.

Prerequisite: git installed and on PATH.

### Quick start

1. Create a **private** empty repository and a fine-grained PAT with Contents read/write on that repository only.
2. In DSH, ask the AI to run `sync_setup` (repository URL + token; optionally an encryption passphrase to also sync `credentials.yaml`), then `sync_push`.
3. New machine: install the plugin → `sync_setup` → `sync_pull` → restart DSH. Changes auto-push and pull periodically afterwards.

### Tools

| Tool | Purpose |
|---|---|
| `sync_setup` | Configure repository, token, passphrase, options |
| `sync_push` | Snapshot this machine's state into the repository and push |
| `sync_pull` | Fetch the latest state and apply it locally (LWW merge) |
| `sync_status` | Show configuration, last push/pull times, Git worktree state |

### Configuration

Settings file: `~/.dsh/.dsh-shifan-sync/settings.json`. See the Chinese section above for the full field table. Credentials live in the DSH credential center: `DSH_SHIFAN_SYNC_TOKEN`, `DSH_SHIFAN_SYNC_PASSPHRASE`.

### Notes

- Profile/plugin changes need a DSH restart after a pull.
- Session records are large; tune `maxFileBytes` / `rootsOverride` if repository limits are a concern.
- Use a **private** repository: the sync payload contains all your conversations.

### License

MIT

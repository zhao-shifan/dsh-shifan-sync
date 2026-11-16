// dsh-shifan-sync client half: sidebar panel icon + native-feeling sync page.
window.__ModuleLoader__.load({
  id: 'dsh-shifan-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const ROUTE = 'api/dsh-shifan-sync/bridge';
    const PAGE_KEY = 'shifan-sync';

    const STRINGS = {
      zh: {
        title: '时帆同步', subtitle: '把本机 DSH 的配置、插件、技能与全部会话同步起来,换电脑一键恢复。推荐用同步文件夹模式,不需要 GitHub 账号。',
        modeFolder: '同步文件夹(推荐)', modeFolderDesc: '选一个文件夹存放同步数据。把它放在 OneDrive / 百度网盘 / 坚果云等网盘的同步目录里,就能跨电脑自动同步;不放网盘也可以当本机备份。不需要任何账号。',
        modeGit: 'Git 私有仓库(高级)', modeGitDesc: '数据存到你自己的 GitHub/Gitee 私有仓库。需要仓库地址和访问令牌(PAT)。',
        pickFolder: '选择文件夹', chosenFolder: '已选文件夹', passphrase: '凭据加密口令(可选,牢记)',
        encryptCredentials: '加密同步 credentials.yaml(API key 等敏感文件)',
        autoPush: '改动后自动推送', autoPullMinutes: '自动拉取间隔(分钟,0 关闭)',
        save: '保存并启用', saving: '保存中…', push: '立即推送', pull: '从云端恢复', refresh: '刷新',
        pushing: '推送中…', pulling: '恢复中…', configTitle: '同步配置', autoPushLabel: '自动推送',
        storage: '存储占用', cleanupBackups: '清理同步备份', cleanupMirror: '重建本地镜像', cleanupState: '清除同步状态记录',
        lastPush: '上次推送', lastPull: '上次恢复', device: '本机设备', never: '从未', upToDate: '已是最新',
        restored: '个文件已恢复', restartHint: '已恢复本机文件;若涉及配置/插件,请重启 DSH 生效。被覆盖的旧文件在 ~/.dsh/.dsh-shifan-sync/backup/ 有备份。',
        error: '出错', confirmCleanup: '确认清理?', setupHelpFolder: '提示:路径结尾不要指向 DSH 自己的 ~/.dsh 目录。跨电脑同步 = 把文件夹放进网盘的同步目录。',
        setupHelp: '仓库需为私有;令牌只需该仓库的 Contents 读写权限。忘记口令将无法在新电脑解密凭据。',
        repoUrl: '私有仓库地址(HTTPS)', token: 'Git 访问令牌(PAT,Contents 读写)', branch: '分支',
        storage: '存储占用', usageTotal: '同步范围合计', usageBackup: '同步备份', usageMirror: '本地镜像',
        enabled: '同步已启用', disabled: '同步未启用', modeLabel: '同步方式', modeNameFolder: '同步文件夹', modeNameGit: 'Git 私有仓库',
      },
      en: {
        title: 'Shifan sync', subtitle: 'Mirror this machine\'s DSH config, plugins, skills, and all sessions. The sync-folder mode needs no GitHub account at all.',
        modeFolder: 'Sync folder (recommended)', modeFolderDesc: 'Pick a folder to store the synced data. Put it inside a cloud-drive sync directory (OneDrive / Baidu Net Disk / Nutstore) for automatic cross-machine sync; or use it as a plain local backup. No account needed.',
        modeGit: 'Git private repository (advanced)', modeGitDesc: 'Store the data in your own GitHub/Gitee private repository. Requires a repository URL and an access token (PAT).',
        pickFolder: 'Choose folder', chosenFolder: 'Chosen folder', passphrase: 'Credential encryption passphrase (optional, remember it)',
        encryptCredentials: 'Encrypt credentials.yaml in the synced data (API keys and other secrets)',
        autoPush: 'Auto-push on changes', autoPullMinutes: 'Auto-pull interval (minutes, 0 disables)',
        save: 'Save and enable', saving: 'Saving…', push: 'Push now', pull: 'Restore from cloud', refresh: 'Refresh',
        pushing: 'Pushing…', pulling: 'Restoring…', configTitle: 'Sync settings', autoPushLabel: 'Auto-push',
        storage: 'Storage usage', cleanupBackups: 'Clear sync backups', cleanupMirror: 'Rebuild local mirror', cleanupState: 'Clear sync history',
        lastPush: 'Last push', lastPull: 'Last restore', device: 'This device', never: 'never', upToDate: 'Up to date',
        restored: 'file(s) restored', restartHint: 'Local files restored; restart DSH if profile/plugin changes should take effect. Overwritten files are backed up under ~/.dsh/.dsh-shifan-sync/backup/.',
        error: 'Error', confirmCleanup: 'Confirm cleanup?', setupHelpFolder: 'Tip: do not point the folder at DSH\'s own ~/.dsh directory. Cross-machine sync = put the folder inside a cloud-drive sync directory.',
        setupHelp: 'Use a private repository; the token only needs Contents read/write on it. A forgotten passphrase cannot decrypt credentials on a new machine.',
        repoUrl: 'Private repository URL (HTTPS)', token: 'Git access token (PAT, Contents read/write)', branch: 'Branch',
        storage: 'Storage usage', usageTotal: 'Sync scope total', usageBackup: 'Sync backups', usageMirror: 'Local mirror',
        enabled: 'Sync enabled', disabled: 'Sync disabled', modeLabel: 'Backend', modeNameFolder: 'Sync folder', modeNameGit: 'Git private repository',
      },
    };

    async function callBridge(body) {
      const response = await fetch(new URL(ROUTE, document.baseURI), {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return response.json();
    }

    function fmtBytes(n) {
      if (!Number.isFinite(n) || n <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = n, unit = 0;
      while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
      return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
    }
    function fmtTime(iso) {
      if (!iso) return null;
      try { return new Date(iso).toLocaleString(); } catch { return iso; }
    }

    const styles = `
.sfs{--sfs-bg:var(--dsw-alias-bg-layer-1,#fff);--sfs-soft:var(--dsw-alias-bg-layer-2,#f6f7f9);--sfs-text:var(--dsw-alias-label-primary,#1a2233);--sfs-muted:var(--dsw-alias-label-secondary,#68738a);--sfs-border:var(--dsw-alias-border-l3,#e6e8ef);--sfs-accent:var(--dsw-alias-accent-primary,#3a6ff2);--sfs-ok:var(--dsw-alias-state-success-primary,#24794a);--sfs-warn:var(--dsw-alias-state-warning-primary,#8a5a00);--sfs-err:var(--dsw-alias-state-error-primary,#b43c3c);color:var(--sfs-text);font:14px/1.65 var(--dsh-font-family-content,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif);height:100%;display:flex;flex-direction:column;min-width:0;background:var(--sfs-bg)}
.sfs *,.sfs *:before,.sfs *:after{box-sizing:border-box}
.sfs-scroll{overflow:auto;padding:calc(24px + var(--dsh-frame-top-clearance,0px)) 28px 32px max(28px,var(--dsh-frame-leading-clearance,0px));flex:1;min-height:0}
.sfs h1{margin:0;font-size:26px;line-height:1.25;font-weight:650}
.sfs h2{margin:0;font-size:18px;font-weight:600}
.sfs h3{margin:0 0 10px;font-size:14px;font-weight:600}
.sfs .sfs-sub{margin:8px 0 0;color:var(--sfs-muted);font-size:13px;max-width:640px}
.sfs .sfs-card{border:1px solid var(--sfs-border);border-radius:12px;background:var(--sfs-bg);padding:18px 20px;margin-top:16px;max-width:760px}
.sfs .sfs-grid{display:flex;gap:12px;flex-wrap:wrap}
.sfs .sfs-stat{flex:1;min-width:150px;border:1px solid var(--sfs-border);border-radius:10px;padding:12px 14px;background:var(--sfs-soft)}
.sfs .sfs-stat-label{color:var(--sfs-muted);font-size:12px}
.sfs .sfs-stat-value{margin-top:4px;font-size:14px;font-weight:550;overflow-wrap:anywhere}
.sfs .sfs-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.sfs button{font:inherit;color:inherit;cursor:pointer}
.sfs .sfs-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--sfs-border);border-radius:9px;background:var(--sfs-bg);padding:8px 16px;min-height:36px;font-weight:550}
.sfs .sfs-btn:hover:not(:disabled){background:var(--sfs-soft)}
.sfs .sfs-btn[disabled]{opacity:.55;cursor:not-allowed}
.sfs .sfs-primary{background:var(--sfs-accent);border-color:var(--sfs-accent);color:#fff}
.sfs .sfs-primary:hover:not(:disabled){opacity:.92;background:var(--sfs-accent)}
.sfs .sfs-danger{color:var(--sfs-err);border-color:var(--sfs-err);background:transparent}
.sfs .sfs-danger:hover:not(:disabled){background:color-mix(in srgb,var(--sfs-err) 8%,transparent)}
.sfs label.sfs-field{display:grid;gap:6px;margin-top:14px;font-size:13px;color:var(--sfs-muted)}
.sfs input{font:inherit;color:var(--sfs-text);background:var(--sfs-bg);border:1px solid var(--sfs-border);border-radius:8px;padding:8px 11px;min-height:38px;width:100%}
.sfs input:focus-visible{outline:2px solid var(--sfs-accent);outline-offset:2px}
.sfs .sfs-check{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:13px;color:var(--sfs-text)}
.sfs input[type=checkbox]{width:16px;height:16px;flex-shrink:0;accent-color:var(--sfs-accent)}
.sfs .sfs-mode{border:1px solid var(--sfs-border);border-radius:10px;padding:14px 16px;margin-top:14px;cursor:pointer;max-width:640px}
.sfs .sfs-mode:hover{background:var(--sfs-soft);border-color:var(--sfs-accent)}
.sfs .sfs-mode:focus-visible{outline:2px solid var(--sfs-accent);outline-offset:2px}
.sfs .sfs-mode .sfs-sub{margin-top:6px}
.sfs .sfs-note{margin-top:12px;font-size:12px;color:var(--sfs-muted)}
.sfs .sfs-banner{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--sfs-border);border-radius:10px;background:var(--sfs-soft);padding:11px 14px;margin-top:14px;font-size:13px}
.sfs .sfs-banner[data-tone=ok]{color:var(--sfs-ok)}
.sfs .sfs-banner[data-tone=warn]{color:var(--sfs-warn)}
.sfs .sfs-banner[data-tone=err]{color:var(--sfs-err)}
.sfs .sfs-switch{position:relative;display:inline-flex;align-items:center;gap:9px;cursor:pointer;font-size:13px}
.sfs .sfs-switch input{position:absolute;opacity:0;width:0;height:0}
.sfs .sfs-track{width:36px;height:22px;border-radius:12px;background:var(--sfs-border);border:1px solid var(--sfs-border);position:relative;transition:background .15s;pointer-events:none;flex-shrink:0}
.sfs .sfs-track:before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:2px;left:2px;transition:transform .15s;box-shadow:0 1px 2px #0002}
.sfs .sfs-switch input:checked + .sfs-track{background:var(--sfs-accent);border-color:var(--sfs-accent)}
.sfs .sfs-switch input:checked + .sfs-track:before{transform:translateX(14px)}
.sfs .sfs-switch input:focus-visible + .sfs-track{outline:2px solid var(--sfs-accent);outline-offset:3px}
.sfs .sfs-spin{width:14px;height:14px;border:2px solid var(--sfs-border);border-top-color:var(--sfs-accent);border-radius:50%;animation:sfs-spin .8s linear infinite;flex-shrink:0}
@keyframes sfs-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.sfs .sfs-spin{animation:none}}
`;

    function IconSync({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M20 11a8 8 0 0 0-14.9-3' }),
        h('path', { d: 'M4 13a8 8 0 0 0 14.9 3' }),
        h('path', { d: 'M4 4v4h4' }), h('path', { d: 'M20 20v-4h-4' }));
    }

    function Banner({ tone = 'ok', children }) {
      return h('div', { className: 'sfs-banner', 'data-tone': tone, role: tone === 'err' ? 'alert' : 'status' }, children);
    }

    function SyncIcon({ size = 20 }) {
      return h('span', { style: { display: 'inline-flex' }, 'aria-hidden': true }, h(IconSync, { size }));
    }

    function App({ t }) {
      const [status, setStatus] = useState(null);
      const [usage, setUsage] = useState(null);
      const [busy, setBusy] = useState(null);
      const [notice, setNotice] = useState(null);
      const [wizardMode, setWizardMode] = useState(null); // null = pick-a-mode cards, 'folder', 'git'
      const [form, setForm] = useState({ repoUrl: '', branch: 'main', token: '', syncDir: '', passphrase: '', encryptCredentials: true, autoPullMinutes: 10 });

      const refresh = useCallback(async () => {
        const [s, u] = await Promise.all([callBridge({ action: 'status' }), callBridge({ action: 'usage' })]);
        setStatus(s);
        setUsage(u);
        if (s?.configured) setForm(prev => ({ ...prev, repoUrl: s.repoUrl || '', branch: s.branch || 'main', encryptCredentials: s.encryptCredentials !== false, autoPullMinutes: s.autoPullMinutes ?? 10 }));
      }, []);
      useEffect(() => { void refresh(); }, [refresh]);

      const run = useCallback(async (action, label, extra = {}) => {
        setBusy(action); setNotice(null);
        try {
          const result = await callBridge({ action, ...extra });
          if (result?.ok === false) setNotice({ tone: 'err', text: `${t('error')}: ${result.error ?? 'unknown'}` });
          else if (action === 'pull' && result?.restored > 0) setNotice({ tone: 'warn', text: `${result.restored} ${t('restored')} — ${t('restartHint')}` });
          else if (action === 'pull') setNotice({ tone: 'ok', text: t('upToDate') });
          else if (action === 'push') setNotice({ tone: 'ok', text: `${t('push')} ✓` });
          else if (action === 'setup') setNotice({ tone: 'ok', text: t('enabled') });
          else if (action === 'cleanup') setNotice({ tone: 'ok', text: `${t('confirmCleanup')} ✓` });
          await refresh();
        } catch (error) {
          setNotice({ tone: 'err', text: `${t('error')}: ${error.message}` });
        } finally {
          setBusy(null);
        }
      }, [refresh, t]);

      const saveSetup = useCallback(async (mode) => {
        setBusy('setup'); setNotice(null);
        try {
          const payload = mode === 'folder'
            ? { action: 'folderSetup', syncDir: form.syncDir, passphrase: form.passphrase, encryptCredentials: form.encryptCredentials, autoPullMinutes: form.autoPullMinutes }
            : { action: 'setup', ...form };
          const result = await callBridge(payload);
          if (result?.ok === false) setNotice({ tone: 'err', text: `${t('error')}: ${result.error}` });
          else setNotice({ tone: 'ok', text: t('enabled') });
          await refresh();
        } catch (error) {
          setNotice({ tone: 'err', text: `${t('error')}: ${error.message}` });
        } finally { setBusy(null); }
      }, [form, refresh, t]);

      const pickFolder = useCallback(async () => {
        setNotice(null);
        try {
          const result = await callBridge({ action: 'pickDirectory' });
          if (result?.ok === false) setNotice({ tone: 'err', text: `${t('error')}: ${result.error}` });
          else if (result?.path) setForm(prev => ({ ...prev, syncDir: result.path }));
        } catch (error) {
          setNotice({ tone: 'err', text: `${t('error')}: ${error.message}` });
        }
      }, [t]);

      const toggleAutoPush = useCallback(async (checked) => {
        const settings = status ?? {};
        await callBridge({ action: 'setup', repoUrl: settings.repoUrl, branch: settings.branch, autoPush: checked, autoPullMinutes: settings.autoPullMinutes, encryptCredentials: settings.encryptCredentials });
        await refresh();
      }, [status, refresh]);

      const configured = !!status?.configured;
      const state = readStateSafe(status);

      return h('div', { className: 'sfs' },
        h('style', null, styles),
        h('div', { className: 'sfs-scroll' },
          h('h1', null, t('title')),
          h('p', { className: 'sfs-sub' }, t('subtitle')),
          notice ? h(Banner, { tone: notice.tone }, notice.text) : null,
          !configured && status && wizardMode === null ? h('div', { className: 'sfs-card' },
            h('h2', null, t('modeLabel')),
            h('div', { className: 'sfs-mode', role: 'button', tabIndex: 0, onClick: () => setWizardMode('folder'), onKeyDown: e => { if (e.key === 'Enter') setWizardMode('folder'); } },
              h('h3', null, t('modeFolder')), h('div', { className: 'sfs-sub' }, t('modeFolderDesc'))),
            h('div', { className: 'sfs-mode', role: 'button', tabIndex: 0, onClick: () => setWizardMode('git'), onKeyDown: e => { if (e.key === 'Enter') setWizardMode('git'); } },
              h('h3', null, t('modeGit')), h('div', { className: 'sfs-sub' }, t('modeGitDesc')))) : null,
          !configured && status && wizardMode === 'folder' ? h('div', { className: 'sfs-card' },
            h('h2', null, t('modeFolder')),
            h('div', { className: 'sfs-actions' },
              h('button', { className: 'sfs-btn', onClick: pickFolder, disabled: busy !== null }, t('pickFolder')),
              h('span', { className: 'sfs-chosen', style: { alignSelf: 'center', fontSize: 13, color: 'var(--sfs-muted)', overflowWrap: 'anywhere' } }, form.syncDir ? `${t('chosenFolder')}: ${form.syncDir}` : '')),
            form.syncDir ? h(React.Fragment, null,
              h('label', { className: 'sfs-field' }, t('passphrase'), h('input', { type: 'password', value: form.passphrase, onChange: e => setForm({ ...form, passphrase: e.target.value }) })),
              h('label', { className: 'sfs-check' }, h('input', { type: 'checkbox', checked: form.encryptCredentials, onChange: e => setForm({ ...form, encryptCredentials: e.target.checked }) }), t('encryptCredentials')),
              h('label', { className: 'sfs-field' }, t('autoPullMinutes'), h('input', { type: 'number', min: 0, value: form.autoPullMinutes, onChange: e => setForm({ ...form, autoPullMinutes: Number(e.target.value) || 0 }) })),
              h('div', { className: 'sfs-actions' },
                h('button', { className: 'sfs-btn sfs-primary', disabled: busy !== null, onClick: () => saveSetup('folder') }, busy === 'setup' ? h('span', { className: 'sfs-spin' }) : null, busy === 'setup' ? t('saving') : t('save'))),
              h('p', { className: 'sfs-note' }, t('setupHelpFolder'))) : null) : null,
          !configured && status && wizardMode === 'git' ? h('div', { className: 'sfs-card' },
            h('h2', null, t('modeGit')),
            h('label', { className: 'sfs-field' }, t('repoUrl'), h('input', { value: form.repoUrl, placeholder: 'https://github.com/you/dsh-sync-state.git', onChange: e => setForm({ ...form, repoUrl: e.target.value }) })),
            h('label', { className: 'sfs-field' }, t('token'), h('input', { type: 'password', value: form.token, placeholder: 'github_pat_…', onChange: e => setForm({ ...form, token: e.target.value }) })),
            h('label', { className: 'sfs-field' }, t('branch'), h('input', { value: form.branch, onChange: e => setForm({ ...form, branch: e.target.value }) })),
            h('label', { className: 'sfs-field' }, t('passphrase'), h('input', { type: 'password', value: form.passphrase, onChange: e => setForm({ ...form, passphrase: e.target.value }) })),
            h('label', { className: 'sfs-check' }, h('input', { type: 'checkbox', checked: form.encryptCredentials, onChange: e => setForm({ ...form, encryptCredentials: e.target.checked }) }), t('encryptCredentials')),
            h('label', { className: 'sfs-field' }, t('autoPullMinutes'), h('input', { type: 'number', min: 0, value: form.autoPullMinutes, onChange: e => setForm({ ...form, autoPullMinutes: Number(e.target.value) || 0 }) })),
            h('div', { className: 'sfs-actions' },
              h('button', { className: 'sfs-btn sfs-primary', disabled: busy !== null || !form.repoUrl, onClick: () => saveSetup('git') }, busy === 'setup' ? h('span', { className: 'sfs-spin' }) : null, busy === 'setup' ? t('saving') : t('save'))),
            h('p', { className: 'sfs-note' }, t('setupHelp'))) : null,
          configured && status ? h(React.Fragment, null,
            h('div', { className: 'sfs-card' },
              h('h2', null, t('configTitle')),
              h('div', { className: 'sfs-grid', style: { marginTop: 14 } },
                stat(t('device'), status.device),
                stat(t('modeLabel'), status.mode === 'folder' ? t('modeNameFolder') : t('modeNameGit')),
                stat(status.mode === 'folder' ? t('chosenFolder') : status.repoUrl, status.mode === 'folder' ? status.syncDir : status.branch, true),
                stat(t('lastPush'), fmtTime(status.lastPush?.at) ?? t('never')),
                stat(t('lastPull'), fmtTime(status.lastPull?.at) ?? t('never')),
                stat(state, null)),
              h('div', { className: 'sfs-actions' },
                h('button', { className: 'sfs-btn sfs-primary', disabled: busy !== null, onClick: () => run('push') }, busy === 'push' ? h('span', { className: 'sfs-spin' }) : null, busy === 'push' ? t('pushing') : t('push')),
                h('button', { className: 'sfs-btn', disabled: busy !== null, onClick: () => run('pull') }, busy === 'pull' ? h('span', { className: 'sfs-spin' }) : null, busy === 'pull' ? t('pulling') : t('pull')),
                h('button', { className: 'sfs-btn', disabled: busy !== null, onClick: () => run('status').then(() => {}), 'aria-label': t('refresh') }, t('refresh')),
                h('label', { className: 'sfs-switch' },
                  h('input', { type: 'checkbox', checked: status.autoPush !== false, disabled: busy !== null, onChange: e => toggleAutoPush(e.target.checked), 'aria-label': t('autoPushLabel') }),
                  h('span', { className: 'sfs-track', 'aria-hidden': true }),
                  t('autoPushLabel'))),
              status.lastError ? h(Banner, { tone: 'err' }, `${status.lastError.op}: ${status.lastError.message}`) : null),
            h('div', { className: 'sfs-card' },
              h('h2', null, t('storage')),
              h('div', { className: 'sfs-grid', style: { marginTop: 14 } },
                stat(t('usageTotal'), usage ? `${fmtBytes(usage.areas.reduce((sum, area) => sum + area.bytes, 0))} · ${usage.areas.reduce((sum, area) => sum + area.files, 0)} files` : '…'),
                stat(t('usageBackup'), usage ? fmtBytes(usage.backup.bytes) : '…'),
                stat(t('usageMirror'), usage ? fmtBytes(usage.mirror.bytes) : '…')),
              h('div', { className: 'sfs-actions' },
                h('button', { className: 'sfs-btn sfs-danger', disabled: busy !== null, onClick: () => { if (window.confirm(t('confirmCleanup'))) run('cleanup', null, { target: 'backups' }); } }, t('cleanupBackups')),
                h('button', { className: 'sfs-btn sfs-danger', disabled: busy !== null, onClick: () => { if (window.confirm(t('confirmCleanup'))) run('cleanup', null, { target: 'mirror' }); } }, t('cleanupMirror')),
                h('button', { className: 'sfs-btn sfs-danger', disabled: busy !== null, onClick: () => { if (window.confirm(t('confirmCleanup'))) run('cleanup', null, { target: 'state' }); } }, t('cleanupState'))))) : null,
          !status ? h(Banner, { tone: 'warn' }, '…') : null));

      function stat(label, value, mono) {
        return h('div', { className: 'sfs-stat' },
          h('div', { className: 'sfs-stat-label', style: mono ? { overflowWrap: 'anywhere' } : null }, label),
          value ? h('div', { className: 'sfs-stat-value', style: mono ? { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12 } : null }, value) : null);
      }
    }

    function readStateSafe(status) {
      if (status?.lastError) return status.enabled ?? '⚠︎';
      return status?.autoPush === false ? '⏸' : '✓';
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = (key) => {
          const lang = ctx.locale?.language ?? ctx.locale?.lang ?? 'zh';
          const table = STRINGS[String(lang).startsWith('zh') ? 'zh' : 'en'];
          return table[key] ?? STRINGS.zh[key] ?? key;
        };
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PAGE_KEY }, function SyncPage(props) { return h(App, { t, ...props }); }));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PAGE_KEY, order: 46, label: STRINGS.zh.title }, function SyncPanelIcon({ size }) { return h(SyncIcon, { size }); }));
      },
    };
  },
});

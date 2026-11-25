import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, CheckCircle2, AlertCircle, Cloud, CloudOff, CloudUpload, RefreshCw, ShieldCheck, FileText, Save, Trash2, Star, BellRing, Monitor, Volume2, RotateCcw, Send } from "lucide-react";
import api from "./api";
import { useAuth } from "./authContext";
import { useConfirm } from "./confirmContext";
import { loadNotificationPrefs, resetNotificationPrefs, saveNotificationPrefs } from "./notificationPrefs";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  async function submit(event) {
    event.preventDefault();

    if (next !== confirm) {
      return notify("error", "The new password and the confirmation do not match.");
    }

    setSaving(true);
    try {
      await api.post("/api/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      sessionStorage.setItem("gst_notice", "Password changed. Please sign in again.");
      logout();
    } catch (err) {
      const detail = err.response?.data?.detail;
      notify(
        "error",
        typeof detail === "string"
          ? detail
          : "Could not change the password. It needs 8 to 72 characters."
      );
    } finally {
      setSaving(false);
    }
  }

  const type = show ? "text" : "password";

  return (
    <div className="page-content">
      <p className="settings-lead">Account details, security, and administrator preferences.</p>

      <section className="settings-row">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your account</h2>
              <p>Ask an administrator if any of these need to change.</p>
            </div>
          </div>
          <dl className="detail-grid settings-details">
            <div><dt>Full name</dt><dd>{user.full_name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{user.role}</dd></div>
          </dl>
        </div>

        <form className="panel" onSubmit={submit}>
          <div className="panel-heading">
            <div>
              <h2>Change password</h2>
              <p>Use at least 8 characters.</p>
            </div>
            <button
              type="button"
              className="icon-btn"
              title={show ? "Hide passwords" : "Show passwords"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="form-grid settings-form">
            <label>
              Current password
              <input
                type={type}
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type={type}
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                type={type}
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>

          <div className="modal-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving..." : "Change password"}
            </button>
          </div>
        </form>
      </section>

      <AlertPreferencesSection notify={notify} userId={user?.id} />

      {user?.role === "Admin" && (
        <>
          <div className="settings-section-label">Administrator</div>
          <section className="settings-stack">
            <DriveSection notify={notify} />
            <InvoiceTemplateSection notify={notify} />
            <NotificationRulesSection notify={notify} />
          </section>
        </>
      )}

      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

function AlertPreferencesSection({ notify, userId }) {
  const [prefs, setPrefs] = useState(() => loadNotificationPrefs(userId));
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );

  useEffect(() => {
    setPrefs(loadNotificationPrefs(userId));
  }, [userId]);

  useEffect(() => {
    const reload = (event) => setPrefs(event.detail || loadNotificationPrefs(userId));
    window.addEventListener("gst:notification-prefs-changed", reload);
    return () => window.removeEventListener("gst:notification-prefs-changed", reload);
  }, [userId]);

  function update(key, value) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    saveNotificationPrefs(userId, next);
  }

  async function enableDesktop() {
    try {
      if (window.gstApi?.desktopNotify) {
        await window.gstApi.desktopNotify({ title: "GST Office", body: "Desktop notifications are on.", link: "/" });
      } else if (typeof Notification !== "undefined") {
        const result = await Notification.requestPermission();
        if (result !== "granted") {
          notify("error", "Desktop notification permission was not granted.");
          setPermission(result);
          return;
        }
      }
      setPermission("granted");
      notify("success", "Desktop notifications are enabled.");
    } catch {
      notify("error", "Desktop notifications could not be enabled.");
    }
  }

  function sendTest() {
    window.dispatchEvent(new CustomEvent("gst:test-notification", {
      detail: {
        id: `test-${Date.now()}`,
        title: "GST Office",
        body: "Test notification received. Your alerts are working.",
        kind: "Test",
        link: "/",
      },
    }));
    notify("success", "Test notification sent.");
  }

  function restoreDefaults() {
    setPrefs(resetNotificationPrefs(userId));
    notify("success", "Notification preferences restored to defaults.");
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2><BellRing size={17} /> Alert preferences</h2>
          <p>Choose how new notifications reach you. These settings apply to this device.</p>
        </div>
      </div>
      <div className="form-grid settings-form">
        <label className="checkbox-field">
          <input type="checkbox" checked={prefs.popup} onChange={(event) => update("popup", event.target.checked)} />
          <span><strong>Pop-up alerts</strong><small>Show a notification card when something new arrives.</small></span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={prefs.sound} onChange={(event) => update("sound", event.target.checked)} />
          <span><strong>Sound</strong><small>Play a short chime for new alerts.</small></span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={prefs.desktop} onChange={(event) => update("desktop", event.target.checked)} />
          <span><strong>Desktop notifications</strong><small>Send alerts to Windows even when another tab is active.</small></span>
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={prefs.quietHours} onChange={(event) => update("quietHours", event.target.checked)} />
          <span><strong>Quiet hours</strong><small>Pause pop-ups, sound, and desktop alerts during the selected window.</small></span>
        </label>
        <div className="template-fields">
          <label>
            Quiet from
            <input type="time" value={prefs.quietFrom} onChange={(event) => update("quietFrom", event.target.value)} disabled={!prefs.quietHours} />
          </label>
          <label>
            Quiet until
            <input type="time" value={prefs.quietTo} onChange={(event) => update("quietTo", event.target.value)} disabled={!prefs.quietHours} />
          </label>
        </div>
        <label>
          Maximum pop-ups on screen
          <select value={prefs.maxPopups} onChange={(event) => update("maxPopups", Number(event.target.value))}>
            {[1, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      </div>
      <div className="template-actions">
        <button className="primary-btn" onClick={sendTest}><Send size={15} /> Send test notification</button>
        {permission !== "granted" && permission !== "unsupported" && prefs.desktop && (
          <button className="secondary-btn" onClick={enableDesktop}><Monitor size={15} /> Enable desktop alerts</button>
        )}
        {prefs.desktop && <span className="settings-hint"><Volume2 size={14} /> Desktop alerts {permission === "granted" ? "ready" : "available"}</span>}
        <button className="text-btn" onClick={restoreDefaults}><RotateCcw size={14} /> Restore defaults</button>
      </div>
    </section>
  );
}

function DriveSection({ notify }) {
  const askConfirm = useConfirm();
  const [st, setSt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const poll = useRef(null);

  const load = async () => {
    try {
      const r = await api.get("/api/sync/status");
      setSt(r.data);
      setLoadError("");
      return r.data;
    } catch (e) {
      const d = e.response?.data?.detail;
      setLoadError(typeof d === "string" ? d : "Could not reach the sync service. Check that the app is running and try again.");
      return null;
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => {
      clearTimeout(timer);
      clearInterval(poll.current);
    };
  }, []);

  async function act(fn, ok) {
    setBusy(true);
    try {
      const result = await fn();
      const data = result?.data;
      if (data?.status === "error") {
        throw new Error(data.error || "Sync failed.");
      }
      if (data?.status === "conflict") {
        notify("error", "Two versions exist. Choose which one to keep.");
        await load();
        return;
      }
      if (ok) notify("success", ok);
      await load();
    } catch (e) {
      const d = e.response?.data?.detail;
      notify("error", typeof d === "string" ? d : e.message || "Failed. Please try again.");
    } finally { setBusy(false); }
  }

  async function disconnectGoogle() {
    const ok = await askConfirm({
      title: "Disconnect Google?",
      message: "Syncing with this Google account will stop. Existing local data will be kept.",
      confirmLabel: "Disconnect",
    });
    if (ok) await act(() => api.post("/api/sync/disconnect"), "Disconnected.");
  }

  function connect() {
    act(async () => {
      const result = await api.post("/api/sync/connect");
      if (result.data?.url) setAuthUrl(result.data.url);
      return result;
    }, "Finish the sign-in in your browser, then come back.");
    clearInterval(poll.current);
    let checks = 0;
    poll.current = setInterval(async () => {
      checks += 1;
      if (checks > 120) {
        clearInterval(poll.current);
        notify("error", "Google sign-in timed out. Please try again.");
        return;
      }
      const s = await load();
      if (s?.error) {
        clearInterval(poll.current);
        notify("error", s.error);
        return;
      }
      if (s?.connected) {
        clearInterval(poll.current);
        notify("success", "Google account connected.");
      }
    }, 2500);
  }

  if (!st) {
    return (
      <div className="panel gd">
        <div className="gd-head">
          <div className="gd-logo"><Cloud size={22} /></div>
          <div>
            <h2>Google Drive backup and sync</h2>
            <p>Keep your data safe and use it on more than one laptop.</p>
          </div>
        </div>
        <div className="gd-body">
          <div className="gd-status bad">
            <div className="ico"><CloudOff size={20} /></div>
            <div className="txt">
              <strong>Could not load sync status</strong>
              <span>{loadError || "Please check the app is running and try again."}</span>
            </div>
            <button className="secondary-btn" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (!st.supported) {
    return (
      <div className="panel gd">
        <div className="gd-head">
          <div className="gd-logo"><Cloud size={22} /></div>
          <div>
            <h2>Google Drive backup and sync</h2>
            <p>Keep your data safe and use it on more than one laptop.</p>
          </div>
        </div>
        <div className="gd-body">
          <div className="gd-status bad">
            <div className="ico"><CloudOff size={20} /></div>
            <div className="txt">
              <strong>Google Drive backup is not available in this build</strong>
              <span>Please update the app to the latest version.</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const state = st.error ? "bad" : !st.connected ? "" : st.pending ? "wait" : "ok";
  const title = st.error ? "Sync needs attention"
    : !st.connected ? "Not connected"
    : st.pending ? "Changes waiting to upload"
    : "Everything is backed up";
  const sub = st.error ? st.error
    : !st.connected ? (st.configured
      ? "Connect your Google account to turn on automatic backup."
      : `Google Drive backup is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to ${st.config_path || "the .env next to the app"}, then restart.`)
    : st.email;
  const Icon = !st.connected ? CloudOff : state === "wait" ? CloudUpload : Cloud;

  return (
    <div className="panel gd">
      <div className="gd-head">
        <div className="gd-logo"><Cloud size={22} /></div>
        <div>
          <h2>Google Drive backup and sync</h2>
          <p>Keep your data safe and use it on more than one laptop.</p>
        </div>
      </div>

      <div className="gd-body">
        <div className={`gd-status ${state}`}>
          <div className="ico"><Icon size={20} /></div>
          <div className="txt">
            <strong>{title}</strong>
            <span>{sub}</span>
          </div>
          {!st.connected && (
            <button className="primary-btn" onClick={connect} disabled={busy || !st.configured}>
              Connect Google
            </button>
          )}
        </div>

        {st.connected ? (
          <>
            <div className="gd-grid">
              <div className="gd-cell"><small>Connected account</small><b>{st.email}</b></div>
              <div className="gd-cell"><small>Last sync</small><b>{st.last_sync || "Not yet"}</b></div>
              <div className="gd-cell"><small>Automatic sync</small><b>On, every 30 seconds</b></div>
              <div className="gd-cell"><small>Works offline</small><b>Yes, syncs when online</b></div>
            </div>
            <div className="gd-actions">
              <button className="primary-btn" disabled={busy}
                onClick={() => act(() => api.post("/api/sync/now"), "Sync finished.")}>
                <RefreshCw size={16} /> Sync now
              </button>
              <button className="secondary-btn" disabled={busy} onClick={disconnectGoogle}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <ol className="gd-steps">
            <li><b>1</b><span>Click <strong>Connect Google</strong> and sign in with your Google account.</span></li>
            {authUrl && (
              <li><b>↗</b><span>If the browser did not open, <a href={authUrl} target="_blank" rel="noreferrer">open Google sign-in manually</a>.</span></li>
            )}
            <li><b>2</b><span>Your data is saved to your own Google Drive automatically.</span></li>
            <li><b>3</b><span>On another laptop, install the app and choose <strong>Restore from Google Drive</strong> on the first screen.</span></li>
          </ol>
        )}
      </div>

      <div className="gd-foot">
        <ShieldCheck size={16} />
        Only this app can see its backup. Your other Google Drive files are never accessed.
      </div>
    </div>
  );
}

function InvoiceTemplateSection({ notify }) {
  const askConfirm = useConfirm();
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState("");
  const [config, setConfig] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  function selectFrom(list) {
    const first = list.find((t) => t.is_default) || list[0];
    if (first) {
      setSelectedId(first.id);
      setName(first.name);
      setConfig(first.config);
    } else {
      setSelectedId(null);
      setName("");
      setConfig({});
    }
  }

  const load = useCallback(async () => {
    try {
      const [list, defaults] = await Promise.all([
        api.get("/api/invoices/templates"),
        api.get("/api/invoices/templates/default-config"),
      ]);
      setTemplates(list.data);
      setLoadError("");
      const first = list.data.find((t) => t.is_default) || list.data[0];
      if (first) {
        setSelectedId(first.id);
        setName(first.name);
        setConfig(first.config);
      } else {
        setConfig(defaults.data);
      }
    } catch (e) {
      const detail = e.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "Could not load invoice templates.";
      setLoadError(message);
      notify("error", message);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  function setField(field, value) {
    setConfig((prev) => ({ ...(prev || {}), [field]: value }));
  }

  function applyTemplate(id) {
    const selected = templates.find((t) => t.id === Number(id));
    if (!selected) return;
    setSelectedId(selected.id);
    setName(selected.name);
    setConfig(selected.config);
  }

  function newTemplate() {
    setSelectedId(null);
    setName("");
    setConfig((prev) => ({ ...(prev || {}), number_prefix: "INV" }));
    setPreviewHtml("");
  }

  async function save() {
    if (!name.trim()) {
      notify("error", "Give this template a name first.");
      return;
    }
    setBusy(true);
    try {
      const payload = { name: name.trim(), config };
      const saved = selectedId
        ? await api.put(`/api/invoices/templates/${selectedId}`, payload)
        : await api.post("/api/invoices/templates", payload);
      const list = await api.get("/api/invoices/templates");
      setTemplates(list.data);
      setSelectedId(saved.data.id);
      setName(saved.data.name);
      setConfig(saved.data.config);
      notify("success", "Invoice template saved.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not save the template.");
    } finally {
      setBusy(false);
    }
  }

  async function setDefault() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const changed = await api.post(`/api/invoices/templates/${selectedId}/default`);
      const list = await api.get("/api/invoices/templates");
      setTemplates(list.data);
      setConfig(changed.data.config);
      notify("success", "Default invoice template updated.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not set the default template.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    const ok = await askConfirm({
      title: "Delete invoice template?",
      message: "This invoice template will be removed.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/api/invoices/templates/${selectedId}`);
      const list = await api.get("/api/invoices/templates");
      setTemplates(list.data);
      selectFrom(list.data);
      setPreviewHtml("");
      notify("success", "Invoice template deleted.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not delete the template.");
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    try {
      const result = await api.post("/api/invoices/templates/preview", config || {}, {
        responseType: "text",
      });
      setPreviewHtml(typeof result.data === "string" ? result.data : "");
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not build the preview.");
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <div className="panel gd">
        <div className="gd-head">
          <div className="gd-logo"><FileText size={22} /></div>
          <div><h2>Invoice templates</h2><p>Change the look, tax, numbering, and business details on client invoices.</p></div>
        </div>
        <div className="gd-body">
          <div className={`gd-status ${loadError ? "bad" : ""}`}>
            <div className="ico">{loadError ? <AlertCircle size={20} /> : <RefreshCw size={20} />}</div>
            <div className="txt">
              <strong>{loadError ? "Could not load invoice templates" : "Loading templates..."}</strong>
              <span>{loadError || "Fetching your saved invoice designs."}</span>
            </div>
            {loadError && <button className="secondary-btn" onClick={load}>Retry</button>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel gd">
      <div className="gd-head">
        <div className="gd-logo"><FileText size={22} /></div>
        <div>
          <h2>Invoice templates</h2>
          <p>Change the look, tax, numbering, and business details on client invoices.</p>
        </div>
      </div>

      <div className="gd-body">
        <div className="gd-grid template-top">
          <label>
            Saved templates
            <select value={selectedId ?? ""} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">New template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>
              ))}
            </select>
          </label>
          <label>
            Template name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GST invoice" />
          </label>
        </div>

        <div className="form-grid template-fields">
          <label>
            Business name
            <input value={config.business_name || ""} onChange={(e) => setField("business_name", e.target.value)} />
          </label>
          <label>
            Logo or tagline
            <input value={config.logo_text || ""} onChange={(e) => setField("logo_text", e.target.value)} placeholder="Optional" />
          </label>
          <label className="wide">
            Business address
            <textarea rows={2} value={config.address || ""} onChange={(e) => setField("address", e.target.value)} />
          </label>
          <label>
            Phone
            <input value={config.phone || ""} onChange={(e) => setField("phone", e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" value={config.email || ""} onChange={(e) => setField("email", e.target.value)} />
          </label>
          <label>
            GSTIN
            <input value={config.gstin || ""} onChange={(e) => setField("gstin", e.target.value)} />
          </label>
          <label>
            Currency symbol
            <input value={config.currency || ""} onChange={(e) => setField("currency", e.target.value)} />
          </label>
          <label>
            Number prefix
            <input value={config.number_prefix || ""} onChange={(e) => setField("number_prefix", e.target.value)} />
          </label>
          <label>
            Accent colour
            <input type="color" value={config.accent_color || "#2563eb"} onChange={(e) => setField("accent_color", e.target.value)} />
          </label>
          <label>
            Tax percent
            <input type="number" min="0" max="100" step="0.01" value={config.tax_percent ?? 0}
              onChange={(e) => setField("tax_percent", Number(e.target.value))} />
          </label>
          <label className="wide checkbox-field">
            <input type="checkbox" checked={!!config.show_tax}
              onChange={(e) => setField("show_tax", e.target.checked)} />
            Show tax breakdown on invoices
          </label>
          <label className="wide">
            Bank details
            <textarea rows={3} value={config.bank_details || ""} onChange={(e) => setField("bank_details", e.target.value)} placeholder="Bank, account, IFSC" />
          </label>
          <label className="wide">
            Terms
            <textarea rows={3} value={config.terms || ""} onChange={(e) => setField("terms", e.target.value)} placeholder="Payment terms" />
          </label>
          <label className="wide">
            Footer message
            <textarea rows={2} value={config.footer || ""} onChange={(e) => setField("footer", e.target.value)} />
          </label>
        </div>

        <div className="modal-actions template-actions">
          <button className="primary-btn" onClick={save} disabled={busy}><Save size={16} /> Save template</button>
          <button className="secondary-btn" onClick={newTemplate} disabled={busy}>New</button>
          <button className="secondary-btn" onClick={setDefault} disabled={busy || !selectedId}><Star size={16} /> Set as default</button>
          <button className="secondary-btn" onClick={preview} disabled={busy}><Eye size={16} /> Preview</button>
          <button className="secondary-btn" onClick={remove} disabled={busy || !selectedId}><Trash2 size={16} /> Delete</button>
        </div>

        {previewHtml && (
          <div className="template-preview">
            <h3>Live preview</h3>
            <iframe title="Invoice preview" srcDoc={previewHtml} className="preview-frame" />
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRulesSection({ notify }) {
  const askConfirm = useConfirm();
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/notifications/rules");
      setRules(response.data);
      setLoadError("");
    } catch (e) {
      const detail = e.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "Could not load notification rules.";
      setLoadError(message);
      notify("error", message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  function change(index, field, value) {
    setRules((prev) => prev.map((rule, i) => i === index ? { ...rule, [field]: value } : rule));
  }

  async function save(rule) {
    setBusy(true);
    try {
      const result = await api.put(`/api/notifications/rules/${rule.kind}`, {
        label: rule.label,
        lead_days: Number(rule.lead_days),
        enabled: !!rule.enabled,
        include_overdue: !!rule.include_overdue,
        link: rule.link,
        notify_time: rule.notify_time || "09:00",
      });
      setRules((prev) => prev.map((item) => item.kind === rule.kind ? result.data : item));
      notify("success", `${rule.label} reminders updated.`);
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not save this rule.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    const ok = await askConfirm({
      title: "Restore default rules?",
      message: "Your custom reminder times and settings will be replaced with the defaults.",
      confirmLabel: "Restore",
      tone: "default",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await api.post("/api/notifications/rules/reset");
      setRules(result.data);
      notify("success", "Default reminder rules restored.");
    } catch (e) {
      const detail = e.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not reset the rules.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel gd">
      <div className="gd-head">
        <div className="gd-logo"><BellRing size={22} /></div>
        <div>
          <h2>Reminder rules</h2>
          <p>Choose when reminders appear, how early they start, and where they link.</p>
        </div>
        <button className="secondary-btn" onClick={reset} disabled={busy}>Restore defaults</button>
      </div>

      <div className="gd-body rules-body">
        {loadError && (
          <div className="gd-status bad">
            <div className="ico"><AlertCircle size={20} /></div>
            <div className="txt">
              <strong>Could not load reminder rules</strong>
              <span>{loadError}</span>
            </div>
            <button className="secondary-btn" onClick={load}>Retry</button>
          </div>
        )}
        {loading && !loadError && <p className="settings-hint">Loading reminder rules...</p>}
        {!loading && !loadError && rules.length === 0 && (
          <p className="settings-hint">No reminder rules are configured yet.</p>
        )}
        {!loadError && rules.map((rule, index) => (
          <div className="form-grid rule-grid" key={rule.kind}>
            <div className="rule-name">
              <strong>{rule.label}</strong>
              <small>{rule.kind}</small>
            </div>
            <label>
              Days ahead
              <input type="number" min="0" max="365" value={rule.lead_days}
                onChange={(e) => change(index, "lead_days", e.target.value)} />
            </label>
            <label>
              Notify at
              <input type="time" value={rule.notify_time || "09:00"}
                onChange={(e) => change(index, "notify_time", e.target.value)} />
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={!!rule.enabled}
                onChange={(e) => change(index, "enabled", e.target.checked)} />
              Enabled
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={!!rule.include_overdue}
                onChange={(e) => change(index, "include_overdue", e.target.checked)} />
              Show overdue
            </label>
            <label>
              Link
              <input value={rule.link} onChange={(e) => change(index, "link", e.target.value)} />
            </label>
            <button className="secondary-btn" onClick={() => save(rule)} disabled={busy}>Save</button>
          </div>
        ))}
      </div>
    </div>
  );
}
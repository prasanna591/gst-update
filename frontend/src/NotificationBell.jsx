import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Bell, CheckCircle2, BellRing, Check, X, Volume2, VolumeX, Monitor, Trash2, Search,
} from "lucide-react";
import api from "./api";
import { useAuth } from "./authContext";
import { isQuietTime, loadNotificationPrefs, saveNotificationPrefs } from "./notificationPrefs";

function alertKey(userId) {
  return `gst-notification-alerts:${userId || "shared"}`;
}

function readAlertLog(userId) {
  try {
    const raw = localStorage.getItem(alertKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAlertLog(userId, log) {
  localStorage.setItem(alertKey(userId), JSON.stringify(log));
}

function shouldAlert(log, id) {
  const last = Number(log[id] || 0);
  return Date.now() - last >= 10 * 60 * 1000;
}

async function sendDesktop(item, prefs, force = false) {
  if (!prefs.desktop || (!force && isQuietTime(prefs))) return false;
  const payload = {
    title: item.title || "GST Office",
    body: item.body || "",
    link: item.link || "/",
    id: item.id,
  };
  try {
    if (window.gstApi?.desktopNotify) {
      return await window.gstApi.desktopNotify(payload) !== false;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      const note = new Notification(payload.title, { body: payload.body, tag: `gst-${item.id}` });
      note.onclick = () => window.focus();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function playChime(prefs, force = false) {
  if (!prefs.sound || (!force && isQuietTime(prefs))) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    if (context.state === "suspended") context.resume();
    [0, 0.16].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = index === 0 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + 0.16);
    });
    window.setTimeout(() => context.close(), 900);
  } catch {
    return;
  }
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("All");
  const [kindFilter, setKindFilter] = useState("");
  const [search, setSearch] = useState("");
  const [popups, setPopups] = useState([]);
  const [prefs, setPrefs] = useState(() => loadNotificationPrefs(userId));
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const wrap = useRef(null);
  const knownRef = useRef(null);
  const alertLogRef = useRef({});
  const prefsRef = useRef(prefs);
  const openRef = useRef(open);

  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    knownRef.current = null;
    alertLogRef.current = readAlertLog(userId);
    setPrefs(loadNotificationPrefs(userId));
  }, [userId]);
  useEffect(() => {
    const reload = (event) => setPrefs(event.detail || loadNotificationPrefs(userId));
    window.addEventListener("gst:notification-prefs-changed", reload);
    return () => window.removeEventListener("gst:notification-prefs-changed", reload);
  }, [userId]);
  const addPopup = useCallback((item, force = false) => {
    const current = prefsRef.current;
    if (!current.popup || (!force && isQuietTime(current))) return;
    setPopups((list) => [...list.filter((popup) => popup.id !== item.id), item].slice(-Number(current.maxPopups || 3)));
  }, []);

  useEffect(() => {
    if (!window.gstApi?.onNotificationClick) return undefined;
    return window.gstApi.onNotificationClick((link) => {
      if (link) navigate(link);
    });
  }, [navigate]);
  useEffect(() => {
    const onTest = (event) => {
      const item = event.detail;
      if (!item) return;
      addPopup(item, true);
      playChime(prefsRef.current, true);
      sendDesktop(item, prefsRef.current, true);
    };
    window.addEventListener("gst:test-notification", onTest);
    return () => window.removeEventListener("gst:test-notification", onTest);
  }, [addPopup]);

  function dismissPopup(id) {
    setPopups((list) => list.filter((popup) => popup.id !== id));
  }

  useEffect(() => {
    if (!popups.length) return undefined;
    const timers = popups.map((popup) => window.setTimeout(() => dismissPopup(popup.id), 8000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [popups]);

  const load = useCallback(async (alert = false) => {
    try {
      const response = await api.get("/api/notifications");
      const list = response.data;
      setItems(list);
      if (!alert) return;
      const ids = list.map((item) => item.id);
      const fresh = list.filter((item) => !item.is_read && (knownRef.current === null || !knownRef.current.has(item.id)));
      knownRef.current = new Set(ids);
      if (!fresh.length || openRef.current) return;
      for (const item of fresh.slice(-3)) {
        if (!shouldAlert(alertLogRef.current, item.id)) continue;
        addPopup(item);
        playChime(prefsRef.current);
        await sendDesktop(item, prefsRef.current);
        alertLogRef.current = { ...alertLogRef.current, [item.id]: Date.now() };
        writeAlertLog(userId, alertLogRef.current);
      }
    } catch {
      return;
    }
  }, [userId, addPopup]);

  useEffect(() => {
    load(true);
    const timer = window.setInterval(() => load(true), 45 * 1000);
    const onData = () => load(false);
    window.addEventListener("gst:data-changed", onData);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("gst:data-changed", onData);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => { if (wrap.current && !wrap.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function enableDesktop() {
    if (window.gstApi?.desktopNotify) {
      await window.gstApi.desktopNotify({ title: "GST Office", body: "Desktop notifications are on.", link: "/" });
      setPermission("granted");
      return;
    }
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      new Notification("GST Office", { body: "Desktop notifications are on." });
    }
  }

  function togglePref(key) {
    saveNotificationPrefs(userId, { ...prefs, [key]: !prefs[key] });
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
  }

  async function markRead(item, read = true) {
    try {
      await api.patch(`/api/notifications/${item.id}/read`, { read });
      setItems((list) => list.map((entry) => (entry.id === item.id ? { ...entry, is_read: read } : entry)));
      if (read) dismissPopup(item.id);
    } catch {
      return;
    }
  }

  async function markAll() {
    try {
      await api.post("/api/notifications/read-all");
      setItems((list) => list.map((entry) => ({ ...entry, is_read: true })));
      setPopups([]);
    } catch {
      return;
    }
  }

  async function dismissItem(item) {
    try {
      await api.delete(`/api/notifications/${item.id}`);
      setItems((list) => list.filter((entry) => entry.id !== item.id));
      dismissPopup(item.id);
    } catch {
      return;
    }
  }

  async function dismissAll() {
    try {
      await api.post("/api/notifications/dismiss-all");
      setItems([]);
      setPopups([]);
    } catch {
      return;
    }
  }

  function openItem(item) {
    markRead(item);
    setOpen(false);
    dismissPopup(item.id);
    navigate(item.link || "/");
  }

  const kinds = [...new Set(items.map((item) => item.kind).filter(Boolean))];
  const unread = items.filter((item) => !item.is_read);
  const q = search.toLowerCase();
  const shown = items
    .filter((item) => (filter === "All" ? true : filter === "Unread" ? !item.is_read : true))
    .filter((item) => !kindFilter || item.kind === kindFilter)
    .filter((item) => [item.title, item.body, item.kind].some((value) => (value || "").toLowerCase().includes(q)));

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        className="icon-btn bell"
        title="Notifications"
        onClick={() => { setOpen(!open); if (!open) load(false); }}
      >
        <Bell size={17} />
        {unread.length > 0 && <span className="bell-count">{unread.length > 9 ? "9+" : unread.length}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <div>
              <strong>Notification center</strong>
              <small>{unread.length === 0 ? "All caught up" : `${unread.length} unread`}</small>
            </div>
            <div className="notif-head-actions">
              <button className="notif-link" onClick={markAll} title="Mark all as read"><Check size={14} /> Read all</button>
              <button className="notif-link" onClick={dismissAll} title="Dismiss all notifications"><Trash2 size={14} /> Clear</button>
            </div>
          </div>

          <div className="notif-filters">
            <div className="notif-tabs">
              {["All", "Unread"].map((tab) => (
                <button key={tab} className={filter === tab ? "on" : ""} onClick={() => setFilter(tab)}>{tab}</button>
              ))}
            </div>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} title="Filter by type">
              <option value="">All types</option>
              {kinds.map((kind) => <option key={kind}>{kind}</option>)}
            </select>
            <label className="notif-search"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" /></label>
          </div>

          <div className="notif-prefs">
            <button className={prefs.sound ? "on" : ""} onClick={() => togglePref("sound")} title="Toggle notification sound">
              {prefs.sound ? <Volume2 size={14} /> : <VolumeX size={14} />} Sound
            </button>
            <button className={prefs.desktop ? "on" : ""} onClick={() => togglePref("desktop")} title="Toggle desktop notifications">
              <Monitor size={14} /> Desktop
            </button>
            <button className={prefs.popup ? "on" : ""} onClick={() => togglePref("popup")} title="Toggle pop-up alerts">
              <BellRing size={14} /> Popups
            </button>
            <button onClick={sendTest} title="Send a test notification">
              <BellRing size={14} /> Test
            </button>
          </div>

          {permission !== "granted" && permission !== "unsupported" && prefs.desktop && (
            <button className="notif-enable" onClick={enableDesktop}>
              <BellRing size={16} />
              <span>Enable desktop notifications</span>
            </button>
          )}

          {shown.length === 0 ? (
            <div className="notif-empty">
              <CheckCircle2 size={22} />
              <p>{items.length === 0 ? "Nothing needs your attention right now." : "No notifications match these filters."}</p>
            </div>
          ) : (
            <ul className="notif-list">
              {shown.map((item) => (
                <li key={item.id} className={item.is_read ? "read" : ""}>
                  <button className="notif-item-main" onClick={() => openItem(item)}>
                    <strong>{item.title}</strong>
                    <small>{item.kind} · {item.body}</small>
                  </button>
                  <div className="notif-item-actions">
                    <button className="icon-btn sm" title={item.is_read ? "Mark unread" : "Mark read"} onClick={() => markRead(item, !item.is_read)}>
                      {item.is_read ? <Bell size={13} /> : <Check size={13} />}
                    </button>
                    <button className="icon-btn sm danger" title="Dismiss notification" onClick={() => dismissItem(item)}><X size={13} /></button>
                    {!item.is_read && <span className="notif-dot" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="notif-foot"><Link to="/settings" onClick={() => setOpen(false)}>Notification settings</Link></div>
        </div>
      )}

      {createPortal(
        <div className="notification-popups" aria-live="polite">
          {popups.map((item) => (
            <article className="notification-popup" key={item.id}>
              <div className="notification-popup__icon"><BellRing size={18} /></div>
              <div className="notification-popup__body">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
                <div className="notification-popup__actions">
                  <button onClick={() => openItem(item)}>Open</button>
                  <button onClick={() => markRead(item)}>Mark read</button>
                  <button onClick={() => dismissItem(item)}>Dismiss</button>
                </div>
              </div>
              <button className="icon-btn sm" title="Close" onClick={() => dismissPopup(item.id)}><X size={14} /></button>
            </article>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

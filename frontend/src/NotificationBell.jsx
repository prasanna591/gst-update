import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCircle2, BellRing, Check } from "lucide-react";
import api from "./api";

function desktopAlert(items) {
  if (!items.length) return;

  const key = "gst-notified";
  const last = Number(localStorage.getItem(key) || 0);
  const now = Date.now();
  if (now - last < 60 * 60 * 1000) return;

  const title = "GST Office";
  const body =
    items.length === 1
      ? items[0].title
      : `${items.length} new reminders. Open the bell to see them.`;

  try {
    if (window.gstApi?.desktopNotify) {
      window.gstApi.desktopNotify(title, body);
    } else if (
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else {
      return;
    }
    localStorage.setItem(key, String(now));
  } catch {
    /* desktop notifications are optional */
  }
}

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission
  );
  const wrap = useRef(null);

  async function load(alert = false) {
    try {
      const r = await api.get("/api/notifications");
      setItems(r.data);
      if (alert) desktopAlert(r.data.filter((x) => !x.is_read));
    } catch {
      /* stay quiet if the server is not reachable */
    }
  }

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(true), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function enableDesktop() {
    if (typeof Notification === "undefined") return;
    if (window.gstApi?.desktopNotify) {
      window.gstApi.desktopNotify("GST Office", "Desktop notifications are now on.");
      setPermission("granted");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      new Notification("GST Office", { body: "Desktop notifications are now on.", icon: "/favicon.ico" });
    }
  }

  async function markRead(item) {
    if (item.is_read) return;
    try {
      await api.patch(`/api/notifications/${item.id}/read`, { read: true });
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)));
    } catch { /* ignore */ }
  }

  async function markAll() {
    try {
      await api.post("/api/notifications/read-all");
      setItems((list) => list.map((x) => ({ ...x, is_read: true })));
    } catch { /* ignore */ }
  }

  const unread = items.filter((x) => !x.is_read);

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        className="icon-btn bell"
        title="Notifications"
        onClick={() => { setOpen(!open); if (!open) load(); }}
      >
        <Bell size={17} />
        {unread.length > 0 && (
          <span className="bell-count">{unread.length > 9 ? "9+" : unread.length}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <div>
              <strong>Notifications</strong>
              <small>{unread.length === 0 ? "All caught up" : `${unread.length} unread`}</small>
            </div>
            {unread.length > 0 && (
              <button className="notif-link" onClick={markAll}><Check size={14} /> Mark all read</button>
            )}
          </div>

          {permission !== "granted" && permission !== "unsupported" && (
            <button className="notif-enable" onClick={enableDesktop}>
              <BellRing size={16} />
              <span>Enable desktop notifications</span>
            </button>
          )}

          {items.length === 0 ? (
            <div className="notif-empty">
              <CheckCircle2 size={22} />
              <p>Nothing needs your attention right now.</p>
            </div>
          ) : (
            <ul className="notif-list">
              {items.slice(0, 12).map((x) => (
                <li key={x.id} className={x.is_read ? "read" : ""}>
                  <Link to={x.link || "/"} onClick={() => { markRead(x); setOpen(false); }}>
                    <div>
                      <strong>{x.title}</strong>
                      <small>{x.kind} · {x.body}</small>
                    </div>
                    {!x.is_read && <span className="notif-dot" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, CalendarDays, FileText, IndianRupee, ListChecks, Gift, Plus, X,
} from "lucide-react";
import api from "./api";
import DetailCard from "./DetailCard";

const KINDS = ["Registration", "Anniversary", "Deadline", "Custom"];

const TYPE_META = {
  Filing: { bg: "#dbeafe", color: "#1d4ed8", icon: FileText },
  Fee: { bg: "#dcfce7", color: "#166534", icon: IndianRupee },
  Task: { bg: "#fef3c7", color: "#92400e", icon: ListChecks },
  Date: { bg: "#ede9fe", color: "#5b21b6", icon: Gift },
};

const emptyMark = (date) => ({
  title: "", kind: "Custom", event_date: date, repeat_yearly: true, client_id: "", notes: "",
});

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildEvents(filings, fees, tasks, dates) {
  const events = [];

  for (const f of filings || []) {
    if (!f.due_date) continue;
    events.push({
      date: String(f.due_date).slice(0, 10),
      type: "Filing",
      title: `${f.client_name || "Client"}: ${f.return_type} filing`,
      subtitle: `${f.period || ""} · ${f.status || "Pending"}`,
      link: "/filings",
    });
  }

  for (const f of fees || []) {
    if (!f.due_date) continue;
    events.push({
      date: String(f.due_date).slice(0, 10),
      type: "Fee",
      title: `${f.client_name || "Client"}: ${f.purpose}`,
      subtitle: `₹${Number(f.amount || 0).toLocaleString("en-IN")} · ${f.status || "Pending"}`,
      link: "/fees",
    });
  }

  for (const t of tasks || []) {
    if (!t.due_date) continue;
    events.push({
      date: String(t.due_date).slice(0, 10),
      time: t.due_time || "",
      type: "Task",
      title: t.title,
      subtitle: `${t.priority || "Normal"} · ${t.is_done ? "Done" : "Open"}${t.due_time ? ` · ${t.due_time}` : ""}`,
      link: "/tasks",
    });
  }

  for (const d of dates || []) {
    if (!d.date) continue;
    events.push({
      date: String(d.date).slice(0, 10),
      type: "Date",
      title: d.title,
      subtitle: `${d.kind || "Custom"}${d.client_name ? ` · ${d.client_name}` : ""}`,
      link: "/dates",
    });
  }

  return events;
}

export default function Calendar() {
  const today = isoDate(new Date());
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [events, setEvents] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      api.get("/api/filings/"),
      api.get("/api/fees/"),
      api.get("/api/tasks/"),
      api.get("/api/reminders/dates"),
      api.get("/api/clients/"),
    ])
      .then(([f, fee, t, d, c]) => {
        if (!live) return;
        setEvents(buildEvents(f.data, fee.data, t.data, d.data));
        setClients(c.data);
        setError("");
      })
      .catch(() => { if (live) setError("Could not load calendar items."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reloadKey]);

  const monthPrefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
  const monthEvents = useMemo(
    () => events.filter((event) => event.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || "")),
    [events, monthPrefix]
  );

  const byDate = useMemo(() => {
    const map = new Map();
    for (const event of monthEvents) {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date).push(event);
    }
    return map;
  }, [monthEvents]);

  const cells = useMemo(() => {
    const firstDay = new Date(view.year, view.month, 1).getDay();
    const total = new Date(view.year, view.month + 1, 0).getDate();
    const list = [...Array(firstDay).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
    while (list.length % 7) list.push(null);
    return list;
  }, [view]);

  const counts = useMemo(() => {
    const result = { Filing: 0, Fee: 0, Task: 0, Date: 0 };
    for (const event of monthEvents) result[event.type] += 1;
    return result;
  }, [monthEvents]);

  function shift(delta) {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }

  function goToday() {
    const now = new Date();
    setView({ year: now.getFullYear(), month: now.getMonth() });
  }

  function openMark(date = today) {
    setForm(emptyMark(date));
    setFormError("");
  }

  function setMarkField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveMark(event) {
    event.preventDefault();
    setFormError("");
    setSaving(true);
    const body = {
      title: form.title.trim(),
      kind: form.kind,
      event_date: form.event_date,
      repeat_yearly: form.repeat_yearly,
      client_id: form.client_id ? Number(form.client_id) : null,
      notes: form.notes.trim() || null,
    };
    try {
      await api.post("/api/reminders/dates", body);
      setForm(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setFormError(typeof detail === "string" ? detail : "Could not save the marking date.");
    } finally {
      setSaving(false);
    }
  }

  const label = new Date(view.year, view.month, 1).toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button className="primary-btn" onClick={() => openMark(today)}><Plus size={16} /> Add marking date</button>
        <button className="secondary-btn" onClick={() => shift(-1)}><ChevronLeft size={16} /> Previous</button>
        <button className="secondary-btn" onClick={goToday}>Today</button>
        <button className="secondary-btn" onClick={() => shift(1)}>Next <ChevronRight size={16} /></button>
      </div>

      {error && <div className="panel" style={{ marginBottom: 16 }}>{error}</div>}

      <section className="stats-grid">
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const Icon = meta.icon;
          return (
            <article className="stat-card" key={type}>
              <div className="stat-top">
                <span>{type === "Date" ? "Client dates" : `${type}s`}</span>
                <div className="stat-icon" style={{ background: meta.bg, color: meta.color }}><Icon /></div>
              </div>
              <strong>{counts[type]}</strong>
              <small>In {label}</small>
            </article>
          );
        })}
      </section>

      <section className="panel mt calendar-panel">
        <div className="panel-heading">
          <div>
            <h2>{label}</h2>
            <p>{monthEvents.length} scheduled item{monthEvents.length === 1 ? "" : "s"}</p>
          </div>
          <CalendarDays size={20} />
        </div>

        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="calendar-weekday">{day}</div>
          ))}

          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} className="calendar-cell calendar-blank" />;
            const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
            const items = byDate.get(date) || [];
            return (
              <div
                key={date}
                className={`calendar-cell ${date === today ? "calendar-today" : ""}`}
                onClick={() => openMark(date)}
                onKeyDown={(e) => { if (e.key === "Enter") openMark(date); }}
                role="button"
                tabIndex={0}
                title="Click to add a marking date"
              >
                <strong className="calendar-day">{day}</strong>
                {items.slice(0, 3).map((event, i) => {
                  const meta = TYPE_META[event.type];
                  return (
                    <Link
                      key={`${event.type}-${i}`}
                      to={event.link}
                      className="calendar-event"
                      style={{ background: meta.bg, color: meta.color }}
                      title={`${event.title} · ${event.subtitle}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {event.title}
                    </Link>
                  );
                })}
                {items.length > 3 && <small className="calendar-more">+{items.length - 3} more</small>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel mt">
        <div className="panel-heading">
          <div><h2>Agenda</h2><p>Everything scheduled for {label}.</p></div>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : monthEvents.length === 0 ? (
          <div className="empty-state"><CalendarDays size={22} /><p>Nothing scheduled this month.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Item</th><th>Details</th></tr>
              </thead>
              <tbody>
                {monthEvents.map((event, i) => {
                  const meta = TYPE_META[event.type];
                  return (
                    <tr
                      key={`${event.date}-${event.type}-${i}`}
                      className="clickable-row"
                      onClick={() => setDetail({
                        title: event.title || "—",
                        subtitle: event.type || "—",
                        rows: [
                          ["Type", event.type],
                          ["Date", event.date ? new Date(`${event.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"],
                          ["Details", event.subtitle],
                          ["Open in", event.link],
                        ],
                      })}
                    >
                      <td>{new Date(`${event.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                      <td>
                        <span style={{ padding: "3px 8px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 11 }}>
                          {event.type}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}><Link to={event.link}>{event.title}</Link></td>
                      <td>{event.subtitle}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Add marking date</h2>
                <p>Mark a date that matters for your office or a client.</p>
              </div>
              <button className="icon-btn" onClick={() => setForm(null)} aria-label="Close"><X /></button>
            </div>
            <form onSubmit={saveMark}>
              <div className="form-grid">
                <label className="full-width">Title *
                  <input
                    required
                    autoFocus
                    value={form.title}
                    onChange={(e) => setMarkField("title", e.target.value)}
                    placeholder="e.g. Client anniversary"
                  />
                </label>
                <label>Type
                  <select value={form.kind} onChange={(e) => setMarkField("kind", e.target.value)}>
                    {KINDS.map((kind) => <option key={kind}>{kind}</option>)}
                  </select>
                </label>
                <label>Date *
                  <input
                    required
                    type="date"
                    value={form.event_date}
                    onChange={(e) => setMarkField("event_date", e.target.value)}
                  />
                </label>
                <label className="full-width">Client (optional)
                  <select value={form.client_id} onChange={(e) => setMarkField("client_id", e.target.value)}>
                    <option value="">No client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.client_name}</option>
                    ))}
                  </select>
                </label>
                <label className="full-width">
                  <span>
                    <input
                      type="checkbox"
                      checked={form.repeat_yearly}
                      onChange={(e) => setMarkField("repeat_yearly", e.target.checked)}
                    />
                    Repeat every year
                  </span>
                </label>
                <label className="full-width">Notes
                  <textarea rows="2" value={form.notes} onChange={(e) => setMarkField("notes", e.target.value)} />
                </label>
              </div>
              {formError && <p role="alert" style={{ color: "#b91c1c" }}>{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Saving..." : "Save date"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      <DetailCard detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, CalendarDays, FileText, IndianRupee, ListChecks, Gift,
} from "lucide-react";
import api from "./api";

const TYPE_META = {
  Filing: { bg: "#dbeafe", color: "#1d4ed8", icon: FileText },
  Fee: { bg: "#dcfce7", color: "#166534", icon: IndianRupee },
  Task: { bg: "#fef3c7", color: "#92400e", icon: ListChecks },
  Date: { bg: "#ede9fe", color: "#5b21b6", icon: Gift },
};

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
      type: "Task",
      title: t.title,
      subtitle: `${t.priority || "Normal"} · ${t.is_done ? "Done" : "Open"}`,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([
      api.get("/api/filings/"),
      api.get("/api/fees/"),
      api.get("/api/tasks/"),
      api.get("/api/reminders/dates"),
    ])
      .then(([f, fee, t, d]) => {
        if (!live) return;
        setEvents(buildEvents(f.data, fee.data, t.data, d.data));
        setError("");
      })
      .catch(() => { if (live) setError("Could not load calendar items."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const monthPrefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
  const monthEvents = useMemo(
    () => events.filter((event) => event.date.startsWith(monthPrefix)).sort((a, b) => a.date.localeCompare(b.date)),
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

  const label = new Date(view.year, view.month, 1).toLocaleDateString("en-IN", {
    month: "long", year: "numeric",
  });

  return (
    <div className="page-content">
      <header className="topbar">
        <div>
          <span className="crumb">Workspace / Calendar</span>
          <h1>Calendar</h1>
          <p>Filings, fees, tasks and client dates in one place.</p>
        </div>
        <div className="topbar-actions">
          <button className="secondary-btn" onClick={() => shift(-1)}><ChevronLeft size={16} /> Previous</button>
          <button className="secondary-btn" onClick={goToday}>Today</button>
          <button className="secondary-btn" onClick={() => shift(1)}>Next <ChevronRight size={16} /></button>
        </div>
      </header>

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

      <section className="panel mt">
        <div className="panel-heading">
          <div>
            <h2>{label}</h2>
            <p>{monthEvents.length} scheduled item{monthEvents.length === 1 ? "" : "s"}</p>
          </div>
          <CalendarDays size={20} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 12 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} style={{ textAlign: "center", fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              {day}
            </div>
          ))}

          {cells.map((day, index) => {
            if (!day) return <div key={`blank-${index}`} style={{ minHeight: 110 }} />;
            const date = `${monthPrefix}-${String(day).padStart(2, "0")}`;
            const items = byDate.get(date) || [];
            return (
              <div key={date} style={{
                minHeight: 110,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: 8,
                background: date === today ? "#eff6ff" : "#fff",
              }}>
                <strong style={{ fontSize: 12, color: date === today ? "#2563eb" : "#334155" }}>{day}</strong>
                {items.slice(0, 3).map((event, i) => {
                  const meta = TYPE_META[event.type];
                  return (
                    <Link key={`${event.type}-${i}`} to={event.link}
                      title={`${event.title} · ${event.subtitle}`}
                      style={{
                        display: "block", marginTop: 4, padding: "3px 6px", borderRadius: 6,
                        background: meta.bg, color: meta.color, fontSize: 11,
                        textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                      {event.title}
                    </Link>
                  );
                })}
                {items.length > 3 && (
                  <small style={{ display: "block", marginTop: 4, color: "#64748b" }}>+{items.length - 3} more</small>
                )}
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
                    <tr key={`${event.date}-${event.type}-${i}`}>
                      <td>{new Date(`${event.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                      <td>
                        <span style={{ padding: "3px 8px", borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 11 }}>
                          {event.type}
                        </span>
                      </td>
                      <td><Link to={event.link}>{event.title}</Link></td>
                      <td>{event.subtitle}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, X, AlertTriangle, Star, CheckCircle2, CalendarClock,
} from "lucide-react";
import api from "./api";
import DetailCard from "./DetailCard";

const todayStr = () => new Date().toLocaleDateString("en-CA");
const emptyForm = () => ({
  title: "", notes: "", due_date: todayStr(), priority: "Normal", client_id: "",
  service_id: "", recurrence: "None", recurrence_end: "",
});

function daysFromToday(s) {
  const d = new Date(s + "T00:00:00");
  const t = new Date(todayStr() + "T00:00:00");
  return Math.round((d - t) / 86400000);
}

function fmtDate(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("Focus");
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState(null);
  const [detail, setDetail] = useState(null);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  async function load() {
    try {
      const [t, c, s] = await Promise.all([
        api.get("/api/tasks/"),
        api.get("/api/clients/"),
        api.get("/api/services/"),
      ]);
      setTasks(t.data);
      setClients(c.data);
      setServices(s.data);
      setError("");
      window.dispatchEvent(new Event("gst:data-changed"));
    } catch {
      setError("Could not load tasks. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function generateDeadlines() {
    setGenerating(true);
    setNotice(null);
    setError("");
    try {
      const res = await api.post("/api/tasks/generate");
      const created = res.data?.created ?? 0;
      const updated = res.data?.updated ?? 0;
      const checked = res.data?.checked ?? 0;
      let text;
      if (created && updated) {
        text = `Created ${created} new deadline task${created === 1 ? "" : "s"} and updated ${updated} date${updated === 1 ? "" : "s"}.`;
      } else if (created) {
        text = `Created ${created} new deadline task${created === 1 ? "" : "s"} from your services.`;
      } else if (updated) {
        text = `Updated ${updated} deadline date${updated === 1 ? "" : "s"}. No new tasks were needed.`;
      } else {
        text = checked
          ? `Checked ${checked} active service assignment${checked === 1 ? "" : "s"} — all deadlines are already up to date.`
          : "No client has an active service assigned yet. Add services to a client first.";
      }
      setNotice({ type: "success", text });
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      setNotice({
        type: "error",
        text: typeof detail === "string"
          ? detail
          : "Could not generate deadline tasks. Check that the backend is running.",
      });
    } finally {
      setGenerating(false);
    }
  }

  const t0 = todayStr();
  const open = tasks.filter((t) => !t.is_done);
  const dueSoon = open.filter((t) => {
    const n = daysFromToday(t.due_date);
    return n >= 1 && n <= 3;
  });
  const overdue = open.filter((t) => daysFromToday(t.due_date) < 0);
  const todays = open.filter((t) => daysFromToday(t.due_date) === 0);
  const upcoming = open.filter((t) => daysFromToday(t.due_date) > 3);
  const done = tasks.filter((t) => t.is_done);
  const important = open.filter((t) => t.priority === "High");

  const focusRank = (t) => {
    const n = daysFromToday(t.due_date);
    if (n >= 1 && n <= 3) return 0;
    if (n < 0) return 1;
    return 2;
  };
  const byFocus = (a, b) =>
    focusRank(a) - focusRank(b) ||
    a.due_date.localeCompare(b.due_date) ||
    (a.priority === "High" ? 0 : 1) - (b.priority === "High" ? 0 : 1);

  const lists = {
    Focus: [...dueSoon, ...overdue, ...todays].sort(byFocus),
    Upcoming: [...upcoming].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    Done: [...done].sort((a, b) => b.due_date.localeCompare(a.due_date)),
  };
  const shown = lists[tab];

  const cards = [
    { label: "Due in 1-3 days", value: dueSoon.length, note: "Up next", icon: CalendarClock, tone: "blue", card: "" },
    { label: "Overdue", value: overdue.length, note: "Past the date", icon: AlertTriangle, tone: "red", card: "c-red" },
    { label: "Important", value: important.length, note: "High priority, not done", icon: Star, tone: "orange", card: "c-gold" },
    { label: "Done", value: done.length, note: "Completed tasks", icon: CheckCircle2, tone: "green", card: "c-green" },
  ];

  function openNew() {
    setEditId(null);
    setError("");
    setForm(emptyForm());
  }

  function openEdit(t) {
    setEditId(t.id);
    setError("");
    setForm({
      title: t.title, notes: t.notes || "", due_date: t.due_date,
      priority: t.priority, client_id: t.client_id ? String(t.client_id) : "",
      service_id: t.service_id ? String(t.service_id) : "",
      recurrence: t.recurrence || "None",
      recurrence_end: t.recurrence_end || "",
    });
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    const body = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      due_date: form.due_date,
      priority: form.priority,
      client_id: form.client_id ? Number(form.client_id) : null,
      service_id: form.service_id ? Number(form.service_id) : null,
      recurrence: form.recurrence,
      recurrence_end: form.recurrence_end || null,
    };
    try {
      if (editId) await api.put(`/api/tasks/${editId}`, body);
      else await api.post("/api/tasks/", body);
      setForm(null);
      load();
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Please check the details.");
    }
  }

  async function toggle(t) {
    try {
      await api.patch(`/api/tasks/${t.id}/done`, { done: !t.is_done });
      load();
    } catch {
      setError("Could not update the task.");
    }
  }

  async function remove(t) {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    try {
      await api.delete(`/api/tasks/${t.id}`);
      load();
    } catch {
      setError("Could not delete the task.");
    }
  }

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button
          className="secondary-btn"
          title="Create tasks for every service deadline"
          disabled={generating}
          onClick={generateDeadlines}
        >
          <CalendarClock size={17} /> {generating ? "Generating…" : "Generate deadlines"}
        </button>
        <button className="primary-btn" onClick={openNew}><Plus size={18} /> Add task</button>
      </div>

      <section className="stats-grid">
        {cards.map(({ label, value, note, icon: Icon, tone, card }) => (
          <article className={`stat-card ${card}`} key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <div className={`stat-icon ${tone}`}><Icon /></div>
            </div>
            <strong>{loading ? "…" : Math.max(value, 0)}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="tabs">
          {Object.keys(lists).map((k) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {k} ({lists[k].length})
            </button>
          ))}
        </div>

        {error && !form && <div className="login-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}

        {loading ? (
          <p className="task-empty">Loading tasks...</p>
        ) : shown.length === 0 ? (
          <p className="task-empty">
            {tab === "Focus" ? "Nothing due soon or overdue." : tab === "Upcoming" ? "No upcoming tasks." : "No completed tasks yet."}
          </p>
        ) : (
          <ul className="dx-list">
            {shown.map((t) => {
              const late = !t.is_done && t.due_date < t0;
              const n = daysFromToday(t.due_date);
              return (
                <li
                  key={t.id}
                  className={`dx-row ${t.priority === "High" && !t.is_done ? "high" : ""} ${late ? "late" : ""} ${t.is_done ? "done" : ""} clickable-row`}
                  onClick={() => setDetail({
                    title: t.title || "—",
                    subtitle: `${t.client_name || "No client"} · ${t.service_name || "No service"}`,
                    rows: [
                      ["Due date", t.due_date ? fmtDate(t.due_date) : "—"],
                      ["Priority", t.priority || "—"],
                      ["Status", t.is_done ? "Done" : "Open"],
                      ["Client", t.client_name],
                      ["Service", t.service_name],
                      ["Repeat", t.recurrence && t.recurrence !== "None" ? t.recurrence : "—"],
                      ["Repeat until", t.recurrence_end ? fmtDate(t.recurrence_end) : null],
                      ["Task ID", t.id],
                    ],
                    note: t.notes,
                  })}
                >
                  <input
                    type="checkbox"
                    className="dx-check"
                    checked={t.is_done}
                    title={t.is_done ? "Mark as not done" : "Mark as done"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(t)}
                  />
                  <div className="dx-body">
                    <strong>{t.title}</strong>
                    <small>
                      {fmtDate(t.due_date)}{t.client_name ? ` · ${t.client_name}` : ""}
                      {t.service_name ? ` · ${t.service_name}` : ""}
                      {t.recurrence && t.recurrence !== "None" ? ` · repeats ${t.recurrence.toLowerCase()}` : ""}
                      {late ? ` · ${-n} day${-n === 1 ? "" : "s"} overdue` : n === 0 && !t.is_done ? " · Today" : n > 0 && !t.is_done ? ` · in ${n} day${n === 1 ? "" : "s"}` : ""}
                    </small>
                  </div>
                  {t.priority === "High" && !t.is_done && <span className="chip chip-amber">Important</span>}
                  {late && <span className="chip chip-red">Overdue</span>}
                  <div className="dx-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn sm" title="Edit" onClick={() => openEdit(t)}><Pencil size={15} /></button>
                    <button className="icon-btn sm" title="Delete" onClick={() => remove(t)}><Trash2 size={15} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <h2>{editId ? "Edit task" : "Add task"}</h2>
              <button className="icon-btn" onClick={() => setForm(null)} title="Close"><X /></button>
            </div>
            <form onSubmit={save}>
              <div className="form-grid">
                <label className="full-width">Task *
                  <input required autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} />
                </label>
                <label>Date *
                  <input required type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
                </label>
                <label>Priority
                  <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                    <option value="Normal">Normal</option>
                    <option value="High">High (important)</option>
                  </select>
                </label>
                <label className="full-width">Client (optional)
                  <select value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name}</option>)}
                  </select>
                </label>
                <label>Service
                  <select value={form.service_id} onChange={(e) => set("service_id", e.target.value)}>
                    <option value="">No service</option>
                    {services.filter((s) => s.is_active).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label>Repeat
                  <select value={form.recurrence} onChange={(e) => set("recurrence", e.target.value)}>
                    <option value="None">Does not repeat</option>
                    <option value="Monthly">Every month</option>
                    <option value="Quarterly">Every quarter</option>
                    <option value="Half-yearly">Every half-year</option>
                    <option value="Yearly">Every year</option>
                  </select>
                </label>
                {form.recurrence !== "None" && (
                  <label className="full-width">Repeat until (optional, max 24 tasks)
                    <input type="date" value={form.recurrence_end} onChange={(e) => set("recurrence_end", e.target.value)} />
                  </label>
                )}
                <label className="full-width">Notes
                  <textarea rows="2" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                </label>
              </div>
              {error && <div className="login-error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Save</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {notice && (
        <div className={`toast ${notice.type}`} role="status">
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {notice.text}
        </div>
      )}

      <DetailCard detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
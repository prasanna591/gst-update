import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus, Pencil, Trash2, X, Cake, Building2, Sparkles, AlarmClock, Bell,
  CalendarDays, CalendarClock, CalendarRange, Search,
} from "lucide-react";
import api from "./api";
import DetailCard from "./DetailCard";

const KINDS = ["Registration", "Anniversary", "Deadline", "Custom"];
const REPEAT_FREQUENCIES = ["None", "Every N days", "Monthly", "Yearly"];
const empty = { title: "", kind: "Registration", event_date: "", repeat_frequency: "Yearly", repeat_interval: 7, client_id: "", notes: "" };
const ICONS = { Birthday: Cake, Registration: Building2, Anniversary: Sparkles, Deadline: AlarmClock, Custom: Bell };

const fmt = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const weekday = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" });
const repeatLabel = (i) => {
  const frequency = i.repeat_frequency || (i.repeat_yearly ? "Yearly" : "None");
  if (frequency === "Every N days") return `Every ${i.repeat_interval || 7} days`;
  if (frequency === "Monthly") return "Every month";
  if (frequency === "Yearly") return "Every year";
  return "One time";
};

function when(days) {
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} ago`, cls: "past" };
  if (days === 0) return { text: "Today", cls: "today" };
  if (days === 1) return { text: "Tomorrow", cls: "soon" };
  if (days <= 7) return { text: `In ${days} days`, cls: "soon" };
  if (days <= 30) return { text: `In ${days} days`, cls: "near" };
  return { text: `In ${days} days`, cls: "far" };
}

export default function ImportantDates() {
  const [searchParams] = useSearchParams();
  const requestedRange = searchParams.get("range");
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState(requestedRange === "14" ? "14" : requestedRange === "all" ? "All" : "30");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  async function load() {
    const [d, c] = await Promise.all([api.get("/api/reminders/dates"), api.get("/api/clients/")]);
    setItems(d.data); setClients(c.data); setLoading(false);
  }
  useEffect(() => { load().catch(() => { setError("Could not load dates."); setLoading(false); }); }, []);

  const todayN = items.filter((i) => i.days === 0).length;
  const weekN = items.filter((i) => i.days >= 0 && i.days <= 7).length;
  const fourteenN = items.filter((i) => i.days >= 0 && i.days <= 14).length;
  const monthN = items.filter((i) => i.days >= 0 && i.days <= 30).length;

  const q = search.toLowerCase();
  const shown = items
    .filter((i) => tab === "All" || (tab === "14" ? i.days >= 0 && i.days <= 14 : i.days >= 0 && i.days <= 30))
    .filter((i) => [i.title, i.kind, i.client_name].some((v) => (v || "").toLowerCase().includes(q)));

  const cards = [
    { label: "Today", value: todayN, note: todayN ? "Needs your attention" : "Nothing today", icon: AlarmClock, tone: "orange", card: "c-gold" },
    { label: "Next 7 days", value: weekN, note: "Coming this week", icon: CalendarClock, tone: "violet", card: "c-violet" },
    { label: "Next 30 days", value: monthN, note: "Coming this month", icon: CalendarRange, tone: "blue", card: "" },
    { label: "All dates", value: items.length, note: "Including birthdays", icon: CalendarDays, tone: "green", card: "c-green" },
  ];

  function openNew() { setEditId(null); setForm(empty); setError(""); }
  function openEdit(i) {
    setEditId(i.id); setError("");
    setForm({ title: i.title, kind: i.kind, event_date: i.event_date,
              repeat_frequency: i.repeat_frequency || (i.repeat_yearly ? "Yearly" : "None"),
              repeat_interval: i.repeat_interval || 7,
              client_id: i.client_id ? String(i.client_id) : "", notes: i.notes || "" });
  }
  async function save(e) {
    e.preventDefault(); setError("");

    const body = { title: form.title.trim(), kind: form.kind, event_date: form.event_date,
                   repeat_frequency: form.repeat_frequency,
                   repeat_interval: form.repeat_frequency === "Every N days" ? Number(form.repeat_interval) : null,
                   client_id: form.client_id ? Number(form.client_id) : null,
                   notes: form.notes.trim() || null };
    try {
      if (editId) await api.put(`/api/reminders/dates/${editId}`, body);
      else await api.post("/api/reminders/dates", body);
      setForm(null); load();
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Please check the details.");
    }
  }
  const remove = async (i) => {
    if (!window.confirm(`Delete "${i.title}"?`)) return;
    try {
      await api.delete(`/api/reminders/dates/${i.id}`);
      load();
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Could not delete this date.");
    }
  };

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button className="primary-btn" onClick={openNew}><Plus size={18} /> Add date</button>
      </div>

      <section className="stats-grid">
        {cards.map(({ label, value, note, icon: Icon, tone, card }) => (
          <article className={`stat-card ${card}`} key={label}>

            <div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}><Icon /></div></div>
            <strong>{loading ? "…" : value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-tools">
          <div className="tabs">
            <button className={tab === "14" ? "on" : ""} onClick={() => setTab("14")}>Next 14 days ({fourteenN})</button>
            <button className={tab === "30" ? "on" : ""} onClick={() => setTab("30")}>Next 30 days ({monthN})</button>
            <button className={tab === "All" ? "on" : ""} onClick={() => setTab("All")}>All dates ({items.length})</button>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, type or client..." />
          </div>
        </div>
        <p className="page-note">Client birthdays are added automatically from each client's date of birth.</p>
        {error && !form && <p role="alert">{error}</p>}

        {!loading && shown.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><CalendarDays size={26} /></div>
            <h3>{items.length === 0 ? "No dates yet" : "Nothing in this view"}</h3>
            <p>{items.length === 0 ? "Add a registration date, anniversary or reminder." : "Try All dates or a different search."}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Date</th><th>What</th><th>Type</th><th>Client</th><th>Actions</th></tr></thead>
              <tbody>

                {shown.map((i) => {
                  const w = when(i.days);
                  const Icon = ICONS[i.kind] || Bell;
                  const k = i.kind.toLowerCase();
                  return (
                    <tr key={i.key} className={`clickable-row ${i.days === 0 ? "row-today" : ""}`} onClick={() => setDetail(i)}>
                      <td><span className={`when ${w.cls}`}>{w.text}</span></td>
                      <td className="date-cell"><strong>{fmt(i.date)}</strong><small>{weekday(i.date)}</small></td>
                      <td>
                        <div className="what-cell">
                          <div className={`kind-ico k-${k}`}><Icon size={18} /></div>
                          <div>
                            <strong>{i.title}</strong>
                            <small>{repeatLabel(i)}</small>
                          </div>
                        </div>
                      </td>
                      <td><span className={`pill pill-${k}`}>{i.kind}</span></td>
                      <td>{i.client_name || <span className="muted">—</span>}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {i.source === "custom" ? (
                          <div className="row-actions">
                            <button className="icon-btn sm" title="Edit" onClick={() => openEdit(i)}><Pencil size={15} /></button>
                            <button className="icon-btn sm" title="Delete" onClick={() => remove(i)}><Trash2 size={15} /></button>
                          </div>
                        ) : <span className="muted">Automatic</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

          </div>
        )}
        {shown.length > 0 && <p className="table-footer">Showing {shown.length} of {items.length} dates</p>}
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{editId ? "Edit date" : "Add important date"}</h2>
                <p>You will be reminded before this date.</p>
              </div>
              <button className="icon-btn" onClick={() => setForm(null)}><X /></button>
            </div>
            <form onSubmit={save}>
              <div className="form-grid">
                <label className="full-width">What *
                  <input required autoFocus value={form.title} onChange={(e) => set("title", e.target.value)}
                         placeholder="e.g. ABC Traders company anniversary" /></label>
                <label>Type
                  <select value={form.kind} onChange={(e) => set("kind", e.target.value)}>
                    {KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
                <label>Date *
                  <input required type="date" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} /></label>
                <label className="full-width">Client (optional)
                  <select value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name}</option>)}</select></label>
                <label>Repeat
                  <select value={form.repeat_frequency} onChange={(e) => set("repeat_frequency", e.target.value)}>
                    {REPEAT_FREQUENCIES.map((frequency) => <option key={frequency}>{frequency}</option>)}
                  </select>
                </label>
                {form.repeat_frequency === "Every N days" && (
                  <label>Repeat every
                    <span className="inline-number">
                      <input
                        type="number"
                        min="1"
                        max="3650"
                        value={form.repeat_interval}
                        onChange={(e) => set("repeat_interval", e.target.value)}
                      />
                      days
                    </span>
                  </label>
                )}

                <label className="full-width">Notes
                  <textarea rows="2" value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
              </div>
              {error && <p role="alert" style={{ color: "#b91c1c" }}>{error}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Save</button>
              </div>
            </form>
          </section>
        </div>
      )}

      <DetailCard
        detail={detail ? {
          title: detail.title,
          subtitle: `${repeatLabel(detail)} · ${detail.client_name || "No client"}`,
          rows: [
            ["Type", detail.kind],
            ["Date", fmt(detail.date)],
            ["Weekday", weekday(detail.date)],
            ["When", when(detail.days).text],
            ["Repeat", repeatLabel(detail)],
            ["Client", detail.client_name || "—"],
            ["Source", detail.source === "birthday" ? "Client birthday" : "Custom mark"],
          ],
          note: detail.notes,
        } : null}
        onClose={() => setDetail(null)}
        actions={detail?.source === "custom" ? (
          <button className="primary-btn" onClick={() => { openEdit(detail); setDetail(null); }}>Edit date</button>
        ) : null}
      />
    </div>
  );
}

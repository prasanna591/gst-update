import { useState, useEffect } from "react";
import { Plus, Briefcase, Pencil, Trash2, X } from "lucide-react";
import api from "./api";
import DetailCard from "./DetailCard";
import { useConfirm } from "./confirmContext";
import "./App.css";

export default function Services() {
  const askConfirm = useConfirm();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", frequency: "Monthly", due_day: 20 });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const r = await api.get("/api/services/");
      setServices(r.data || []);
    } catch {
      setError("Could not load services.");
    } finally {
      setLoading(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Service name is required.");
      return;
    }
    const req = editingId
      ? api.put(`/api/services/${editingId}`, form)
      : api.post("/api/services/", form);
    try {
      await req;
      setForm({ name: "", frequency: "Monthly", due_day: 20 });
      setEditingId(null);
      await load();
    } catch {
      setError("Failed to save service.");
    }
  }

  function edit(s) {
    setEditingId(s.id);
    setForm({ name: s.name, frequency: s.frequency || "Monthly", due_day: s.due_day || 20 });
    setError("");
  }

  async function remove(id) {
    const ok = await askConfirm({
      title: "Delete service?",
      message: "Clients linked to this service will lose the assignment.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/services/${id}`);
      await load();
    } catch {
      setError("Failed to delete service.");
    }
  }

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button className="primary-btn" onClick={() => { setEditingId(null); setForm({ name: "", frequency: "Monthly", due_day: 20 }); setError(""); }}>
          <Plus size={18} /> Add service
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{editingId ? "Edit service" : "Add new service"}</h2>
            <p>Set the service name, billing frequency and due day.</p>
          </div>
          {!editingId && (
            <button className="icon-btn" title="Cancel" onClick={() => setForm({ name: "", frequency: "Monthly", due_day: 20 })}>
              <X size={18} />
            </button>
          )}
        </div>

        <form onSubmit={save} className="form-grid">
          <label>
            Service name *
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GST return filing" />
          </label>
          <label>
            Frequency
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option>Monthly</option>
              <option>Quarterly</option>
              <option>Half-yearly</option>
              <option>Yearly</option>
            </select>
          </label>
          <label>
            Due day (1–28)
            <input type="number" min="1" max="28" value={form.due_day || 20} onChange={(e) => setForm({ ...form, due_day: Number(e.target.value) || 20 })} />
          </label>
          <div className="full-width">
            <button type="submit" className="primary-btn">{editingId ? "Save changes" : "Add service"}</button>
            {editingId && <button type="button" className="secondary-btn" onClick={() => { setEditingId(null); setForm({ name: "", frequency: "Monthly", due_day: 20 }); }}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="panel mt">
        <div className="panel-heading">
          <div>
            <h2>Existing services</h2>
            <p>{services.length} service{services.length === 1 ? "" : "s"} defined.</p>
          </div>
        </div>

        {loading ? (
          <div className="table-wrap">
            {[0, 1, 2].map((i) => (
              <div className="skeleton-row" key={i}>
                <div className="sk" style={{ width: "26%" }} />
                <div className="sk" style={{ width: "22%" }} />
                <div className="sk" style={{ width: "16%" }} />
                <div className="sk" style={{ width: "18%" }} />
              </div>
            ))}
          </div>
        ) : services.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Briefcase size={26} /></div>
            <h3>No services yet</h3>
            <p>Add your first service above to start assigning it to clients.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Frequency</th><th>Due day</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr
                    key={s.id}
                    className="clickable-row"
                    onClick={() => setDetail({
                      title: s.name || "—",
                      subtitle: `Service ID: ${s.id}`,
                      rows: [
                        ["Name", s.name],
                        ["Frequency", s.frequency || "—"],
                        ["Due day", s.due_day ? `Day ${s.due_day}` : "—"],
                        ["Status", s.is_active === false ? "Inactive" : "Active"],
                      ],
                    })}
                  >
                    <td><strong>{s.name}</strong></td>
                    <td>{s.frequency}</td>
                    <td>{s.due_day}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="icon-btn sm" title="Edit" onClick={() => edit(s)}><Pencil size={15} /></button>
                        <button className="icon-btn sm danger" title="Delete" onClick={() => remove(s.id)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DetailCard detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

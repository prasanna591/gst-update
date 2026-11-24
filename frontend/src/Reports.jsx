import { useState, useEffect, useCallback } from "react";
import { BarChart3, FileText, Clock, Users, Download, Loader2, Save, Trash2 } from "lucide-react";
import api from "./api";
import "./App.css";

const SECTIONS = [
  { value: "summary", label: "Summary" },
  { value: "clients", label: "Clients" },
  { value: "filings", label: "GST Filings" },
  { value: "fees", label: "Fees" },
  { value: "tasks", label: "Tasks" },
  { value: "documents", label: "Documents" },
];

const STATUS_OPTIONS = ["Pending", "Filed", "Overdue", "Done"];
const RETURN_TYPES = ["GSTR-1", "GSTR-3B", "GSTR-9", "GSTR-9C", "CMP-08"];
const GROUP_OPTIONS = [
  { value: "", label: "None" },
  { value: "client", label: "Client" },
  { value: "status", label: "Status" },
  { value: "return_type", label: "Return Type" },
  { value: "month", label: "Month" },
];

const DATE_FIELDS = {
  clients: "date_of_birth",
  filings: "due_date",
  fees: "due_date",
  tasks: "due_date",
  documents: "uploaded_at",
};

const EMPTY_FILTERS = {
  client_id: "",
  status: "",
  return_type: "",
  from_date: "",
  to_date: "",
  group_by: "",
};

export default function Reports() {
  const [clients, setClients] = useState([]);
  const [section, setSection] = useState("summary");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedColumns, setSelectedColumns] = useState([]);

  useEffect(() => {
    api.get("/api/clients/")
      .then((r) => setClients(r.data || []))
      .catch(() => setClients([]));
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await api.get("/api/reports/templates");
      setTemplates(r.data);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const params = useCallback((fmt = "json") => {
    const p = new URLSearchParams();
    if (section !== "summary") p.set("section", section);
    if (filters.client_id) p.set("client_id", filters.client_id);
    if (filters.status) p.set("status", filters.status);
    if (filters.return_type) p.set("return_type", filters.return_type);
    if (filters.from_date || filters.to_date) p.set("date_field", DATE_FIELDS[section] || "");
    if (filters.from_date) p.set("from_date", filters.from_date);
    if (filters.to_date) p.set("to_date", filters.to_date);
    if (filters.group_by) p.set("group_by", filters.group_by);
    p.set("format", fmt);
    return p.toString();
  }, [section, filters]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api.get(`/api/reports?${params()}`);
      setData(r.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Unable to generate the report.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    loadReports();
  }, [section, filters, loadReports]);

  const downloadReport = async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams(params("csv").replace(/^section=summary&/, ""));
      p.set("format", "csv");
      const r = await api.get(`/api/reports?${p.toString()}`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${section || "summary"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Unable to download the report.");
    } finally {
      setLoading(false);
    }
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setError("Enter a name for the template.");
      return;
    }
    setError("");
    try {
      const r = await api.post("/api/reports/templates", {
        name,
        section,
        config: { filters, columns: selectedColumns },
      });
      await loadTemplates();
      setTemplateName("");
      setSelectedTemplate(String(r.data.id));
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not save the template.");
    }
  };

  const applyTemplate = (id) => {
    setSelectedTemplate(id);
    const template = templates.find((t) => String(t.id) === id);
    if (!template) return;
    setSection(template.section);
    setFilters({ ...EMPTY_FILTERS, ...(template.config?.filters || {}) });
    setSelectedColumns(Array.isArray(template.config?.columns) ? template.config.columns : []);
    setData(null);
  };

  const deleteTemplate = async () => {
    if (!selectedTemplate) return;
    try {
      await api.delete(`/api/reports/templates/${selectedTemplate}`);
      setSelectedTemplate("");
      await loadTemplates();
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not delete the template.");
    }
  };

  const rows = section === "summary" ? [] : (data?.rows || []);
  const groups = section === "summary" ? null : (data?.groups || null);
  const tableRows = groups
    ? Object.entries(groups).flatMap(([key, items]) => items.map((item) => ({ ...item, [filters.group_by || "group"]: key })))
    : rows;

  const fieldNames = section === "summary"
    ? []
    : tableRows.length
      ? Object.keys(tableRows[0])
      : [];

  const visibleFields = selectedColumns.length
    ? fieldNames.filter((name) => selectedColumns.includes(name))
    : fieldNames;

  const toggleColumn = (name) => {
    if (!selectedColumns.length) {
      setSelectedColumns(fieldNames.filter((n) => n !== name));
      return;
    }
    if (selectedColumns.includes(name) && selectedColumns.length === 1) return;
    setSelectedColumns((cols) =>
      cols.includes(name) ? cols.filter((c) => c !== name) : [...cols, name]
    );
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return value;
  };

  const summaryCards = [
    { icon: <Users size={18} />, label: "Total clients", value: data?.clients?.total ?? 0, desc: "Registered client records" },
    { icon: <FileText size={18} />, label: "GST filings", value: data?.filings?.total ?? 0, desc: "All filing records" },
    { icon: <Clock size={18} />, label: "Pending filings", value: data?.filings?.pending ?? 0, desc: "Not yet filed" },
    { icon: <Clock size={18} />, label: "Overdue filings", value: data?.filings?.overdue ?? 0, desc: "Past due date" },
    { icon: <FileText size={18} />, label: "Documents", value: data?.documents ?? 0, desc: "Uploaded files" },
    { icon: <BarChart3 size={18} />, label: "Fees paid", value: data?.fees?.paid ?? 0, desc: "Paid fee records" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Custom Reports</h1>
        <p className="muted">Generate filtered reports for clients, filings, fees, tasks and documents.</p>
      </div>

      {error && <div className="login-error" role="alert">{error}</div>}

      <div className="report-controls">
        <label>
          Saved templates
          <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Choose a template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button className="secondary-btn" onClick={deleteTemplate} disabled={!selectedTemplate}>
          <Trash2 size={16} /> Delete
        </button>
        <label>
          Save current view as
          <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
        </label>
        <button className="primary-btn" onClick={saveTemplate}>
          <Save size={16} /> Save template
        </button>
      </div>

      <div className="report-controls">
        <label>
          Section
          <select value={section} onChange={(e) => { setSection(e.target.value); setData(null); setSelectedColumns([]); }}>
            {SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>

        {section !== "summary" && (
          <>
            <label>
              Client
              <select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
                <option value="">All clients</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="">All</option>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {section === "filings" && (
              <label>
                Return type
                <select value={filters.return_type} onChange={(e) => setFilters({ ...filters, return_type: e.target.value })}>
                  <option value="">All</option>
                  {RETURN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            <label>
              From date
              <input type="date" value={filters.from_date} onChange={(e) => setFilters({ ...filters, from_date: e.target.value })} />
            </label>
            <label>
              To date
              <input type="date" value={filters.to_date} onChange={(e) => setFilters({ ...filters, to_date: e.target.value })} />
            </label>
            <label>
              Group by
              <select value={filters.group_by} onChange={(e) => setFilters({ ...filters, group_by: e.target.value })}>
                {GROUP_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </label>
            {fieldNames.length > 0 && (
              <details>
                <summary>Columns</summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8 }}>
                  {fieldNames.map((name) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={selectedColumns.length === 0 || selectedColumns.includes(name)}
                        onChange={() => toggleColumn(name)}
                      />
                      {name.replace(/_/g, " ")}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <div className="control-actions">
          <button className="primary-btn" onClick={loadReports} disabled={loading}>
            {loading ? <Loader2 size={16} /> : "Generate report"}
          </button>
          {section !== "summary" && (
            <button className="primary-btn" onClick={downloadReport} disabled={loading}>
              <Download size={16} /> Download CSV
            </button>
          )}
        </div>
      </div>

      {section === "summary" && (
        <div className="stats-grid">
          {summaryCards.map((card, i) => (
            <div key={i} className="stat-card">
              <div className="stat-icon">{card.icon}</div>
              <div className="stat-value">{card.value}</div>
              <div className="stat-label">{card.label}</div>
              <div className="stat-desc">{card.desc}</div>
            </div>
          ))}
        </div>
      )}

      {section !== "summary" && data && (
        <div className="report-table">
          {tableRows.length === 0 && (
            <div className="muted">No records matched the selected filters.</div>
          )}
          {tableRows.length > 0 && (
            <table>
              <thead>
                <tr>
                  {visibleFields.map((name) => (
                    <th key={name}>{name.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i}>
                    {visibleFields.map((name) => (
                      <td key={name}>{formatValue(row[name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted">{data.count} record{data.count !== 1 ? "s" : ""} found.</div>
        </div>
      )}

      {loading && !error && <div className="muted">Generating report&hellip;</div>}
    </div>
  );
}

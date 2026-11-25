import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  IndianRupee,
  ListChecks,
  Loader2,
  Printer,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import api, { apiErrorMessage } from "./api";
import DetailCard from "./DetailCard";
import "./App.css";

const SECTIONS = [
  { value: "summary", label: "Summary", icon: BarChart3 },
  { value: "clients", label: "Clients", icon: Users },
  { value: "filings", label: "GST Filings", icon: FileText },
  { value: "fees", label: "Fees", icon: IndianRupee },
  { value: "tasks", label: "Tasks", icon: ListChecks },
  { value: "documents", label: "Documents", icon: FileText },
];

const STATUS_OPTIONS = {
  filings: ["Pending", "Filed"],
  fees: ["Pending", "Partial", "Paid", "Overdue"],
  tasks: ["Pending", "Done", "Overdue"],
};

const RETURN_TYPES = ["GSTR-1", "GSTR-3B", "GSTR-9", "GSTR-9C", "CMP-08"];

const GROUP_LABELS = {
  client: "Client",
  status: "Status",
  return_type: "Return Type",
  month: "Month",
};

const GROUP_OPTIONS = {
  clients: ["client", "month"],
  filings: ["client", "status", "return_type", "month"],
  fees: ["client", "status", "month"],
  tasks: ["client", "status", "month"],
  documents: ["client", "month"],
};

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

function sectionFilters(section, source = {}) {
  const merged = { ...EMPTY_FILTERS, ...source };
  if (section === "summary" || !DATE_FIELDS[section]) {
    return { ...EMPTY_FILTERS };
  }
  return {
    client_id: merged.client_id,
    status: STATUS_OPTIONS[section]?.includes(merged.status) ? merged.status : "",
    return_type: section === "filings" ? merged.return_type : "",
    from_date: merged.from_date,
    to_date: merged.to_date,
    group_by: GROUP_OPTIONS[section]?.includes(merged.group_by) ? merged.group_by : "",
  };
}

export default function Reports() {
  const [clients, setClients] = useState([]);
  const [section, setSection] = useState("summary");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [detail, setDetail] = useState(null);
  const didLoadInitialSummary = useRef(false);

  useEffect(() => {
    api.get("/api/clients/")
      .then((r) => setClients(r.data || []))
      .catch(async (err) => {
        setClients([]);
        setError(await apiErrorMessage(err, "Unable to load clients."));
      });
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await api.get("/api/reports/templates");
      setTemplates(r.data || []);
    } catch (err) {
      setTemplates([]);
      setNotice({
        type: "error",
        text: await apiErrorMessage(err, "Unable to load report templates."),
      });
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const buildParams = useCallback((fmt = "json", overrideSection = section, overrideFilters = filters) => {
    const params = new URLSearchParams();
    const active = sectionFilters(overrideSection, overrideFilters);

    if (overrideSection !== "summary") params.set("section", overrideSection);
    Object.entries(active).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    if ((active.from_date || active.to_date) && DATE_FIELDS[overrideSection]) {
      params.set("date_field", DATE_FIELDS[overrideSection]);
    }
    params.set("format", fmt);
    return params;
  }, [section, filters]);

  const loadReports = useCallback(async (announce = false, overrideSection = section, overrideFilters = filters) => {
    setLoading(true);
    setError("");
    try {
      const r = await api.get(`/api/reports?${buildParams("json", overrideSection, overrideFilters).toString()}`);
      setData(r.data);
      if (announce) setNotice({ type: "success", text: "Report generated." });
    } catch (err) {
      setData(null);
      setError(await apiErrorMessage(err, "Unable to generate the report."));
      if (announce) setNotice({ type: "error", text: await apiErrorMessage(err, "Unable to generate the report.") });
    } finally {
      setLoading(false);
    }
  }, [buildParams, section, filters]);

  useEffect(() => {
    if (didLoadInitialSummary.current) return;
    didLoadInitialSummary.current = true;
    loadReports();
  }, [loadReports]);

  const changeSection = (nextSection) => {
    setSection(nextSection);
    setFilters(EMPTY_FILTERS);
    setSelectedColumns([]);
    setSelectedTemplate("");
    setTemplateName("");
    setError("");
    setNotice(null);
    loadReports(false, nextSection, EMPTY_FILTERS);
  };

  const downloadReport = async () => {
    setDownloading(true);
    setError("");
    try {
      const r = await api.get(`/api/reports?${buildParams("csv").toString()}`, {
        responseType: "blob",
      });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `report-${section}.csv`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(await apiErrorMessage(err, "Unable to download the report."));
    } finally {
      setDownloading(false);
    }
  };

  const printReport = () => {
    if (!data) return;
    window.print();
  };

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setNotice({ type: "error", text: "Enter a name for the template." });
      return;
    }

    const wasEditing = Boolean(selectedTemplate);
    setError("");
    setNotice(null);
    const payload = {
      name,
      section,
      config: {
        filters: sectionFilters(section, filters),
        columns: selectedColumns,
      },
    };

    try {
      const r = wasEditing
        ? await api.put(`/api/reports/templates/${selectedTemplate}`, payload)
        : await api.post("/api/reports/templates", payload);
      await loadTemplates();
      setTemplateName("");
      setSelectedTemplate(String(r.data.id));
      setNotice({
        type: "success",
        text: wasEditing ? "Template updated." : "Template saved.",
      });
    } catch (err) {
      setNotice({
        type: "error",
        text: await apiErrorMessage(err, "That template name is already in use."),
      });
    }
  };

  const applyTemplate = (id) => {
    setSelectedTemplate(id);
    const template = templates.find((item) => String(item.id) === id);
    if (!template) {
      setTemplateName("");
      return;
    }

    const nextSection = SECTIONS.some((item) => item.value === template.section)
      ? template.section
      : "summary";
    const columns = Array.isArray(template.config?.columns)
      ? template.config.columns.filter((name) => typeof name === "string")
      : [];

    const nextFilters = sectionFilters(nextSection, template.config?.filters);
    setSection(nextSection);
    setFilters(nextFilters);
    setSelectedColumns(columns);
    setTemplateName(template.name);
    setError("");
    setNotice(null);
    loadReports(false, nextSection, nextFilters);
  };

  const deleteTemplate = async () => {
    if (!selectedTemplate) return;
    setError("");
    setNotice(null);
    try {
      await api.delete(`/api/reports/templates/${selectedTemplate}`);
      setSelectedTemplate("");
      setTemplateName("");
      await loadTemplates();
      setNotice({ type: "success", text: "Template deleted." });
    } catch (err) {
      setNotice({
        type: "error",
        text: await apiErrorMessage(err, "Could not delete the template."),
      });
    }
  };

  const reportRows = data?.rows;
  const reportGroups = data?.groups;

  const tableRows = useMemo(() => {
    if (section === "summary") return [];
    if (!reportGroups) return reportRows || [];
    return Object.entries(reportGroups).flatMap(([key, items]) =>
      (items || []).map((item) => ({ ...item, [filters.group_by || "group"]: key }))
    );
  }, [section, reportRows, reportGroups, filters.group_by]);

  const fieldNames = useMemo(() => {
    if (section === "summary" || !tableRows.length) return [];
    return Object.keys(tableRows[0]);
  }, [section, tableRows]);

  useEffect(() => {
    if (!selectedColumns.length || !fieldNames.length) return;
    if (!selectedColumns.some((name) => fieldNames.includes(name))) {
      setSelectedColumns([]);
    }
  }, [fieldNames, selectedColumns]);

  const visibleFields = selectedColumns.length
    ? fieldNames.filter((name) => selectedColumns.includes(name))
    : fieldNames;

  const toggleColumn = (name) => {
    if (!selectedColumns.length) {
      setSelectedColumns(fieldNames.filter((field) => field !== name));
      return;
    }
    if (selectedColumns.includes(name) && selectedColumns.length === 1) return;
    setSelectedColumns((cols) =>
      cols.includes(name) ? cols.filter((col) => col !== name) : [...cols, name]
    );
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return value;
  };

  const openDetail = (row, index) => {
    setDetail({
      title: row.title || row.client_name || row.name || `Record ${index + 1}`,
      subtitle: SECTIONS.find((item) => item.value === section)?.label || "Report",
      rows: visibleFields.map((name) => [
        name.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
        formatValue(row[name]),
      ]),
    });
  };

  const statusOptions = STATUS_OPTIONS[section] || [];
  const groupOptions = GROUP_OPTIONS[section] || [];
  const busy = loading || downloading;
  const sectionLabel = SECTIONS.find((item) => item.value === section)?.label || "Report";
  const activeFilters = sectionFilters(section, filters);
  const filterSummary = [
    activeFilters.client_id && `Client: ${clients.find((c) => String(c.id) === String(activeFilters.client_id))?.client_name || "Selected client"}`,
    activeFilters.status && `Status: ${activeFilters.status}`,
    activeFilters.return_type && `Return type: ${activeFilters.return_type}`,
    activeFilters.from_date && `From: ${activeFilters.from_date}`,
    activeFilters.to_date && `To: ${activeFilters.to_date}`,
    activeFilters.group_by && `Grouped by: ${GROUP_LABELS[activeFilters.group_by]}`,
  ].filter(Boolean).join("  |  ") || "All records";
  const generatedLabel = data?.generated_at
    ? new Date(data.generated_at).toLocaleString("en-IN", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : new Date().toLocaleString("en-IN", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });

  const summaryCards = [
    { icon: <Users size={18} />, label: "Total clients", value: data?.clients?.total ?? 0, desc: "Registered client records" },
    { icon: <FileText size={18} />, label: "GST filings", value: data?.filings?.total ?? 0, desc: "All filing records" },
    { icon: <Clock size={18} />, label: "Pending filings", value: data?.filings?.pending ?? 0, desc: "Not yet filed" },
    { icon: <Clock size={18} />, label: "Overdue filings", value: data?.filings?.overdue ?? 0, desc: "Past due date" },
    { icon: <FileText size={18} />, label: "Documents", value: data?.documents ?? 0, desc: "Uploaded files" },
    { icon: <BarChart3 size={18} />, label: "Fees paid", value: data?.fees?.paid ?? 0, desc: "Paid fee records" },
  ];

  return (
    <div className="page reports-page">
      <p className="page-subtitle">Generate filtered reports for clients, filings, fees, tasks and documents.</p>

      {error && (
        <div className="report-error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          className={`report-notice ${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          {notice.type === "error" ? (
            <AlertCircle size={16} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={16} aria-hidden="true" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      <section className="panel report-panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title-with-icon"><Save size={17} /> Saved views</h2>
            <p>Reuse a saved filter and column setup.</p>
          </div>
          <button className="secondary-btn" onClick={deleteTemplate} disabled={!selectedTemplate || busy}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
        <div className="report-controls report-template-controls">
          <label className="report-field">
            <span>Saved templates</span>
            <select className="filter-select" value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Choose a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          </label>
          <label className="report-field report-field-grow">
            <span>{selectedTemplate ? "Template name" : "Save current view as"}</span>
            <input
              className="report-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. October GST filings"
            />
          </label>
          <div className="report-actions">
            <button className="primary-btn" onClick={saveTemplate} disabled={busy}>
              <Save size={16} /> {selectedTemplate ? "Update template" : "Save template"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel report-panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title-with-icon"><BarChart3 size={17} /> Report builder</h2>
            <p>Choose a section and narrow the records you want.</p>
          </div>
          <div className="report-actions">
            <button className="primary-btn" onClick={() => loadReports(true)} disabled={busy}>
              {loading ? (
                <>
                  <Loader2 size={16} className="report-spinner" /> Generating…
                </>
              ) : (
                <>
                  <BarChart3 size={16} /> Generate report
                </>
              )}
            </button>
            {section !== "summary" && (
              <button className="secondary-btn" onClick={downloadReport} disabled={busy}>
                <Download size={16} /> {downloading ? "Downloading…" : "Download CSV"}
              </button>
            )}
            <button className="secondary-btn" onClick={printReport} disabled={!data || busy}>
              <Printer size={16} /> Print custom
            </button>
          </div>
        </div>

        <div className="report-section-tabs">
          <span>Section</span>
          <div className="tabs">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.value} className={section === item.value ? "on" : ""} onClick={() => changeSection(item.value)}>
                  <Icon size={15} /> {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="report-controls">
          {section !== "summary" && (
            <>
              <label className="report-field">
                <span>Client</span>
                <select
                  className="filter-select"
                  value={filters.client_id}
                  onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}
                >
                  <option value="">All clients</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.client_name}</option>
                  ))}
                </select>
              </label>

              {statusOptions.length > 0 && (
                <label className="report-field">
                  <span>Status</span>
                  <select
                    className="filter-select"
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  >
                    <option value="">All</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
              )}

              {section === "filings" && (
                <label className="report-field">
                  <span>Return type</span>
                  <select
                    className="filter-select"
                    value={filters.return_type}
                    onChange={(e) => setFilters({ ...filters, return_type: e.target.value })}
                  >
                    <option value="">All</option>
                    {RETURN_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="report-field">
                <span>From date</span>
                <input
                  className="report-input"
                  type="date"
                  value={filters.from_date}
                  onChange={(e) => setFilters({ ...filters, from_date: e.target.value })}
                />
              </label>
              <label className="report-field">
                <span>To date</span>
                <input
                  className="report-input"
                  type="date"
                  value={filters.to_date}
                  onChange={(e) => setFilters({ ...filters, to_date: e.target.value })}
                />
              </label>
              <label className="report-field">
                <span>Group by</span>
                <select
                  className="filter-select"
                  value={filters.group_by}
                  onChange={(e) => setFilters({ ...filters, group_by: e.target.value })}
                >
                  <option value="">None</option>
                  {groupOptions.map((value) => (
                    <option key={value} value={value}>{GROUP_LABELS[value]}</option>
                  ))}
                </select>
              </label>

              {fieldNames.length > 0 && (
                <details className="report-columns">
                  <summary><SlidersHorizontal size={14} /> Columns</summary>
                  <div className="report-columns__list">
                    {fieldNames.map((name) => {
                      const isLastColumn =
                        fieldNames.length === 1 ||
                        (selectedColumns.length === 1 && selectedColumns[0] === name);
                      return (
                        <label key={name}>
                          <input
                            type="checkbox"
                            checked={selectedColumns.length === 0 || selectedColumns.includes(name)}
                            disabled={isLastColumn}
                            title={isLastColumn ? "At least one column must stay selected" : undefined}
                            onChange={() => toggleColumn(name)}
                          />
                          {name.replace(/_/g, " ")}
                        </label>
                      );
                    })}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </section>

      {section === "summary" && !loading && (
        <section className="stats-grid">
          {summaryCards.map((card) => (
            <article key={card.label} className="report-stat-card">
              <div className="report-stat-icon">{card.icon}</div>
              <div className="report-stat-value">{card.value}</div>
              <div className="report-stat-label">{card.label}</div>
              <div className="report-stat-desc">{card.desc}</div>
            </article>
          ))}
        </section>
      )}

      {loading && (
        <div className="report-loading" role="status">
          <Loader2 size={16} className="report-spinner" /> Generating report&hellip;
        </div>
      )}

      {section !== "summary" && data && !loading && (
        <div className="report-table">
          {tableRows.length === 0 ? (
            <div className="report-table__empty">No records matched the selected filters.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  {visibleFields.map((name) => (
                    <th key={name}>
                      {name.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, index) => (
                  <tr
                    key={index}
                    className="report-table__row clickable-row"
                    tabIndex={0}
                    role="button"
                    onClick={() => openDetail(row, index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDetail(row, index);
                      }
                    }}
                  >
                    {visibleFields.map((name) => (
                      <td key={name}>{formatValue(row[name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="report-table__count">
            {data.count ?? tableRows.length} record{(data.count ?? tableRows.length) !== 1 ? "s" : ""} found.
          </div>
        </div>
      )}

      {data && !loading && createPortal(
        <section className="report-print">
          <header className="report-print__header">
            <div className="report-print__brand">
              <div className="report-print__logo">G</div>
              <div>
                <strong>GST Office</strong>
                <span>Client management system</span>
              </div>
            </div>
            <div className="report-print__meta">
              Generated {generatedLabel}
              <br />
              {section === "summary"
                ? "Summary snapshot"
                : `${data.count ?? tableRows.length ?? 0} record${(data.count ?? tableRows.length ?? 0) === 1 ? "" : "s"}`}
            </div>
          </header>

          <div className="report-print__title">
            <h1>{sectionLabel} report</h1>
            <p>{filterSummary}</p>
          </div>

          {section === "summary" ? (
            <div className="report-print__summary">
              {summaryCards.map((card) => (
                <div className="report-print__summary-item" key={card.label}>
                  <span>{card.desc}</span>
                  <strong>{card.value}</strong>
                  <small>{card.label}</small>
                </div>
              ))}
            </div>
          ) : tableRows.length === 0 ? (
            <p className="report-print__empty">No records matched the selected filters.</p>
          ) : (
            <table className="report-print__table">
              <thead>
                <tr>
                  {visibleFields.map((name) => (
                    <th key={name}>{name.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, index) => (
                  <tr key={index}>
                    {visibleFields.map((name) => (
                      <td key={name}>{formatValue(row[name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <footer className="report-print__footer">
            <span>Confidential — generated for internal use.</span>
            <span>GST Office · {sectionLabel}</span>
          </footer>
        </section>,
        document.body
      )}

      <DetailCard detail={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

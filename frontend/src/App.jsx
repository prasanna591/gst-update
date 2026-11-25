import { useCallback, useEffect, useState } from "react";
import '@fontsource-variable/inter';
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import Auditors from "./Auditors";
import Filings from "./Filings";
import Fees from "./Fees";
import Invoices from "./Invoices";
import Tasks from "./Tasks";
import ImportantDates from "./ImportantDates";
import Dashboard from "./Dashboard";
import Documents from "./Documents";
import UsersPage from "./Users";
import SettingsPage from "./Settings";
import NotificationBell from "./NotificationBell";
import SyncStatus from "./SyncStatus";
import NavBadge from "./NavBadge";
import ClientDetail from "./ClientDetail";
import GlobalSearch from "./GlobalSearch";
import Services from "./Services";
import Reports from "./Reports";
import Calendar from "./Calendar";
import { useAuth } from "./authContext";
import { useConfirm } from "./confirmContext";
import {
  Users, Search, Plus, LayoutDashboard, FileText, CalendarDays, IndianRupee, ListChecks, Gift, ReceiptText,
  Settings, RefreshCw, X, Pencil, Eye, CheckCircle2, AlertCircle, UserCheck, LogOut, ShieldCheck, Menu,
  Briefcase, BarChart3, Trash2, Mail, Phone,
} from "lucide-react";
import api from "./api";
import "./App.css";

const emptyForm = {
  client_name: "", business_name: "", email: "", phone: "",
  address: "", gstin: "", pan: "", business_registration: "", notes: "",
  date_of_birth: "", is_active: true, auditor_id: "",
  referred_by: "", religion: "", service_ids: [],
};

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const askConfirm = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  const pageTitle = (() => {
    if (pathname === "/") return "Dashboard";
    if (pathname === "/calendar") return "Calendar";
    if (pathname === "/dates") return "Important dates";
    if (pathname === "/tasks") return "Tasks";
    if (pathname === "/clients") return "Clients";
    if (pathname.startsWith("/clients/")) return "Client details";
    if (pathname === "/auditors") return "Auditors";
    if (pathname === "/services") return "Services";
    if (pathname === "/filings") return "GST filings";
    if (pathname === "/fees") return "Fees";
    if (pathname === "/invoices") return "Invoices";
    if (pathname === "/documents") return "Documents";
    if (pathname === "/reports") return "Custom reports";
    if (pathname === "/settings") return "Settings";
    if (pathname === "/users") return "User management";
    return "Workspace";
  })();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    const onResize = () => { if (window.innerWidth > 760) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = "";
      window.dispatchEvent(new Event("app:close-search"));
    };
  }, [menuOpen]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [viewClient, setViewClient] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [statusFilter, setStatusFilter] = useState("all");
  const [auditors, setAuditors] = useState([]);
  const [services, setServices] = useState([]);
  const [auditorFilter, setAuditorFilter] = useState("all");
  const [pendingFilings, setPendingFilings] = useState(null);
  const [docCount, setDocCount] = useState(null);
  const [selectedClients, setSelectedClients] = useState([]);

  const notify = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/clients/");
      setClients(response.data);
    } catch {
      notify("error", "Unable to load clients. Check that the backend is running.");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadAuditors = useCallback(async () => {
    try {
      const response = await api.get("/api/auditors/");
      setAuditors(response.data);
    } catch {
      notify("error", "Unable to load auditors.");
    }
  }, [notify]);

  const loadServices = useCallback(async () => {
    try {
      const response = await api.get("/api/services/");
      setServices(response.data);
    } catch {
      notify("error", "Unable to load services.");
    }
  }, [notify]);

  function auditorName(id) {
    return auditors.find((a) => a.id === id)?.name || "—";
  }

  useEffect(() => {
    loadClients();
    loadAuditors();
    loadServices();
    api.get("/api/filings/").then((r) => setPendingFilings(r.data.filter((f) => f.status !== "Filed").length)).catch(() => {});
    api.get("/api/documents/").then((r) => setDocCount(r.data.length)).catch(() => {});
  }, [loadAuditors, loadClients, loadServices, pathname]);

  useEffect(() => {
    if (pathname === "/clients") {
      setSearch("");
      setStatusFilter("all");
      setAuditorFilter("all");
      setSelectedClients([]);
    }
  }, [pathname]);

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEditForm(client) {
    setViewClient(null);
    setEditingId(client.id);
    setForm({
      client_name: client.client_name || "",
      business_name: client.business_name || "",
      email: client.email || "",
      phone: client.phone || "",
      address: client.address || "",
      gstin: client.gstin || "",
      pan: client.pan || "",
      business_registration: client.business_registration || "",
      notes: client.notes || "",
      date_of_birth: client.date_of_birth || "",
      is_active: client.is_active !== false,
      auditor_id: client.auditor_id ? String(client.auditor_id) : "",
      referred_by: client.referred_by || "",
      religion: client.religion || "",
      service_ids: client.service_ids || [],
    });
    setShowForm(true);
  }

  function setField(key, value) {
    const upper = key === "gstin" || key === "pan";
    setForm({ ...form, [key]: upper ? value.toUpperCase() : value });
  }

  async function saveClient(event) {
    event.preventDefault();

    const missing = [];
    if (!form.client_name.trim()) missing.push("client name");
    if (!form.business_name.trim()) missing.push("business name");
    if (form.phone.trim().length < 7) missing.push("mobile number");
    if (!form.religion.trim()) missing.push("religion");
    if (!form.service_ids.length) missing.push("at least one service");
    if (missing.length) {
      return notify("error", `Please fill: ${missing.join(", ")}.`);
    }

    if (form.gstin.trim() && !GSTIN_RE.test(form.gstin.trim())) {
      return notify("error", "GSTIN must be 15 characters, for example 33ABCDE1234F1Z5.");
    }
    if (form.pan.trim() && !PAN_RE.test(form.pan.trim())) {
      return notify("error", "PAN must be 10 characters, for example ABCDE1234F.");
    }

    setSaving(true);
    try {
      const { is_active, auditor_id, service_ids, ...textFields } = form;
      const payload = {
        ...Object.fromEntries(
          Object.entries(textFields).map(([k, v]) => [k, v.trim() || null])
        ),
        is_active,
        auditor_id: auditor_id ? Number(auditor_id) : null,
        service_ids,
      };
      if (editingId) {
        await api.put(`/api/clients/${editingId}`, payload);
      } else {
        await api.post("/api/clients/", payload);
      }
      notify("success", editingId ? "Client updated." : "Client added.");
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
      await loadClients();
    } catch (err) {
      const detail = err.response?.data?.detail;
      notify(
        "error",
        typeof detail === "string"
          ? detail
          : "Could not save the client. Please check the details."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivateClient(client) {
    const ok = await askConfirm({
      title: "Deactivate client?",
      message: `${client.client_name} will be deactivated. Their history will be kept.`,
      confirmLabel: "Deactivate",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/clients/${client.id}`);
      notify("success", "Client deactivated.");
      await loadClients();
    } catch (err) {
      const detail = err.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not deactivate the client.");
    }
  }

  const q = search.toLowerCase();
  const filteredClients = clients.filter((c) => {
    const matchesSearch = [
      c.client_name, c.business_name, c.gstin, c.pan, c.phone, c.email,
      c.referred_by, c.religion, ...(c.service_names || []),
    ].some((v) => (v || "").toLowerCase().includes(q));
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? c.is_active : !c.is_active);
    const matchesAuditor =
      auditorFilter === "all" ||
      (auditorFilter === "none" ? !c.auditor_id : String(c.auditor_id) === auditorFilter);
    return matchesSearch && matchesStatus && matchesAuditor;
  });

  function toggleClientSelect(id) {
    setSelectedClients((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const allClientsSelected = filteredClients.length > 0 && filteredClients.every((c) => selectedClients.includes(c.id));
  function toggleAllClients() {
    setSelectedClients(allClientsSelected ? [] : filteredClients.map((c) => c.id));
  }

  async function bulkClientAction(active) {
    if (!selectedClients.length) return;
    if (!active) {
      const ok = await askConfirm({
        title: "Deactivate clients?",
        message: `${selectedClients.length} client${selectedClients.length === 1 ? "" : "s"} will be deactivated. Their history will be kept.`,
        confirmLabel: "Deactivate",
      });
      if (!ok) return;
    }
    try {
      await api.post("/api/clients/bulk/active", { ids: selectedClients, active });
      setSelectedClients([]);
      notify("success", `${selectedClients.length} client${selectedClients.length === 1 ? "" : "s"} ${active ? "activated" : "deactivated"}.`);
      await loadClients();
    } catch (err) {
      const detail = err.response?.data?.detail;
      notify("error", typeof detail === "string" ? detail : "Could not update the selected clients.");
    }
  }

  const activeCount = clients.filter((c) => c.is_active).length;


  const statCards = [
    { label: "Total clients", value: clients.length, note: "All registered clients", icon: Users, tone: "blue", card: "" },
    { label: "Active clients", value: activeCount, note: "Currently being served", icon: Users, tone: "green", card: "c-green" },
    { label: "Pending filings", value: pendingFilings ?? "—", note: "Returns not yet filed", icon: CalendarDays, tone: "violet", card: "c-violet" },
    { label: "Documents", value: docCount ?? "—", note: "Files stored for clients", icon: FileText, tone: "orange", card: "c-gold" },
  ];

  const detailRows = viewClient && [
    ["Business name", viewClient.business_name],
    ["Phone", viewClient.phone],
    ["Email", viewClient.email],
    ["GSTIN", viewClient.gstin],
    ["PAN", viewClient.pan],
    ["Religion", viewClient.religion],
    ["Referred by", viewClient.referred_by],
    ["Services", (viewClient.service_names || []).join(", ")],
    ["Date of birth", viewClient.date_of_birth],
    ["Auditor", auditorName(viewClient.auditor_id)],
    ["Business registration", viewClient.business_registration],
    ["Address", viewClient.address, true],
    ["Notes", viewClient.notes, true],
  ];

  if (!user) return null;

  return (
    <div className="app-shell">
      <div className="mobile-bar">
        <div className="brand">
          <div className="brand-icon">G</div>
          <div><strong>GST Office</strong><small>Client management</small></div>
        </div>
        <button
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-drawer"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20} />
        </button>
      </div>
      <div
        className={`drawer-backdrop ${menuOpen ? "show" : ""}`}
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`sidebar ${menuOpen ? "open" : ""}`} id="app-drawer">
        <button
          className="icon-btn sm drawer-close"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        >
          <X size={18} />
        </button>
        <div className="brand">
          <div className="brand-icon">G</div>
          <div><strong>GST Office</strong><small>Client management</small></div>
        </div>

        <p className="nav-heading">Workspace</p>
        <nav onClick={() => setMenuOpen(false)}>
          <NavLink className="nav-item" to="/" end><LayoutDashboard size={18} /> Dashboard</NavLink>
          <NavLink className="nav-item" to="/calendar"><CalendarDays size={18} /> Calendar</NavLink>
          <NavLink className="nav-item" to="/dates"><Gift size={18} /> Important dates</NavLink>
          <NavLink className="nav-item" to="/tasks"><ListChecks size={18} /> Tasks <NavBadge kind="tasks" /></NavLink>
          <NavLink className="nav-item" to="/clients"><Users size={18} /> Clients</NavLink>
          <NavLink className="nav-item" to="/auditors"><UserCheck size={18} /> Auditors</NavLink>
          <NavLink className="nav-item" to="/services"><Briefcase size={18} /> Services</NavLink>
          <NavLink className="nav-item" to="/filings"><CalendarDays size={18} /> GST filings</NavLink>
          <NavLink className="nav-item" to="/fees"><IndianRupee size={18} /> Fees <NavBadge kind="fees" /></NavLink>
          <NavLink className="nav-item" to="/invoices"><ReceiptText size={18} /> Invoices</NavLink>
          <NavLink className="nav-item" to="/documents"><FileText size={18} /> Documents</NavLink>
          <NavLink className="nav-item" to="/reports"><BarChart3 size={18} /> Reports</NavLink>
          <NavLink className="nav-item" to="/settings"><Settings size={18} /> Settings</NavLink>
          {user?.role === "Admin" && (
            <NavLink className="nav-item" to="/users"><ShieldCheck size={18} /> Users</NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="support-card">
            <strong>Customer care</strong>
            <span>PSM INNOVTION PRIVATE LIMITED</span>
            <a href="mailto:hello@problemsolvingmind.com"><Mail size={13} /> hello@problemsolvingmind.com</a>
            <a href="tel:9360207861"><Phone size={13} /> 9360207861</a>
          </div>
          <SyncStatus />
          <div className="user-card">
            <div className="user-avatar">
              {(user?.full_name || "?").charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <strong>{user?.full_name || "User"}</strong>
              <small className="user-email" title={user?.email || ""}>{user?.email || "No email"}</small>
              <span className="user-role">{user?.role || "Staff"}</span>
            </div>
            <button
              className="icon-btn sm logout-btn"
              title={`Sign out${user?.email ? ` (${user.email})` : ""}`}
              aria-label={`Sign out${user?.email ? ` (${user.email})` : ""}`}
              onClick={() => setLogoutConfirm(true)}
            >
              <LogOut size={15} />
              <span className="logout-label">Sign out</span>
            </button>
          </div>
        </div>
        </aside>

      <main className="main-content">
        <header className="topbar shell-topbar">
          <div>
            <span className="crumb">Workspace</span>
            <h1>{pageTitle}</h1>
          </div>
        <div className="topbar-actions">
          {pathname === "/clients" && (
            <button className="primary-btn" onClick={openAddForm}>
              <Plus size={18} /> Add client
            </button>
          )}
          <GlobalSearch />
          <NotificationBell />
        </div>
        </header>

        {pathname.startsWith("/clients/") ? (
          <ClientDetail />
        ) : pathname === "/auditors" ? (
        <Auditors />
      ) : pathname === "/services" ? (
        <Services />
      ) : pathname === "/filings" ? (
        <Filings />
      ) : pathname === "/fees" ? (
        <Fees />
      ) : pathname === "/invoices" ? (
        <Invoices />
      ) : pathname === "/tasks" ? (
        <Tasks />
      ) : pathname === "/calendar" ? (
        <Calendar />
      ) : pathname === "/dates" ? (
        <ImportantDates />
      ) : pathname === "/reports" ? (
        <Reports />
      ) : pathname === "/settings" ? (
        <SettingsPage />
      ) : pathname === "/users" && user?.role === "Admin" ? (
        <UsersPage />
      ) : pathname === "/documents" ? (
        <Documents />
      ) : pathname === "/" ? (
        <Dashboard />
      ) : pathname === "/clients" ? (
        <>
        <section className="stats-grid" id="dashboard">
          {statCards.map(({ label, value, note, icon: Icon, tone, card }) => (
            <article className={`stat-card ${card}`} key={label}>
              <div className="stat-top">
                <span>{label}</span>
                <div className={`stat-icon ${tone}`}><Icon /></div>
              </div>
              <strong>{loading && typeof value === "number" ? "…" : value}</strong>
              <small>{note}</small>
            </article>
          ))}
        </section>

        <section className="panel" id="clients">
          <div className="panel-heading">
            <div>
              <h2>All clients</h2>
              <p>Search by name, GSTIN, PAN, phone or email.</p>
            </div>
            <button className="icon-btn" onClick={loadClients} title="Refresh">
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="toolbar">
            <div className="search-box">
              <Search size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients..."
              />
            </div>
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              className="filter-select"
              value={auditorFilter}
              onChange={(e) => setAuditorFilter(e.target.value)}
            >
              <option value="all">All auditors</option>
              <option value="none">Not assigned</option>
              {auditors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {user?.role === "Admin" && selectedClients.length > 0 && (
              <div className="row-actions" style={{ marginLeft: "auto" }}>
                <button className="secondary-btn" onClick={() => bulkClientAction(true)}>Activate</button>
                <button className="secondary-btn danger" onClick={() => bulkClientAction(false)}>Deactivate</button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="table-wrap">
              {[0, 1, 2].map((i) => (
                <div className="skeleton-row" key={i}>
                  <div className="sk circle" />
                  <div className="sk" style={{ width: "22%" }} />
                  <div className="sk" style={{ width: "26%" }} />
                  <div className="sk" style={{ width: "16%" }} />
                </div>
              ))}
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Users size={26} /></div>
              <h3>{clients.length === 0 ? "No clients yet" : "No matching clients"}</h3>
              <p>
                {clients.length === 0
                  ? "Add your first client to start tracking GST work."
                  : "Try a different name, GSTIN, PAN or phone number."}
              </p>
              {clients.length === 0 && (
                <button className="primary-btn" onClick={openAddForm}>
                  <Plus size={18} /> Add client
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{user?.role === "Admin" && <input type="checkbox" checked={allClientsSelected} onChange={toggleAllClients} title="Select all" />}</th>
                      <th>Client</th><th>Business</th><th>Services</th><th>GSTIN</th>
                      <th>Phone</th><th>Email</th><th>Auditor</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="clickable-row" onClick={() => setViewClient(client)}>
                        <td onClick={(e) => e.stopPropagation()}>{user?.role === "Admin" && (
                          <input type="checkbox" checked={selectedClients.includes(client.id)} onChange={() => toggleClientSelect(client.id)} title="Select client" />
                        )}</td>
                        <td>
                          <div className="client-cell">
                            <div className={`avatar av-${client.id % 5}`}>
                              {(client.client_name || "?").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <Link className="name-link" to={`/clients/${client.id}`} onClick={(e) => e.stopPropagation()}>
                                <strong>{client.client_name}</strong>
                              </Link>
                              <small>ID: {client.id}</small>
                            </div>
                          </div>
                        </td>
                        <td>{client.business_name || "—"}</td>
                        <td>
                          {(client.service_names || []).length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <div className="chip-row">
                              {client.service_names.map((name) => (
                                <span className="chip chip-blue" key={name}>{name}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="mono">{client.gstin || "—"}</td>
                        <td className="mono">{client.phone || "—"}</td>
                        <td>{client.email || "—"}</td>
                        <td>{client.auditor_id ? auditorName(client.auditor_id) : <span className="muted">Not assigned</span>}</td>
                        <td>
                          <span className={`badge ${client.is_active ? "badge-active" : "badge-inactive"}`}>
                            {client.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions">
                            <button className="icon-btn sm" title="View" onClick={() => setViewClient(client)}>
                              <Eye size={15} />
                            </button>
                            <button className="icon-btn sm" title="Edit" onClick={() => openEditForm(client)}>
                              <Pencil size={15} />
                            </button>
                            {user?.role === "Admin" && client.is_active && (
                              <button className="icon-btn sm danger" title="Deactivate" onClick={() => deactivateClient(client)}>
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="table-footer">
                Showing {filteredClients.length} of {clients.length} clients
              </p>
            </>
          )}
        </section>
        </>
      ) : (
        <>
        <header className="topbar">
          <div>
            <span className="crumb">Workspace</span>
            <h1>Page not found</h1>
            <p>The page you requested does not exist.</p>
          </div>
          <Link className="primary-btn" to="/">Go to dashboard</Link>
        </header>
        </>
      )}

      {/* Add / Edit modal */}
      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{editingId ? "Edit client" : "Add new client"}</h2>
                <p>Enter the client's business details.</p>
              </div>
              <button className="icon-btn" onClick={() => setShowForm(false)} title="Close"><X /></button>
            </div>
            <form onSubmit={saveClient}>
              <div className="form-grid">
                {[
                  ["client_name", "Client name *", true],
                  ["business_name", "Business name *", true],
                  ["phone", "Mobile number *", true],
                  ["email", "Email"],
                  ["religion", "Religion *", true],
                  ["gstin", "GSTIN"],
                  ["pan", "PAN"],
                  ["business_registration", "Business registration"],
                ].map(([key, label, required]) => (
                  <label key={key}>
                    {label}
                    <input
                      required={Boolean(required)}
                      value={form[key]}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  Referred by
                  <input
                    list="referrer-options"
                    value={form.referred_by}
                    onChange={(e) => setField("referred_by", e.target.value)}
                  />
                  <datalist id="referrer-options">
                    {clients
                      .filter((c) => c.id !== editingId)
                      .map((c) => (
                        <option key={c.id} value={c.client_name || ""}>
                          {c.business_name
                            ? `${c.client_name} (${c.business_name})`
                            : c.client_name}
                        </option>
                      ))}
                  </datalist>
                  <small className="muted">Choose an existing client or type a name.</small>
                </label>
                <div className="full-width service-field">
                  <span>Services *</span>
                  <div className="service-picker">
                    {services.filter((s) => s.is_active).map((s) => (
                      <label key={s.id} className={`service-chip ${form.service_ids.includes(s.id) ? "on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={form.service_ids.includes(s.id)}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...form.service_ids, s.id]
                              : form.service_ids.filter((id) => id !== s.id);
                            setForm({ ...form, service_ids: ids });
                          }}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                  {services.length === 0 && (
                    <small className="muted">Add services first from the Services page.</small>
                  )}
                </div>
                <label>
  Date of birth
  <input
    type="date"
    value={form.date_of_birth}
    onChange={(e) => setField("date_of_birth", e.target.value)}
  />
</label>
<label>
  Status
  <select
    value={form.is_active ? "active" : "inactive"}
    onChange={(e) => setForm({ ...form, is_active: e.target.value === "active" })}
  >
    <option value="active">Active</option>
    <option value="inactive">Inactive</option>
  </select>
</label>
<label className="full-width">
  Responsible auditor
  <select
    value={form.auditor_id}
    onChange={(e) => setForm({ ...form, auditor_id: e.target.value })}
  >
    <option value="">Not assigned</option>
    {auditors
      .filter((a) => a.is_active)
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}{a.firm_name ? ` (${a.firm_name})` : ""}
        </option>
      ))}
  </select>
</label>
                <label className="full-width">
                  Address
                  <input value={form.address} onChange={(e) => setField("address", e.target.value)} />
                </label>
                <label className="full-width">
                  Notes
                  <textarea rows="3" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? "Saving..." : editingId ? "Update client" : "Save client"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* View modal */}
      {viewClient && (
        <div className="modal-backdrop" onClick={() => setViewClient(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <h2>Client details</h2>
              <button className="icon-btn" onClick={() => setViewClient(null)} title="Close"><X /></button>
            </div>
            <div className="detail-head">
              <div className={`avatar av-${viewClient.id % 5}`}>
                {(viewClient.client_name || "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <h3>{viewClient.client_name}</h3>
                <p>ID: {viewClient.id} · <span className={`badge ${viewClient.is_active ? "badge-active" : "badge-inactive"}`}>
                  {viewClient.is_active ? "Active" : "Inactive"}
                </span></p>
              </div>
            </div>
            <dl className="detail-grid">
              {detailRows.map(([label, value, wide]) => (
                <div key={label} className={wide ? "wide" : ""}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="modal-actions">
              <button
                className="secondary-btn"
                onClick={() => { const id = viewClient.id; setViewClient(null); navigate(`/clients/${id}`); }}
              >
                Full history
              </button>
              <button className="secondary-btn" onClick={() => setViewClient(null)}>Close</button>
              <button className="primary-btn" onClick={() => openEditForm(viewClient)}>
                <Pencil size={16} /> Edit client
              </button>
            </div>
          </section>
        </div>
      )}

      </main>

      {logoutConfirm && (
        <div className="modal-backdrop" onClick={() => setLogoutConfirm(false)}>
          <section className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <h2><AlertCircle size={18} /> Sign out?</h2>
              <button className="icon-btn" onClick={() => setLogoutConfirm(false)} title="Close"><X /></button>
            </div>
            <p className="settings-hint">You will need to sign in again to continue using GST Office.</p>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setLogoutConfirm(false)}>Cancel</button>
              <button className="primary-btn danger-btn" onClick={() => { setLogoutConfirm(false); logout(); }}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </section>
        </div>
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

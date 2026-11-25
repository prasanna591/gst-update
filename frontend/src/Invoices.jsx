import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, CalendarClock, CheckCircle2, IndianRupee, Mail, Plus, Printer, ReceiptText, Search, X,
} from "lucide-react";
import api, { apiErrorMessage } from "./api";
import DetailCard from "./DetailCard";

const STATUSES = ["All", "Issued", "Paid", "Cancelled", "Draft"];
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmt = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [fees, setFees] = useState([]);
  const [tab, setTab] = useState("All");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [selectedFee, setSelectedFee] = useState("");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const frameRef = useRef(null);

  const notify = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    const [i, c, f] = await Promise.all([
      api.get("/api/invoices/"),
      api.get("/api/clients/"),
      api.get("/api/fees/"),
    ]);
    setInvoices(i.data);
    setClients(c.data);
    setFees(f.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const reload = () => {
      load().catch((err) => {
        apiErrorMessage(err, "Could not load invoices.").then((message) => notify("error", message));
        setLoading(false);
      });
    };
    reload();
    window.addEventListener("gst:data-changed", reload);
    return () => window.removeEventListener("gst:data-changed", reload);
  }, [load]);

  const counts = STATUSES.reduce((acc, status) => {
    acc[status] = status === "All" ? invoices.length : invoices.filter((i) => i.status === status).length;
    return acc;
  }, {});
  const total = invoices.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const paid = invoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthly = invoices.filter((i) => (i.issued_date || "").startsWith(thisMonth));

  const cards = [
    { label: "Total invoices", value: invoices.length, note: `${counts.Issued} issued, ${counts.Draft} draft`, icon: ReceiptText, tone: "blue", card: "" },
    { label: "Invoiced amount", value: inr(total), note: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} raised`, icon: IndianRupee, tone: "violet", card: "c-violet" },
    { label: "Realised", value: inr(paid), note: `${counts.Paid} payment${counts.Paid === 1 ? "" : "s"} received`, icon: CheckCircle2, tone: "green", card: "c-green" },
    { label: "This month", value: monthly.length, note: inr(monthly.reduce((s, i) => s + Number(i.amount || 0), 0)), icon: CalendarClock, tone: "orange", card: "c-gold" },
  ];

  const q = search.toLowerCase().trim();
  const shown = invoices
    .filter((i) => tab === "All" || i.status === tab)
    .filter((i) => !clientFilter || String(i.client_id) === clientFilter)
    .filter((i) => !q || [i.invoice_no, i.client_name, i.business_name, i.purpose].some((v) => (v || "").toLowerCase().includes(q)));

  const generatableFees = fees.filter((f) => f.status === "Paid" && !f.invoice_id);

  async function viewInvoice(invoice) {
    try {
      const r = await api.get(`/api/invoices/${invoice.id}/html`, { responseType: "text" });
      setPreview({ invoice, html: r.data });
    } catch (err) {
      notify("error", await apiErrorMessage(err, "Could not open the invoice."));
    }
  }

  async function emailInvoice(invoice) {
    try {
      const r = await api.post(`/api/invoices/${invoice.id}/email`);
      notify("success", `Invoice sent to ${r.data.to || invoice.email || "the client"}.`);
    } catch (err) {
      notify("error", await apiErrorMessage(err, "Could not email the invoice."));
    }
  }

  async function markPaid(invoice) {
    try {
      await api.patch(`/api/invoices/${invoice.id}`, { status: "Paid" });
      setDetail(null);
      await load();
      notify("success", `${invoice.invoice_no} marked as paid.`);
    } catch (err) {
      notify("error", await apiErrorMessage(err, "Could not update the invoice."));
    }
  }

  async function generateInvoice() {
    if (!selectedFee) return;
    try {
      const r = await api.post(`/api/fees/${selectedFee}/invoice`);
      setGenerating(false);
      setSelectedFee("");
      await load();
      notify("success", `Invoice ${r.data.invoice_no} generated.`);
    } catch (err) {
      notify("error", await apiErrorMessage(err, "Could not generate the invoice."));
    }
  }

  function printPreview() {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function statusClass(status) {
    if (status === "Paid") return "badge badge-active";
    if (status === "Issued") return "badge badge-pending";
    return "badge badge-inactive";
  }

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button className="primary-btn" onClick={() => { setSelectedFee(generatableFees[0] ? String(generatableFees[0].id) : ""); setGenerating(true); }}>
          <Plus size={18} /> Generate invoice
        </button>
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
            {STATUSES.map((status) => (
              <button key={status} className={tab === status ? "on" : ""} onClick={() => setTab(status)}>
                {status} ({counts[status]})
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, client or purpose..." />
          </div>
          <select className="filter-select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} title="Filter by client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name}</option>)}
          </select>
        </div>

        {!loading && shown.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><ReceiptText size={26} /></div>
            <h3>{invoices.length === 0 ? "No invoices yet" : "Nothing here"}</h3>
            <p>{invoices.length === 0 ? "Mark a fee as paid to generate the first invoice." : "Try another tab or search."}</p>
            {invoices.length === 0 && generatableFees.length > 0 && (
              <button className="primary-btn" onClick={() => setGenerating(true)}><Plus size={18} /> Generate invoice</button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Invoice</th><th>Client</th><th>Purpose</th><th>Amount</th><th>Issued</th><th>Due</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr
                    key={i.id}
                    className="clickable-row"
                    onClick={() => setDetail({
                      invoice: i,
                      title: i.invoice_no,
                      subtitle: i.client_name || "—",
                      rows: [
                        ["Client", i.client_name],
                        ["Business", i.business_name],
                        ["Purpose", i.purpose],
                        ["Amount", inr(i.amount)],
                        ["Issued", fmt(i.issued_date)],
                        ["Due", fmt(i.due_date)],
                        ["Status", i.status],
                        ["Fee ID", i.fee_id],
                      ],
                      note: i.notes,
                    })}
                  >
                    <td><strong>{i.invoice_no}</strong></td>
                    <td>
                      <div className="person">
                        <div className={`avatar av-${i.client_id % 5}`}>{(i.client_name || "?").charAt(0).toUpperCase()}</div>
                        <strong>{i.client_name || "—"}</strong>
                      </div>
                    </td>
                    <td>{i.purpose}</td>
                    <td className="money">{inr(i.amount)}</td>
                    <td>{fmt(i.issued_date)}</td>
                    <td>{fmt(i.due_date)}</td>
                    <td><span className={statusClass(i.status)}>{i.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="icon-btn sm" title="View / print invoice" onClick={() => viewInvoice(i)}><ReceiptText size={15} /></button>
                        <button className="icon-btn sm" title={i.email ? `Email to ${i.email}` : "Client has no email"} disabled={!i.email} onClick={() => emailInvoice(i)}><Mail size={15} /></button>
                        {i.status !== "Paid" && <button className="icon-btn sm" title="Mark as paid" onClick={() => markPaid(i)}><CheckCircle2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > 0 && <p className="table-footer">Showing {shown.length} of {invoices.length} invoices</p>}
      </section>

      {generating && (
        <div className="modal-backdrop" onClick={() => setGenerating(false)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Generate invoice</h2>
                <p>Choose a paid fee that does not have an invoice yet.</p>
              </div>
              <button className="icon-btn" onClick={() => setGenerating(false)} aria-label="Close"><X /></button>
            </div>
            {generatableFees.length === 0 ? (
              <p className="empty-state-inline">All paid fees already have invoices.</p>
            ) : (
              <div className="form-grid">
                <label className="full-width">Paid fee *
                  <select value={selectedFee} onChange={(e) => setSelectedFee(e.target.value)}>
                    <option value="">Select a paid fee</option>
                    {generatableFees.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.client_name} — {f.purpose} ({inr(f.amount)})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setGenerating(false)}>Cancel</button>
              <button className="primary-btn" disabled={!selectedFee} onClick={generateInvoice}>Generate</button>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section className="modal invoice-preview" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{preview.invoice.invoice_no}</h2>
                <p>Print the invoice or save it as a PDF from your browser.</p>
              </div>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Close preview"><X /></button>
            </div>
            <iframe ref={frameRef} srcDoc={preview.html} className="preview-frame" title="Invoice preview" />
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setPreview(null)}>Close</button>
              <button className="secondary-btn" disabled={!preview.invoice.email} onClick={() => emailInvoice(preview.invoice)}><Mail size={16} /> Email</button>
              <button className="primary-btn" onClick={printPreview}><Printer size={16} /> Print / save as PDF</button>
            </div>
          </section>
        </div>
      )}

      <DetailCard
        detail={detail}
        onClose={() => setDetail(null)}
        actions={
          detail ? (
            <>
              <button className="secondary-btn" onClick={() => { viewInvoice(detail.invoice); setDetail(null); }}>
                <ReceiptText size={16} /> View
              </button>
              {detail.invoice.status !== "Paid" && <button className="primary-btn" onClick={() => markPaid(detail.invoice)}><CheckCircle2 size={16} /> Mark paid</button>}
            </>
          ) : null
        }
      />

      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

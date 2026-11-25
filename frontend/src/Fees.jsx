import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus, Pencil, Trash2, X, IndianRupee, AlertTriangle, CalendarClock, CheckCircle2, Search,
  ReceiptText, Mail, Printer, Wallet, ListChecks, Bell, History, Send, FileText, ArrowRight, Undo2,
} from "lucide-react";
import api from "./api";

const STAGES = ["New", "Contacted", "In progress", "Awaiting payment", "Completed"];
const empty = {
  client_id: "", purpose: "", amount: "", due_date: "", expected_date: "", reference_person: "",
  notes: "", upfront_amount: "0", process_stage: "New", next_followup_date: "", followup_note: "",
};
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const todayStr = () => new Date().toLocaleDateString("en-CA");
const fmt = (s) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
const daysFrom = (s) => Math.round((new Date(s + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 86400000);
const addDays = (s, n) => {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

function dueText(f) {
  if (f.status === "Paid") return { text: f.paid_date ? `Paid on ${fmt(f.paid_date)}` : "Paid", cls: "" };
  const d = daysFrom(f.due_date);
  let result;
  if (d < 0) result = { text: `${-d} day${d === -1 ? "" : "s"} overdue`, cls: "late" };
  else if (d === 0) result = { text: "Due today", cls: "soon" };
  else if (d <= 7) result = { text: `Due in ${d} day${d === 1 ? "" : "s"}`, cls: "soon" };
  else result = { text: `Due in ${d} days`, cls: "" };
  if (f.status === "Partial") return { ...result, text: `Partial · ${result.text}` };
  return result;
}

function followupText(f) {
  if (!f.next_followup_date) return { text: "Not scheduled", cls: "" };
  const d = daysFrom(f.next_followup_date);
  if (d < 0) return { text: `${-d} day${d === -1 ? "" : "s"} overdue`, cls: "late" };
  if (d === 0) return { text: "Follow up today", cls: "soon" };
  return { text: fmt(f.next_followup_date), cls: "" };
}

export default function Fees() {
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const [fees, setFees] = useState([]);
  const [clients, setClients] = useState([]);
  const [tab, setTab] = useState(
    ["Pending", "Partial", "Upfront", "Overdue", "Follow-ups", "Paid", "All"].includes(requestedStatus) ? requestedStatus : "Pending"
  );
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [undo, setUndo] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoiceNotice, setInvoiceNotice] = useState(null);
  const [selected, setSelected] = useState([]);
  const [feeDetail, setFeeDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("Overview");
  const [paymentFee, setPaymentFee] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const [paymentError, setPaymentError] = useState("");
  const [extendFee, setExtendFee] = useState(null);
  const [extendForm, setExtendForm] = useState(null);
  const [extendError, setExtendError] = useState("");
  const [planFee, setPlanFee] = useState(null);
  const [planForm, setPlanForm] = useState(null);
  const [planError, setPlanError] = useState("");
  const [followupFee, setFollowupFee] = useState(null);
  const [followupForm, setFollowupForm] = useState(null);
  const [followupError, setFollowupError] = useState("");
  const [reminderFee, setReminderFee] = useState(null);
  const [reminderForm, setReminderForm] = useState(null);
  const [reminderError, setReminderError] = useState("");
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  async function load() {
    const [f, c] = await Promise.all([api.get("/api/fees/"), api.get("/api/clients/")]);
    setFees(f.data); setClients(c.data); setLoading(false);
  }
  useEffect(() => {
    const reload = () => {
      load().catch(() => { setError("Could not load fees."); setLoading(false); });
    };
    reload();
    window.addEventListener("gst:data-changed", reload);
    return () => window.removeEventListener("gst:data-changed", reload);
  }, []);
  function notify(next, undoAction = null) {
    setNotice(next);
    setUndo(undoAction ? { action: undoAction } : null);
  }

  function askConfirm(dialog) {
    setConfirmChecked(false);
    setConfirmDialog(dialog);
  }

  async function runConfirmed() {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    if (action) await action();
  }

  async function handleUndo() {
    const action = undo?.action;
    setUndo(null);
    setNotice(null);
    if (action) await action();
  }

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), 3000);
    return () => clearTimeout(timer);
  }, [undo]);

  const pending = fees.filter((f) => f.status !== "Paid");
  const partial = fees.filter((f) => f.status === "Partial");
  const paid = fees.filter((f) => f.status === "Paid");
  const overdue = pending.filter((f) => daysFrom(f.due_date) < 0);
  const soon = pending.filter((f) => { const d = daysFrom(f.due_date); return d >= 0 && d <= 7; });
  const upfrontPending = pending.filter((f) => Number(f.upfront_amount || 0) > 0 && f.upfront_status === "Pending");
  const followups = pending.filter((f) => Boolean(f.next_followup_date));
  const followupsDue = followups.filter((f) => daysFrom(f.next_followup_date) <= 0);
  const balance = (f) => f.balance ?? Math.max(Number(f.amount || 0) - Number(f.paid_amount || 0), 0);
  const sumBalance = (list) => list.reduce((s, f) => s + balance(f), 0);
  const sumPaid = (list) => list.reduce((s, f) => s + Number(f.paid_amount || 0), 0);

  const q = search.toLowerCase();
  const shown = fees
    .filter((f) => {
      if (tab === "All") return true;
      if (tab === "Overdue") return f.status !== "Paid" && daysFrom(f.due_date) < 0;
      if (tab === "Upfront") return upfrontPending.some((x) => x.id === f.id);
      if (tab === "Follow-ups") return Boolean(f.next_followup_date);
      return f.status === tab;
    })
    .filter((f) => [f.client_name, f.purpose, f.reference_person, f.process_stage].some((v) => (v || "").toLowerCase().includes(q)));

  const cards = [
    { label: "Pending amount", value: inr(sumBalance(pending)), note: `${pending.length} fee${pending.length === 1 ? "" : "s"} to collect`, icon: IndianRupee, tone: "blue", card: "" },
    { label: "Partial payments", value: partial.length, note: partial.length ? inr(sumBalance(partial)) + " still due" : "No split payments", icon: Wallet, tone: "violet", card: "c-violet" },
    { label: "Overdue", value: overdue.length, note: overdue.length ? inr(sumBalance(overdue)) + " past due date" : "Nothing overdue", icon: AlertTriangle, tone: "orange", card: "c-gold", red: overdue.length > 0 },
    { label: "Due this week", value: soon.length, note: soon.length ? inr(sumBalance(soon)) + " to collect" : "Nothing due soon", icon: CalendarClock, tone: "violet", card: "c-violet" },
    { label: "Upfront pending", value: upfrontPending.length, note: upfrontPending.length ? inr(sumBalance(upfrontPending)) + " to collect" : "No advance due", icon: ArrowRight, tone: "violet", card: "c-violet" },
    { label: "Follow-ups due", value: followupsDue.length, note: `${followups.length} scheduled`, icon: Bell, tone: "orange", card: "c-gold", red: followupsDue.length > 0 },
    { label: "Collected", value: inr(sumPaid(fees)), note: `${paid.length} fee${paid.length === 1 ? "" : "s"} fully paid`, icon: CheckCircle2, tone: "green", card: "c-green" },
  ];

  async function refreshDetails(id) {
    try {
      const r = await api.get(`/api/fees/${id}/details`);
      setFeeDetail(r.data);
    } catch {
      notify({ type: "error", text: "Could not refresh the fee details." });
    }
  }

  function openNew() { setEditId(null); setForm({ ...empty }); setError(""); }
  function openEdit(f) {
    setEditId(f.id); setError("");
    setForm({
      client_id: String(f.client_id), purpose: f.purpose, amount: String(f.amount), due_date: f.due_date,
      expected_date: f.expected_date || "", reference_person: f.reference_person || "", notes: f.notes || "",
      upfront_amount: String(f.upfront_amount || 0), process_stage: f.process_stage || "New",
      next_followup_date: f.next_followup_date || "", followup_note: f.followup_note || "",
    });
  }

  async function save(e) {
    e.preventDefault(); setError("");
    const body = {
      client_id: Number(form.client_id), purpose: form.purpose.trim(), amount: Number(form.amount),
      due_date: form.due_date, expected_date: form.expected_date || null,
      reference_person: form.reference_person.trim() || null, notes: form.notes.trim() || null,
      upfront_amount: Number(form.upfront_amount || 0), process_stage: form.process_stage,
      next_followup_date: form.next_followup_date || null, followup_note: form.followup_note.trim() || null,
    };
    try {
      if (editId) await api.put(`/api/fees/${editId}`, body); else await api.post("/api/fees/", body);
      setForm(null); await load();
      notify({ type: "success", text: editId ? "Fee updated." : "Fee added. Track payments and follow-ups from this tab." });
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Please check the details.");
    }
  }

  async function applyPaidState(f, markPaid) {
    const r = await api.patch(`/api/fees/${f.id}/paid`, { paid: markPaid });
    await load();
    if (feeDetail?.fee.id === f.id) await refreshDetails(f.id);
    return r;
  }

  function toggle(f) {
    const markPaid = f.status !== "Paid";
    askConfirm({
      title: markPaid ? "Mark this fee as paid?" : "Reopen this fee?",
      message: markPaid
        ? `${f.client_name} · ${f.purpose} · ${inr(f.amount)}. This records the full balance and generates an invoice.`
        : `${f.client_name} · ${f.purpose}. All recorded payments for this fee will be removed.`,
      confirmLabel: markPaid ? "Yes, mark paid" : "Yes, reopen fee",
      checkLabel: markPaid ? "I confirm the full payment has been received." : "I confirm this fee should be reopened.",
      tone: markPaid ? "primary" : "danger",
      onConfirm: async () => {
        try {
          const r = await applyPaidState(f, markPaid);
          notify(
            { type: "success", text: markPaid ? "Fee marked paid. Undo is available for 3 seconds." : "Fee reopened. Undo is available for 3 seconds." },
            async () => {
              await applyPaidState(f, !markPaid);
              notify({ type: "success", text: markPaid ? "Mark paid undone." : "Reopen undone." });
            }
          );
          if (markPaid && r.data.invoice_id) {
            setInvoiceNotice({
              invoiceId: r.data.invoice_id,
              invoiceNo: r.data.invoice_no,
              clientName: f.client_name,
              email: clients.find((c) => c.id === f.client_id)?.email || "",
              message: `Payment received. Invoice ${r.data.invoice_no} has been generated.`,
            });
          }
        } catch (err) {
          const d = err.response?.data?.detail;
          notify({ type: "error", text: typeof d === "string" ? d : "Could not update the payment." });
        }
      },
    });
  }

  async function openPayment(f) {
    setPaymentError("");
    setPaymentFee({ ...f, payments: [] });
    setPaymentForm({
      amount: String(balance(f)), payment_date: todayStr(), method: "Cash", reference: "", notes: "",
    });
    try {
      const r = await api.get(`/api/fees/${f.id}/payments`);
      setPaymentFee({ ...f, payments: r.data });
    } catch {
      setPaymentError("Could not load payment history.");
    }
  }

  async function savePayment(e) {
    e.preventDefault();
    setPaymentError("");
    try {
      const r = await api.post(`/api/fees/${paymentFee.id}/payments`, {
        amount: Number(paymentForm.amount),
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        reference: paymentForm.reference.trim() || null,
        notes: paymentForm.notes.trim() || null,
      });
      setPaymentFee(null);
      await load();
      if (feeDetail?.fee.id === r.data.details.fee.id) setFeeDetail(r.data.details);
      notify({ type: "success", text: `Payment recorded. Fee is now ${r.data.fee.status}.` });
      if (r.data.invoice_id) {
        setInvoiceNotice({
          invoiceId: r.data.invoice_id,
          invoiceNo: r.data.invoice_no,
          clientName: paymentFee.client_name,
          email: clients.find((c) => c.id === paymentFee.client_id)?.email || "",
          message: `Full amount received. Invoice ${r.data.invoice_no} has been generated.`,
        });
      }
    } catch (err) {
      const d = err.response?.data?.detail;
      setPaymentError(typeof d === "string" ? d : "Could not record the payment.");
    }
  }

  function removePayment(payment) {
    const feeId = paymentFee.id;
    askConfirm({
      title: "Delete this payment?",
      message: `${inr(payment.amount)} received on ${fmt(payment.payment_date)} by ${payment.method}. This changes the fee status and balance.`,
      confirmLabel: "Delete payment",
      checkLabel: "I confirm this payment should be deleted.",
      tone: "danger",
      onConfirm: async () => {
        try {
          const r = await api.delete(`/api/fees/${feeId}/payments/${payment.id}`);
          const deleted = r.data.deleted_payment;
          await load();
          if (feeDetail?.fee.id === feeId) await refreshDetails(feeId);
          const history = await api.get(`/api/fees/${feeId}/payments`);
          setPaymentFee((current) => ({ ...current, payments: history.data }));
          notify(
            { type: "success", text: "Payment deleted. Undo is available for 3 seconds." },
            async () => {
              try {
                await api.post(`/api/fees/${feeId}/payments`, {
                  amount: deleted.amount,
                  payment_date: deleted.payment_date,
                  method: deleted.method,
                  reference: deleted.reference || null,
                  notes: deleted.notes || null,
                });
                await load();
                if (feeDetail?.fee.id === feeId) await refreshDetails(feeId);
                const restored = await api.get(`/api/fees/${feeId}/payments`);
                setPaymentFee((current) => ({ ...current, payments: restored.data }));
                notify({ type: "success", text: "Payment restored." });
              } catch {
                notify({ type: "error", text: "Could not restore the payment." });
              }
            }
          );
        } catch {
          setPaymentError("Could not delete the payment.");
        }
      },
    });
  }

  function openExtend(f) {
    setExtendError("");
    setExtendFee(f);
    setExtendForm({
      due_date: addDays(f.due_date, 7),
      expected_date: f.expected_date || "",
      reason: "",
      postpone_tasks: true,
    });
  }

  async function saveExtend(e) {
    e.preventDefault();
    setExtendError("");
    try {
      const r = await api.patch(`/api/fees/${extendFee.id}/extend`, {
        due_date: extendForm.due_date,
        expected_date: extendForm.expected_date || null,
        reason: extendForm.reason.trim() || null,
        postpone_tasks: extendForm.postpone_tasks,
      });
      setExtendFee(null);
      await load();
      if (feeDetail?.fee.id === extendFee.id) setFeeDetail(r.data.details);
      const parts = [`Due date extended by ${r.data.days_extended} day${r.data.days_extended === 1 ? "" : "s"}.`];
      if (r.data.tasks_postponed) parts.push(`${r.data.tasks_postponed} linked task${r.data.tasks_postponed === 1 ? "" : "s"} postponed.`);
      notify({ type: "success", text: parts.join(" ") });
    } catch (err) {
      const d = err.response?.data?.detail;
      setExtendError(typeof d === "string" ? d : "Could not extend the due date.");
    }
  }

  function buildPlan(f, count, interval, start) {
    const total = Math.round(balance(f) * 100);
    const parts = Math.max(1, Number(count || 1));
    const base = Math.floor(total / parts);
    return Array.from({ length: parts }, (_, i) => {
      const amount = i === parts - 1 ? (total - base * (parts - 1)) / 100 : base / 100;
      const day = new Date(start + "T00:00:00");
      day.setDate(day.getDate() + i * Number(interval || 7));
      return { amount, due_date: day.toLocaleDateString("en-CA"), notes: `Installment ${i + 1} of ${parts}` };
    }).filter((item) => item.amount > 0);
  }

  function openPlan(f) {
    setPlanError("");
    setPlanFee(f);
    const start = daysFrom(todayStr()) > daysFrom(f.due_date) ? todayStr() : f.due_date;
    setPlanForm({ count: 2, interval: 7, start });
  }

  async function savePlan(e) {
    e.preventDefault();
    setPlanError("");
    const plan = buildPlan(planFee, planForm.count, planForm.interval, planForm.start);
    try {
      const r = await api.post(`/api/fees/${planFee.id}/installments`, { installments: plan });
      setPlanFee(null);
      await load();
      if (feeDetail?.fee.id === planFee.id) setFeeDetail(r.data.details);
      notify({ type: "success", text: `Payment plan saved with ${plan.length} installments.` });
    } catch (err) {
      const d = err.response?.data?.detail;
      setPlanError(typeof d === "string" ? d : "Could not save the payment plan.");
    }
  }

  async function applyInstallment(feeId, item, paid) {
    const r = await api.patch(`/api/fees/${feeId}/installments/${item.id}`, {
      paid,
      payment_date: todayStr(),
      method: "Manual",
    });
    setFeeDetail(r.data.details);
    await load();
    return r;
  }

  function toggleInstallment(item) {
    if (!feeDetail) return;
    const feeId = feeDetail.fee.id;
    const markPaid = item.status !== "Paid";
    askConfirm({
      title: markPaid ? "Mark this installment paid?" : "Reopen this installment?",
      message: `${inr(item.amount)} due ${fmt(item.due_date)}${item.notes ? ` · ${item.notes}` : ""}.`,
      confirmLabel: markPaid ? "Yes, mark paid" : "Yes, reopen",
      checkLabel: markPaid ? "I confirm this installment has been received." : "I confirm this installment should be reopened.",
      tone: markPaid ? "primary" : "danger",
      onConfirm: async () => {
        try {
          await applyInstallment(feeId, item, markPaid);
          notify(
            { type: "success", text: markPaid ? "Installment marked paid. Undo is available for 3 seconds." : "Installment reopened. Undo is available for 3 seconds." },
            async () => {
              try {
                await applyInstallment(feeId, item, !markPaid);
                notify({ type: "success", text: "Installment change undone." });
              } catch {
                notify({ type: "error", text: "Could not undo the installment change." });
              }
            }
          );
        } catch (err) {
          const d = err.response?.data?.detail;
          notify({ type: "error", text: typeof d === "string" ? d : "Could not update the installment." });
        }
      },
    });
  }

  function openFollowup(f) {
    setFollowupError("");
    setFollowupFee(f);
    setFollowupForm({
      next_date: f.next_followup_date || addDays(todayStr(), 1),
      note: f.followup_note || "",
    });
  }

  async function saveFollowup(e) {
    e.preventDefault();
    setFollowupError("");
    try {
      const r = await api.post(`/api/fees/${followupFee.id}/followup`, {
        next_date: followupForm.next_date || null,
        note: followupForm.note.trim() || null,
      });
      setFollowupFee(null);
      await load();
      if (feeDetail?.fee.id === followupFee.id) setFeeDetail(r.data.details);
      notify({ type: "success", text: "Follow-up scheduled." });
    } catch (err) {
      const d = err.response?.data?.detail;
      setFollowupError(typeof d === "string" ? d : "Could not save the follow-up.");
    }
  }

  function openReminder(f) {
    setReminderError("");
    setReminderFee(f);
    setReminderForm({
      message: `Hello ${f.client_name || "there"}, a payment of ${inr(balance(f))} is pending toward ${f.purpose}. Please arrange it by ${fmt(f.due_date)}.`,
      send_email: Boolean(clients.find((c) => c.id === f.client_id)?.email),
      next_date: f.next_followup_date || addDays(todayStr(), 2),
    });
  }

  async function sendReminder(e) {
    e.preventDefault();
    setReminderError("");
    try {
      const r = await api.post(`/api/fees/${reminderFee.id}/remind`, {
        message: reminderForm.message.trim(),
        send_email: reminderForm.send_email,
        next_date: reminderForm.next_date || null,
      });
      setReminderFee(null);
      await load();
      if (feeDetail?.fee.id === reminderFee.id) setFeeDetail(r.data.details);
      notify({
        type: r.data.error ? "error" : "success",
        text: r.data.emailed ? "Reminder emailed to the client." : (r.data.error || "Reminder logged."),
      });
    } catch (err) {
      const d = err.response?.data?.detail;
      setReminderError(typeof d === "string" ? d : "Could not save the reminder.");
    }
  }

  async function changeStage(stage) {
    if (!feeDetail || stage === feeDetail.fee.process_stage) return;
    try {
      const r = await api.post(`/api/fees/${feeDetail.fee.id}/stage`, { stage });
      setFeeDetail(r.data.details);
      await load();
      notify({ type: "success", text: `Stage updated to ${stage}.` });
    } catch (err) {
      const d = err.response?.data?.detail;
      notify({ type: "error", text: typeof d === "string" ? d : "Could not update the stage." });
    }
  }

  async function openDetails(f) {
    setDetailTab("Overview");
    try {
      const r = await api.get(`/api/fees/${f.id}/details`);
      setFeeDetail(r.data);
    } catch {
      notify({ type: "error", text: "Could not open the fee details." });
    }
  }

  async function viewInvoice(invoiceId) {
    try {
      const r = await api.get(`/api/invoices/${invoiceId}/html`, { responseType: "text" });
      const blob = new Blob([r.data], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify({ type: "error", text: "Could not open the invoice." });
    }
  }

  async function emailInvoice(invoiceId) {
    try {
      const r = await api.post(`/api/invoices/${invoiceId}/email`);
      setInvoiceNotice((n) => ({ ...n, message: r.data.message }));
    } catch (err) {
      const d = err.response?.data?.detail;
      setInvoiceNotice((n) => ({ ...n, message: typeof d === "string" ? d : "Could not email the invoice." }));
    }
  }

  function remove(f) {
    askConfirm({
      title: "Delete this fee?",
      message: `${f.client_name} · ${f.purpose}. Payments, installments, activity and the linked invoice will be removed.`,
      confirmLabel: "Delete fee",
      checkLabel: "I understand this cannot be undone.",
      tone: "danger",
      onConfirm: async () => {
        try {
          await api.delete(`/api/fees/${f.id}`);
          if (feeDetail?.fee.id === f.id) setFeeDetail(null);
          await load();
          notify({ type: "success", text: "Fee deleted." });
        } catch (err) {
          const d = err.response?.data?.detail;
          notify({ type: "error", text: typeof d === "string" ? d : "Could not delete this fee." });
        }
      },
    });
  }

  function toggleSelect(id) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const allShownSelected = shown.length > 0 && shown.every((f) => selected.includes(f.id));
  function toggleAll() {
    setSelected(allShownSelected ? [] : shown.map((f) => f.id));
  }

  async function applyBulkPaid(ids, paid) {
    await api.post("/api/fees/bulk/paid", { ids, paid });
    await load();
    if (feeDetail && ids.includes(feeDetail.fee.id)) await refreshDetails(feeDetail.fee.id);
  }

  function bulkAction(action) {
    if (!selected.length) return;
    const ids = [...selected];
    const isPaidAction = action === "paid" || action === "pending";
    askConfirm({
      title: action === "delete" ? `Delete ${ids.length} selected fee${ids.length === 1 ? "" : "s"}?`
        : action === "followup" ? "Schedule follow-ups for tomorrow?"
          : action === "paid" ? "Mark selected fees as paid?" : "Reopen selected fees?",
      message: action === "delete"
        ? "This permanently removes the selected fees and their records."
        : action === "followup"
          ? "Each selected fee will get a follow-up for tomorrow."
          : `${ids.length} fee${ids.length === 1 ? "" : "s"} will be updated. Undo will be available for 3 seconds.`,
      confirmLabel: action === "delete" ? "Delete selected" : action === "followup" ? "Schedule" : action === "paid" ? "Mark paid" : "Reopen",
      checkLabel: action === "delete"
        ? "I understand this cannot be undone."
        : action === "paid"
          ? "I confirm the full payments have been received."
          : "I confirm this bulk change.",
      tone: action === "delete" || action === "pending" ? "danger" : "primary",
      onConfirm: async () => {
        try {
          if (action === "delete") await api.post("/api/fees/bulk/delete", { ids });
          else if (action === "followup") {
            for (const id of ids) {
              await api.post(`/api/fees/${id}/followup`, { next_date: addDays(todayStr(), 1), note: "Bulk follow-up scheduled" });
            }
          } else await applyBulkPaid(ids, action === "paid");
          setSelected([]);
          notify({ type: "success", text: action === "followup" ? "Follow-ups scheduled for tomorrow." : "Selected fees updated." }, isPaidAction
            ? async () => {
              try {
                await applyBulkPaid(ids, action !== "paid");
                setSelected(ids);
                notify({ type: "success", text: "Bulk payment change undone." });
              } catch {
                notify({ type: "error", text: "Could not undo the bulk change." });
              }
            }
            : null);
        } catch {
          notify({ type: "error", text: "Could not update the selected fees." });
        }
      },
    });
  }

  const detail = feeDetail?.fee;
  const detailFee = detail ? { ...detail, payments: feeDetail.payments } : null;

  return (
    <div className="page-content">
      <div className="page-actions-bar">
        <button className="primary-btn" onClick={openNew}><Plus size={18} /> Add fee</button>
      </div>

      <section className="stats-grid">
        {cards.map(({ label, value, note, icon: Icon, tone, card, red }) => (
          <article className={`stat-card ${card}`} key={label}>
            <div className="stat-top"><span>{label}</span><div className={`stat-icon ${tone}`}><Icon /></div></div>
            <strong style={red ? { color: "#b91c1c" } : {}}>{loading ? "…" : value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-tools">
          <div className="tabs">
            {[
              ["Pending", pending.filter((f) => f.status === "Pending").length],
              ["Partial", partial.length],
              ["Upfront", upfrontPending.length],
              ["Overdue", overdue.length],
              ["Follow-ups", followups.length],
              ["Paid", paid.length],
              ["All", fees.length],
            ].map(([t, n]) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t} ({n})</button>
            ))}
          </div>
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, purpose, stage or contact..." />
          </div>
          {selected.length > 0 && (
            <div className="row-actions" style={{ marginLeft: "auto" }}>
              <button className="secondary-btn" onClick={() => bulkAction("followup")}><Bell size={14} /> Follow up tomorrow</button>
              <button className="secondary-btn" onClick={() => bulkAction("paid")}>Mark paid</button>
              <button className="secondary-btn" onClick={() => bulkAction("pending")}>Mark pending</button>
              <button className="secondary-btn danger" onClick={() => bulkAction("delete")}>Delete</button>
            </div>
          )}
        </div>

        {error && !form && <p role="alert">{error}</p>}

        {!loading && shown.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><IndianRupee size={26} /></div>
            <h3>{fees.length === 0 ? "No fees yet" : "Nothing here"}</h3>
            <p>{fees.length === 0 ? "Add the first fee to record advance, full or split payments." : "Try another tab or search."}</p>
            {fees.length === 0 && <button className="primary-btn" onClick={openNew}><Plus size={18} /> Add fee</button>}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th><input type="checkbox" checked={allShownSelected} onChange={toggleAll} title="Select all" /></th><th>Paid</th><th>Client</th><th>Purpose / stage</th><th>Amount</th><th>Received</th><th>Due date</th><th>Follow-up</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const due = dueText(f);
                  const follow = followupText(f);
                  const late = f.status !== "Paid" && daysFrom(f.due_date) < 0;
                  return (
                    <tr key={f.id} className={`${late ? "row-late" : f.status === "Paid" ? "row-paid" : ""}`}>
                      <td><input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggleSelect(f.id)} title="Select fee" /></td>
                      <td><input type="checkbox" className="task-check" checked={f.status === "Paid"} onChange={() => toggle(f)} title="Mark fully paid" /></td>
                      <td>
                        <div className="person">
                          <div className={`avatar av-${f.client_id % 5}`}>{(f.client_name || "?").charAt(0).toUpperCase()}</div>
                          <strong>{f.client_name}</strong>
                        </div>
                      </td>
                      <td>
                        <button className="link-btn" onClick={() => openDetails(f)}>{f.purpose}</button>
                        <span className="fee-meta">{f.reference_person || "No contact"}</span>
                        <span className={`stage-chip stage-${(f.process_stage || "New").toLowerCase().replace(/\s+/g, "-")}`}>{f.process_stage || "New"}</span>
                        {Number(f.upfront_amount) > 0 && <span className={`upfront-badge ${f.upfront_status === "Received" ? "done" : ""}`}>Upfront {f.upfront_status}</span>}
                      </td>
                      <td className="money">{inr(f.amount)}<span className="due-note">Balance {inr(balance(f))}</span></td>
                      <td className="money">
                        {inr(f.paid_amount)}
                        <span className={`status-chip ${f.status?.toLowerCase()}`}>{f.status || "Pending"}</span>
                        <div className="fee-progress"><span style={{ width: `${Math.min(Number(f.progress || 0), 100)}%` }} /></div>
                      </td>
                      <td>{fmt(f.due_date)}<span className={`due-note ${due.cls}`}>{due.text}</span></td>
                      <td>{follow.text === "Not scheduled" ? <span className="muted">—</span> : <span className={`due-note ${follow.cls}`}>{follow.text}</span>}{f.followup_note && <span className="fee-meta">{f.followup_note}</span>}</td>
                      <td>
                        <div className="row-actions">
                          <button className="icon-btn sm" title="Fee details and activity" onClick={() => openDetails(f)}><FileText size={15} /></button>
                          <button className="icon-btn sm" title="Record payment" onClick={() => openPayment(f)}><Wallet size={15} /></button>
                          <button className="icon-btn sm" title="Create payment plan" onClick={() => openPlan(f)}><ListChecks size={15} /></button>
                          <button className="icon-btn sm" title="Schedule follow-up" onClick={() => openFollowup(f)}><Bell size={15} /></button>
                          <button className="icon-btn sm" title="Extend due date" onClick={() => openExtend(f)}><CalendarClock size={15} /></button>
                          {f.invoice_id ? (
                            <button className="icon-btn sm" title="View invoice" onClick={() => viewInvoice(f.invoice_id)}><ReceiptText size={15} /></button>
                          ) : f.status === "Paid" ? (
                            <button
                              className="icon-btn sm"
                              title="Generate invoice"
                              onClick={async () => {
                                try {
                                  const r = await api.post(`/api/fees/${f.id}/invoice`);
                                  setInvoiceNotice({
                                    invoiceId: r.data.invoice_id,
                                    invoiceNo: r.data.invoice_no,
                                    clientName: f.client_name,
                                    email: clients.find((c) => c.id === f.client_id)?.email || "",
                                    message: `Invoice ${r.data.invoice_no} generated.`,
                                  });
                                  await load();
                                  if (feeDetail?.fee.id === f.id) await refreshDetails(f.id);
                                } catch {
                                  notify({ type: "error", text: "Could not generate the invoice." });
                                }
                              }}
                            ><ReceiptText size={15} /></button>
                          ) : null}
                          <button className="icon-btn sm" title="Edit" onClick={() => openEdit(f)}><Pencil size={15} /></button>
                          <button className="icon-btn sm danger" title="Delete" onClick={() => remove(f)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > 0 && <p className="table-footer">Showing {shown.length} of {fees.length} fees</p>}
      </section>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{editId ? "Edit fee" : "Add fee"}</h2>
                <p>Set the amount, advance payment and follow-up plan.</p>
              </div>
              <button className="icon-btn" onClick={() => setForm(null)}><X /></button>
            </div>
            <form onSubmit={save}>
              <div className="form-grid">
                <label className="full-width">Client *
                  <select required value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
                    <option value="">Select a client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name}{c.business_name ? ` (${c.business_name})` : ""}</option>)}
                  </select></label>
                <label className="full-width">Purpose / service *
                  <input required value={form.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="e.g. GSTR-3B filing, March" /></label>
                <label>Amount (₹) *
                  <input required type="number" min="1" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></label>
                <label>Upfront / advance (₹)
                  <input type="number" min="0" step="0.01" value={form.upfront_amount} onChange={(e) => set("upfront_amount", e.target.value)} /></label>
                <label>Process stage
                  <select value={form.process_stage} onChange={(e) => set("process_stage", e.target.value)}>
                    {STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select></label>
                <label>Reference person
                  <input value={form.reference_person} onChange={(e) => set("reference_person", e.target.value)} /></label>
                <label>Due date *
                  <input required type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></label>
                <label>Expected payment date
                  <input type="date" value={form.expected_date} onChange={(e) => set("expected_date", e.target.value)} /></label>
                <label>Next follow-up
                  <input type="date" value={form.next_followup_date} onChange={(e) => set("next_followup_date", e.target.value)} /></label>
                <label className="full-width">Follow-up note
                  <input value={form.followup_note} onChange={(e) => set("followup_note", e.target.value)} placeholder="e.g. Confirm UTR by evening" /></label>
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

      {feeDetail && detail && (
        <div className="modal-backdrop" onClick={() => setFeeDetail(null)}>
          <section className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{detail.purpose}</h2>
                <p>{detail.client_name} · Fee #{detail.id} · {detail.status}</p>
              </div>
              <button className="icon-btn" onClick={() => setFeeDetail(null)}><X /></button>
            </div>
            <div className="fee-summary-grid">
              <div><span>Fee amount</span><strong>{inr(detail.amount)}</strong></div>
              <div><span>Received</span><strong>{inr(detail.paid_amount)}</strong></div>
              <div><span>Balance</span><strong>{inr(detail.balance)}</strong></div>
              <div><span>Upfront</span><strong>{inr(detail.upfront_amount)}</strong><small>{detail.upfront_status}</small></div>
              <div><span>Due date</span><strong>{fmt(detail.due_date)}</strong><small>{dueText(detail).text}</small></div>
              <div><span>Follow-up</span><strong>{detail.next_followup_date ? fmt(detail.next_followup_date) : "Not scheduled"}</strong><small>{detail.followup_note || "—"}</small></div>
            </div>
            <div className="fee-progress large"><span style={{ width: `${Math.min(Number(detail.progress || 0), 100)}%` }} /><b>{detail.progress || 0}% received</b></div>
            <div className="fee-actions-row">
              <button className="primary-btn" onClick={() => openPayment(detailFee)}><Wallet size={15} /> Record payment</button>
              <button className="secondary-btn" onClick={() => openPlan(detailFee)}><ListChecks size={15} /> Payment plan</button>
              <button className="secondary-btn" onClick={() => openFollowup(detailFee)}><Bell size={15} /> Follow-up</button>
              <button className="secondary-btn" onClick={() => openReminder(detailFee)}><Send size={15} /> Reminder</button>
              <button className="secondary-btn" onClick={() => openExtend(detailFee)}><CalendarClock size={15} /> Extend date</button>
              {detail.invoice_id && <button className="secondary-btn" onClick={() => viewInvoice(detail.invoice_id)}><Printer size={15} /> Invoice</button>}
            </div>
            <div className="stage-control">
              <label>Process stage
                <select value={detail.process_stage || "New"} onChange={(e) => changeStage(e.target.value)}>
                  {STAGES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <span>{detail.installment_count || 0} installment{detail.installment_count === 1 ? "" : "s"} · {detail.payment_count || 0} payment{detail.payment_count === 1 ? "" : "s"} · {detail.activity_count || 0} updates</span>
            </div>
            <div className="fee-detail-tabs">
              {["Overview", "Payments", "Plan", "Activity"].map((t) => (
                <button key={t} className={detailTab === t ? "on" : ""} onClick={() => setDetailTab(t)}>{t}</button>
              ))}
            </div>
            <div className="fee-detail-body">
              {detailTab === "Overview" && (
                <div className="fee-overview">
                  <div><h3>Next action</h3><p>{detail.upfront_status === "Pending" ? `Collect the advance payment of ${inr(detail.upfront_amount)} first.` : detail.pending_installment_count ? `${detail.pending_installment_count} installment${detail.pending_installment_count === 1 ? "" : "s"} pending. Next on ${fmt(detail.next_installment_date)}.` : detail.status === "Paid" ? "Payment complete. Invoice is ready." : `Collect ${inr(detail.balance)} by ${fmt(detail.due_date)}.`}</p></div>
                  <div><h3>Reference</h3><p>{detail.reference_person || "No reference person"}</p></div>
                  <div><h3>Notes</h3><p>{detail.notes || "No notes added."}</p></div>
                </div>
              )}
              {detailTab === "Payments" && (
                <div className="payment-history">
                  {feeDetail.payments.length === 0 ? <p className="muted">No payments recorded yet.</p> : feeDetail.payments.map((p) => (
                    <div className="payment-history-row" key={p.id}>
                      <div><strong>{inr(p.amount)}</strong><small>{fmt(p.payment_date)} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</small></div>
                      <button className="icon-btn sm danger" title="Manage payments" onClick={() => openPayment(detailFee)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              {detailTab === "Plan" && (
                <div className="plan-list">
                  {feeDetail.installments.length === 0 ? <p className="muted">No payment plan yet. Use “Payment plan” to split the balance.</p> : feeDetail.installments.map((item) => (
                    <div className={`plan-row ${item.status === "Paid" ? "done" : ""}`} key={item.id}>
                      <div><strong>{inr(item.amount)}</strong><small>Due {fmt(item.due_date)}{item.notes ? ` · ${item.notes}` : ""}</small></div>
                      <span className={`status-chip ${item.status.toLowerCase()}`}>{item.status}</span>
                      <button className="secondary-btn sm" onClick={() => toggleInstallment(item)}>{item.status === "Paid" ? "Reopen" : "Mark paid"}</button>
                    </div>
                  ))}
                </div>
              )}
              {detailTab === "Activity" && (
                <div className="activity-list">
                  {feeDetail.activities.length === 0 ? <p className="muted">No activity recorded yet.</p> : feeDetail.activities.map((item) => (
                    <div className="activity-row" key={item.id}>
                      <div className="activity-dot"><History size={13} /></div>
                      <div><strong>{item.kind}</strong><p>{item.message}</p></div>
                      <time>{fmt(item.activity_date)}</time>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setFeeDetail(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {paymentFee && paymentForm && (
        <div className="modal-backdrop" onClick={() => setPaymentFee(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Record payment</h2>
                <p>{paymentFee.client_name} · {paymentFee.purpose}</p>
              </div>
              <button className="icon-btn" onClick={() => setPaymentFee(null)}><X /></button>
            </div>
            <div className="payment-summary">
              <div><span>Fee</span><strong>{inr(paymentFee.amount)}</strong></div>
              <div><span>Received</span><strong>{inr(paymentFee.paid_amount)}</strong></div>
              <div><span>Balance</span><strong>{inr(balance(paymentFee))}</strong></div>
            </div>
            {Number(paymentFee.upfront_amount) > 0 && paymentFee.upfront_status === "Pending" && (
              <p className="upfront-hint">Advance target: {inr(paymentFee.upfront_amount)}. It is marked received automatically once payments reach this amount.</p>
            )}
            <form onSubmit={savePayment}>
              <div className="form-grid">
                <label>Payment amount (₹) *
                  <input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                </label>
                <label>Payment date *
                  <input required type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} />
                </label>
                <label>Method
                  <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                    {["Cash", "UPI", "Bank transfer", "Cheque", "Card", "Other"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label>Reference
                  <input value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="UTR / cheque no." />
                </label>
                <label className="full-width">Notes
                  <textarea rows="2" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
                </label>
              </div>
              {paymentError && <p role="alert" style={{ color: "#b91c1c" }}>{paymentError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setPaymentFee(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Add payment</button>
              </div>
            </form>
            {paymentFee.payments?.length > 0 && (
              <div className="payment-history">
                <h3>Payment history</h3>
                {paymentFee.payments.map((p) => (
                  <div className="payment-history-row" key={p.id}>
                    <div><strong>{inr(p.amount)}</strong><small>{fmt(p.payment_date)} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</small></div>
                    <button className="icon-btn sm danger" title="Delete payment" onClick={() => removePayment(p)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {extendFee && extendForm && (
        <div className="modal-backdrop" onClick={() => setExtendFee(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Extend due date</h2>
                <p>{extendFee.client_name} · {extendFee.purpose}</p>
              </div>
              <button className="icon-btn" onClick={() => setExtendFee(null)}><X /></button>
            </div>
            <form onSubmit={saveExtend}>
              <div className="form-grid">
                <label>Current due date
                  <input value={fmt(extendFee.due_date)} readOnly />
                </label>
                <label>New due date *
                  <input required type="date" min={addDays(extendFee.due_date, 1)} value={extendForm.due_date} onChange={(e) => setExtendForm({ ...extendForm, due_date: e.target.value })} />
                </label>
                <label>Expected payment date
                  <input type="date" value={extendForm.expected_date} onChange={(e) => setExtendForm({ ...extendForm, expected_date: e.target.value })} />
                </label>
                <label className="full-width checkbox-field">
                  <input type="checkbox" checked={extendForm.postpone_tasks} onChange={(e) => setExtendForm({ ...extendForm, postpone_tasks: e.target.checked })} />
                  Postpone linked open tasks and pending installments by the same days
                </label>
                <label className="full-width">Reason
                  <textarea rows="2" value={extendForm.reason} onChange={(e) => setExtendForm({ ...extendForm, reason: e.target.value })} placeholder="e.g. Client requested more time" />
                </label>
              </div>
              {extendError && <p role="alert" style={{ color: "#b91c1c" }}>{extendError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setExtendFee(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Extend due date</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {planFee && planForm && (
        <div className="modal-backdrop" onClick={() => setPlanFee(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Payment plan</h2>
                <p>{planFee.client_name} · {planFee.purpose}</p>
              </div>
              <button className="icon-btn" onClick={() => setPlanFee(null)}><X /></button>
            </div>
            <p className="muted">Balance to split: <strong>{inr(balance(planFee))}</strong>. Saving replaces pending installments; already paid installments stay recorded.</p>
            <form onSubmit={savePlan}>
              <div className="form-grid">
                <label>Number of installments
                  <input required type="number" min="2" max="24" value={planForm.count} onChange={(e) => setPlanForm({ ...planForm, count: e.target.value })} />
                </label>
                <label>Gap between installments (days)
                  <input required type="number" min="1" max="90" value={planForm.interval} onChange={(e) => setPlanForm({ ...planForm, interval: e.target.value })} />
                </label>
                <label className="full-width">First installment date
                  <input required type="date" value={planForm.start} onChange={(e) => setPlanForm({ ...planForm, start: e.target.value })} />
                </label>
              </div>
              <div className="plan-preview">
                {buildPlan(planFee, planForm.count, planForm.interval, planForm.start).map((item, i) => (
                  <span key={i}>{fmt(item.due_date)} · {inr(item.amount)}</span>
                ))}
              </div>
              {planError && <p role="alert" style={{ color: "#b91c1c" }}>{planError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setPlanFee(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Save plan</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {followupFee && followupForm && (
        <div className="modal-backdrop" onClick={() => setFollowupFee(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Schedule follow-up</h2>
                <p>{followupFee.client_name} · {followupFee.purpose}</p>
              </div>
              <button className="icon-btn" onClick={() => setFollowupFee(null)}><X /></button>
            </div>
            <form onSubmit={saveFollowup}>
              <div className="form-grid">
                <label>Next follow-up date
                  <input type="date" value={followupForm.next_date} onChange={(e) => setFollowupForm({ ...followupForm, next_date: e.target.value })} />
                </label>
                <label className="full-width">Note
                  <textarea rows="3" value={followupForm.note} onChange={(e) => setFollowupForm({ ...followupForm, note: e.target.value })} placeholder="What needs to happen on this follow-up?" />
                </label>
              </div>
              {followupError && <p role="alert" style={{ color: "#b91c1c" }}>{followupError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setFollowupFee(null)}>Cancel</button>
                <button type="submit" className="primary-btn">Save follow-up</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {reminderFee && reminderForm && (
        <div className="modal-backdrop" onClick={() => setReminderFee(null)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Payment reminder</h2>
                <p>{reminderFee.client_name} · {reminderFee.purpose}</p>
              </div>
              <button className="icon-btn" onClick={() => setReminderFee(null)}><X /></button>
            </div>
            <form onSubmit={sendReminder}>
              <div className="form-grid">
                <label className="full-width">Message
                  <textarea rows="4" value={reminderForm.message} onChange={(e) => setReminderForm({ ...reminderForm, message: e.target.value })} />
                </label>
                <label>Next follow-up
                  <input type="date" value={reminderForm.next_date} onChange={(e) => setReminderForm({ ...reminderForm, next_date: e.target.value })} />
                </label>
                <label className="full-width checkbox-field">
                  <input type="checkbox" checked={reminderForm.send_email} onChange={(e) => setReminderForm({ ...reminderForm, send_email: e.target.checked })} />
                  Send by email to {clients.find((c) => c.id === reminderFee.client_id)?.email || "client email (not available)"}
                </label>
              </div>
              {reminderError && <p role="alert" style={{ color: "#b91c1c" }}>{reminderError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setReminderFee(null)}>Cancel</button>
                <button type="submit" className="primary-btn"><Send size={15} /> Save reminder</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {invoiceNotice && (
        <div className="modal-backdrop" onClick={() => setInvoiceNotice(null)}>
          <section className="modal invoice-notice" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>Invoice {invoiceNotice.invoiceNo}</h2>
                <p>{invoiceNotice.message}</p>
              </div>
              <button className="icon-btn" onClick={() => setInvoiceNotice(null)}><X /></button>
            </div>
            <div className="invoice-actions">
              <button className="primary-btn" onClick={() => viewInvoice(invoiceNotice.invoiceId)}>
                <Printer size={16} /> View / print
              </button>
              <button
                className="secondary-btn"
                disabled={!invoiceNotice.email}
                title={invoiceNotice.email ? `Email PDF to ${invoiceNotice.email}` : "Client has no email address"}
                onClick={() => emailInvoice(invoiceNotice.invoiceId)}
              >
                <Mail size={16} /> Email PDF
              </button>
            </div>
            {!invoiceNotice.email && <p className="muted">Add an email address to this client to send invoices by email.</p>}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setInvoiceNotice(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {confirmDialog && (
        <div className="modal-backdrop" onClick={() => setConfirmDialog(null)}>
          <section className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <h2>{confirmDialog.title}</h2>
                <p>{confirmDialog.message}</p>
              </div>
              <button className="icon-btn" onClick={() => setConfirmDialog(null)}><X /></button>
            </div>
            {confirmDialog.checkLabel && (
              <label className="checkbox-field confirm-check">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                />
                {confirmDialog.checkLabel}
              </label>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                className={confirmDialog.tone === "danger" ? "secondary-btn danger" : "primary-btn"}
                disabled={Boolean(confirmDialog.checkLabel) && !confirmChecked}
                onClick={runConfirmed}
              >
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className={`toast ${notice.type}`} role="status">
          {notice.type === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.text}</span>
          {undo && (
            <button className="toast-undo" onClick={handleUndo}>
              <Undo2 size={15} /> Undo (3s)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

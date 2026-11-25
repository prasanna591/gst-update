import json
from datetime import date, timedelta
from decimal import Decimal
from html import escape
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_db, require_admin
from app.mail_config import (
    BUSINESS_ADDRESS,
    BUSINESS_EMAIL,
    BUSINESS_GSTIN,
    BUSINESS_NAME,
    BUSINESS_PHONE,
)
from app.mailer import send_mail
from app.models import Client, Fee, Invoice, InvoiceTemplate

router = APIRouter(prefix="/api/invoices", tags=["Invoices"])

DEFAULT_CONFIG = {
    "business_name": BUSINESS_NAME,
    "address": BUSINESS_ADDRESS,
    "phone": BUSINESS_PHONE,
    "email": BUSINESS_EMAIL,
    "gstin": BUSINESS_GSTIN,
    "logo_text": "",
    "accent_color": "#2563eb",
    "number_prefix": "INV",
    "tax_percent": 0,
    "show_tax": False,
    "bank_details": "",
    "terms": "",
    "footer": "Thank you for your business.",
    "currency": "₹",
}


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    config: dict


class InvoiceUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=10)
    notes: str | None = None


def _safe_color(value) -> str:
    color = str(value or "").strip()
    if (
        color.startswith("#")
        and len(color) in (4, 7)
        and all(ch in "0123456789abcdefABCDEF" for ch in color[1:])
    ):
        return color
    return DEFAULT_CONFIG["accent_color"]


def _safe_prefix(value) -> str:
    prefix = "".join(
        ch for ch in str(value or "").strip() if ch.isalnum() or ch in "-_"
    )[:20]
    return prefix or DEFAULT_CONFIG["number_prefix"]


def _merge_config(raw: dict | None) -> dict:
    config = dict(DEFAULT_CONFIG)
    if isinstance(raw, dict):
        config.update(raw)
    config["accent_color"] = _safe_color(config.get("accent_color"))
    config["number_prefix"] = _safe_prefix(config.get("number_prefix"))
    return config


def _active_config(db: Session) -> dict:
    row = (
        db.query(InvoiceTemplate)
        .filter(InvoiceTemplate.is_default.is_(True))
        .order_by(InvoiceTemplate.id.desc())
        .first()
    )
    if not row:
        return _merge_config(None)
    try:
        return _merge_config(json.loads(row.config))
    except Exception:
        return _merge_config(None)


def _template_out(row: InvoiceTemplate) -> dict:
    try:
        raw = json.loads(row.config)
    except Exception:
        raw = {}
    return {
        "id": row.id,
        "name": row.name,
        "config": _merge_config(raw),
        "is_default": bool(row.is_default),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def invoice_out(invoice: Invoice, client: Client | None = None, fee: Fee | None = None) -> dict:
    return {
        "id": invoice.id,
        "invoice_no": invoice.invoice_no,
        "fee_id": invoice.fee_id,
        "client_id": invoice.client_id,
        "client_name": client.client_name if client else None,
        "business_name": client.business_name if client else None,
        "email": client.email if client else None,
        "purpose": invoice.purpose,
        "amount": float(invoice.amount),
        "issued_date": invoice.issued_date,
        "due_date": fee.due_date if fee else None,
        "status": invoice.status,
        "notes": invoice.notes,
        "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
    }


def ensure_invoice(db: Session, fee: Fee) -> Invoice:
    inv = db.query(Invoice).filter(Invoice.fee_id == fee.id).first()
    if inv:
        inv.client_id = fee.client_id
        inv.amount = fee.amount
        inv.purpose = fee.purpose
        return inv
    prefix = _active_config(db)["number_prefix"]
    inv = Invoice(
        invoice_no=f"{prefix}-{fee.id}-{date.today().strftime('%Y%m%d')}",
        fee_id=fee.id,
        client_id=fee.client_id,
        amount=fee.amount,
        purpose=fee.purpose,
        issued_date=date.today(),
    )
    db.add(inv)
    db.flush()
    return inv


def _invoice_data(db: Session, invoice_id: int) -> tuple[Invoice, Client | None, Fee | None]:
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    client = db.query(Client).filter(Client.id == invoice.client_id).first()
    fee = db.query(Fee).filter(Fee.id == invoice.fee_id).first()
    return invoice, client, fee


def _invoice_html(
    invoice: Invoice,
    client: Client | None,
    fee: Fee | None,
    config: dict | None = None,
) -> str:
    config = _merge_config(config)
    client_name = escape(client.client_name if client else "Client")
    business = escape(client.business_name or "") if client else ""
    address = escape(client.address or "") if client else ""
    email = escape(client.email or "") if client else ""
    phone = escape(client.phone or "") if client else ""
    gstin = escape(client.gstin or "") if client else ""
    issued = invoice.issued_date.strftime("%d %b %Y")
    due = fee.due_date.strftime("%d %b %Y") if fee else "-"

    try:
        tax_percent = float(config.get("tax_percent") or 0)
    except (TypeError, ValueError):
        tax_percent = 0
    amount = float(invoice.amount or 0)
    tax = amount * tax_percent / 100 if config.get("show_tax") else 0
    total = amount + tax
    currency = escape(str(config.get("currency") or "₹"))
    accent = config["accent_color"]

    business_name = escape(str(config.get("business_name") or BUSINESS_NAME))
    logo_text = escape(str(config.get("logo_text") or ""))
    business_address = escape(str(config.get("address") or "")).replace("\n", "<br>")
    bank_details = escape(str(config.get("bank_details") or "")).replace("\n", "<br>")
    terms = escape(str(config.get("terms") or "")).replace("\n", "<br>")
    footer = escape(str(config.get("footer") or "")).replace("\n", "<br>")
    contact_parts = [
        escape(str(config.get("phone") or "")),
        escape(str(config.get("email") or "")),
        f"GSTIN: {escape(str(config.get('gstin') or ''))}" if config.get("gstin") else "",
    ]
    business_contact = " · ".join(part for part in contact_parts if part)

    tax_rows = ""
    if config.get("show_tax"):
        tax_rows = (
            "<tr><td>Subtotal</td><td style='text-align:right'>"
            f"{currency} {amount:,.2f}</td></tr>"
            "<tr><td>Tax ({tax_percent:g}%)</td><td style='text-align:right'>"
            f"{currency} {tax:,.2f}</td></tr>"
        ).replace("{tax_percent:g}", f"{tax_percent:g}")

    bank_box = ""
    if bank_details:
        bank_box = (
            "<div class='box'><strong>Bank details</strong>"
            f"<div class='muted'>{bank_details}</div></div>"
        )
    terms_box = ""
    if terms:
        terms_box = (
            "<div class='box'><strong>Terms</strong>"
            f"<div class='muted'>{terms}</div></div>"
        )

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{escape(invoice.invoice_no)}</title>
<style>
  body {{ font-family: Arial, sans-serif; color: #1e293b; margin: 40px; }}
  .sheet {{ max-width: 760px; margin: auto; border: 1px solid #e2e8f0; padding: 32px; }}
  .top {{ display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid {accent}; padding-bottom: 18px; }}
  h1 {{ margin: 0 0 4px; font-size: 24px; }}
  h2 {{ color: {accent}; margin: 0 0 4px; font-size: 30px; letter-spacing: 1px; }}
  .muted {{ color: #64748b; font-size: 13px; line-height: 1.5; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 26px 0; }}
  .box {{ background: #f8fafc; border-radius: 10px; padding: 16px; }}
  .box strong {{ display: block; margin-bottom: 8px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
  th, td {{ text-align: left; padding: 12px; border-bottom: 1px solid #e2e8f0; }}
  th {{ background: #f1f5f9; font-size: 12px; text-transform: uppercase; color: #64748b; }}
  .total {{ text-align: right; font-size: 22px; font-weight: 700; padding-top: 18px; }}
  .foot {{ margin-top: 40px; color: #64748b; font-size: 12px; }}
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div>
        {f'<div class="muted">{logo_text}</div>' if logo_text else ''}
        <h1>{business_name}</h1>
        <div class="muted">{business_address}<br>{business_contact}</div>
      </div>
      <div style="text-align:right">
        <h2>INVOICE</h2>
        <div class="muted">
          <strong>{escape(invoice.invoice_no)}</strong><br>
          Issued: {issued}<br>
          Status: {escape(invoice.status)}
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <strong>Billed to</strong>
        <div>{client_name}</div>
        {f'<div class="muted">{business}</div>' if business else ''}
        {f'<div class="muted">{address}</div>' if address else ''}
        {f'<div class="muted">{email} {phone}</div>' if email or phone else ''}
        {f'<div class="muted">GSTIN: {gstin}</div>' if gstin else ''}
      </div>
      <div class="box">
        <strong>Payment details</strong>
        <div class="muted">
          Fee due date: {due}<br>
          Purpose: {escape(invoice.purpose)}
        </div>
      </div>
      {bank_box}
      {terms_box}
    </div>

    <table>
      <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>
        <tr><td>{escape(invoice.purpose)}</td><td style="text-align:right">{currency} {amount:,.2f}</td></tr>
        {tax_rows}
      </tbody>
    </table>
    <div class="total">Total: {currency} {total:,.2f}</div>
    <div class="foot">{footer}</div>
  </div>
</body>
</html>"""


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), user=Depends(require_admin)):
    rows = db.query(InvoiceTemplate).order_by(InvoiceTemplate.name.asc()).all()
    return [_template_out(row) for row in rows]


@router.post("/templates", status_code=201)
def create_template(
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    duplicate = db.query(InvoiceTemplate).filter(InvoiceTemplate.name == name).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    row = InvoiceTemplate(name=name, config=json.dumps(payload.config))
    db.add(row)
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.get("/templates/default-config")
def default_config(user=Depends(require_admin)):
    return _merge_config(None)


@router.post("/templates/preview", response_class=HTMLResponse)
def preview_template(payload: dict, user=Depends(require_admin)):
    config = _merge_config(payload)
    invoice = SimpleNamespace(
        invoice_no=f"{config['number_prefix']}-DEMO",
        amount=Decimal("1500.00"),
        purpose="Professional fees",
        issued_date=date.today(),
        status="Draft",
    )
    client = SimpleNamespace(
        client_name="Sample Client",
        business_name="Sample Business",
        address="12 Main Street",
        email="client@example.com",
        phone="9876543210",
        gstin="33ABCDE1234F1Z5",
    )
    fee = SimpleNamespace(due_date=date.today() + timedelta(days=15))
    return HTMLResponse(_invoice_html(invoice, client, fee, config))


@router.post("/templates/{template_id}/default")
def set_default_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    row = db.get(InvoiceTemplate, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Invoice template not found")
    db.query(InvoiceTemplate).filter(InvoiceTemplate.id != template_id).update(
        {"is_default": False}
    )
    row.is_default = True
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    row = db.get(InvoiceTemplate, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Invoice template not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    duplicate = (
        db.query(InvoiceTemplate)
        .filter(InvoiceTemplate.name == name, InvoiceTemplate.id != template_id)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    row.name = name
    row.config = json.dumps(payload.config)
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    row = db.get(InvoiceTemplate, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Invoice template not found")
    db.delete(row)
    db.commit()


@router.get("/")
def list_invoices(
    client_id: int | None = None,
    status: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = (
        db.query(Invoice, Client, Fee)
        .outerjoin(Client, Client.id == Invoice.client_id)
        .outerjoin(Fee, Fee.id == Invoice.fee_id)
    )
    if client_id:
        query = query.filter(Invoice.client_id == client_id)
    if status:
        query = query.filter(Invoice.status == status.strip())
    if from_date:
        query = query.filter(Invoice.issued_date >= from_date)
    if to_date:
        query = query.filter(Invoice.issued_date <= to_date)
    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Invoice.invoice_no.ilike(term),
                Invoice.purpose.ilike(term),
                Client.client_name.ilike(term),
                Client.business_name.ilike(term),
            )
        )
    rows = query.order_by(Invoice.issued_date.desc(), Invoice.id.desc()).all()
    return [invoice_out(invoice, client, fee) for invoice, client, fee in rows]


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    invoice, client, fee = _invoice_data(db, invoice_id)
    return invoice_out(invoice, client, fee)


@router.patch("/{invoice_id}")
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    invoice, client, fee = _invoice_data(db, invoice_id)
    if payload.status is not None:
        status = payload.status.strip()
        if status not in {"Draft", "Issued", "Paid", "Cancelled"}:
            raise HTTPException(status_code=422, detail="Unsupported invoice status")
        invoice.status = status
    if payload.notes is not None:
        invoice.notes = payload.notes.strip() or None
    db.commit()
    db.refresh(invoice)
    return invoice_out(invoice, client, fee)


@router.get("/{invoice_id}/html", response_class=HTMLResponse)
def invoice_html(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    invoice, client, fee = _invoice_data(db, invoice_id)
    return HTMLResponse(_invoice_html(invoice, client, fee, _active_config(db)))


@router.post("/{invoice_id}/email")
def invoice_email(
    invoice_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    invoice, client, fee = _invoice_data(db, invoice_id)
    if not client or not client.email:
        raise HTTPException(422, "This client does not have an email address")
    config = _active_config(db)
    html = _invoice_html(invoice, client, fee, config)
    business_name = str(config.get("business_name") or BUSINESS_NAME)
    body = (
        f"Hello {client.client_name},\n\n"
        f"Please find invoice {invoice.invoice_no} for "
        f"INR {float(invoice.amount):,.2f} attached below in HTML format.\n\n"
        f"Purpose: {invoice.purpose}\n\n"
        f"{business_name}"
    )
    send_mail(
        client.email,
        f"Invoice {invoice.invoice_no} from {business_name}",
        body,
        html=html,
    )
    return {"ok": True, "to": client.email, "invoice_no": invoice.invoice_no}

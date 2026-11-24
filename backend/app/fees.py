from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_db
from app.invoices import ensure_invoice
from app.models import Client, Fee, Invoice

router = APIRouter(prefix="/api/fees", tags=["Fees"])


class FeeIn(BaseModel):
    client_id: int
    purpose: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    due_date: date
    expected_date: date | None = None
    reference_person: str | None = Field(default=None, max_length=150)
    notes: str | None = None


class PaidToggle(BaseModel):
    paid: bool


class BulkIds(BaseModel):
    ids: list[int]


class BulkPaid(BulkIds):
    paid: bool


def out(f: Fee, client_name: str | None, invoice: Invoice | None = None):
    return {
        "id": f.id,
        "client_id": f.client_id,
        "client_name": client_name,
        "purpose": f.purpose,
        "amount": float(f.amount),
        "due_date": f.due_date,
        "expected_date": f.expected_date,
        "reference_person": f.reference_person,
        "status": f.status,
        "paid_date": f.paid_date,
        "notes": f.notes,
        "invoice_id": invoice.id if invoice else None,
        "invoice_no": invoice.invoice_no if invoice else None,
    }


def _invoice_for(db: Session, fee_id: int) -> Invoice | None:
    return db.query(Invoice).filter(Invoice.fee_id == fee_id).first()


@router.get("/")
def list_fees(db: Session = Depends(get_db)):
    rows = (
        db.query(Fee, Client.client_name)
        .join(Client, Client.id == Fee.client_id)
        .order_by(Fee.status.desc(), Fee.due_date)
        .all()
    )
    return [out(fee, name, _invoice_for(db, fee.id)) for fee, name in rows]


@router.post("/", status_code=201)
def create_fee(data: FeeIn, db: Session = Depends(get_db)):
    client = db.get(Client, data.client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    fee = Fee(**data.model_dump(), status="Pending")
    db.add(fee)
    db.commit()
    db.refresh(fee)
    return out(fee, client.client_name)


@router.post("/bulk/paid")
def bulk_paid(data: BulkPaid, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(data.ids))
    fees = db.query(Fee).filter(Fee.id.in_(ids)).all() if ids else []
    for fee in fees:
        fee.status = "Paid" if data.paid else "Pending"
        fee.paid_date = date.today() if data.paid else None
        if data.paid:
            ensure_invoice(db, fee)
    db.commit()
    return {"updated": len(fees)}


@router.post("/bulk/delete")
def bulk_delete(data: BulkIds, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        return {"deleted": 0}
    db.query(Invoice).filter(Invoice.fee_id.in_(ids)).delete(synchronize_session=False)
    deleted = db.query(Fee).filter(Fee.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@router.put("/{fee_id}")
def update_fee(fee_id: int, data: FeeIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    client = db.get(Client, data.client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    for key, value in data.model_dump().items():
        setattr(fee, key, value)
    invoice = _invoice_for(db, fee.id)
    if invoice:
        invoice.client_id = fee.client_id
        invoice.amount = fee.amount
        invoice.purpose = fee.purpose
    db.commit()
    db.refresh(fee)
    return out(fee, client.client_name, _invoice_for(db, fee.id))


@router.patch("/{fee_id}/paid")
def set_paid(fee_id: int, data: PaidToggle, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    fee.status = "Paid" if data.paid else "Pending"
    fee.paid_date = date.today() if data.paid else None
    invoice = ensure_invoice(db, fee) if data.paid else _invoice_for(db, fee.id)
    db.commit()
    return {
        "status": fee.status,
        "invoice_id": invoice.id if invoice else None,
        "invoice_no": invoice.invoice_no if invoice else None,
    }


@router.post("/{fee_id}/invoice")
def create_invoice(fee_id: int, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    if fee.status != "Paid":
        raise HTTPException(422, "Mark the fee as paid before generating an invoice")
    invoice = ensure_invoice(db, fee)
    db.commit()
    db.refresh(invoice)
    return {
        "invoice_id": invoice.id,
        "invoice_no": invoice.invoice_no,
    }


@router.delete("/{fee_id}", status_code=204)
def delete_fee(fee_id: int, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    db.query(Invoice).filter(Invoice.fee_id == fee.id).delete()
    db.delete(fee)
    db.commit()

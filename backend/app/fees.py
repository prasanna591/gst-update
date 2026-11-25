from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_db
from app.database import SessionLocal
from app.invoices import ensure_invoice
from app.mailer import send_mail
from app.notifications import create_notification
from app.models import (
    Client,
    Fee,
    FeeActivity,
    FeeInstallment,
    FeePayment,
    Invoice,
    Task,
)

router = APIRouter(prefix="/api/fees", tags=["Fees"])

STAGES = ["New", "Contacted", "In progress", "Awaiting payment", "Completed"]


class FeeIn(BaseModel):
    client_id: int
    purpose: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    due_date: date
    expected_date: date | None = None
    reference_person: str | None = Field(default=None, max_length=150)
    notes: str | None = None
    upfront_amount: float = Field(default=0, ge=0)
    process_stage: str = Field(default="New", max_length=20)
    next_followup_date: date | None = None
    followup_note: str | None = None


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    payment_date: date = Field(default_factory=date.today)
    method: str = Field(default="Cash", max_length=30)
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = None


class ExtendDueIn(BaseModel):
    due_date: date
    expected_date: date | None = None
    reason: str | None = Field(default=None, max_length=300)
    postpone_tasks: bool = True


class PaidToggle(BaseModel):
    paid: bool


class BulkIds(BaseModel):
    ids: list[int]


class BulkPaid(BulkIds):
    paid: bool


class StageIn(BaseModel):
    stage: str
    note: str | None = Field(default=None, max_length=300)


class FollowupIn(BaseModel):
    next_date: date | None = None
    note: str | None = Field(default=None, max_length=500)


class InstallmentIn(BaseModel):
    amount: float = Field(gt=0)
    due_date: date
    notes: str | None = Field(default=None, max_length=300)


class InstallmentsIn(BaseModel):
    installments: list[InstallmentIn] = Field(min_length=1)


class InstallmentUpdateIn(BaseModel):
    paid: bool
    payment_date: date = Field(default_factory=date.today)
    method: str = Field(default="Manual", max_length=30)
    reference: str | None = Field(default=None, max_length=100)


class ReminderIn(BaseModel):
    message: str | None = Field(default=None, max_length=1000)
    send_email: bool = False
    next_date: date | None = None


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _append_note(current: str | None, addition: str) -> str:
    return f"{current}\n{addition}" if current else addition


def _validate_stage(stage: str) -> str:
    value = (stage or "").strip()
    if value not in STAGES:
        raise HTTPException(422, f"Stage must be one of: {', '.join(STAGES)}")
    return value


def _validate_upfront(amount, upfront) -> Decimal:
    total = _money(amount)
    advance = _money(upfront)
    if advance < 0:
        raise HTTPException(422, "Upfront amount cannot be negative")
    if advance > total:
        raise HTTPException(422, "Upfront amount cannot be greater than the fee amount")
    return advance


def _activity(db: Session, fee: Fee, kind: str, message: str, when: date | None = None):
    db.add(FeeActivity(
        fee_id=fee.id,
        kind=kind,
        message=message,
        activity_date=when or date.today(),
    ))


def _payments_for(db: Session, fee_id: int) -> list[FeePayment]:
    return (
        db.query(FeePayment)
        .filter(FeePayment.fee_id == fee_id)
        .order_by(FeePayment.payment_date, FeePayment.id)
        .all()
    )


def _installments_for(db: Session, fee_id: int) -> list[FeeInstallment]:
    return (
        db.query(FeeInstallment)
        .filter(FeeInstallment.fee_id == fee_id)
        .order_by(FeeInstallment.due_date, FeeInstallment.id)
        .all()
    )


def _activities_for(db: Session, fee_id: int) -> list[FeeActivity]:
    return (
        db.query(FeeActivity)
        .filter(FeeActivity.fee_id == fee_id)
        .order_by(FeeActivity.activity_date.desc(), FeeActivity.id.desc())
        .all()
    )


def _allocate_installments(db: Session, fee: Fee, payment: FeePayment):
    remaining = _money(payment.amount)
    pending = [
        item for item in _installments_for(db, fee.id)
        if item.status == "Pending"
    ]
    for installment in pending:
        if remaining <= 0:
            break
        needed = _money(installment.amount)
        if remaining >= needed:
            installment.status = "Paid"
            installment.paid_date = payment.payment_date
            installment.payment_id = payment.id
            remaining -= needed


def _release_installments(db: Session, fee_id: int, payment_id: int | None = None):
    query = db.query(FeeInstallment).filter(
        FeeInstallment.fee_id == fee_id,
        FeeInstallment.status == "Paid",
    )
    if payment_id is not None:
        query = query.filter(FeeInstallment.payment_id == payment_id)
    for installment in query.all():
        installment.status = "Pending"
        installment.paid_date = None
        installment.payment_id = None


def _recalculate(db: Session, fee: Fee) -> list[FeePayment]:
    payments = _payments_for(db, fee.id)
    total = sum((_money(p.amount) for p in payments), Decimal("0"))
    amount = _money(fee.amount)
    fee.paid_amount = total
    if total <= 0:
        fee.status = "Pending"
        fee.paid_date = None
    else:
        fee.paid_date = max(p.payment_date for p in payments)
        fee.status = "Paid" if total >= amount else "Partial"
    advance = _money(fee.upfront_amount)
    if advance > 0 and total >= advance and not fee.upfront_paid_date:
        fee.upfront_paid_date = fee.paid_date
    return payments


def _payment_out(payment: FeePayment) -> dict:
    return {
        "id": payment.id,
        "amount": float(_money(payment.amount)),
        "payment_date": payment.payment_date,
        "method": payment.method,
        "reference": payment.reference,
        "notes": payment.notes,
    }


def _installment_out(item: FeeInstallment) -> dict:
    return {
        "id": item.id,
        "amount": float(_money(item.amount)),
        "due_date": item.due_date,
        "status": item.status,
        "paid_date": item.paid_date,
        "payment_id": item.payment_id,
        "notes": item.notes,
    }


def _activity_out(item: FeeActivity) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "message": item.message,
        "activity_date": item.activity_date,
        "created_at": item.created_at,
    }


def out(
    f: Fee,
    client_name: str | None,
    invoice: Invoice | None = None,
    payments: list[FeePayment] | None = None,
    installments: list[FeeInstallment] | None = None,
    activities: list[FeeActivity] | None = None,
):
    payments = payments if payments is not None else []
    installments = installments if installments is not None else []
    activities = activities if activities is not None else []
    amount = _money(f.amount)
    paid = _money(f.paid_amount)
    advance = _money(f.upfront_amount)
    pending_installments = [item for item in installments if item.status == "Pending"]
    return {
        "id": f.id,
        "client_id": f.client_id,
        "client_name": client_name,
        "purpose": f.purpose,
        "amount": float(amount),
        "paid_amount": float(paid),
        "balance": float(max(amount - paid, Decimal("0"))),
        "progress": round(float(paid / amount * 100), 1) if amount > 0 else 0,
        "due_date": f.due_date,
        "expected_date": f.expected_date,
        "reference_person": f.reference_person,
        "status": f.status,
        "paid_date": f.paid_date,
        "payment_count": len(payments),
        "last_payment_date": max((p.payment_date for p in payments), default=None),
        "upfront_amount": float(advance),
        "upfront_paid_date": f.upfront_paid_date,
        "upfront_status": "Not required" if advance <= 0 else ("Received" if f.upfront_paid_date else "Pending"),
        "process_stage": f.process_stage or "New",
        "next_followup_date": f.next_followup_date,
        "followup_note": f.followup_note,
        "installment_count": len(installments),
        "pending_installment_count": len(pending_installments),
        "next_installment_date": min((item.due_date for item in pending_installments), default=None),
        "activity_count": len(activities),
        "notes": f.notes,
        "invoice_id": invoice.id if invoice else None,
        "invoice_no": invoice.invoice_no if invoice else None,
    }


def _details(db: Session, fee: Fee) -> dict:
    client = db.get(Client, fee.client_id)
    payments = _payments_for(db, fee.id)
    installments = _installments_for(db, fee.id)
    activities = _activities_for(db, fee.id)
    return {
        "fee": out(
            fee,
            client.client_name if client else None,
            _invoice_for(db, fee.id),
            payments,
            installments,
            activities,
        ),
        "payments": [_payment_out(payment) for payment in payments],
        "installments": [_installment_out(item) for item in installments],
        "activities": [_activity_out(item) for item in activities],
    }


def _invoice_for(db: Session, fee_id: int) -> Invoice | None:
    return db.query(Invoice).filter(Invoice.fee_id == fee_id).first()


def _mark_paid(db: Session, fee: Fee, paid: bool) -> Invoice | None:
    if paid:
        outstanding = _money(fee.amount) - _money(fee.paid_amount)
        if outstanding > 0:
            payment = FeePayment(
                fee_id=fee.id,
                amount=outstanding,
                payment_date=date.today(),
                method="Manual",
                reference="Marked paid",
            )
            db.add(payment)
            db.flush()
            _allocate_installments(db, fee, payment)
        _activity(db, fee, "status", f"Fee marked paid for {float(_money(fee.amount)):,.2f}.")
    else:
        _release_installments(db, fee.id)
        db.query(FeePayment).filter(FeePayment.fee_id == fee.id).delete(
            synchronize_session=False
        )
        _activity(db, fee, "status", "Fee reopened.")
        db.flush()
    _recalculate(db, fee)
    return ensure_invoice(db, fee) if paid and fee.status == "Paid" else _invoice_for(db, fee.id)


def backfill_fee_payments():
    db = SessionLocal()
    try:
        for fee in db.query(Fee).all():
            payments = _payments_for(db, fee.id)
            if not payments:
                seeded = _money(fee.amount) if fee.status == "Paid" else _money(fee.paid_amount)
                if seeded > 0:
                    db.add(FeePayment(
                        fee_id=fee.id,
                        amount=seeded,
                        payment_date=fee.paid_date or date.today(),
                        method="Imported",
                        reference="Existing payment",
                    ))
                    db.flush()
            if not fee.process_stage:
                fee.process_stage = "New"
            _recalculate(db, fee)
        db.commit()
    finally:
        db.close()


@router.get("/")
def list_fees(db: Session = Depends(get_db)):
    rows = (
        db.query(Fee, Client.client_name)
        .join(Client, Client.id == Fee.client_id)
        .all()
    )
    fee_ids = [fee.id for fee, _ in rows]
    payments_by_fee = {fee_id: [] for fee_id in fee_ids}
    installments_by_fee = {fee_id: [] for fee_id in fee_ids}
    activities_by_fee = {fee_id: [] for fee_id in fee_ids}
    if fee_ids:
        payments = (
            db.query(FeePayment)
            .filter(FeePayment.fee_id.in_(fee_ids))
            .order_by(FeePayment.payment_date, FeePayment.id)
            .all()
        )
        for payment in payments:
            payments_by_fee.setdefault(payment.fee_id, []).append(payment)
        installments = (
            db.query(FeeInstallment)
            .filter(FeeInstallment.fee_id.in_(fee_ids))
            .order_by(FeeInstallment.due_date, FeeInstallment.id)
            .all()
        )
        for installment in installments:
            installments_by_fee.setdefault(installment.fee_id, []).append(installment)
        activities = (
            db.query(FeeActivity)
            .filter(FeeActivity.fee_id.in_(fee_ids))
            .order_by(FeeActivity.activity_date.desc(), FeeActivity.id.desc())
            .all()
        )
        for activity in activities:
            activities_by_fee.setdefault(activity.fee_id, []).append(activity)

    result = [
        out(
            fee,
            name,
            _invoice_for(db, fee.id),
            payments_by_fee.get(fee.id, []),
            installments_by_fee.get(fee.id, []),
            activities_by_fee.get(fee.id, []),
        )
        for fee, name in rows
    ]
    result.sort(key=lambda item: (item["status"] == "Paid", item["due_date"]))
    return result


@router.post("/", status_code=201)
def create_fee(data: FeeIn, db: Session = Depends(get_db)):
    fee = new_fee(db, data)
    db.add(fee)
    db.flush()
    _activity(db, fee, "created", f"Fee created for {fee.purpose}.")
    db.commit()
    db.refresh(fee)
    return out(fee, db.get(Client, fee.client_id).client_name, payments=[])


@router.get("/{fee_id}/details")
def fee_details(fee_id: int, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    return _details(db, fee)


@router.get("/{fee_id}/payments")
def list_payments(fee_id: int, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    return [_payment_out(payment) for payment in _payments_for(db, fee_id)]


@router.post("/{fee_id}/payments", status_code=201)
def add_payment(fee_id: int, data: PaymentIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    outstanding = _money(fee.amount) - _money(fee.paid_amount)
    amount = _money(data.amount)
    if amount > outstanding:
        raise HTTPException(
            422,
            f"Payment exceeds the outstanding balance of ₹{float(outstanding):,.2f}",
        )
    payment = FeePayment(
        fee_id=fee.id,
        amount=amount,
        payment_date=data.payment_date,
        method=data.method.strip() or "Cash",
        reference=data.reference,
        notes=data.notes,
    )
    db.add(payment)
    db.flush()
    _allocate_installments(db, fee, payment)
    payments = _recalculate(db, fee)
    invoice = ensure_invoice(db, fee) if fee.status == "Paid" else _invoice_for(db, fee.id)
    _activity(
        db,
        fee,
        "payment",
        f"Received {float(amount):,.2f} by {payment.method} on {payment.payment_date.isoformat()}.",
        payment.payment_date,
    )
    db.commit()
    db.refresh(fee)
    return {
        "payment": _payment_out(payment),
        "fee": out(fee, db.get(Client, fee.client_id).client_name, invoice, payments),
        "invoice_id": invoice.id if invoice else None,
        "invoice_no": invoice.invoice_no if invoice else None,
        "details": _details(db, fee),
    }


@router.delete("/{fee_id}/payments/{payment_id}")
def delete_payment(fee_id: int, payment_id: int, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    payment = db.get(FeePayment, payment_id)
    if not payment or payment.fee_id != fee_id:
        raise HTTPException(404, "Payment not found")
    amount = _money(payment.amount)
    deleted_payment = _payment_out(payment)
    _release_installments(db, fee_id, payment_id)
    db.delete(payment)
    db.flush()
    payments = _recalculate(db, fee)
    _activity(db, fee, "payment", f"Removed a payment of {float(amount):,.2f}.")
    db.commit()
    db.refresh(fee)
    return {
        "fee": out(fee, db.get(Client, fee.client_id).client_name, _invoice_for(db, fee.id), payments),
        "deleted_payment": deleted_payment,
    }


@router.patch("/{fee_id}/extend")
def extend_due(fee_id: int, data: ExtendDueIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    if data.due_date <= fee.due_date:
        raise HTTPException(422, "New due date must be later than the current due date")

    old_due = fee.due_date
    days = (data.due_date - old_due).days
    fee.due_date = data.due_date
    if data.expected_date is not None:
        fee.expected_date = data.expected_date
    elif fee.expected_date:
        fee.expected_date = fee.expected_date + timedelta(days=days)

    note = f"Due date extended from {old_due.isoformat()} to {data.due_date.isoformat()} ({days} days)."
    if data.reason:
        note += f" Reason: {data.reason.strip()}"
    fee.notes = _append_note(fee.notes, note)
    _activity(db, fee, "extension", note)

    for installment in _installments_for(db, fee.id):
        if installment.status == "Pending":
            installment.due_date = installment.due_date + timedelta(days=days)

    postponed = 0
    if data.postpone_tasks:
        tasks = db.query(Task).filter(Task.fee_id == fee.id, Task.is_done.is_(False)).all()
        for task in tasks:
            task.due_date = task.due_date + timedelta(days=days)
            task.notes = _append_note(task.notes, note)
            postponed += 1

    db.commit()
    db.refresh(fee)
    return {
        "days_extended": days,
        "tasks_postponed": postponed,
        "fee": out(fee, db.get(Client, fee.client_id).client_name, _invoice_for(db, fee.id)),
        "details": _details(db, fee),
    }


@router.post("/{fee_id}/stage")
def set_stage(fee_id: int, data: StageIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    stage = _validate_stage(data.stage)
    previous = fee.process_stage or "New"
    fee.process_stage = stage
    message = f"Stage changed from {previous} to {stage}."
    if data.note and data.note.strip():
        message += f" {data.note.strip()}"
    _activity(db, fee, "stage", message)
    db.commit()
    db.refresh(fee)
    return {"stage": stage, "details": _details(db, fee)}


@router.post("/{fee_id}/followup")
def set_followup(fee_id: int, data: FollowupIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    fee.next_followup_date = data.next_date
    fee.followup_note = data.note.strip() if data.note else None
    when = data.next_date.isoformat() if data.next_date else "no date"
    _activity(db, fee, "followup", f"Follow-up scheduled for {when}: {fee.followup_note or 'No note'}", data.next_date or date.today())
    db.commit()
    db.refresh(fee)
    return {"details": _details(db, fee)}


@router.post("/{fee_id}/remind")
def remind(fee_id: int, data: ReminderIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    client = db.get(Client, fee.client_id)
    balance = _money(fee.amount) - _money(fee.paid_amount)
    message = (data.message or "").strip() or (
        f"Hello {client.client_name if client else 'there'}, "
        f"a payment of ₹{float(balance):,.2f} is pending toward {fee.purpose}. "
        f"Please arrange the payment by {fee.due_date.isoformat()}."
    )
    emailed = False
    email_error = None
    if data.send_email:
        if not client or not client.email:
            email_error = "Client has no email address"
        else:
            try:
                send_mail(client.email, f"Payment reminder — {fee.purpose}", message)
                emailed = True
            except Exception as exc:
                email_error = str(getattr(exc, "detail", exc))
    if data.next_date:
        fee.next_followup_date = data.next_date
    _activity(
        db,
        fee,
        "reminder",
        f"Reminder {'emailed' if emailed else 'logged'}: {message}" + (f" ({email_error})" if email_error else ""),
        data.next_date or date.today(),
    )
    create_notification(
        db,
        key=f"manual-fee-reminder:{fee.id}:{uuid4().hex[:8]}",
        title=f"Payment reminder · {client.client_name if client else fee.purpose}"[:200],
        body=message[:500],
        kind="Payment",
        link="/fees?status=Pending",
        reset_dismissed=True,
    )
    db.commit()
    return {"emailed": emailed, "error": email_error, "details": _details(db, fee)}


@router.post("/{fee_id}/installments")
def set_installments(fee_id: int, data: InstallmentsIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    outstanding = _money(fee.amount) - _money(fee.paid_amount)
    total = sum((_money(item.amount) for item in data.installments), Decimal("0"))
    if total > outstanding:
        raise HTTPException(
            422,
            f"Installments total more than the outstanding balance of ₹{float(outstanding):,.2f}",
        )
    db.query(FeeInstallment).filter(
        FeeInstallment.fee_id == fee.id,
        FeeInstallment.status == "Pending",
    ).delete(synchronize_session=False)
    for item in data.installments:
        db.add(FeeInstallment(
            fee_id=fee.id,
            amount=_money(item.amount),
            due_date=item.due_date,
            notes=item.notes,
            status="Pending",
        ))
    _activity(db, fee, "plan", f"Payment plan saved with {len(data.installments)} installments.")
    db.commit()
    db.refresh(fee)
    return {"details": _details(db, fee)}


@router.patch("/{fee_id}/installments/{installment_id}")
def update_installment(
    fee_id: int,
    installment_id: int,
    data: InstallmentUpdateIn,
    db: Session = Depends(get_db),
):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    installment = db.get(FeeInstallment, installment_id)
    if not installment or installment.fee_id != fee_id:
        raise HTTPException(404, "Installment not found")

    if data.paid:
        if installment.status == "Paid":
            return {"details": _details(db, fee)}
        outstanding = _money(fee.amount) - _money(fee.paid_amount)
        amount = _money(installment.amount)
        if amount > outstanding:
            raise HTTPException(
                422,
                f"Outstanding balance is only ₹{float(outstanding):,.2f}",
            )
        payment = FeePayment(
            fee_id=fee.id,
            amount=amount,
            payment_date=data.payment_date,
            method=data.method.strip() or "Manual",
            reference=data.reference or "Installment",
        )
        db.add(payment)
        db.flush()
        installment.status = "Paid"
        installment.paid_date = data.payment_date
        installment.payment_id = payment.id
        _recalculate(db, fee)
        if fee.status == "Paid":
            ensure_invoice(db, fee)
        _activity(
            db,
            fee,
            "plan",
            f"Installment of {float(amount):,.2f} marked paid on {data.payment_date.isoformat()}.",
            data.payment_date,
        )
    else:
        if installment.status != "Paid":
            return {"details": _details(db, fee)}
        if installment.payment_id:
            _release_installments(db, fee.id, installment.payment_id)
            payment = db.get(FeePayment, installment.payment_id)
            if payment:
                db.delete(payment)
        installment.status = "Pending"
        installment.paid_date = None
        installment.payment_id = None
        db.flush()
        _recalculate(db, fee)
        _activity(db, fee, "plan", "Installment reopened.")

    db.commit()
    return {"details": _details(db, fee)}


@router.post("/bulk/paid")
def bulk_paid(data: BulkPaid, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(data.ids))
    fees = db.query(Fee).filter(Fee.id.in_(ids)).all() if ids else []
    for fee in fees:
        _mark_paid(db, fee, data.paid)
    db.commit()
    return {"updated": len(fees)}


@router.post("/bulk/delete")
def bulk_delete(data: BulkIds, db: Session = Depends(get_db)):
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        return {"deleted": 0}
    db.query(FeeInstallment).filter(FeeInstallment.fee_id.in_(ids)).delete(synchronize_session=False)
    db.query(FeeActivity).filter(FeeActivity.fee_id.in_(ids)).delete(synchronize_session=False)
    db.query(FeePayment).filter(FeePayment.fee_id.in_(ids)).delete(synchronize_session=False)
    db.query(Invoice).filter(Invoice.fee_id.in_(ids)).delete(synchronize_session=False)
    deleted = db.query(Fee).filter(Fee.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


def new_fee(db: Session, data: FeeIn) -> Fee:
    client = db.get(Client, data.client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    payload = data.model_dump()
    payload["upfront_amount"] = _validate_upfront(data.amount, data.upfront_amount)
    payload["process_stage"] = _validate_stage(data.process_stage)
    return Fee(**payload, status="Pending", paid_amount=0)


@router.put("/{fee_id}")
def update_fee(fee_id: int, data: FeeIn, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    client = db.get(Client, data.client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    paid = _money(fee.paid_amount)
    amount = _money(data.amount)
    if paid > amount:
        raise HTTPException(422, "Amount cannot be less than the payments already received")
    advance = _validate_upfront(data.amount, data.upfront_amount)
    stage = _validate_stage(data.process_stage)
    plan_total = sum(
        (_money(item.amount) for item in _installments_for(db, fee.id) if item.status == "Pending"),
        Decimal("0"),
    )
    if plan_total > amount - paid:
        raise HTTPException(422, "Installment plan is higher than the new outstanding balance")
    payload = data.model_dump()
    payload["upfront_amount"] = advance
    payload["process_stage"] = stage
    for key, value in payload.items():
        setattr(fee, key, value)
    _recalculate(db, fee)
    invoice = _invoice_for(db, fee.id)
    if invoice:
        invoice.client_id = fee.client_id
        invoice.amount = fee.amount
        invoice.purpose = fee.purpose
    _activity(db, fee, "updated", "Fee details updated.")
    db.commit()
    db.refresh(fee)
    return out(fee, client.client_name, _invoice_for(db, fee.id), _payments_for(db, fee.id))


@router.patch("/{fee_id}/paid")
def set_paid(fee_id: int, data: PaidToggle, db: Session = Depends(get_db)):
    fee = db.get(Fee, fee_id)
    if not fee:
        raise HTTPException(404, "Fee not found")
    invoice = _mark_paid(db, fee, data.paid)
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
        raise HTTPException(422, "Receive the full amount before generating an invoice")
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
    db.query(FeeInstallment).filter(FeeInstallment.fee_id == fee.id).delete()
    db.query(FeeActivity).filter(FeeActivity.fee_id == fee.id).delete()
    db.query(FeePayment).filter(FeePayment.fee_id == fee.id).delete()
    db.query(Invoice).filter(Invoice.fee_id == fee.id).delete()
    db.delete(fee)
    db.commit()

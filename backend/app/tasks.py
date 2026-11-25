import calendar
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.auth import get_db
from app.fees import FeeIn, new_fee
from app.models import Client, Fee, Invoice, Service, Task

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])

Recurrence = Literal["None", "Monthly", "Quarterly", "Half-yearly", "Yearly"]


class TaskFeeIn(BaseModel):
    amount: float = Field(gt=0)
    purpose: str | None = Field(default=None, max_length=200)
    expected_date: date | None = None
    reference_person: str | None = Field(default=None, max_length=150)
    notes: str | None = None


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    due_date: date
    due_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    priority: Literal["Normal", "High"] = "Normal"
    client_id: int | None = None
    service_id: int | None = None
    recurrence: Recurrence = "None"
    recurrence_end: date | None = None
    fee: TaskFeeIn | None = None

    @model_validator(mode="after")
    def validate_recurrence(self):
        if self.recurrence_end and self.recurrence_end < self.due_date:
            raise ValueError("Repeat-until date cannot be before the due date")
        if self.recurrence == "None" and self.recurrence_end:
            raise ValueError("Repeat-until date requires a recurrence")
        if self.fee and not self.client_id:
            raise ValueError("A fee requires a client")
        return self


class DoneToggle(BaseModel):
    done: bool


class PostponeIn(BaseModel):
    due_date: date
    reason: str | None = Field(default=None, max_length=300)
    extend_fee: bool = False


def _append_note(current: str | None, addition: str) -> str:
    return f"{current}\n{addition}" if current else addition


def out(t: Task, client_name: str | None = None, service_name: str | None = None,
        fee: Fee | None = None):
    return {
        "id": t.id, "title": t.title, "notes": t.notes, "due_date": t.due_date,
        "due_time": t.due_time, "priority": t.priority, "is_done": t.is_done, "client_id": t.client_id,
        "client_name": client_name,
        "service_id": t.service_id,
        "service_name": service_name,
        "recurrence": t.recurrence or "None",
        "recurrence_end": t.recurrence_end,
        "period": t.period,
        "auto_generated": t.auto_generated,
        "fee_id": t.fee_id,
        "fee_amount": float(fee.amount) if fee and fee.amount is not None else None,
        "fee_purpose": fee.purpose if fee else None,
        "fee_expected_date": fee.expected_date if fee else None,
        "fee_status": fee.status if fee else None,
    }


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _next_due(value: date, recurrence: str) -> date | None:
    if recurrence == "Monthly":
        return _add_months(value, 1)
    if recurrence == "Quarterly":
        return _add_months(value, 3)
    if recurrence == "Half-yearly":
        return _add_months(value, 6)
    if recurrence == "Yearly":
        return _add_months(value, 12)
    return None


MAX_TASK_SERIES = 24


def _series(start: date, recurrence: str, end: date | None) -> list[date]:
    if recurrence == "None":
        return [start]
    horizon = end or _add_months(start, 60)
    dates = [start]
    current = start
    while True:
        current = _next_due(current, recurrence)
        if not current or current > horizon:
            break
        if len(dates) >= MAX_TASK_SERIES:
            raise HTTPException(
                status_code=422,
                detail=f"Recurring tasks are limited to {MAX_TASK_SERIES} occurrences",
            )
        dates.append(current)
    return dates


def _client_name(db: Session, client_id: int | None) -> str | None:
    if not client_id:
        return None
    client = db.get(Client, client_id)
    return client.client_name if client else None


def _service_name(db: Session, service_id: int | None) -> str | None:
    if not service_id:
        return None
    service = db.get(Service, service_id)
    return service.name if service else None


@router.get("/")
def list_tasks(db: Session = Depends(get_db)):
    rows = (
        db.query(Task, Client.client_name, Service.name, Fee)
        .outerjoin(Client, Client.id == Task.client_id)
        .outerjoin(Service, Service.id == Task.service_id)
        .outerjoin(Fee, Fee.id == Task.fee_id)
        .order_by(Task.is_done, Task.due_date, Task.due_time, Task.priority)
        .all()
    )
    return [out(t, client_name, service_name, fee)
            for t, client_name, service_name, fee in rows]


@router.post("/", status_code=201)
def create_task(data: TaskIn, db: Session = Depends(get_db)):
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    if data.service_id and not db.get(Service, data.service_id):
        raise HTTPException(404, "Service not found")

    payload = data.model_dump(exclude={"fee"})
    recurrence = payload.get("recurrence") or "None"
    dates = _series(payload["due_date"], recurrence, payload.get("recurrence_end"))

    fee = None
    if data.fee:
        fee = new_fee(db, FeeIn(
            client_id=data.client_id,
            purpose=data.fee.purpose or payload["title"],
            amount=data.fee.amount,
            due_date=dates[0],
            expected_date=data.fee.expected_date,
            reference_person=data.fee.reference_person,
            notes=data.fee.notes,
        ))
        db.add(fee)
        db.flush()

    created = []
    for index, due in enumerate(dates):
        task = Task(**{**payload, "due_date": due, "fee_id": fee.id if fee else None})
        if index > 0:
            task.auto_generated = True
        db.add(task)
        created.append(task)
    db.commit()
    db.refresh(created[0])
    if fee:
        db.refresh(fee)
    return out(created[0], _client_name(db, created[0].client_id),
               _service_name(db, created[0].service_id), fee)


@router.put("/{task_id}")
def update_task(task_id: int, data: TaskIn, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    if data.service_id and not db.get(Service, data.service_id):
        raise HTTPException(404, "Service not found")
    if t.fee_id and not data.client_id:
        raise HTTPException(422, "A task with a linked fee must have a client")

    payload = data.model_dump(exclude={"fee"})
    for k, v in payload.items():
        setattr(t, k, v)

    fee = db.get(Fee, t.fee_id) if t.fee_id else None
    if data.fee:
        fee_data = FeeIn(
            client_id=data.client_id,
            purpose=data.fee.purpose or payload["title"],
            amount=data.fee.amount,
            due_date=payload["due_date"],
            expected_date=data.fee.expected_date,
            reference_person=data.fee.reference_person,
            notes=data.fee.notes,
        )
        if fee:
            for key, value in fee_data.model_dump().items():
                setattr(fee, key, value)
            invoice = db.query(Invoice).filter(Invoice.fee_id == fee.id).first()
            if invoice:
                invoice.client_id = fee.client_id
                invoice.amount = fee.amount
                invoice.purpose = fee.purpose
        else:
            fee = new_fee(db, fee_data)
            db.add(fee)
            db.flush()
            t.fee_id = fee.id

    db.commit()
    db.refresh(t)
    if fee:
        db.refresh(fee)
    return out(t, _client_name(db, t.client_id), _service_name(db, t.service_id), fee)


@router.patch("/{task_id}/done")
def set_done(task_id: int, data: DoneToggle, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    t.is_done = data.done
    t.done_at = datetime.now() if data.done else None
    db.commit()
    return {"is_done": t.is_done}


@router.patch("/{task_id}/postpone")
def postpone_task(task_id: int, data: PostponeIn, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if data.due_date <= t.due_date:
        raise HTTPException(422, "New due date must be later than the current due date")

    old_due = t.due_date
    days = (data.due_date - old_due).days
    note = f"Task postponed from {old_due.isoformat()} to {data.due_date.isoformat()} ({days} days)."
    if data.reason:
        note += f" Reason: {data.reason.strip()}"
    t.due_date = data.due_date
    t.notes = _append_note(t.notes, note)

    fee_updated = False
    if data.extend_fee and t.fee_id:
        fee = db.get(Fee, t.fee_id)
        if fee and data.due_date > fee.due_date:
            fee_days = (data.due_date - fee.due_date).days
            fee.due_date = data.due_date
            if fee.expected_date:
                fee.expected_date = fee.expected_date + timedelta(days=fee_days)
            fee.notes = _append_note(fee.notes, note)
            fee_updated = True

    db.commit()
    db.refresh(t)
    return {
        "days_postponed": days,
        "fee_updated": fee_updated,
        "task": out(t, _client_name(db, t.client_id), _service_name(db, t.service_id),
                    db.get(Fee, t.fee_id) if t.fee_id else None),
    }


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    db.delete(t)
    db.commit()


@router.post("/generate")
def generate_deadlines():
    from app.recurrence import generate_all

    return generate_all()

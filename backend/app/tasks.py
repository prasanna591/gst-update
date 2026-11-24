import calendar
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.auth import get_db
from app.models import Client, Service, Task

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])

Recurrence = Literal["None", "Monthly", "Quarterly", "Half-yearly", "Yearly"]


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    due_date: date
    priority: Literal["Normal", "High"] = "Normal"
    client_id: int | None = None
    service_id: int | None = None
    recurrence: Recurrence = "None"
    recurrence_end: date | None = None

    @model_validator(mode="after")
    def validate_recurrence(self):
        if self.recurrence_end and self.recurrence_end < self.due_date:
            raise ValueError("Repeat-until date cannot be before the due date")
        if self.recurrence == "None" and self.recurrence_end:
            raise ValueError("Repeat-until date requires a recurrence")
        return self


class DoneToggle(BaseModel):
    done: bool


def out(t: Task, client_name: str | None = None, service_name: str | None = None):
    return {
        "id": t.id, "title": t.title, "notes": t.notes, "due_date": t.due_date,
        "priority": t.priority, "is_done": t.is_done, "client_id": t.client_id,
        "client_name": client_name,
        "service_id": t.service_id,
        "service_name": service_name,
        "recurrence": t.recurrence or "None",
        "recurrence_end": t.recurrence_end,
        "period": t.period,
        "auto_generated": t.auto_generated,
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
        db.query(Task, Client.client_name, Service.name)
        .outerjoin(Client, Client.id == Task.client_id)
        .outerjoin(Service, Service.id == Task.service_id)
        .order_by(Task.is_done, Task.due_date, Task.priority)
        .all()
    )
    return [out(t, client_name, service_name) for t, client_name, service_name in rows]


@router.post("/", status_code=201)
def create_task(data: TaskIn, db: Session = Depends(get_db)):
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    if data.service_id and not db.get(Service, data.service_id):
        raise HTTPException(404, "Service not found")

    payload = data.model_dump()
    recurrence = payload.get("recurrence") or "None"
    dates = _series(payload["due_date"], recurrence, payload.get("recurrence_end"))

    created = []
    for index, due in enumerate(dates):
        task = Task(**{**payload, "due_date": due})
        if index > 0:
            task.auto_generated = True
        db.add(task)
        created.append(task)
    db.commit()
    db.refresh(created[0])
    return out(created[0], _client_name(db, created[0].client_id),
               _service_name(db, created[0].service_id))


@router.put("/{task_id}")
def update_task(task_id: int, data: TaskIn, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    if data.service_id and not db.get(Service, data.service_id):
        raise HTTPException(404, "Service not found")
    for k, v in data.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return out(t, _client_name(db, t.client_id), _service_name(db, t.service_id))


@router.patch("/{task_id}/done")
def set_done(task_id: int, data: DoneToggle, db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    t.is_done = data.done
    t.done_at = datetime.now() if data.done else None
    db.commit()
    return {"is_done": t.is_done}


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

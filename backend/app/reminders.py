import calendar
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.auth import get_db
from app.models import Client, Fee, Filing, ImportantDate, Task

router = APIRouter(prefix="/api/reminders", tags=["Reminders"])
WINDOW = 7


class DateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: Literal["Registration", "Anniversary", "Deadline", "Custom"] = "Custom"
    event_date: date
    repeat_yearly: bool = True
    repeat_frequency: Literal["None", "Every N days", "Monthly", "Yearly"] | None = None
    repeat_interval: int | None = Field(default=7, ge=1, le=3650)
    client_id: int | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def normalize_repeat(self):
        if self.repeat_frequency is None:
            self.repeat_frequency = "Yearly" if self.repeat_yearly else "None"
        if self.repeat_frequency == "Every N days" and not self.repeat_interval:
            raise ValueError("Repeat interval is required")
        if self.repeat_frequency != "Every N days":
            self.repeat_interval = None
        self.repeat_yearly = self.repeat_frequency == "Yearly"
        return self


def next_occurrence(
    d: date,
    today: date,
    frequency: str = "Yearly",
    interval: int | None = None,
) -> date:
    if frequency == "None":
        return d

    if frequency == "Every N days":
        step = max(1, interval or 7)
        elapsed = (today - d).days
        if elapsed <= 0:
            return d
        cycles = (elapsed + step - 1) // step
        return d + timedelta(days=cycles * step)

    if frequency == "Monthly":
        def on_month(year: int, month: int) -> date:
            return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))

        year, month = today.year, today.month
        candidate = on_month(year, month)
        if candidate < today:
            month += 1
            if month > 12:
                month = 1
                year += 1
            candidate = on_month(year, month)
        return candidate

    def on_year(y):
        try:
            return d.replace(year=y)
        except ValueError:                 # 29 Feb in a non-leap year
            return date(y, 3, 1)
    n = on_year(today.year)
    return n if n >= today else on_year(today.year + 1)


def date_items(db: Session, today: date):
    items = []
    for c in db.query(Client).filter(Client.date_of_birth.isnot(None)).all():
        n = next_occurrence(c.date_of_birth, today)
        items.append({"key": f"b{c.id}", "id": None, "source": "birthday", "kind": "Birthday",
                      "title": f"{c.client_name}'s birthday", "date": n,
                      "days": (n - today).days, "client_name": c.client_name,
                      "repeat_yearly": True, "repeat_frequency": "Yearly", "repeat_interval": None,
                      "notes": None, "client_id": c.id, "event_date": c.date_of_birth})
    rows = (db.query(ImportantDate, Client.client_name)
              .outerjoin(Client, Client.id == ImportantDate.client_id).all())
    for d, cname in rows:
        frequency = d.repeat_frequency or ("Yearly" if d.repeat_yearly else "None")
        interval = d.repeat_interval or 7
        n = next_occurrence(d.event_date, today, frequency, interval)
        items.append({"key": f"d{d.id}", "id": d.id, "source": "custom", "kind": d.kind,
                      "title": d.title, "date": n, "days": (n - today).days,
                      "client_name": cname, "repeat_yearly": frequency == "Yearly",
                      "repeat_frequency": frequency,
                      "repeat_interval": interval if frequency == "Every N days" else None,
                      "notes": d.notes, "client_id": d.client_id, "event_date": d.event_date})
    return sorted(items, key=lambda x: x["days"])


@router.get("/dates")
def list_dates(db: Session = Depends(get_db)):
    return date_items(db, date.today())


@router.post("/dates", status_code=201)
def create_date(data: DateIn, db: Session = Depends(get_db)):
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    d = ImportantDate(**data.model_dump())
    db.add(d); db.commit()
    return {"id": d.id}


@router.put("/dates/{date_id}")
def update_date(date_id: int, data: DateIn, db: Session = Depends(get_db)):
    d = db.get(ImportantDate, date_id)
    if not d:
        raise HTTPException(404, "Not found")
    if data.client_id and not db.get(Client, data.client_id):
        raise HTTPException(404, "Client not found")
    for k, v in data.model_dump().items():
        setattr(d, k, v)
    db.commit()
    return {"id": d.id}


@router.delete("/dates/{date_id}", status_code=204)
def delete_date(date_id: int, db: Session = Depends(get_db)):
    d = db.get(ImportantDate, date_id)
    if not d:
        raise HTTPException(404, "Not found")
    db.delete(d); db.commit()


@router.get("/upcoming")
def upcoming(db: Session = Depends(get_db)):
    today = date.today()
    names = {c.id: c.client_name for c in db.query(Client).all()}
    out = []

    for f in db.query(Filing).filter(Filing.status != "Filed").all():
        days = (f.due_date - today).days
        if days <= WINDOW:
            out.append({"type": "Filing", "title": names.get(f.client_id, "Client"),
                        "subtitle": f"{f.return_type} · {f.period}", "days": days, "link": "/filings"})

    for f in db.query(Fee).filter(Fee.status == "Pending").all():
        days = (f.due_date - today).days
        if days <= WINDOW:
            out.append({"type": "Fee", "title": names.get(f.client_id, "Client"),
                        "subtitle": f"Fee ₹{float(f.amount):,.0f} · {f.purpose}", "days": days, "link": "/fees"})

    for t in db.query(Task).filter(Task.is_done == False).all():
        days = (t.due_date - today).days
        if days <= 0 or (t.priority == "High" and days <= 3):
            out.append({"type": "Task", "title": t.title,
                        "subtitle": "Important task" if t.priority == "High" else "Task",
                        "days": days, "link": "/tasks"})

    for i in date_items(db, today):
        if 0 <= i["days"] <= WINDOW:
            out.append({"type": i["kind"], "title": i["title"],
                        "subtitle": i["client_name"] or i["kind"], "days": i["days"], "link": "/dates"})

    return sorted(out, key=lambda x: x["days"])
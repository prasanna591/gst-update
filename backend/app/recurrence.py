import calendar
import threading
import time
from datetime import date

from app.database import SessionLocal
from app.models import Client, ClientService, Service, Task

_FREQUENCIES = {
    "Monthly": 1,
    "Quarterly": 3,
    "Half-yearly": 6,
    "Yearly": 12,
}


def _at_month(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _next_due(service: Service, today: date) -> tuple[date, str]:
    frequency = service.frequency if service.frequency in _FREQUENCIES else "Monthly"
    step = _FREQUENCIES[frequency]
    day = min(max(service.due_day or 20, 1), 31)

    if frequency == "Monthly":
        anchor = 1
    else:
        anchor = service.due_month if service.due_month and 1 <= service.due_month <= 12 else 1

    anchor_index = (today.year - 1) * 12 + anchor - 1
    today_index = (today.year - 1) * 12 + today.month - 1
    cycles = max(0, (today_index - anchor_index) // step)

    while True:
        index = anchor_index + cycles * step
        year, month = index // 12 + 1, index % 12 + 1
        due = _at_month(year, month, day)
        if due >= today:
            break
        cycles += 1

    if frequency == "Monthly":
        period = f"{year:04d}-{month:02d}"
    elif frequency == "Quarterly":
        period = f"{year:04d}-Q{(month - 1) // 3 + 1}"
    elif frequency == "Half-yearly":
        period = f"{year:04d}-H{(month - 1) // 6 + 1}"
    else:
        period = f"{year:04d}"
    return due, period


def generate_all() -> dict:
    db = SessionLocal()
    created = updated = checked = 0
    try:
        assignments = (
            db.query(ClientService, Client, Service)
            .join(Client, Client.id == ClientService.client_id)
            .join(Service, Service.id == ClientService.service_id)
            .filter(
                ClientService.is_active.is_(True),
                Client.is_active.is_(True),
                Service.is_active.is_(True),
            )
            .all()
        )
        if not assignments:
            return {"created": 0, "updated": 0, "checked": 0}

        client_ids = {client.id for _, client, _ in assignments}
        service_ids = {service.id for _, _, service in assignments}
        existing = (
            db.query(Task)
            .filter(
                Task.auto_generated.is_(True),
                Task.client_id.in_(client_ids),
                Task.service_id.in_(service_ids),
            )
            .all()
        )
        by_period = {
            (task.client_id, task.service_id, task.period): task
            for task in existing
        }

        today = date.today()
        for _, client, service in assignments:
            checked += 1
            due, period = _next_due(service, today)
            task = by_period.get((client.id, service.id, period))
            if task:
                if not task.is_done and task.due_date != due:
                    task.due_date = due
                    updated += 1
                continue

            task = Task(
                title=service.name,
                notes=f"Automatically generated deadline for {client.client_name}.",
                due_date=due,
                priority="Normal",
                client_id=client.id,
                service_id=service.id,
                period=period,
                auto_generated=True,
                recurrence=service.frequency if service.frequency in _FREQUENCIES else "None",
            )
            db.add(task)
            by_period[(client.id, service.id, period)] = task
            created += 1

        db.commit()
        return {"created": created, "updated": updated, "checked": checked}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _loop():
    while True:
        try:
            generate_all()
        except Exception:
            pass
        time.sleep(6 * 60 * 60)


def start_recurrence():
    threading.Thread(target=_loop, daemon=True).start()

import threading
import time
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_db, require_admin
from app.database import SessionLocal
from app.models import Client, Fee, Filing, Notification, NotificationRule, Task
from app.reminders import date_items

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
WINDOW = 7
_started = False
_lock = threading.Lock()

DEFAULT_RULES = {
    "Filing": {
        "label": "Filing deadlines",
        "lead_days": 7,
        "enabled": True,
        "include_overdue": True,
        "link": "/filings",
    },
    "Fee": {
        "label": "Fee due dates",
        "lead_days": 7,
        "enabled": True,
        "include_overdue": True,
        "link": "/fees",
    },
    "Task": {
        "label": "Task due dates",
        "lead_days": 7,
        "enabled": True,
        "include_overdue": True,
        "link": "/tasks",
    },
    "Date": {
        "label": "Client dates",
        "lead_days": 7,
        "enabled": True,
        "include_overdue": False,
        "link": "/dates",
    },
}
GENERATED_PREFIXES = {"filing", "fee", "task", "date"}


class MarkRead(BaseModel):
    read: bool = True


class RuleIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    lead_days: int = Field(ge=0, le=365)
    enabled: bool = True
    include_overdue: bool = True
    link: str = Field(default="/", max_length=200)


def _days_text(days: int) -> str:
    if days < 0:
        return f"{-days} day{'s' if days != -1 else ''} overdue"
    if days == 0:
        return "due today"
    return f"due in {days} day{'s' if days != 1 else ''}"


def _rule_out(rule: NotificationRule) -> dict:
    return {
        "kind": rule.kind,
        "label": rule.label,
        "lead_days": rule.lead_days,
        "enabled": bool(rule.enabled),
        "include_overdue": bool(rule.include_overdue),
        "link": rule.link,
    }


def _rules(db: Session) -> dict[str, NotificationRule]:
    rules = {rule.kind: rule for rule in db.query(NotificationRule).all()}
    for kind, values in DEFAULT_RULES.items():
        if kind not in rules:
            rule = NotificationRule(kind=kind, **values)
            db.add(rule)
            db.flush()
            rules[kind] = rule
    db.commit()
    return rules


def _candidates(db: Session, today: date) -> dict[str, dict]:
    items: dict[str, dict] = {}
    rules = _rules(db)

    def include(kind: str, days: int) -> bool:
        rule = rules.get(kind)
        if not rule or not rule.enabled:
            return False
        if days > rule.lead_days:
            return False
        if days < 0 and not rule.include_overdue:
            return False
        return True

    filings = (
        db.query(Filing, Client.client_name)
        .outerjoin(Client, Client.id == Filing.client_id)
        .filter(Filing.status != "Filed")
        .all()
    )
    for filing, client_name in filings:
        days = (filing.due_date - today).days
        if not include("Filing", days):
            continue
        name = client_name or "Client"
        key = f"filing:{filing.id}:{filing.due_date.isoformat()}"
        items[key] = {
            "title": f"{name}: {filing.return_type} filing",
            "body": f"{filing.period} · {_days_text(days)}",
            "kind": "Filing",
            "link": rules["Filing"].link,
        }

    fees = (
        db.query(Fee, Client.client_name)
        .outerjoin(Client, Client.id == Fee.client_id)
        .filter(Fee.status == "Pending")
        .all()
    )
    for fee, client_name in fees:
        days = (fee.due_date - today).days
        if not include("Fee", days):
            continue
        name = client_name or "Client"
        key = f"fee:{fee.id}:{fee.due_date.isoformat()}"
        items[key] = {
            "title": f"{name}: payment due",
            "body": f"₹{float(fee.amount):,.0f} · {fee.purpose} · {_days_text(days)}",
            "kind": "Fee",
            "link": rules["Fee"].link,
        }

    tasks = db.query(Task).filter(Task.is_done.is_(False)).all()
    for task in tasks:
        days = (task.due_date - today).days
        if not include("Task", days):
            continue
        key = f"task:{task.id}:{task.due_date.isoformat()}"
        items[key] = {
            "title": task.title,
            "body": _days_text(days),
            "kind": "Task",
            "link": rules["Task"].link,
        }

    for item in date_items(db, today):
        if not include("Date", item["days"]):
            continue
        key = f"date:{item['key']}:{item['date'].isoformat()}"
        items[key] = {
            "title": item["title"],
            "body": _days_text(item["days"]),
            "kind": item["kind"],
            "link": rules["Date"].link,
        }

    return items


def sync_notifications(db: Session) -> None:
    today = date.today()
    wanted = _candidates(db, today)
    existing = {
        notification.key: notification
        for notification in db.query(Notification).all()
    }
    for key, data in wanted.items():
        notification = existing.get(key)
        if notification:
            notification.title = data["title"]
            notification.body = data["body"]
            notification.kind = data["kind"]
            notification.link = data["link"]
        else:
            db.add(Notification(key=key, **data))
    for key, notification in existing.items():
        if key not in wanted and key.split(":", 1)[0] in GENERATED_PREFIXES:
            db.delete(notification)
    db.commit()


@router.get("")
def list_notifications(user=Depends(get_current_user), db: Session = Depends(get_db)):
    sync_notifications(db)
    return (
        db.query(Notification)
        .order_by(Notification.is_read, Notification.created_at.desc())
        .all()
    )


@router.get("/rules")
def list_rules(db: Session = Depends(get_db), user=Depends(require_admin)):
    _rules(db)
    rows = db.query(NotificationRule).order_by(NotificationRule.id.asc()).all()
    return [_rule_out(row) for row in rows]


@router.post("/rules/reset")
def reset_rules(db: Session = Depends(get_db), user=Depends(require_admin)):
    db.query(NotificationRule).delete()
    db.commit()
    _rules(db)
    rows = db.query(NotificationRule).order_by(NotificationRule.id.asc()).all()
    return [_rule_out(row) for row in rows]


@router.put("/rules/{kind}")
def update_rule(
    kind: str,
    payload: RuleIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    rules = _rules(db)
    rule = rules.get(kind)
    if not rule:
        raise HTTPException(404, "Notification rule not found")
    for field, value in payload.model_dump().items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.patch("/{notification_id}/read")
def mark_read(
    notification_id: int,
    payload: MarkRead,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notification = db.get(Notification, notification_id)
    if not notification:
        raise HTTPException(404, "Notification not found")
    notification.is_read = payload.read
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def read_all(user=Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.is_read.is_(False)).update(
        {"is_read": True}
    )
    db.commit()
    return {"ok": True}


def _loop():
    while True:
        db = SessionLocal()
        try:
            sync_notifications(db)
        except Exception:
            db.rollback()
        finally:
            db.close()
        time.sleep(15 * 60)


def start_notifications():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, daemon=True).start()

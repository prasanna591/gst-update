import csv
import json
from datetime import date, datetime, time
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, true
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user, get_db
from app.models import Client, Document, Fee, Filing, ReportTemplate, Task, User

router = APIRouter(prefix="/api/reports", tags=["Reports"])

SECTIONS = {"clients", "filings", "fees", "tasks", "documents", "summary"}
DATE_SECTIONS = {"clients", "filings", "fees", "tasks", "documents"}
STATUS_SECTIONS = {"filings", "fees", "tasks"}
STATUS_VALUES = {
    "filings": {"Pending", "Filed", "Overdue"},
    "fees": {"Pending", "Partial", "Paid", "Overdue"},
    "tasks": {"Pending", "Done", "Overdue"},
}


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    section: str
    config: dict


def _template_out(row: ReportTemplate) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "section": row.section,
        "config": json.loads(row.config),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _own_template(db: Session, template_id: int, user_id: int) -> ReportTemplate:
    row = db.get(ReportTemplate, template_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Report template not found")
    return row


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        db.query(ReportTemplate)
        .filter(ReportTemplate.user_id == user.id)
        .order_by(ReportTemplate.name.asc())
        .all()
    )
    return [_template_out(row) for row in rows]


@router.post("/templates", status_code=201)
def create_template(
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if payload.section not in SECTIONS:
        raise HTTPException(status_code=400, detail="Invalid section")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    duplicate = (
        db.query(ReportTemplate)
        .filter(ReportTemplate.user_id == user.id, ReportTemplate.name == name)
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    row = ReportTemplate(
        user_id=user.id,
        name=name,
        section=payload.section,
        config=json.dumps(payload.config),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _own_template(db, template_id, user.id)
    if payload.section not in SECTIONS:
        raise HTTPException(status_code=400, detail="Invalid section")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Template name is required")
    duplicate = (
        db.query(ReportTemplate)
        .filter(
            ReportTemplate.user_id == user.id,
            ReportTemplate.name == name,
            ReportTemplate.id != template_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A template with this name already exists")
    row.name = name
    row.section = payload.section
    row.config = json.dumps(payload.config)
    db.commit()
    db.refresh(row)
    return _template_out(row)


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    row = _own_template(db, template_id, user.id)
    db.delete(row)
    db.commit()


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid date: {value}") from None


def _client_name_by_id(db: Session, client_id: int | None) -> str | None:
    if not client_id:
        return None
    client = db.get(Client, client_id)
    return client.client_name if client else None


def _serialize_client(row: Client) -> dict:
    return {
        "id": row.id,
        "client_name": row.client_name,
        "business_name": row.business_name,
        "email": row.email,
        "phone": row.phone,
        "gstin": row.gstin,
        "pan": row.pan,
        "is_active": row.is_active,
        "date_of_birth": row.date_of_birth.isoformat() if row.date_of_birth else None,
        "auditor_id": row.auditor_id,
    }


def _serialize_filing(db: Session, row: Filing) -> dict:
    due = row.due_date
    today = date.today()
    overdue = due is not None and row.status != "Filed" and due < today
    return {
        "id": row.id,
        "client_id": row.client_id,
        "client_name": _client_name_by_id(db, row.client_id),
        "return_type": row.return_type,
        "period": row.period,
        "due_date": due.isoformat() if due else None,
        "filed_date": row.filed_date.isoformat() if row.filed_date else None,
        "status": row.status,
        "arn": row.arn,
        "overdue": overdue,
    }


def _serialize_fee(db: Session, row: Fee) -> dict:
    due = row.due_date
    today = date.today()
    overdue = due is not None and row.status != "Paid" and due < today
    return {
        "id": row.id,
        "client_id": row.client_id,
        "client_name": _client_name_by_id(db, row.client_id),
        "purpose": row.purpose,
        "amount": float(row.amount),
        "paid_amount": float(row.paid_amount or 0),
        "balance": float(max(row.amount - (row.paid_amount or 0), 0)),
        "due_date": due.isoformat() if due else None,
        "expected_date": row.expected_date.isoformat() if row.expected_date else None,
        "paid_date": row.paid_date.isoformat() if row.paid_date else None,
        "status": row.status,
        "overdue": overdue,
    }


def _serialize_task(db: Session, row: Task) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "notes": row.notes,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "due_time": row.due_time,
        "priority": row.priority,
        "is_done": row.is_done,
        "done_at": row.done_at.isoformat() if row.done_at else None,
        "client_id": row.client_id,
        "client_name": _client_name_by_id(db, row.client_id),
        "service_id": row.service_id,
        "period": row.period,
        "auto_generated": row.auto_generated,
        "recurrence": row.recurrence,
        "recurrence_end": row.recurrence_end.isoformat() if row.recurrence_end else None,
    }


def _serialize_document(db: Session, row: Document) -> dict:
    return {
        "id": row.id,
        "client_id": row.client_id,
        "client_name": _client_name_by_id(db, row.client_id),
        "category": row.category,
        "title": row.title,
        "original_filename": row.original_filename,
        "size_bytes": row.size_bytes,
        "content_type": row.content_type,
        "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
        "uploaded_by_name": row.uploaded_by_name,
    }


def _apply_section_filters(query, section, client_id, status, return_type, date_field, from_date, to_date):
    if client_id is not None:
        query = query.filter(_model_client_column(section) == client_id)

    if section in STATUS_SECTIONS and status:
        if status not in STATUS_VALUES[section]:
            raise HTTPException(status_code=400, detail=f"Unsupported status: {status}")
        today = date.today()
        if section == "filings":
            if status == "Filed":
                query = query.filter(Filing.status == "Filed")
            elif status == "Pending":
                query = query.filter(Filing.status != "Filed")
            else:
                query = query.filter(
                    Filing.status != "Filed",
                    Filing.due_date.isnot(None),
                    Filing.due_date < today,
                )
        elif section == "fees":
            if status == "Paid":
                query = query.filter(Fee.status == "Paid")
            elif status == "Partial":
                query = query.filter(Fee.status == "Partial")
            elif status == "Pending":
                query = query.filter(Fee.status == "Pending")
            else:
                query = query.filter(
                    Fee.status != "Paid",
                    Fee.due_date.isnot(None),
                    Fee.due_date < today,
                )
        elif status == "Done":
            query = query.filter(Task.is_done == true())
        elif status == "Pending":
            query = query.filter(Task.is_done != true())
        else:
            query = query.filter(
                Task.is_done != true(),
                Task.due_date.isnot(None),
                Task.due_date < today,
            )

    if section == "filings" and return_type:
        query = query.filter(Filing.return_type == return_type)

    if section in DATE_SECTIONS and date_field and (from_date or to_date):
        column = _model_date_column(section, date_field)
        conditions = []
        if from_date:
            conditions.append(column >= from_date)
        if to_date:
            if section == "documents":
                conditions.append(func.date(column) <= to_date)
            else:
                conditions.append(column <= to_date)
        if conditions:
            query = query.filter(and_(*conditions))

    return query


def _model_client_column(section):
    if section == "filings":
        return Filing.client_id
    if section == "fees":
        return Fee.client_id
    if section == "tasks":
        return Task.client_id
    if section == "documents":
        return Document.client_id
    return Client.id


def _model_status_column(section):
    if section == "filings":
        return Filing.status
    if section == "fees":
        return Fee.status
    return Task.is_done


def _model_date_column(section, date_field):
    if section == "clients":
        return Client.date_of_birth
    if section == "filings":
        if date_field == "filed_date":
            return Filing.filed_date
        return Filing.due_date
    if section == "fees":
        if date_field == "paid_date":
            return Fee.paid_date
        if date_field == "expected_date":
            return Fee.expected_date
        return Fee.due_date
    if section == "tasks":
        return Task.due_date
    return Document.uploaded_at


def _serialize_row(section, db, row):
    if section == "clients":
        return _serialize_client(row)
    if section == "filings":
        return _serialize_filing(db, row)
    if section == "fees":
        return _serialize_fee(db, row)
    if section == "tasks":
        return _serialize_task(db, row)
    return _serialize_document(db, row)


def _group_key(row, section, group_by):
    if group_by == "client":
        return row.get("client_name") or "Unassigned"
    if group_by == "status":
        if section == "tasks":
            return "Done" if row.get("is_done") else "Pending"
        return row.get("status") or "Unknown"
    if group_by == "return_type":
        return row.get("return_type") or "Unknown"
    if group_by == "month":
        date_value = None
        if section == "clients":
            date_value = row.get("date_of_birth")
        elif section == "filings":
            date_value = row.get("due_date")
        elif section == "fees":
            date_value = row.get("due_date")
        elif section == "tasks":
            date_value = row.get("due_date")
        elif section == "documents":
            date_value = row.get("uploaded_at")
        if date_value:
            if isinstance(date_value, str):
                try:
                    date_value = datetime.fromisoformat(date_value)
                except ValueError:
                    return "Undated"
            return date_value.strftime("%Y-%m")
        return "Undated"
    return "All"


def _summary_counts(db, client_id):
    clients = db.query(Client).all()
    filings = db.query(Filing).all()
    fees = db.query(Fee).all()
    documents = db.query(Document).all()

    if client_id:
        clients = [c for c in clients if c.id == client_id]
        filings = [f for f in filings if f.client_id == client_id]
        fees = [f for f in fees if f.client_id == client_id]
        documents = [d for d in documents if d.client_id == client_id]

    today = date.today()
    pending_filings = [f for f in filings if f.status != "Filed"]
    overdue_filings = [f for f in pending_filings if f.due_date and f.due_date < today]
    pending_fees = [f for f in fees if f.status != "Paid"]
    overdue_fees = [f for f in pending_fees if f.due_date and f.due_date < today]
    paid_fees = [f for f in fees if f.status == "Paid"]

    return {
        "clients": {
            "total": len(clients),
            "active": sum(1 for c in clients if c.is_active),
            "inactive": sum(1 for c in clients if not c.is_active),
        },
        "filings": {
            "total": len(filings),
            "pending": len(pending_filings),
            "overdue": len(overdue_filings),
            "filed": sum(1 for f in filings if f.status == "Filed"),
        },
        "fees": {
            "total": len(fees),
            "pending": len(pending_fees),
            "overdue": len(overdue_fees),
            "paid": len(paid_fees),
            "received": float(sum(f.paid_amount or 0 for f in fees)),
            "outstanding": float(sum(f.amount - (f.paid_amount or 0) for f in pending_fees)),
        },
        "documents": len(documents),
    }


@router.get("")
def reports(
    section: str = Query(default="summary"),
    client_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    return_type: str | None = Query(default=None),
    date_field: str | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    group_by: str | None = Query(default=None),
    format: str = Query(default="json"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if section not in SECTIONS:
        raise HTTPException(status_code=400, detail="Invalid section")

    if format not in {"json", "csv"}:
        raise HTTPException(status_code=400, detail="Invalid format")

    if status and status not in STATUS_VALUES.get(section, set()):
        raise HTTPException(
            status_code=400,
            detail=f"Status '{status}' is not supported for the {section} section",
        )

    if section == "summary":
        data = _summary_counts(db, client_id)
        if format == "csv":
            buffer = StringIO()
            writer = csv.writer(buffer)
            writer.writerow(["section", "metric", "value"])
            for key, value in data.items():
                if isinstance(value, dict):
                    for sub_key, sub_value in value.items():
                        writer.writerow([key, sub_key, sub_value])
                else:
                    writer.writerow([key, "count", value])
            buffer.seek(0)
            return StreamingResponse(
                iter([buffer.getvalue()]),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=report-summary.csv"},
            )
        return data

    start = _parse_date(from_date)
    end = _parse_date(to_date)

    if section == "clients":
        query = db.query(Client)
    elif section == "filings":
        query = db.query(Filing)
    elif section == "fees":
        query = db.query(Fee)
    elif section == "tasks":
        query = db.query(Task)
    else:
        query = db.query(Document)

    query = _apply_section_filters(
        query, section, client_id, status, return_type, date_field, start, end
    )

    rows = [_serialize_row(section, db, row) for row in query.all()]

    if group_by:
        groups = {}
        for row in rows:
            key = _group_key(row, section, group_by)
            groups.setdefault(key, []).append(row)
        payload = {
            "section": section,
            "group_by": group_by,
            "groups": {key: rows for key, rows in groups.items()},
            "count": len(rows),
            "generated_at": datetime.utcnow().isoformat(),
        }
    else:
        payload = {
            "section": section,
            "rows": rows,
            "count": len(rows),
            "generated_at": datetime.utcnow().isoformat(),
        }

    if format == "json":
        return payload

    buffer = StringIO()
    fieldnames = set()
    for row in rows:
        fieldnames.update(row.keys())
    fieldnames = sorted(fieldnames)
    if group_by:
        fieldnames = [group_by] + [name for name in fieldnames if name != group_by]

    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        if group_by:
            row = {**row, group_by: _group_key(row, section, group_by)}
        writer.writerow(row)

    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="report-{section}.csv"'},
    )

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import get_current_user, get_db
from app.models import Client, Fee, Filing

router = APIRouter(tags=["Search"])


@router.get("/api/search")
def search(
    q: str = Query(default="", max_length=100),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    term = q.strip()
    if not term:
        return {"query": term, "results": []}
    like = f"%{term}%"
    results = []

    clients = (
        db.query(Client)
        .filter(or_(
            Client.client_name.ilike(like),
            Client.business_name.ilike(like),
            Client.gstin.ilike(like),
            Client.pan.ilike(like),
            Client.phone.ilike(like),
            Client.email.ilike(like),
        ))
        .order_by(Client.client_name)
        .limit(10)
        .all()
    )
    for client in clients:
        results.append({
            "type": "client",
            "id": client.id,
            "title": client.client_name,
            "subtitle": (
                client.business_name
                or client.gstin
                or client.phone
                or "Client"
            ),
            "link": f"/clients/{client.id}",
        })

    filings = (
        db.query(Filing, Client.client_name)
        .outerjoin(Client, Client.id == Filing.client_id)
        .filter(or_(
            Filing.return_type.ilike(like),
            Filing.period.ilike(like),
            Filing.arn.ilike(like),
        ))
        .order_by(Filing.due_date.desc())
        .limit(8)
        .all()
    )
    for filing, client_name in filings:
        results.append({
            "type": "filing",
            "id": filing.id,
            "title": f"{filing.return_type} · {filing.period}",
            "subtitle": client_name or "Filing",
            "link": "/filings",
        })

    fees = (
        db.query(Fee, Client.client_name)
        .outerjoin(Client, Client.id == Fee.client_id)
        .filter(or_(
            Fee.purpose.ilike(like),
            Fee.reference_person.ilike(like),
        ))
        .order_by(Fee.due_date.desc())
        .limit(8)
        .all()
    )
    for fee, client_name in fees:
        results.append({
            "type": "fee",
            "id": fee.id,
            "title": fee.purpose,
            "subtitle": f"{client_name or 'Client'} · ₹{float(fee.amount):,.0f}",
            "link": "/fees",
        })

    return {"query": term, "results": results[:20]}


from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import SessionLocal
from app.models import Client, ClientService, Service, User
from app.schemas import ClientCreate, ClientResponse

router = APIRouter(prefix="/api/clients", tags=["Clients"])


class BulkActive(BaseModel):
    ids: list[int]
    active: bool


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _services_for(db: Session, client_id: int):
    rows = (
        db.query(Service)
        .join(ClientService, ClientService.service_id == Service.id)
        .filter(ClientService.client_id == client_id, ClientService.is_active.is_(True))
        .order_by(Service.name)
        .all()
    )
    return [s.id for s in rows], [s.name for s in rows]


def client_out(db: Session, client: Client) -> dict:
    data = {
        column.name: getattr(client, column.name)
        for column in Client.__table__.columns
    }
    service_ids, service_names = _services_for(db, client.id)
    data["service_ids"] = service_ids
    data["service_names"] = service_names
    return data


def _check_duplicates(
    db: Session,
    gstin: str | None,
    pan: str | None,
    exclude_id: int | None = None,
):
    for field, value, label in (("gstin", gstin, "GSTIN"), ("pan", pan, "PAN")):
        if not value:
            continue
        query = db.query(Client).filter(getattr(Client, field) == value)
        if exclude_id is not None:
            query = query.filter(Client.id != exclude_id)
        if query.first():
            raise HTTPException(status_code=409, detail=f"{label} already exists")


def _validate_services(db: Session, service_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(service_ids or []))
    if not unique_ids:
        raise HTTPException(status_code=422, detail="Please select at least one service")
    found = {
        row[0]
        for row in db.query(Service.id).filter(Service.id.in_(unique_ids)).all()
    }
    missing = [sid for sid in unique_ids if sid not in found]
    if missing:
        raise HTTPException(status_code=422, detail="One or more selected services do not exist")
    return unique_ids


def _save_services(db: Session, client_id: int, service_ids: list[int]):
    db.query(ClientService).filter(ClientService.client_id == client_id).delete()
    for service_id in service_ids:
        db.add(ClientService(client_id=client_id, service_id=service_id))


def _generate_deadlines():
    try:
        from app.recurrence import generate_all

        generate_all()
    except Exception:
        # A failed deadline refresh must never block saving a client.
        pass


@router.post("/", response_model=ClientResponse, status_code=201)
def create_client(
    client_data: ClientCreate,
    db: Session = Depends(get_db),
):
    _check_duplicates(db, client_data.gstin, client_data.pan)

    service_ids = _validate_services(db, client_data.service_ids)
    payload = client_data.model_dump(exclude={"service_ids"})
    client = Client(**payload)
    db.add(client)
    db.flush()
    _save_services(db, client.id, service_ids)
    db.commit()
    db.refresh(client)
    _generate_deadlines()
    return client_out(db, client)


@router.get("/", response_model=list[ClientResponse])
def list_clients(db: Session = Depends(get_db)):
    clients = db.query(Client).order_by(Client.id.desc()).all()
    return [client_out(db, client) for client in clients]


@router.post("/bulk/active")
def bulk_active(
    payload: BulkActive,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    ids = list(dict.fromkeys(payload.ids))
    if not ids:
        return {"updated": 0}
    db.query(Client).filter(Client.id.in_(ids)).update({"is_active": payload.active})
    db.query(ClientService).filter(ClientService.client_id.in_(ids)).update(
        {"is_active": payload.active}
    )
    db.commit()
    return {"updated": len(ids)}


@router.get("/{client_id}", response_model=ClientResponse)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client_out(db, client)


@router.put("/{client_id}", response_model=ClientResponse)
def update_client(
    client_id: int,
    client_data: ClientCreate,
    db: Session = Depends(get_db),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    _check_duplicates(db, client_data.gstin, client_data.pan, exclude_id=client_id)

    service_ids = _validate_services(db, client_data.service_ids)
    for field, value in client_data.model_dump(exclude={"service_ids"}).items():
        setattr(client, field, value)

    _save_services(db, client_id, service_ids)
    db.commit()
    db.refresh(client)
    _generate_deadlines()
    return client_out(db, client)


@router.delete("/{client_id}", status_code=204)
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.is_active = False
    db.query(ClientService).filter(ClientService.client_id == client_id).update(
        {"is_active": False}
    )
    db.commit()

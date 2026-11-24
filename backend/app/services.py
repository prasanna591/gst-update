from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_db
from app.models import ClientService, Service, Task

router = APIRouter(prefix="/api/services", tags=["Services"])


class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    frequency: Literal["Monthly", "Quarterly", "Half-yearly", "Yearly"] = "Monthly"
    due_day: int = Field(default=20, ge=1, le=28)
    due_month: int | None = Field(default=None, ge=1, le=12)
    is_active: bool = True


class ServiceOut(BaseModel):
    id: int
    name: str
    frequency: str
    due_day: int
    due_month: int | None = None
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ServiceOut])
@router.get("", response_model=List[ServiceOut])
def list_services(db: Session = Depends(get_db)):
    return db.query(Service).order_by(Service.name.asc()).all()


@router.post("/", response_model=ServiceOut, status_code=201)
@router.post("", response_model=ServiceOut, status_code=201)
def create_service(payload: ServiceIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if db.query(Service).filter(Service.name == name).first():
        raise HTTPException(status_code=409, detail="Service already exists")
    svc = Service(**{**payload.model_dump(), "name": name})
    db.add(svc)
    db.commit()
    db.refresh(svc)
    return svc


@router.put("/{service_id}", response_model=ServiceOut)
def update_service(service_id: int, payload: ServiceIn, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.id == service_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    name = payload.name.strip()
    duplicate = db.query(Service).filter(
        Service.name == name,
        Service.id != service_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Service already exists")
    for k, v in {**payload.model_dump(), "name": name}.items():
        setattr(svc, k, v)
    db.commit()
    db.refresh(svc)
    return svc


@router.delete("/{service_id}")
def delete_service(service_id: int, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.id == service_id).first()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    db.query(ClientService).filter(ClientService.service_id == service_id).delete()
    db.query(Task).filter(Task.service_id == service_id).update({"service_id": None})
    db.delete(svc)
    db.commit()
    return {"ok": True}

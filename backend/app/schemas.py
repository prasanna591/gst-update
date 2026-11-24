
from datetime import date, datetime

import re
from typing import Annotated, Literal
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}\d{4}[A-Z]$")


def _validate_password_bytes(value: str) -> str:
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes long")
    return value


PasswordText = Annotated[
    str,
    Field(min_length=8, max_length=128),
    AfterValidator(_validate_password_bytes),
]


class ClientBase(BaseModel):
    client_name: str = Field(min_length=1, max_length=150)
    business_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    gstin: str | None = Field(default=None, max_length=15)
    pan: str | None = Field(default=None, max_length=10)
    business_registration: str | None = None
    notes: str | None = None
    is_active: bool = True
    date_of_birth: date | None = None
    auditor_id: int | None = None
    referred_by: str | None = Field(default=None, max_length=150)
    religion: str | None = Field(default=None, max_length=50)


class ClientCreate(ClientBase):
    business_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=7, max_length=20)
    religion: str = Field(min_length=1, max_length=50)
    service_ids: list[int] = Field(default_factory=list)

    @field_validator("gstin", "pan", mode="before")
    @classmethod
    def clean_codes(cls, value):
        if value is None:
            return None
        value = str(value).strip().upper()
        return value or None

    @field_validator("gstin")
    @classmethod
    def validate_gstin(cls, value):
        if value and not GSTIN_RE.fullmatch(value):
            raise ValueError("GSTIN must be 15 characters, for example 33ABCDE1234F1Z5")
        return value

    @field_validator("pan")
    @classmethod
    def validate_pan(cls, value):
        if value and not PAN_RE.fullmatch(value):
            raise ValueError("PAN must be 10 characters, for example ABCDE1234F")
        return value


class ClientResponse(ClientBase):
    id: int
    service_ids: list[int] = Field(default_factory=list)
    service_names: list[str] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
class AuditorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    email: str | None = None
    phone: str | None = None
    qualification: str | None = None
    membership_no: str | None = None
    firm_name: str | None = None
    notes: str | None = None
    is_active: bool = True


class AuditorResponse(AuditorCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class FilingCreate(BaseModel):
    client_id: int
    return_type: str = Field(min_length=1, max_length=20)
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    due_date: date
    filed_date: date | None = None
    status: Literal["Pending", "Filed"] = "Pending"
    arn: str | None = Field(default=None, max_length=50)
    notes: str | None = None


class FilingResponse(FilingCreate):
    id: int

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    email: str = Field(min_length=3, max_length=255)
    password: PasswordText
    role: Literal["Admin", "Staff"] = "Staff"


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    role: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class DocumentResponse(BaseModel):
    id: int
    client_id: int
    filing_id: int | None
    title: str
    category: str
    original_filename: str
    content_type: str | None
    size_bytes: int
    uploaded_by_name: str | None
    uploaded_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=150)
    role: Literal["Admin", "Staff"]
    is_active: bool
    password: PasswordText | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: PasswordText
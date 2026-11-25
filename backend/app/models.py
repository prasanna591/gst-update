from datetime import date

from sqlalchemy import Column, Integer, String, Text, Boolean, Date, DateTime, ForeignKey, Numeric, func
from app.database import engine

from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    client_name = Column(String(150), nullable=False)
    business_name = Column(String(200), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    address = Column(Text, nullable=True)
    gstin = Column(String(15), unique=True, nullable=True, index=True)
    pan = Column(String(10), nullable=True, index=True)
    business_registration = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    date_of_birth = Column(Date, nullable=True)
    auditor_id = Column(Integer, ForeignKey("auditors.id"), nullable=True)
    referred_by = Column(String(150), nullable=True)
    religion = Column(String(50), nullable=True)
class Auditor(Base):
    __tablename__ = "auditors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    qualification = Column(String(150), nullable=True)
    membership_no = Column(String(50), nullable=True)
    firm_name = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)


class Filing(Base):
    __tablename__ = "filings"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    return_type = Column(String(20), nullable=False)
    period = Column(String(7), nullable=False)
    due_date = Column(Date, nullable=False)
    filed_date = Column(Date, nullable=True)
    status = Column(String(10), nullable=False, default="Pending")
    arn = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)


class Fee(Base):
    __tablename__ = "fees"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    purpose = Column(String(200), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    due_date = Column(Date, nullable=False)
    expected_date = Column(Date, nullable=True)
    reference_person = Column(String(150), nullable=True)
    status = Column(String(10), nullable=False, default="Pending")
    paid_amount = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    paid_date = Column(Date, nullable=True)
    upfront_amount = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    upfront_paid_date = Column(Date, nullable=True)
    process_stage = Column(String(20), nullable=False, default="New", server_default="New")
    next_followup_date = Column(Date, nullable=True)
    followup_note = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)


class FeePayment(Base):
    __tablename__ = "fee_payments"

    id = Column(Integer, primary_key=True, index=True)
    fee_id = Column(Integer, ForeignKey("fees.id"), nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    payment_date = Column(Date, nullable=False)
    method = Column(String(30), nullable=False, default="Cash")
    reference = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class FeeInstallment(Base):
    __tablename__ = "fee_installments"

    id = Column(Integer, primary_key=True, index=True)
    fee_id = Column(Integer, ForeignKey("fees.id"), nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    due_date = Column(Date, nullable=False)
    status = Column(String(10), nullable=False, default="Pending", server_default="Pending")
    paid_date = Column(Date, nullable=True)
    payment_id = Column(Integer, ForeignKey("fee_payments.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class FeeActivity(Base):
    __tablename__ = "fee_activities"

    id = Column(Integer, primary_key=True, index=True)
    fee_id = Column(Integer, ForeignKey("fees.id"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    message = Column(Text, nullable=False)
    activity_date = Column(Date, nullable=False, default=date.today)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    token_version = Column(Integer, nullable=False, default=0)
    role = Column(String(10), nullable=False, default="Staff")
    is_active = Column(Boolean, nullable=False, default=True)


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    filing_id = Column(Integer, ForeignKey("filings.id"), nullable=True, index=True)
    title = Column(String(200), nullable=False)
    category = Column(String(30), nullable=False, default="Other")
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(100), unique=True, nullable=False)
    content_type = Column(String(100), nullable=True)
    size_bytes = Column(Integer, nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_name = Column(String(150), nullable=True)
    uploaded_at = Column(DateTime, nullable=False, server_default=func.now())
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    due_date = Column(Date, nullable=False)
    due_time = Column(String(5), nullable=True)
    priority = Column(String(10), nullable=False, default="Normal")   # Normal or High
    is_done = Column(Boolean, nullable=False, default=False)
    done_at = Column(DateTime, nullable=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=True)
    fee_id = Column(Integer, ForeignKey("fees.id"), nullable=True)
    period = Column(String(10), nullable=True)
    auto_generated = Column(Boolean, nullable=False, default=False)
    recurrence = Column(String(12), nullable=False, default="None")
    recurrence_end = Column(Date, nullable=True)
class ImportantDate(Base):
    __tablename__ = "important_dates"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    kind = Column(String(20), nullable=False, default="Custom")   # Registration, Anniversary, Deadline, Custom
    event_date = Column(Date, nullable=False)
    repeat_yearly = Column(Boolean, nullable=False, default=True)
    repeat_frequency = Column(String(20), nullable=False, default="Yearly")
    repeat_interval = Column(Integer, nullable=True, default=7)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    notes = Column(Text, nullable=True)


class Service(Base):
    __tablename__ = "services"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    frequency = Column(String(12), nullable=False, default="Monthly")
    due_day = Column(Integer, nullable=False, default=20)
    due_month = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)


class ClientService(Base):
    __tablename__ = "client_services"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    service_id = Column(Integer, ForeignKey("services.id"), nullable=False, index=True)
    fee_amount = Column(Numeric(12, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    invoice_no = Column(String(30), unique=True, nullable=False, index=True)
    fee_id = Column(Integer, ForeignKey("fees.id"), nullable=True, unique=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    purpose = Column(String(200), nullable=False)
    issued_date = Column(Date, nullable=False)
    status = Column(String(10), nullable=False, default="Issued")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(120), unique=True, nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    kind = Column(String(20), nullable=False, default="Reminder")
    link = Column(String(200), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    dismissed = Column(Boolean, nullable=False, default=False, server_default="0")
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class ReportTemplate(Base):
    __tablename__ = "report_templates"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    section = Column(String(40), nullable=False)
    config = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class InvoiceTemplate(Base):
    __tablename__ = "invoice_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    config = Column(Text, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(20), nullable=False, unique=True, index=True)
    label = Column(String(60), nullable=False)
    lead_days = Column(Integer, nullable=False, default=7)
    enabled = Column(Boolean, nullable=False, default=True)
    include_overdue = Column(Boolean, nullable=False, default=True)
    link = Column(String(200), nullable=False, default="/")
    notify_time = Column(String(5), nullable=False, default="09:00")
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

import os
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
APP_NAME = "GST Office"

# Shown on invoices and other client-facing documents.
BUSINESS_NAME = os.getenv("BUSINESS_NAME", APP_NAME)
BUSINESS_ADDRESS = os.getenv("BUSINESS_ADDRESS", "")
BUSINESS_PHONE = os.getenv("BUSINESS_PHONE", "")
BUSINESS_EMAIL = os.getenv("BUSINESS_EMAIL", SMTP_USER)
BUSINESS_GSTIN = os.getenv("BUSINESS_GSTIN", "")

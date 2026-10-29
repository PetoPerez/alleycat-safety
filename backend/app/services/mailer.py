"""SMTP adapter. Link previews exist only with an explicit APP_ENV=development (fail closed)."""
import os
import smtplib
from email.message import EmailMessage

TEMPLATES = {
    "magic_link": ("Your Alleycat Safety sign-in link", "Sign in to Alleycat Safety (valid for 15 minutes, single use): {link}"),
    "invitation": ("Your Alleycat Safety race invitation", "Open your private race invitation: {link}"),
}


def preview_enabled() -> bool:
    return os.getenv("APP_ENV") == "development"


def deliver(email: str, link: str, kind: str) -> str:
    if preview_enabled():
        return "preview"
    host = os.getenv("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST is required outside APP_ENV=development")
    subject, body = TEMPLATES[kind]
    message = EmailMessage()
    message["From"] = os.getenv("SMTP_FROM", "no-reply@alleycat.local")
    message["To"] = email
    message["Subject"] = subject
    message.set_content(body.format(link=link))
    with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        if os.getenv("SMTP_STARTTLS", "true").lower() == "true":
            smtp.starttls()
        if os.getenv("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
        smtp.send_message(message)
    return "sent"


def public_link(path: str) -> str:
    return os.getenv("PUBLIC_APP_URL", "").rstrip("/") + path

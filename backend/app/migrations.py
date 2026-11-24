from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


_COLUMNS = {
    "clients": {
        "is_active": ("BOOLEAN NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT TRUE"),
        "date_of_birth": ("DATE", "DATE"),
        "auditor_id": ("INTEGER", "INTEGER"),
        "referred_by": ("VARCHAR(150)", "VARCHAR(150)"),
        "religion": ("VARCHAR(50)", "VARCHAR(50)"),
    },
    "users": {
        "token_version": ("INTEGER NOT NULL DEFAULT 0", "INTEGER NOT NULL DEFAULT 0"),
    },
    "tasks": {
        "service_id": ("INTEGER", "INTEGER"),
        "period": ("VARCHAR(10)", "VARCHAR(10)"),
        "auto_generated": ("BOOLEAN NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT FALSE"),
        "recurrence": ("VARCHAR(12) NOT NULL DEFAULT 'None'", "VARCHAR(12) NOT NULL DEFAULT 'None'"),
        "recurrence_end": ("DATE", "DATE"),
    },
}


def ensure_columns(engine: Engine):
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    quote = engine.dialect.identifier_preparer.quote
    sqlite = engine.dialect.name == "sqlite"

    with engine.begin() as connection:
        for table_name, columns in _COLUMNS.items():
            if table_name not in tables:
                continue
            existing = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, (sqlite_type, default_type) in columns.items():
                if column_name in existing:
                    continue
                column_type = sqlite_type if sqlite else default_type
                connection.execute(text(
                    f"ALTER TABLE {quote(table_name)} "
                    f"ADD COLUMN {quote(column_name)} {column_type}"
                ))

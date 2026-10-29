from alembic import context
from app.database import engine

# Use the app engine directly: same URL normalization, and no configparser '%' interpolation of passwords.
with engine.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()

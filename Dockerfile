# Minimal python image
FROM python:3.9-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app /app/app

# Create a volume mount point for the database (persistence)
VOLUME /data
# Tell the app to use this path (you'd modify database.py to read env var, 
# or just symlink. For simplicity, we just run inside /app)

EXPOSE 8000

# Start via Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
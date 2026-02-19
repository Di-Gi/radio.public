# --- Stage 1: Build Frontend ---
FROM node:20-slim AS builder
WORKDIR /build

# 1. Copy package files first
COPY package.json .

# 2. Install dependencies (this builds the correct binaries for the container's OS)
RUN npm install

# 3. Copy the rest of the source (but NOT what's in .dockerignore)
COPY . .

# 4. Build via the npm script
RUN npm run build

# --- Stage 2: Final Image ---
FROM python:3.9-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories and grant full permissions
RUN mkdir -p /data /app/app/parsers && chmod -R 777 /data /app

# Copy built assets
COPY --from=builder /build/dist /app/dist 
COPY app /app/app

# Ensure even the app folder is writable for the fallback db
RUN chmod -R 777 /app

ENV DATABASE_PATH=/data/stations.db
ENV PORT=8000

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
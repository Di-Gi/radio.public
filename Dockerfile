# --- Stage 1: Build Frontend ---
FROM node:20-slim AS builder
WORKDIR /build

# Copy package files and install dependencies
COPY package.json .
RUN npm install

# Copy the rest of the source
COPY . .

# Build the frontend (Vite will output to the /dist folder per your vite.config.ts)
RUN npm run build

# --- Stage 2: Final Image ---
FROM python:3.9-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create data directory for persistent SQLite DB
RUN mkdir -p /data

# Copy built frontend from Stage 1
COPY --from=builder /build/dist /app/dist 

# Copy backend code
COPY app /app/app

# Set Environment Variables
ENV DATABASE_PATH=/data/stations.db
ENV PORT=8000

EXPOSE 8000

# Start via Uvicorn, serving from the app.main module
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
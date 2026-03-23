# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Runtime
FROM python:3.12-slim
WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt python-dotenv

# Copy backend code
COPY backend/ ./backend/

# Copy pre-built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy data & DB
COPY o2c.db ./o2c.db

# Copy SAP source data (needed for graph build if DB is rebuilt)
# If you have sap-o2c-data/ in the same parent dir, mount it as a volume instead.

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

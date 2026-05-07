FROM python:3.11-slim

WORKDIR /app

# Install OCR binary for tracking scanner (image-based even pages).
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies.
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source.
COPY . /app

# Optional explicit command path; service also supports PATH lookup.
ENV TESSERACT_CMD=/usr/bin/tesseract

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]

FROM nvcr.io/nvidia/pytorch:25.01-py3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src

RUN pip install --upgrade pip \
    && pip install --force-reinstall --no-deps \
        --index-url https://download.pytorch.org/whl/cu124 \
        --trusted-host download.pytorch.org \
        --trusted-host download-r2.pytorch.org \
        "torch==2.6.0+cu124" \
    && pip install .

EXPOSE 8000

CMD ["uvicorn", "retrieval_service.main:app", "--host", "0.0.0.0", "--port", "8000"]

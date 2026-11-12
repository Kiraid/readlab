# readlab: one image for the API (which also serves the built frontend) and the queue worker.
# The pipeline needs Node at runtime too: it builds chapter pages with tools/build.mjs.
#   docker compose up -d --build

FROM node:22.22.1-slim AS web
WORKDIR /web
COPY app/frontend/package.json app/frontend/package-lock.json ./
RUN npm ci
COPY app/frontend/ ./
RUN npm run build

FROM node:22.22.1-slim AS nodedeps
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM ghcr.io/astral-sh/uv:0.13.7 AS uv

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH
COPY --from=node:22.22.1-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY --from=nodedeps /deps/node_modules ./node_modules
COPY . .
COPY --from=web /web/dist ./app/frontend/dist

RUN useradd --uid 1000 --create-home readlab && mkdir -p sources .cache && chown readlab sources .cache
USER readlab
EXPOSE 8000
CMD ["uvicorn", "app.backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

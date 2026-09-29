# Worker image. Build context: apps/worker.
# Base pinned by digest (docs/11-security.md); Dependabot keeps it current.
FROM python:3.14-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS build

# uv from PyPI; pinned to the version CI uses.
RUN pip install --no-cache-dir "uv==0.12.20"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app
# Dependencies first so code changes don't reinstall them.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable


FROM python:3.14-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Non-root (docs/11-security.md → ffmpeg and native tools on the server).
RUN groupadd --system --gid 10001 etb && useradd --system --uid 10001 --gid etb --no-create-home etb
COPY --from=build /opt/venv /opt/venv
USER etb
WORKDIR /tmp

CMD ["python", "-m", "etb_worker"]

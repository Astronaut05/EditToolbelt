# Worker image. Build context: apps/worker.
# Base pinned by digest (docs/11-security.md); Dependabot keeps it current.
FROM python:3.12-slim-trixie@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS build

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


FROM python:3.12-slim-trixie@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# ffmpeg and ffprobe for the processors: Debian's build (GPL, never
# --enable-nonfree; docs/13-licenses.md), updated with every image rebuild.
# Noto (OFL) for Burn Subtitles: Latin, Cyrillic and Greek, sans, serif and mono.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# Non-root (docs/11-security.md → ffmpeg and native tools on the server).
RUN groupadd --system --gid 10001 etb && useradd --system --uid 10001 --gid etb --no-create-home etb
COPY --from=build /opt/venv /opt/venv
USER etb
WORKDIR /tmp

CMD ["python", "-m", "etb_worker"]

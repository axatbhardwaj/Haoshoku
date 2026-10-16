FROM oven/bun:1.4.2 AS bun
FROM python:3.12-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client nodejs npm ca-certificates util-linux jq curl lua5.4
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /opt/haoshoku
COPY . .
RUN bun install --frozen-lockfile
RUN useradd --uid 10001 --create-home verifier

USER 10001:10001
ENV HOME=/tmp/home TMPDIR=/tmp/scratch
ENTRYPOINT ["/bin/bash", "/opt/haoshoku/.github/ci/run-suite.sh"]

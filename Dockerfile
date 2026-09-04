# Builds one image that serves both the API and the interface.
#
# The library's data does NOT live in this image. It lives on a mounted volume
# at LIBRARY_DATA_DIR — see docs/DEPLOYMENT.md. An image is replaced on every
# deploy; the database must not be.

FROM node:22-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 compiles a native module, so the toolchain is needed here —
# and deliberately not in the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/

RUN npm ci

COPY . .

RUN npm run typecheck \
    && npm run build \
    && npm prune --omit=dev


FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages

# Listen on every interface: inside a container, loopback is unreachable from
# the platform's proxy. The service is still not public on its own — the
# platform decides what it exposes.
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3000
ENV UI_DIR=/app/packages/ui/dist
ENV TRUST_PROXY=true
ENV LIBRARY_DATA_DIR=/data

EXPOSE 3000

# A container that cannot answer is a container the platform should replace.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/server.mjs"]

# Omzetserver voor de verzamellink (Google Cloud Run). Ubuntu 24.04: ffmpeg met zscale/tonemap en libheif voor iPhone-foto's.
FROM node:22-bookworm-slim AS node
FROM ubuntu:24.04
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libheif-examples libheif-plugin-libde265 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
ENV PORT=8080 NODE_ENV=production
CMD ["node", "server.js"]

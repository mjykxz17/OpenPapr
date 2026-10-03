# Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
# better-sqlite3 has no prebuilt musl binary; build tools compile it from source.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
# npm ci rejects this lockfile on linux: npm records nested platform-specific
# esbuild binaries without their optional flag. Same reason CI uses npm install.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# LibreOffice turns PowerPoint and Word files into PDFs for the in-app viewer
# (and for study-guide citations). Only the three office components are
# installed; the fonts cover Latin, symbols and Chinese/Japanese/Korean.
RUN apk add --no-cache libreoffice-impress libreoffice-writer libreoffice-calc \
    font-liberation font-dejavu font-noto font-noto-cjk \
    ghostscript qpdf
ENV SOFFICE_BIN=/usr/bin/soffice
# Litestream backs the database up to object storage (litestream.yml,
# start.sh). A static binary, pinned and checked against its published sum.
ARG LITESTREAM_VERSION=0.5.17
ARG LITESTREAM_SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
RUN wget -qO /tmp/litestream.tar.gz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz" \
 && echo "${LITESTREAM_SHA256}  /tmp/litestream.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
 && rm /tmp/litestream.tar.gz
# Ghostscript compresses lecture decks (22.7MB -> 3.4MB on a real one) and
# qpdf lays them out for range loading; see src/server/pdf-optimize.ts.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./
COPY start.sh litestream.yml ./
EXPOSE 3000
CMD ["sh", "start.sh"]

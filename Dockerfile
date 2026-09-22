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
    font-liberation font-dejavu font-noto font-noto-cjk
ENV SOFFICE_BIN=/usr/bin/soffice
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./
COPY start.sh ./
EXPOSE 3000
CMD ["sh", "start.sh"]

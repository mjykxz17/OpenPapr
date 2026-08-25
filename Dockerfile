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

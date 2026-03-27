# Stage 1: Build
FROM node:18-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN npm run build:prod

# Stage 2: Production
FROM node:18-slim
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/build ./build
USER app
EXPOSE 3001
CMD ["node", "build/src/transports/http-entrypoint.js"]

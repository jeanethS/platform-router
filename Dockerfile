FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN adduser -D appuser
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/rules ./src/rules
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8080 9090
CMD ["node", "dist/index.js"]

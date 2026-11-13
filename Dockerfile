FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git openssh-client
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:web

FROM nginx:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

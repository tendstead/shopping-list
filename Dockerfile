FROM node:25-alpine AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.4 AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=frontend /src/web/build/ ./cmd/server/static/
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /shopping-list ./cmd/server

FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=backend /shopping-list /app/shopping-list
ENV GOMEMLIMIT=96MiB GOMAXPROCS=1
EXPOSE 8080
ENTRYPOINT ["/app/shopping-list"]

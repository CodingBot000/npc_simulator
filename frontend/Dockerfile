FROM node:22-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/scripts/package.json backend/scripts/package.json

RUN npm ci

FROM node:22-alpine AS build
WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json ./tsconfig.json
COPY contracts ./contracts
COPY shared ./shared
COPY frontend ./frontend
COPY backend/scripts/package.json ./backend/scripts/package.json

RUN npm run build --workspace frontend

FROM node:22-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production

COPY --from=build /workspace/frontend/dist ./frontend/dist
COPY --from=build /workspace/frontend/scripts/runtime ./frontend/scripts/runtime

EXPOSE 3000

CMD ["node", "frontend/scripts/runtime/static-server.mjs"]

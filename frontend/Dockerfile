FROM node:22-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json

RUN npm ci

FROM node:22-alpine AS build
WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .

ENV NPC_SIMULATOR_ROOT=/workspace

RUN npm run build --workspace frontend

FROM node:22-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV NPC_SIMULATOR_ROOT=/workspace

COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/package-lock.json ./package-lock.json
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/frontend ./frontend
COPY --from=build /workspace/backend/scripts ./backend/scripts
COPY --from=build /workspace/data ./data

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "frontend"]

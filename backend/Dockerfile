FROM node:22-trixie-slim AS node-deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/scripts/package.json backend/scripts/package.json

RUN npm ci

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace/backend

COPY backend/gradlew gradlew
COPY backend/gradle gradle
COPY backend/build.gradle.kts backend/settings.gradle.kts ./
COPY backend/src src

RUN chmod +x gradlew
RUN ./gradlew --no-daemon bootJar

FROM node:22-trixie-slim
WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/*

ENV SPRING_PROFILES_ACTIVE=prod
ENV NPC_SIMULATOR_ROOT=/workspace
ENV NPC_SIMULATOR_WORKDIR=/workspace
ENV NPC_SIMULATOR_SCRIPTS_ROOT=/workspace/backend/scripts
ENV NPC_SIMULATOR_NODE_BIN_DIR=/workspace/node_modules/.bin
ENV NPC_SIMULATOR_DATA_ROOT=/workspace/data
ENV NPC_SIMULATOR_OUTPUTS_ROOT=/workspace/outputs

COPY --from=node-deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY backend/scripts backend/scripts
COPY data data
COPY --from=build /workspace/backend/build/libs/*.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

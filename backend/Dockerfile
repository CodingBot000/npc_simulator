FROM node:22-bookworm-slim AS node-deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json

RUN npm ci

FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace/backend

COPY backend/gradlew gradlew
COPY backend/gradle gradle
COPY backend/build.gradle.kts backend/settings.gradle.kts ./
COPY backend/src src

RUN chmod +x gradlew
RUN ./gradlew --no-daemon bootJar

FROM node:22-bookworm-slim
WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/*

ENV SPRING_PROFILES_ACTIVE=prod
ENV NPC_SIMULATOR_ROOT=/workspace

COPY --from=node-deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY frontend frontend
COPY backend/scripts backend/scripts
COPY data data
COPY --from=build /workspace/backend/build/libs/*.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]

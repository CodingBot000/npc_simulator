import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "../..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a local port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForHttpReady(url, label) {
  const deadline = Date.now() + 15_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `${label} did not become ready: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

function createMockBackend({ allowedOrigin }) {
  return createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Vary", "Origin");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.url === "/api/system/info") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          service: "npc-simulator-backend",
          status: "ok",
          phase: "separated-deployment-smoke",
          capabilities: ["remote-api-config", "cors"],
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ message: "not found" }));
  });
}

function terminateProcess(child) {
  if (!child || child.killed) {
    return Promise.resolve();
  }

  child.kill("SIGTERM");
  return once(child, "exit").catch(() => {});
}

async function main() {
  const frontendPort = await getFreePort();
  const backendPort = await getFreePort();
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const backendServer = createMockBackend({ allowedOrigin: frontendOrigin });

  await once(
    backendServer.listen(backendPort, "127.0.0.1"),
    "listening",
  );

  const frontendProcess = spawn("node", ["scripts/runtime/static-server.mjs"], {
    cwd: frontendDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(frontendPort),
      NPC_SIMULATOR_API_BASE_URL: backendOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  frontendProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitForHttpReady(`${frontendOrigin}/`, "frontend static server");

    const [indexHtmlResponse, runtimeConfigResponse, backendInfoResponse] =
      await Promise.all([
        fetch(`${frontendOrigin}/`, { cache: "no-store" }),
        fetch(`${frontendOrigin}/env-config.js`, { cache: "no-store" }),
        fetch(`${backendOrigin}/api/system/info`, {
          cache: "no-store",
          headers: {
            Origin: frontendOrigin,
            Accept: "application/json",
          },
        }),
      ]);

    const indexHtml = await indexHtmlResponse.text();
    const runtimeConfigScript = await runtimeConfigResponse.text();
    const backendInfo = await backendInfoResponse.json();

    assert.equal(indexHtmlResponse.status, 200);
    assert.match(indexHtml, /<script src="\/env-config\.js"><\/script>/);

    assert.equal(runtimeConfigResponse.status, 200);
    assert.equal(runtimeConfigResponse.headers.get("cache-control"), "no-store");
    assert.match(runtimeConfigScript, /window\.__NPC_SIMULATOR_CONFIG__/);
    assert.match(runtimeConfigScript, new RegExp(backendOrigin.replaceAll("/", "\\/")));
    assert.match(runtimeConfigScript, /"source":"NPC_SIMULATOR_API_BASE_URL"/);

    assert.equal(backendInfoResponse.status, 200);
    assert.equal(
      backendInfoResponse.headers.get("access-control-allow-origin"),
      frontendOrigin,
    );
    assert.equal(backendInfo.service, "npc-simulator-backend");
    assert.equal(backendInfo.phase, "separated-deployment-smoke");

    process.stdout.write("Separated deployment smoke passed.\n");
  } finally {
    await Promise.allSettled([
      terminateProcess(frontendProcess),
      new Promise((resolve, reject) =>
        backendServer.close((error) => (error ? reject(error) : resolve())),
      ),
    ]);

    if (frontendProcess.exitCode && frontendProcess.exitCode !== 0 && stderr.trim()) {
      process.stderr.write(stderr);
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

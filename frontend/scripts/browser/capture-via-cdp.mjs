#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    cdpBaseUrl: "http://127.0.0.1:9222",
    pageUrl: "http://localhost:3000",
    outDir: "artifacts/cdp-capture",
    width: 1440,
    height: 1400,
    waitMs: 1200,
    readyExpression:
      "typeof window.render_game_to_text === 'function' || document.body.innerText.trim().length > 0",
    readyTimeoutMs: 10000,
    stateExpression:
      "typeof window.render_game_to_text === 'function' ? window.render_game_to_text() : null",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--cdp" && next) {
      args.cdpBaseUrl = next;
      index += 1;
    } else if (arg === "--url" && next) {
      args.pageUrl = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      args.outDir = next;
      index += 1;
    } else if (arg === "--width" && next) {
      args.width = Number(next);
      index += 1;
    } else if (arg === "--height" && next) {
      args.height = Number(next);
      index += 1;
    } else if (arg === "--wait-ms" && next) {
      args.waitMs = Number(next);
      index += 1;
    } else if (arg === "--ready-expression" && next) {
      args.readyExpression = next;
      index += 1;
    } else if (arg === "--ready-timeout-ms" && next) {
      args.readyTimeoutMs = Number(next);
      index += 1;
    }
  }

  return args;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Cannot reach CDP endpoint at ${url}.`,
        "Start a Chrome instance with remote debugging first.",
        "Try: npm run browser:cdp",
        `Original error: ${message}`,
      ].join(" "),
    );
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`);
  }

  return response.json();
}

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.eventListeners = new Map();

    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data.toString());

      if (payload.id) {
        const pending = this.pending.get(payload.id);
        if (!pending) {
          return;
        }

        this.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(
            new Error(
              payload.error.message ||
                `CDP ${pending.method} failed with code ${payload.error.code}`,
            ),
          );
          return;
        }

        pending.resolve(payload.result);
        return;
      }

      if (!payload.method) {
        return;
      }

      const listeners = this.eventListeners.get(payload.method) ?? [];
      for (const listener of listeners) {
        listener(payload.params);
      }

      const waiters = this.eventWaiters.get(payload.method);
      if (!waiters || waiters.length === 0) {
        return;
      }

      const waiter = waiters.shift();
      if (waiters.length === 0) {
        this.eventWaiters.delete(payload.method);
      }
      waiter(payload.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);

      const resolveWithCleanup = (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      };

      const waiters = this.eventWaiters.get(method) ?? [];
      waiters.push(resolveWithCleanup);
      this.eventWaiters.set(method, waiters);
    });
  }

  subscribe(method, listener) {
    const listeners = this.eventListeners.get(method) ?? [];
    listeners.push(listener);
    this.eventListeners.set(method, listeners);

    return () => {
      const nextListeners = (this.eventListeners.get(method) ?? []).filter(
        (entry) => entry !== listener,
      );

      if (nextListeners.length === 0) {
        this.eventListeners.delete(method);
        return;
      }

      this.eventListeners.set(method, nextListeners);
    };
  }
}

async function openTarget(cdpBaseUrl, pageUrl) {
  const version = await fetchJson(`${cdpBaseUrl}/json/version`);
  const created = await fetchJson(
    `${cdpBaseUrl}/json/new?${encodeURIComponent(pageUrl)}`,
    { method: "PUT" },
  );

  return {
    browserVersion: version.Browser,
    targetId: created.id,
    webSocketDebuggerUrl: created.webSocketDebuggerUrl,
  };
}

async function closeTarget(cdpBaseUrl, targetId) {
  try {
    await fetch(`${cdpBaseUrl}/json/close/${targetId}`);
  } catch {
    // Ignore cleanup failures.
  }
}

function serializeRemoteObject(remoteObject) {
  if (!remoteObject) {
    return null;
  }

  if ("value" in remoteObject) {
    return remoteObject.value;
  }

  return (
    remoteObject.unserializableValue ??
    remoteObject.description ??
    remoteObject.className ??
    null
  );
}

async function waitForReady(session, args) {
  const startedAt = Date.now();
  let lastValue = null;
  let checks = 0;

  while (Date.now() - startedAt < args.readyTimeoutMs) {
    checks += 1;
    const result = await session.send("Runtime.evaluate", {
      expression: args.readyExpression,
      returnByValue: true,
    });

    lastValue = result.result?.value ?? null;
    if (lastValue) {
      return {
        ok: true,
        checks,
        elapsedMs: Date.now() - startedAt,
        lastValue,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    ok: false,
    checks,
    elapsedMs: Date.now() - startedAt,
    lastValue,
  };
}

async function capture() {
  const args = parseArgs(process.argv);
  await ensureDir(args.outDir);

  const target = await openTarget(args.cdpBaseUrl, args.pageUrl);
  const socket = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      (event) => reject(new Error(`WebSocket open failed: ${String(event.message || event)}`)),
      { once: true },
    );
  });

  const session = new CdpSession(socket);
  const consoleEvents = [];
  const exceptions = [];

  try {
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("Network.enable");
    const unsubscribeConsole = session.subscribe("Runtime.consoleAPICalled", (params) => {
      consoleEvents.push({
        type: params.type,
        args: (params.args ?? []).map(serializeRemoteObject),
      });
    });
    const unsubscribeException = session.subscribe("Runtime.exceptionThrown", (params) => {
      exceptions.push({
        text: params.exceptionDetails?.text ?? null,
        url: params.exceptionDetails?.url ?? null,
        lineNumber: params.exceptionDetails?.lineNumber ?? null,
        columnNumber: params.exceptionDetails?.columnNumber ?? null,
      });
    });
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loadEvent = session.waitForEvent("Page.loadEventFired", 10000).catch(
      () => null,
    );
    await session.send("Page.navigate", { url: args.pageUrl });
    await loadEvent;

    if (args.waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.waitMs));
    }

    const ready = await waitForReady(session, args);

    const [layout, domEval, stateEval, bodyTextEval] = await Promise.all([
      session.send("Page.getLayoutMetrics"),
      session.send("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      }),
      session.send("Runtime.evaluate", {
        expression: args.stateExpression,
        returnByValue: true,
      }),
      session.send("Runtime.evaluate", {
        expression: "document.body.innerText",
        returnByValue: true,
      }),
    ]);

    const contentSize = layout.contentSize ?? { width: args.width, height: args.height };
    const screenshot = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.max(args.width, Math.ceil(contentSize.width)),
        height: Math.max(args.height, Math.ceil(contentSize.height)),
        scale: 1,
      },
    });

    const screenshotPath = path.join(args.outDir, "page.png");
    const htmlPath = path.join(args.outDir, "page.html");
    const statePath = path.join(args.outDir, "state.json");
    const metaPath = path.join(args.outDir, "meta.json");

    await Promise.all([
      fs.writeFile(screenshotPath, Buffer.from(screenshot.data, "base64")),
      fs.writeFile(htmlPath, String(domEval.result?.value ?? ""), "utf8"),
      fs.writeFile(
        statePath,
        typeof stateEval.result?.value === "string"
          ? stateEval.result.value
          : JSON.stringify(stateEval.result?.value ?? null, null, 2),
        "utf8",
      ),
      fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            browserVersion: target.browserVersion,
            pageUrl: args.pageUrl,
            contentSize,
            outDir: args.outDir,
            ready,
            bodyTextPreview: String(bodyTextEval.result?.value ?? "").slice(0, 1000),
            consoleEvents,
            exceptions,
          },
          null,
          2,
        ),
        "utf8",
      ),
    ]);

    console.log(
      JSON.stringify(
        {
          ok: true,
          browserVersion: target.browserVersion,
          screenshotPath,
          htmlPath,
          statePath,
          metaPath,
        },
        null,
        2,
      ),
    );

    unsubscribeConsole();
    unsubscribeException();
  } finally {
    socket.close();
    await closeTarget(args.cdpBaseUrl, target.targetId);
  }
}

capture().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        hint:
          "If Chrome is not already running with CDP enabled, run `npm run browser:cdp` in your local terminal first.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

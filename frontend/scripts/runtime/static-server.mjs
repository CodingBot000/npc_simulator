import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import {
  createRuntimeConfigScript,
  resolveFrontendRuntimeConfig,
  resolveStaticServerSettings,
} from "./runtime-config.mjs";

const { distDir, host, port } = resolveStaticServerSettings({
  scriptUrl: import.meta.url,
});

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function writeRuntimeConfig() {
  writeFileSync(
    path.join(distDir, "env-config.js"),
    createRuntimeConfigScript(resolveFrontendRuntimeConfig()),
  );
}

function resolveRequestPath(url) {
  const parsedUrl = new URL(url ?? "/", "http://localhost");
  const decodedPathname = decodeURIComponent(parsedUrl.pathname);
  const normalizedPathname = path.normalize(decodedPathname).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = path.join(distDir, normalizedPathname);
  const relativePath = path.relative(distDir, requestedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return path.join(distDir, "index.html");
  }

  if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
    return requestedPath;
  }

  return path.join(distDir, "index.html");
}

if (!existsSync(path.join(distDir, "index.html"))) {
  throw new Error(`Frontend dist directory is missing: ${distDir}`);
}

writeRuntimeConfig();

const server = createServer((request, response) => {
  const filePath = resolveRequestPath(request.url);
  const extension = path.extname(filePath);
  const contentType = contentTypes.get(extension) ?? "application/octet-stream";

  response.setHeader("Content-Type", contentType);
  if (filePath.endsWith("env-config.js")) {
    response.setHeader("Cache-Control", "no-store");
  }

  createReadStream(filePath)
    .on("error", () => {
      response.statusCode = 404;
      response.end("Not found");
    })
    .pipe(response);
});

server.listen(port, host, () => {
  console.log(`Frontend static server listening on http://${host}:${port}`);
});

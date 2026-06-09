import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import http from "node:http";

const port = Number(process.env.PORT || 3000);
const rootDir = join(process.cwd(), "dist");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0] || "/");
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(rootDir, safePath === "/" ? "index.html" : safePath);

  try {
    const stats = statSync(filePath);
    if (stats.isFile()) {
      return filePath;
    }
  } catch {
    return join(rootDir, "index.html");
  }

  return join(rootDir, "index.html");
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  const filePath = resolveRequestPath(req.url || "/");
  const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";

  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": filePath.endsWith("index.html")
      ? "no-store"
      : "public, max-age=31536000, immutable"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`mobile-web listening on ${port}`);
});

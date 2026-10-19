import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function proxyApi(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const requested = new URL(request.url ?? "/", "http://127.0.0.1:3000");
  const upstreamUrl = new URL(
    `${requested.pathname}${requested.search}`,
    "http://127.0.0.1:3000",
  );

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: {
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
        ...(request.headers["content-type"]
          ? { "content-type": request.headers["content-type"] }
          : {}),
        accept: request.headers.accept ?? "application/json",
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(30000),
    });
    response.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        message:
          "The API is unavailable. Start both services with npm run dev.",
      }),
    );
  }
}

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", `http://${host}:${port}`)
    .pathname;
  if (pathname.startsWith("/api/v1/")) {
    await proxyApi(request, response);
    return;
  }
  const filePath = resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );

  if (!filePath.startsWith(root + sep) || !contentTypes[extname(filePath)]) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, host, () => {
  const browserHost = host === "127.0.0.1" ? "localhost" : host;
  process.stdout.write(`HydroJimma frontend: http://${browserHost}:${port}\n`);
});

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const frontendDir = fileURLToPath(new URL(".", import.meta.url));
const backendDir = fileURLToPath(new URL("../backend/", import.meta.url));
const backendEntry = fileURLToPath(
  new URL("../backend/dist/main.js", import.meta.url),
);
let backend;
let frontend;

async function apiReady() {
  try {
    const response = await fetch("http://localhost:3000/health/ready", {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

async function buildBackendIfNeeded() {
  try {
    await access(backendEntry);
    return;
  } catch {
    process.stdout.write("Building the backend for the first run…\n");
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const build = spawn(command, ["run", "build"], {
    cwd: backendDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if ((await waitForExit(build)) !== 0) {
    throw new Error(
      "Backend build failed. Run npm install in backend and try again.",
    );
  }
}

async function startBackend() {
  await buildBackendIfNeeded();
  backend = spawn(process.execPath, [backendEntry], {
    cwd: backendDir,
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await apiReady()) return;
    if (backend.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "The API did not become ready. Check PostgreSQL, Redis, and backend/.env.",
  );
}

function stop() {
  frontend?.kill();
  backend?.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  if (!(await apiReady())) {
    process.stdout.write("Starting the HydroJimma API…\n");
    await startBackend();
  } else {
    process.stdout.write(
      "Using the API already running on http://localhost:3000\n",
    );
  }

  frontend = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    {
      cwd: frontendDir,
      stdio: "inherit",
    },
  );
  process.exitCode = (await waitForExit(frontend)) ?? 0;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  stop();
}

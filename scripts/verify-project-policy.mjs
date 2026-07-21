import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedVersion = "3.2.0";
const failures = [];

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const cargoToml = await read("src-tauri/Cargo.toml");
const cargoLock = await read("src-tauri/Cargo.lock");
const tauriConfig = JSON.parse(await read("src-tauri/tauri.conf.json"));
const indexHtml = await read("index.html");
const styles = await read("src/styles.css");
const app = await read("src/App.tsx");
const viteConfig = await read("vite.config.ts");
const ciWorkflow = await read(".github/workflows/ci.yml");

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLockVersion = cargoLock.match(
  /\[\[package\]\]\nname = "illama"\nversion = "([^"]+)"/,
)?.[1];
const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["src-tauri/Cargo.toml", cargoVersion],
  ["src-tauri/Cargo.lock", cargoLockVersion],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
]);

for (const [file, version] of versions) {
  if (version !== expectedVersion) {
    fail(`${file} version is ${version ?? "missing"}; expected ${expectedVersion}`);
  }
}

const csp = tauriConfig.app?.security?.csp;
if (typeof csp !== "string" || csp.trim() === "") {
  fail("Tauri CSP must be a non-empty string");
} else {
  const requiredDirectives = [
    "default-src 'self'",
    "connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:*",
    "img-src 'self' asset: http://asset.localhost data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];
  for (const directive of requiredDirectives) {
    if (!csp.split(";").some((part) => part.trim() === directive)) {
      fail(`Tauri CSP is missing exact directive: ${directive}`);
    }
  }
  if (/\bhttps?:\/\/(?!ipc\.localhost\b|asset\.localhost\b|127\.0\.0\.1(?=[:/]))/i.test(csp)) {
    fail("Tauri CSP allows a remote HTTP(S) origin");
  }
}

if (/(?:href|src)=["']https?:\/\//i.test(indexHtml)) {
  fail("index.html contains a remote HTTP(S) resource");
}
if (/url\(\s*["']?https?:\/\//i.test(styles)) {
  fail("src/styles.css contains a remote HTTP(S) resource");
}

if (/\bInter\b/.test(styles)) {
  fail("src/styles.css still depends on the remote Inter font");
}
if (/version-badge[^\n]*v\d+\.\d+\.\d+/.test(app)) {
  fail("src/App.tsx hardcodes the version badge");
}
if (!viteConfig.includes("__APP_VERSION__")) {
  fail("vite.config.ts does not expose package.json version as __APP_VERSION__");
}
if (!ciWorkflow.includes("npm run check:project")) {
  fail("CI does not run the project policy verification");
}
if (!ciWorkflow.includes("npm audit --audit-level=high")) {
  fail("CI does not reject high/critical npm advisories");
}
if (!ciWorkflow.includes("rustsec/audit-check@")) {
  fail("CI does not run the RustSec audit action");
}

if (failures.length > 0) {
  console.error("Project policy verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Project policy verified for iLlama ${expectedVersion}.`);
}

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const defaultRoot = resolve(import.meta.dirname, "..");
const expectedVersion = "3.2.0";

export function extractRustsecReview(markdown) {
  const match = markdown.match(
    /<!-- rustsec-review-json:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- rustsec-review-json:end -->/,
  );
  if (!match) {
    throw new Error("docs/security/rustsec-3.2.0.md is missing its machine-readable RustSec review block.");
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(
      `The machine-readable RustSec review block is invalid JSON: ${error.message}`,
      { cause: error },
    );
  }
}

export function validateRustsecReview(
  audit,
  review,
  {
    cargoLockSha256 = null,
    now = new Date().toISOString().slice(0, 10),
  } = {},
) {
  const failures = [];
  const allowedCategories = new Set(["notice", "unmaintained", "unsound"]);
  const live = new Map();

  if ((audit?.settings?.ignore ?? []).length > 0) {
    failures.push("cargo audit must not use an ignore list for the 3.2.0 release review.");
  }

  for (const [category, warnings] of Object.entries(audit?.warnings ?? {})) {
    if (!allowedCategories.has(category) && (warnings?.length ?? 0) > 0) {
      failures.push(`RustSec emitted unsupported informational category ${category}.`);
    }
    for (const item of warnings ?? []) {
      const advisoryId = item?.advisory?.id;
      if (!advisoryId) {
        failures.push(`RustSec ${category} warning is missing an advisory ID.`);
        continue;
      }
      live.set(advisoryId, {
        advisoryId,
        category: item.kind ?? category,
        crate: item.package?.name ?? null,
        version: item.package?.version ?? null,
        vulnerability: false,
      });
    }
  }

  for (const item of audit?.vulnerabilities?.list ?? []) {
    const advisoryId = item?.advisory?.id ?? "unknown";
    failures.push(`Vulnerability ${advisoryId} blocks release; it cannot be accepted by review.`);
    live.set(advisoryId, {
      advisoryId,
      category: "vulnerability",
      crate: item.package?.name ?? null,
      version: item.package?.version ?? null,
      vulnerability: true,
    });
  }
  if ((audit?.vulnerabilities?.count ?? 0) > 0 && (audit?.vulnerabilities?.list ?? []).length === 0) {
    failures.push("cargo audit reports vulnerabilities without advisory details; release is blocked.");
  }

  if (review?.schemaVersion !== 1) failures.push("RustSec review schemaVersion must be 1.");
  if (review?.release !== expectedVersion) {
    failures.push(`RustSec review release is ${review?.release ?? "missing"}; expected ${expectedVersion}.`);
  }
  if (!/^[0-9a-f]{64}$/i.test(review?.audit?.cargoLockSha256 ?? "")) {
    failures.push("RustSec review is missing a valid Cargo.lock SHA-256.");
  } else if (
    cargoLockSha256 &&
    review.audit.cargoLockSha256.toLowerCase() !== cargoLockSha256.toLowerCase()
  ) {
    failures.push(
      `RustSec review Cargo.lock SHA-256 is ${review.audit.cargoLockSha256}; current lockfile is ${cargoLockSha256}.`,
    );
  }
  if (!Array.isArray(review?.reviews)) {
    failures.push("RustSec review entries are missing.");
    return failures;
  }

  const requiredTextFields = [
    "advisoryId",
    "category",
    "crate",
    "version",
    "dependencyPath",
    "releaseRelevance",
    "mitigation",
    "owner",
    "reviewedOn",
    "reviewExpires",
    "rereviewCondition",
  ];
  const reviewed = new Map();
  for (const entry of review.reviews) {
    const entryId = entry?.advisoryId ?? "unknown";
    if (reviewed.has(entryId)) failures.push(`Duplicate RustSec review ${entryId}.`);
    reviewed.set(entryId, entry);

    for (const field of requiredTextFields) {
      if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
        failures.push(`${entryId} missing ${field}.`);
      }
    }
    for (const target of ["macosArm64", "windowsPreview"]) {
      if (
        typeof entry?.targetReachability?.[target] !== "string" ||
        entry.targetReachability[target].trim() === ""
      ) {
        failures.push(`${entryId} missing targetReachability.${target}.`);
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(entry?.reviewExpires ?? "")) {
      if (entry.reviewExpires < now) {
        failures.push(`${entryId} review expired on ${entry.reviewExpires}.`);
      }
    } else {
      failures.push(`${entryId} reviewExpires must be YYYY-MM-DD.`);
    }
  }

  for (const [advisoryId, item] of live) {
    const entry = reviewed.get(advisoryId);
    if (!entry) {
      failures.push(`Unreviewed RustSec advisory ${advisoryId}.`);
      continue;
    }
    if (entry.crate !== item.crate || entry.version !== item.version) {
      failures.push(
        `${advisoryId} crate/version review is ${entry.crate}@${entry.version}; audit reports ${item.crate}@${item.version}.`,
      );
    }
    if (entry.category !== item.category) {
      failures.push(
        `${advisoryId} category review is ${entry.category}; audit reports ${item.category}.`,
      );
    }
  }
  for (const advisoryId of reviewed.keys()) {
    if (!live.has(advisoryId)) failures.push(`Stale RustSec review ${advisoryId} is not emitted by cargo audit.`);
  }

  if (review?.audit?.vulnerabilityCount !== (audit?.vulnerabilities?.count ?? 0)) {
    failures.push("RustSec review vulnerabilityCount does not match cargo audit.");
  }
  if (review?.audit?.dependencyCount !== audit?.lockfile?.["dependency-count"]) {
    failures.push("RustSec review dependencyCount does not match cargo audit.");
  }
  const warningCount = Object.values(audit?.warnings ?? {}).reduce(
    (count, warnings) => count + (warnings?.length ?? 0),
    0,
  );
  if (review?.audit?.warningCount !== warningCount) {
    failures.push("RustSec review warningCount does not match cargo audit.");
  }
  if (
    !Array.isArray(review?.audit?.ignoredAdvisories) ||
    review.audit.ignoredAdvisories.length > 0
  ) {
    failures.push("RustSec review ignoredAdvisories must be an empty array.");
  }
  return failures;
}

const REQUIRED_TAURI_CSP_DIRECTIVES = Object.freeze([
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
]);

export function validateTauriCsp(csp) {
  const failures = [];
  if (typeof csp !== "string" || csp.trim() === "") {
    return ["Tauri CSP must be a non-empty string"];
  }

  const parts = csp
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const directives = new Map();
  for (const part of parts) {
    const [name, ...sources] = part.split(/\s+/);
    const occurrences = directives.get(name) ?? [];
    occurrences.push(part);
    directives.set(name, occurrences);

    if (sources.includes("*")) {
      failures.push(`Tauri CSP directive ${name} contains a wildcard source.`);
    }
    if (sources.includes("'unsafe-eval'")) {
      failures.push(`Tauri CSP directive ${name} contains 'unsafe-eval'.`);
    }
  }

  const expectedNames = new Set();
  for (const expected of REQUIRED_TAURI_CSP_DIRECTIVES) {
    const name = expected.split(/\s+/, 1)[0];
    expectedNames.add(name);
    const occurrences = directives.get(name) ?? [];
    if (occurrences.length !== 1) {
      failures.push(
        `Tauri CSP directive ${name} must appear exactly once; found ${occurrences.length}.`,
      );
    } else if (occurrences[0] !== expected) {
      failures.push(`Tauri CSP is missing exact directive: ${expected}`);
    }
  }

  for (const name of directives.keys()) {
    if (!expectedNames.has(name)) {
      failures.push(`Tauri CSP contains unexpected directive: ${name}`);
    }
  }
  if (/\bhttps?:\/\/(?!ipc\.localhost\b|asset\.localhost\b|127\.0\.0\.1(?=[:/]))/i.test(csp)) {
    failures.push("Tauri CSP allows a remote HTTP(S) origin");
  }
  return failures;
}

export function validateWorkflowSecurityGates(ciWorkflow, releaseWorkflow) {
  const failures = [];
  const required = [
    "npm run test:release-policy",
    "npm run test:release-evidence",
    "npm run check:project",
    "npm audit --audit-level=high",
    "npm audit --omit=dev",
    "uses: taiki-e/install-action@v2.83.2",
    "tool: cargo-audit@0.22.2",
    "fallback: none",
    "cargo audit --json --file src-tauri/Cargo.lock",
    "node scripts/verify-project-policy.mjs --audit",
  ];
  for (const [label, workflow] of [
    ["CI", ciWorkflow],
    ["Release", releaseWorkflow],
  ]) {
    for (const text of required) {
      if (!workflow.includes(text)) {
        failures.push(`${label} workflow is missing required security gate: ${text}`);
      }
    }
    if (workflow.includes("cargo install cargo-audit")) {
      failures.push(`${label} workflow must not source-compile cargo-audit with cargo install.`);
    }
  }
  if (ciWorkflow.includes("checks: write")) {
    failures.push("CI workflow must not grant the unused checks: write permission.");
  }
  return failures;
}

export function isTrackedApplicationFile(relativePath) {
  const path = relativePath.replaceAll("\\", "/");
  if (
    /(^|\/)(?:node_modules|dist|target|build|coverage|\.vite)(?:\/|$)/.test(path) ||
    /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path) ||
    /\.(?:test|spec)\.[^.]+$/i.test(path)
  ) {
    return false;
  }

  const extension = path.match(/\.([^./]+)$/)?.[1]?.toLowerCase() ?? "";
  const sourceExtensions = new Set([
    "css",
    "html",
    "htm",
    "js",
    "jsx",
    "json",
    "json5",
    "less",
    "mjs",
    "rs",
    "sass",
    "scss",
    "svg",
    "toml",
    "ts",
    "tsx",
    "yaml",
    "yml",
  ]);
  if (!sourceExtensions.has(extension)) return false;

  if (path === "index.html") return true;
  if (/^(?:src|public)\//.test(path)) return true;
  if (/^src-tauri\/(?:src|capabilities)\//.test(path)) return true;
  if (/^src-tauri\/(?:Cargo\.toml|tauri\.conf\.json)$/.test(path)) return true;
  return /^(?:eslint|vite|vitest)\.config\.[^.]+$/.test(path) ||
    /^tsconfig(?:\.[^.]+)?\.json$/.test(path) ||
    /^(?:package|components)\.json$/.test(path);
}

function remoteNetworkUrl(value) {
  const candidate = value.trim().replace(/[),;]+$/, "");
  if (candidate.startsWith("//")) {
    try {
      const parsed = new URL(`http:${candidate}`);
      if (!parsed.hostname) return null;
      if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
        return null;
      }
      return candidate;
    } catch {
      return null;
    }
  }
  if (!/^(?:https?|wss?):\/\//i.test(candidate)) return null;
  if (
    /^(?:http|ws):\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(candidate) ||
    /^http:\/\/(?:ipc|asset)\.localhost(?=[:/]|$)/i.test(candidate) ||
    /^http:\/\/www\.w3\.org\/2000\/svg(?:\b|\/)/i.test(candidate)
  ) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return null;
    }
  } catch {
    return candidate;
  }
  return candidate;
}

export function findRemoteResourceLoads(source, relativePath = "source") {
  const findings = [];
  const addFinding = (kind, url) => {
    if (!findings.some((item) => item.kind === kind && item.url === url)) {
      findings.push({ file: relativePath, kind, url });
    }
  };
  const patterns = [
    {
      kind: "markup-resource",
      regex: /<(?:script|img|image|use|feImage|audio|video|source|track|iframe|frame|embed|object|link)\b[^>]*?\b(?:src|href|poster|data)\s*=\s*(?:{\s*)?["'`]([^"'`}>\s]+)/gi,
    },
    { kind: "css-import", regex: /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi },
    { kind: "css-url", regex: /\burl\(\s*["']?([^"')\s]+)/gi },
    {
      kind: "module-import",
      regex: /\b(?:import|export)\s+(?:[^"'`]*?\sfrom\s*)?["'`]([^"'`]+)["'`]/gi,
    },
    { kind: "dynamic-import", regex: /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/gi },
    {
      kind: "network-call",
      regex: /\b(?:fetch|WebSocket|EventSource)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    },
    {
      kind: "xhr-call",
      regex: /\.open\s*\(\s*["'`][A-Z]+["'`]\s*,\s*["'`]([^"'`]+)["'`]/gi,
    },
    {
      kind: "config-network-source",
      regex: /["']?(?:endpoint|baseURL|baseUrl|apiURL|apiUrl|fontURL|fontUrl)["']?\s*[:=]\s*["'`]([^"'`]+)["'`]/g,
    },
    {
      kind: "dom-resource-assignment",
      regex: /\.(?:src|href|poster|data)\s*=\s*["'`]([^"'`]+)["'`]/gi,
    },
    {
      kind: "dom-resource-attribute",
      regex: /\.setAttribute\s*\(\s*["'`](?:src|href|poster|data)["'`]\s*,\s*["'`]([^"'`]+)["'`]/gi,
    },
    {
      kind: "beacon-call",
      regex: /\bnavigator\s*\.\s*sendBeacon\s*\(\s*["'`]([^"'`]+)["'`]/gi,
    },
    {
      kind: "object-resource-property",
      regex: /\b(?:src|srcSet|srcset|href|poster|data)\s*:\s*["'`]([^"'`]+)["'`]/g,
    },
    {
      kind: "unquoted-markup-resource",
      regex: /<(?:script|img|image|use|feImage|audio|video|source|track|iframe|frame|embed|object|link)\b[^>]*?\b(?:src|href|poster|data)\s*=\s*(?!["'`{])([^\s>]+)/gi,
    },
  ];

  for (const { kind, regex } of patterns) {
    for (const match of source.matchAll(regex)) {
      const url = remoteNetworkUrl(match[1]);
      if (url) addFinding(kind, url);
    }
  }
  const srcsetPattern = /\bsrcset\s*=\s*(?:{\s*)?(["'`])([\s\S]*?)\1\s*}?/gi;
  for (const match of source.matchAll(srcsetPattern)) {
    for (const candidate of match[2].split(",")) {
      const url = remoteNetworkUrl(candidate.trim().split(/\s+/, 1)[0]);
      if (url) addFinding("srcset-resource", url);
    }
  }

  // Conservatively reject every network-scheme literal in shipped application
  // code, even when it first flows through a variable or object spread. The two
  // exceptions are inert SVG namespace text and explicit user-click navigation
  // links; neither causes an application resource load by itself.
  const networkLiteral = /(?:https?|wss?):\/\/[^\s"'`<>\])},;]+/gi;
  for (const match of source.matchAll(networkLiteral)) {
    const url = remoteNetworkUrl(match[0]);
    if (!url || isAllowedNavigationReference(source, match.index ?? 0, relativePath)) continue;
    addFinding("network-scheme-literal", url);
  }
  const protocolRelativeLiteral = /["'`](\/\/[A-Za-z0-9](?:[^\s"'`<>\])},;]*))["'`]/g;
  for (const match of source.matchAll(protocolRelativeLiteral)) {
    const url = remoteNetworkUrl(match[1]);
    const urlIndex = (match.index ?? 0) + 1;
    if (!url || isAllowedNavigationReference(source, urlIndex, relativePath)) continue;
    addFinding("protocol-relative-literal", url);
  }
  findStaticJavaScriptNetworkValues(source, relativePath, addFinding);
  return findings;
}

function isAllowedNavigationReference(source, index, relativePath) {
  const before = source.slice(Math.max(0, index - 240), index);
  if (/<a\b[^>]*\bhref\s*=\s*(?:{\s*)?["'`]?$/i.test(before)) return true;
  if (
    relativePath.replaceAll("\\", "/") === "src/lib/externalClients.ts" &&
    /\bhomepageUrl\s*:\s*["'`]?$/i.test(before)
  ) {
    return true;
  }
  return false;
}

function findStaticJavaScriptNetworkValues(source, relativePath, addFinding) {
  const normalizedPath = relativePath.replaceAll("\\", "/").toLowerCase();
  if (!/\.(?:[cm]?js|jsx|ts|tsx)$/.test(normalizedPath)) return;
  const scriptKind = normalizedPath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : normalizedPath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : normalizedPath.endsWith(".ts")
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const declarations = new Map();
  const visitDeclarations = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visitDeclarations);
  };
  visitDeclarations(sourceFile);

  const bindings = new Map();
  for (let pass = 0; pass <= declarations.size; pass += 1) {
    let changed = false;
    for (const [name, initializer] of declarations) {
      if (bindings.has(name)) continue;
      const value = evaluateStaticString(initializer, bindings, new Set());
      if (value === null) continue;
      bindings.set(name, value);
      changed = true;
    }
    if (!changed) break;
  }

  const visitValues = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateExpression(node) ||
      (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const value = evaluateStaticString(node, bindings, new Set());
      const url = value === null ? null : remoteNetworkUrl(value);
      const index = node.getStart(sourceFile);
      if (url && !isAllowedNavigationReference(source, index, relativePath)) {
        addFinding("static-network-value", url);
      }
    }
    ts.forEachChild(node, visitValues);
  };
  visitValues(sourceFile);
}

function evaluateStaticString(node, bindings, seen) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) {
    return evaluateStaticString(node.expression, bindings, seen);
  }
  if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return evaluateStaticString(node.expression, bindings, seen);
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text) || !bindings.has(node.text)) return null;
    seen.add(node.text);
    const value = bindings.get(node.text);
    seen.delete(node.text);
    return value;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = evaluateStaticString(span.expression, bindings, seen);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evaluateStaticString(node.left, bindings, seen);
    const right = evaluateStaticString(node.right, bindings, seen);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

export function runCargoAudit(root = defaultRoot, { spawn = spawnSync } = {}) {
  const result = spawn(
    "cargo",
    ["audit", "--json", "--file", "src-tauri/Cargo.lock"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = `${result.stdout ?? ""}`.trim();
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `cargo audit did not produce JSON (exit ${result.status ?? 1}); install cargo-audit and ensure the advisory database is available.`,
    );
  }
}

export function listTrackedApplicationFiles(root = defaultRoot, { spawn = spawnSync } = {}) {
  const result = spawn("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed with exit ${result.status ?? 1}.`);
  }
  return `${result.stdout ?? ""}`
    .split("\0")
    .filter(Boolean)
    .filter(isTrackedApplicationFile)
    .sort();
}

function staticAuditFromReview(review) {
  const warnings = {};
  const vulnerabilities = [];
  for (const entry of review?.reviews ?? []) {
    const item = {
      advisory: { id: entry.advisoryId, informational: entry.category },
      kind: entry.category,
      package: { name: entry.crate, version: entry.version },
    };
    if (entry.category === "vulnerability") vulnerabilities.push(item);
    else (warnings[entry.category] ??= []).push(item);
  }
  return {
    lockfile: { "dependency-count": review?.audit?.dependencyCount },
    settings: { ignore: review?.audit?.ignoredAdvisories ?? [] },
    vulnerabilities: {
      count: review?.audit?.vulnerabilityCount ?? vulnerabilities.length,
      found: (review?.audit?.vulnerabilityCount ?? vulnerabilities.length) > 0,
      list: vulnerabilities,
    },
    warnings,
  };
}

export async function verifyProjectPolicy({
  auditJsonPath = null,
  liveRustsec = false,
  now = new Date().toISOString().slice(0, 10),
  root = defaultRoot,
  rustsecAudit = null,
  spawn = spawnSync,
  trackedFiles = null,
} = {}) {
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
  const cargoLockSha256 = createHash("sha256").update(cargoLock).digest("hex");
  const tauriConfig = JSON.parse(await read("src-tauri/tauri.conf.json"));
  const styles = await read("src/styles.css");
  const app = await read("src/App.tsx");
  const viteConfig = await read("vite.config.ts");
  const ciWorkflow = await read(".github/workflows/ci.yml");
  const releaseWorkflow = await read(".github/workflows/release.yml");

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
  for (const cspFailure of validateTauriCsp(csp)) fail(cspFailure);

  let resourceFiles = [];
  try {
    resourceFiles = trackedFiles ?? listTrackedApplicationFiles(root, { spawn });
  } catch (error) {
    fail(`Could not enumerate tracked application files: ${error.message}`);
  }
  for (const relativePath of resourceFiles) {
    const source = await read(relativePath);
    for (const remote of findRemoteResourceLoads(source, relativePath)) {
      fail(`${relativePath} contains a remote ${remote.kind} load: ${remote.url}`);
    }
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
  for (const workflowFailure of validateWorkflowSecurityGates(ciWorkflow, releaseWorkflow)) {
    fail(workflowFailure);
  }
  if (
    packageJson.scripts?.["test:release-policy"] !==
    "node --test scripts/tests/release-infrastructure.test.mjs scripts/tests/verify-project-policy.test.mjs"
  ) {
    fail("package.json test:release-policy does not run both release policy suites");
  }
  if (
    packageJson.scripts?.["test:release-evidence"] !==
    "node --test scripts/tests/portable-checksum.test.mjs scripts/tests/release-evidence.test.mjs"
  ) {
    fail("package.json test:release-evidence does not run both release evidence suites");
  }
  if (
    packageJson.scripts?.["release:infrastructure"] !==
    "node scripts/release-infrastructure.mjs"
  ) {
    fail("package.json release:infrastructure does not invoke the infrastructure auditor");
  }
  if (!ciWorkflow.includes("npm run test:ui")) {
    fail("CI does not run the Playwright UI suite");
  }
  if (!ciWorkflow.includes("npm run test:tauri")) {
    fail("CI does not run the Rust/Tauri runtime contract suite");
  }
  if (!ciWorkflow.includes('tags: ["v3.2.0*"]')) {
    fail("CI does not run for 3.2.0 release tags");
  }
  if (tauriConfig.bundle?.macOS?.minimumSystemVersion !== "11.0") {
    fail("Apple Silicon minimumSystemVersion must match the Mach-O 11.0 deployment target");
  }

  try {
    const rustsecReview = extractRustsecReview(
      await read("docs/security/rustsec-3.2.0.md"),
    );
    let liveAudit = rustsecAudit;
    if (!liveAudit && auditJsonPath) {
      liveAudit = JSON.parse(await readFile(resolve(root, auditJsonPath), "utf8"));
    }
    if (!liveAudit && liveRustsec) liveAudit = runCargoAudit(root, { spawn });
    liveAudit ??= staticAuditFromReview(rustsecReview);
    failures.push(
      ...validateRustsecReview(liveAudit, rustsecReview, {
        cargoLockSha256,
        now,
      }),
    );
  } catch (error) {
    fail(`RustSec review verification failed: ${error.message}`);
  }

  return failures;
}

function parseMainArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--audit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--audit requires a JSON file path.");
      options.auditJsonPath = value;
      index += 1;
    } else if (argument === "--live-rustsec") {
      options.liveRustsec = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseMainArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.help) {
    console.log(
      [
        "Usage: node scripts/verify-project-policy.mjs [--audit cargo-audit.json]",
        "",
        "Default mode performs static policy checks and validates the review against Cargo.lock.",
        "Use --audit with freshly generated cargo-audit JSON for the CI/release advisory gate.",
        "Use --live-rustsec to execute cargo audit directly in an environment where it is installed.",
      ].join("\n"),
    );
    return 0;
  }
  const failures = await verifyProjectPolicy(options);
  if (failures.length > 0) {
    console.error("Project policy verification failed:\n");
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  const mode = options.auditJsonPath || options.liveRustsec
    ? "including live RustSec review"
    : "(static; live RustSec comparison still requires --audit)";
  console.log(`Project policy verified for iLlama ${expectedVersion} ${mode}.`);
  return 0;
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  process.exitCode = await main();
}

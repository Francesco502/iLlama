import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

const policy = await import("../verify-project-policy.mjs");
const CARGO_LOCK_SHA256 = "7".repeat(64);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

test("exports side-effect-free RustSec and remote-resource policy helpers", () => {
  assert.equal(typeof policy.extractRustsecReview, "function");
  assert.equal(typeof policy.validateRustsecReview, "function");
  assert.equal(typeof policy.isTrackedApplicationFile, "function");
  assert.equal(typeof policy.findRemoteResourceLoads, "function");
  assert.equal(typeof policy.runCargoAudit, "function");
  assert.equal(typeof policy.listTrackedApplicationFiles, "function");
  assert.equal(typeof policy.verifyProjectPolicy, "function");
  assert.equal(typeof policy.validateTauriCsp, "function");
  assert.equal(typeof policy.validateWorkflowSecurityGates, "function");
  assert.equal(typeof policy.validatePinnedWorkflowActions, "function");
});

const REQUIRED_TAURI_CSP = [
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
].join("; ");

test("accepts the single exact fail-closed Tauri CSP", () => {
  assert.deepEqual(policy.validateTauriCsp(REQUIRED_TAURI_CSP), []);
});

for (const [label, csp] of [
  ["duplicate permissive connect-src", `connect-src *; ${REQUIRED_TAURI_CSP}`],
  ["duplicate permissive script-src", `script-src *; ${REQUIRED_TAURI_CSP}`],
  ["wildcard source", REQUIRED_TAURI_CSP.replace("font-src 'self'", "font-src 'self' *")],
  ["unsafe eval", REQUIRED_TAURI_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")],
]) {
  test(`rejects ${label} in Tauri CSP`, () => {
    assert.ok(policy.validateTauriCsp(csp).length > 0);
  });
}

function warning(id, category, crate, version) {
  return {
    advisory: { id, informational: category },
    kind: category,
    package: { name: crate, version },
  };
}

function auditFixture() {
  return {
    database: {
      "advisory-count": 1166,
      "last-commit": "b5fc89b8be99e96f79194d8a6f11e9b4143b99f0",
      "last-updated": "2026-07-17T17:52:38+02:00",
    },
    lockfile: { "dependency-count": 468 },
    vulnerabilities: { count: 0, found: false, list: [] },
    warnings: {
      unmaintained: [
        warning("RUSTSEC-2024-0415", "unmaintained", "gtk", "0.18.2"),
      ],
      unsound: [warning("RUSTSEC-2024-0429", "unsound", "glib", "0.18.5")],
    },
  };
}

function reviewEntry(id, category, crate, version) {
  return {
    advisoryId: id,
    category,
    crate,
    dependencyPath: `${crate} -> tauri -> illama`,
    mitigation: "Pinned transitively while the upstream Tauri dependency is monitored.",
    owner: "iLlama maintainers / release owner",
    releaseRelevance: "Reviewed for the formal macOS arm64 release and Windows preview.",
    rereviewCondition: "Before 2026-10-22 or when the upstream dependency changes.",
    reviewExpires: "2026-10-22",
    reviewedOn: "2026-07-22",
    targetReachability: {
      macosArm64: "not-runtime-reachable",
      windowsPreview: "not-runtime-reachable",
    },
    version,
  };
}

function reviewFixture() {
  return {
    audit: {
      advisoryDatabaseCommit: "b5fc89b8be99e96f79194d8a6f11e9b4143b99f0",
      cargoLockSha256: CARGO_LOCK_SHA256,
      command: "cargo audit --json --file src-tauri/Cargo.lock",
      dependencyCount: 468,
      ignoredAdvisories: [],
      vulnerabilityCount: 0,
      warningCount: 2,
    },
    release: "3.2.0",
    reviewedOn: "2026-07-22",
    reviews: [
      reviewEntry("RUSTSEC-2024-0415", "unmaintained", "gtk", "0.18.2"),
      reviewEntry("RUSTSEC-2024-0429", "unsound", "glib", "0.18.5"),
    ],
    schemaVersion: 1,
  };
}

test("extracts the bounded machine-readable RustSec review block", () => {
  const expected = reviewFixture();
  const markdown = [
    "# Review",
    "<!-- rustsec-review-json:start -->",
    "```json",
    JSON.stringify(expected, null, 2),
    "```",
    "<!-- rustsec-review-json:end -->",
  ].join("\n");

  assert.deepEqual(policy.extractRustsecReview(markdown), expected);
  assert.throws(
    () => policy.extractRustsecReview("# no machine-readable block"),
    /machine-readable RustSec review block/,
  );
});

test("accepts only fully recorded, unexpired informational advisories", () => {
  assert.deepEqual(
    policy.validateRustsecReview(auditFixture(), reviewFixture(), {
      cargoLockSha256: CARGO_LOCK_SHA256,
      now: "2026-07-22",
    }),
    [],
  );
});

test("binds the review to the exact Cargo.lock SHA-256", () => {
  const failures = policy.validateRustsecReview(auditFixture(), reviewFixture(), {
    cargoLockSha256: "8".repeat(64),
    now: "2026-07-22",
  });

  assert.ok(failures.some((failure) => failure.includes("Cargo.lock SHA-256")));
});

test("binds review counts and forbids documented ignore IDs", () => {
  const review = reviewFixture();
  review.audit.warningCount = 99;
  review.audit.ignoredAdvisories = ["RUSTSEC-2024-0415"];

  const failures = policy.validateRustsecReview(auditFixture(), review, {
    cargoLockSha256: CARGO_LOCK_SHA256,
    now: "2026-07-22",
  });
  assert.ok(failures.some((failure) => failure.includes("warningCount")));
  assert.ok(failures.some((failure) => failure.includes("ignoredAdvisories")));
});

test("rejects every live advisory without a matching review", () => {
  const review = reviewFixture();
  review.reviews.pop();

  assert.ok(
    policy
      .validateRustsecReview(auditFixture(), review, { now: "2026-07-22" })
      .some((failure) => failure.includes("Unreviewed RustSec advisory RUSTSEC-2024-0429")),
  );
});

test("rejects stale review IDs and review metadata that does not match the audit", () => {
  const review = reviewFixture();
  review.reviews.push(
    reviewEntry("RUSTSEC-2099-0001", "unmaintained", "old-crate", "1.0.0"),
  );
  review.reviews[0].version = "9.9.9";
  review.reviews[1].category = "notice";

  const failures = policy.validateRustsecReview(auditFixture(), review, {
    now: "2026-07-22",
  });
  assert.ok(failures.some((failure) => failure.includes("Stale RustSec review RUSTSEC-2099-0001")));
  assert.ok(failures.some((failure) => failure.includes("RUSTSEC-2024-0415 crate/version")));
  assert.ok(failures.some((failure) => failure.includes("RUSTSEC-2024-0429 category")));
});

test("rejects vulnerabilities even when someone records an acceptance", () => {
  const audit = auditFixture();
  const vulnerability = warning("RUSTSEC-2099-9999", null, "unsafe-crate", "1.0.0");
  audit.vulnerabilities = { count: 1, found: true, list: [vulnerability] };
  const review = reviewFixture();
  review.reviews.push(
    reviewEntry("RUSTSEC-2099-9999", "vulnerability", "unsafe-crate", "1.0.0"),
  );

  assert.ok(
    policy
      .validateRustsecReview(audit, review, { now: "2026-07-22" })
      .some((failure) => failure.includes("Vulnerability RUSTSEC-2099-9999 blocks release")),
  );
});

test("rejects cargo-audit ignore lists and unknown warning categories", () => {
  const audit = auditFixture();
  audit.settings = { ignore: ["RUSTSEC-2024-0415"] };
  audit.warnings.future_category = [
    warning("RUSTSEC-2099-0002", "future_category", "future-crate", "1.0.0"),
  ];
  const review = reviewFixture();
  review.reviews.push(
    reviewEntry(
      "RUSTSEC-2099-0002",
      "future_category",
      "future-crate",
      "1.0.0",
    ),
  );

  const failures = policy.validateRustsecReview(audit, review, {
    now: "2026-07-22",
  });
  assert.ok(failures.some((failure) => failure.includes("must not use an ignore list")));
  assert.ok(failures.some((failure) => failure.includes("unsupported informational category")));
});

test("rejects expired or incomplete RustSec reviews", () => {
  const review = reviewFixture();
  review.reviews[0].reviewExpires = "2026-07-21";
  review.reviews[1].mitigation = "";

  const failures = policy.validateRustsecReview(auditFixture(), review, {
    now: "2026-07-22",
  });
  assert.ok(failures.some((failure) => failure.includes("RUSTSEC-2024-0415 review expired")));
  assert.ok(failures.some((failure) => failure.includes("RUSTSEC-2024-0429 missing mitigation")));
});

test("selects all tracked application source, markup, style, and config files only", () => {
  for (const path of [
    "index.html",
    "src/App.tsx",
    "src/styles.css",
    "src-tauri/src/lib.rs",
    "src-tauri/tauri.conf.json",
    "src-tauri/capabilities/default.json",
    "public/icon.svg",
    "vite.config.ts",
    "tsconfig.json",
  ]) {
    assert.equal(policy.isTrackedApplicationFile(path), true, path);
  }

  for (const path of [
    "dist/assets/index.js",
    "node_modules/pkg/index.js",
    "src-tauri/target/release/generated.js",
    "src/App.test.tsx",
    "tests/ui/workbench.spec.ts",
    "docs/release-strategy.md",
    "scripts/release-macos.mjs",
    ".github/workflows/ci.yml",
  ]) {
    assert.equal(policy.isTrackedApplicationFile(path), false, path);
  }
});

test("runs a live cargo audit for the exact lockfile without ignore flags", () => {
  const expected = auditFixture();
  const calls = [];
  const actual = policy.runCargoAudit("/workspace", {
    spawn: (command, args, options) => {
      calls.push({ args, command, options });
      return { status: 1, stderr: "vulnerabilities found", stdout: JSON.stringify(expected) };
    },
  });

  assert.deepEqual(actual, expected);
  assert.deepEqual(calls[0].command, "cargo");
  assert.deepEqual(calls[0].args, [
    "audit",
    "--json",
    "--file",
    "src-tauri/Cargo.lock",
  ]);
  assert.equal(calls[0].options.cwd, "/workspace");
  assert.equal(calls[0].args.some((argument) => argument.includes("ignore")), false);
});

test("fails closed when cargo audit cannot provide parseable JSON", () => {
  assert.throws(
    () =>
      policy.runCargoAudit("/workspace", {
        spawn: () => ({ status: 127, stderr: "not found", stdout: "" }),
      }),
    /cargo audit did not produce JSON/,
  );
});

test("gets remote-resource inputs only from git tracked application files", () => {
  const calls = [];
  const files = policy.listTrackedApplicationFiles("/workspace", {
    spawn: (command, args, options) => {
      calls.push({ args, command, options });
      return {
        status: 0,
        stderr: "",
        stdout: [
          "src/App.tsx",
          "dist/assets/index.js",
          "src-tauri/src/lib.rs",
          "scripts/release-macos.mjs",
          "vite.config.ts",
          "",
        ].join("\0"),
      };
    },
  });

  assert.deepEqual(files, ["src-tauri/src/lib.rs", "src/App.tsx", "vite.config.ts"]);
  assert.deepEqual(calls[0].command, "git");
  assert.deepEqual(calls[0].args, ["ls-files", "-z"]);
  assert.equal(calls[0].options.cwd, "/workspace");
});

test("default project check validates the review statically without invoking cargo audit", async () => {
  const commands = [];
  const failures = await policy.verifyProjectPolicy({
    now: "2027-01-01",
    root: projectRoot,
    spawn: (command) => {
      commands.push(command);
      throw new Error(`unexpected command ${command}`);
    },
    trackedFiles: [],
  });

  assert.equal(commands.includes("cargo"), false);
  assert.ok(failures.some((failure) => failure.includes("review expired")));
});

const FRESH_AUDIT_WORKFLOW = [
  "npm run test:release-policy",
  "npm run test:release-evidence",
  "npm run check:project",
  "npm audit --audit-level=high",
  "npm audit --omit=dev",
  "uses: taiki-e/install-action@43aecc8d72668fbcfe75c31400bc4f890f1c5853",
  "tool: cargo-audit@0.22.2",
  "fallback: none",
  "cargo audit --json --file src-tauri/Cargo.lock",
  "node scripts/verify-project-policy.mjs --audit",
].join("\n");

test("requires fresh pinned RustSec and npm production gates in CI and release", () => {
  assert.deepEqual(
    policy.validateWorkflowSecurityGates(FRESH_AUDIT_WORKFLOW, FRESH_AUDIT_WORKFLOW),
    [],
  );
});

for (const [label, omitted] of [
  ["release-policy tests", "npm run test:release-policy"],
  ["release-evidence tests", "npm run test:release-evidence"],
  ["production npm audit", "npm audit --omit=dev"],
  ["pinned prebuilt installer", "uses: taiki-e/install-action@43aecc8d72668fbcfe75c31400bc4f890f1c5853"],
  ["pinned cargo-audit version", "tool: cargo-audit@0.22.2"],
  ["disabled source fallback", "fallback: none"],
  ["fresh audit JSON", "cargo audit --json --file src-tauri/Cargo.lock"],
  ["bounded review comparison", "node scripts/verify-project-policy.mjs --audit"],
]) {
  test(`rejects CI without ${label}`, () => {
    const weakened = FRESH_AUDIT_WORKFLOW.replace(omitted, "");
    assert.ok(policy.validateWorkflowSecurityGates(weakened, FRESH_AUDIT_WORKFLOW).length > 0);
  });
}

test("rejects source-compiling cargo-audit in a release workflow", () => {
  assert.ok(
    policy
      .validateWorkflowSecurityGates(
        FRESH_AUDIT_WORKFLOW,
        `${FRESH_AUDIT_WORKFLOW}\ncargo install cargo-audit`,
      )
      .some((failure) => failure.includes("cargo install")),
  );
});

test("rejects unnecessary CI checks write permission", () => {
  assert.ok(
    policy
      .validateWorkflowSecurityGates(
        `${FRESH_AUDIT_WORKFLOW}\npermissions:\n  checks: write`,
        FRESH_AUDIT_WORKFLOW,
      )
      .some((failure) => failure.includes("checks: write")),
  );
});

test("requires every third-party workflow action to use a full commit SHA", () => {
  const pinned = [
    "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
    "- uses: ./local-action",
    `- uses: docker://alpine@sha256:${"a".repeat(64)}`,
  ].join("\n");
  assert.deepEqual(policy.validatePinnedWorkflowActions(pinned, "Release"), []);
  assert.ok(
    policy
      .validatePinnedWorkflowActions("- uses: actions/checkout@v7", "Release")
      .some((failure) => failure.includes("not pinned")),
  );
  assert.ok(
    policy
      .validatePinnedWorkflowActions("- uses: docker://alpine:3.22", "Release")
      .some((failure) => failure.includes("image digest")),
  );
});

for (const [label, source] of [
  ["remote script", '<script src="https://cdn.example/app.js"></script>'],
  ["unquoted remote script", '<script src=https://cdn.example/app.js></script>'],
  ["protocol-relative image", '<img src="//cdn.example/image.png">'],
  ["remote font stylesheet", '<link rel="stylesheet" href="https://fonts.example/css">'],
  ["remote frame", '<iframe src="https://frame.example/"></iframe>'],
  ["remote media poster", '<video poster="https://media.example/poster.jpg">'],
  ["remote SVG use", '<use href="//media.example/icons.svg#mark">'],
  ["remote srcset", '<source srcset="https://media.example/a.png 1x">'],
  ["JSX expression image", '<img src={"https://media.example/a.png"} />'],
  [
    "JSX expression stylesheet",
    '<link rel="stylesheet" href={"https://fonts.example/css"} />',
  ],
  [
    "later remote srcset candidate",
    '<img srcset="/local.png 1x, https://media.example/remote.png 2x">',
  ],
  ["CSS import", '@import url("https://cdn.example/theme.css");'],
  ["CSS URL", '.hero { background: url(//cdn.example/hero.png); }'],
  ["module import", 'import helper from "https://cdn.example/helper.js";'],
  ["dynamic import", 'await import("//cdn.example/chunk.js");'],
  ["fetch", 'fetch("https://api.example/models")'],
  [
    "fetch through a constant",
    'const remote = "https://api.example/models"; fetch(remote)',
  ],
  [
    "protocol-relative fetch through a constant",
    'const remote = "//api.example/models"; fetch(remote)',
  ],
  [
    "concatenated remote scheme",
    'const remote = "https:" + "//api.example/models"; fetch(remote)',
  ],
  [
    "dynamic remote host template",
    'const host = "api.example"; fetch(`http://${host}/v1/models`)',
  ],
  ["WebSocket", 'new WebSocket("wss://api.example/socket")'],
  ["EventSource", 'new EventSource("https://api.example/events")'],
  ["sendBeacon", 'navigator.sendBeacon("https://api.example/telemetry", "x")'],
  ["XHR", 'request.open("GET", "https://api.example/models")'],
  ["config endpoint", '{ "endpoint": "https://api.example/v1" }'],
  ["DOM script assignment", 'script.src = "https://cdn.example/runtime.js"'],
  [
    "JSX spread resource",
    '<img {...{ src: "https://media.example/spread.png" }} />',
  ],
  [
    "JSX spread protocol-relative constant",
    'const remote = "//media.example/spread.png"; <img {...{ src: remote }} />',
  ],
  [
    "DOM image setAttribute",
    'image.setAttribute("src", "//media.example/runtime.png")',
  ],
]) {
  test(`rejects ${label} resource loads`, () => {
    assert.ok(policy.findRemoteResourceLoads(source, "src/example.tsx").length > 0);
  });
}

test("allows loopback runtime endpoints, packaged assets, data URLs, and ordinary links", () => {
  const source = [
    'fetch("http://127.0.0.1:8080/v1/models")',
    'new WebSocket("ws://localhost:9090/events")',
    'const baseUrl = `http://127.0.0.1:${port}/v1`',
    '<img src="asset://localhost/icon.png">',
    '<img src="data:image/png;base64,AAAA">',
    '<a href="https://example.com/docs">documentation</a>',
  ].join("\n");

  assert.deepEqual(policy.findRemoteResourceLoads(source, "src/example.tsx"), []);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("../release-infrastructure.mjs", import.meta.url),
);
const infrastructure = await import("../release-infrastructure.mjs");

test("CLI fails closed before GitHub access when repository identity is absent", () => {
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;

  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "missing");
  assert.deepEqual(report.findings, [
    {
      code: "repository-required",
      message: "Pass --repo owner/name or set GITHUB_REPOSITORY.",
      state: "missing",
    },
  ]);
});

test("CLI apply requires --repo even when GITHUB_REPOSITORY is set", async () => {
  const output = [];
  const calls = [];
  const status = await infrastructure.main(
    [
      "--apply",
      "--json",
      "--sha",
      CANDIDATE_SHA,
      "--tag",
      CANDIDATE_TAG,
      "--reviewer-id",
      "101",
      "--required-check",
      REQUIRED_CHECKS[0],
    ],
    { GITHUB_REPOSITORY: REPOSITORY },
    {
      api: async (request) => {
        calls.push(request);
        return {};
      },
      stderr: () => {},
      stdout: (text) => output.push(text),
    },
  );

  assert.equal(status, 2);
  assert.equal(calls.length, 0);
  assertFinding(JSON.parse(output.join("")), "apply-repository-required", "missing");
});

test("exports a dependency-injected infrastructure audit core", () => {
  assert.equal(typeof infrastructure.auditInfrastructure, "function");
});

test("exports apply planning and execution without binding to gh", () => {
  assert.equal(typeof infrastructure.applyInfrastructure, "function");
  assert.equal(typeof infrastructure.createGhApi, "function");
  assert.ok(Array.isArray(infrastructure.REQUIRED_ENVIRONMENT_SECRETS));
  assert.equal(infrastructure.GITHUB_ACTIONS_APP_ID, 15368);
});

test("default protected checks match every current CI job and matrix expansion", async () => {
  const ciWorkflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const jobIds = ["policy", "frontend", "ui", "tauri-contract", "rust"];
  const actual = [];

  for (const [index, jobId] of jobIds.entries()) {
    const nextJob = jobIds[index + 1];
    const start = ciWorkflow.indexOf(`  ${jobId}:`);
    const end = nextJob ? ciWorkflow.indexOf(`  ${nextJob}:`, start + 1) : ciWorkflow.length;
    assert.notEqual(start, -1, `missing CI job ${jobId}`);
    const block = ciWorkflow.slice(start, end);
    const displayName = block.match(/^\s{4}name:\s*(.+)$/m)?.[1];
    assert.ok(displayName, `missing display name for CI job ${jobId}`);
    const matrixValues = block
      .match(/^\s{8}os:\s*\[([^\]]+)\]/m)?.[1]
      ?.split(",")
      .map((value) => value.trim());
    if (matrixValues) {
      actual.push(...matrixValues.map((value) => displayName.replace("${{ matrix.os }}", value)));
    } else {
      actual.push(displayName);
    }
  }

  assert.deepEqual(infrastructure.DEFAULT_REQUIRED_CHECKS, actual);
});

const REPOSITORY = "example/iLlama";
const CANDIDATE_SHA = "a".repeat(40);
const CANDIDATE_TAG = "v3.2.0-rc.1";
const REQUIRED_CHECKS = [...infrastructure.DEFAULT_REQUIRED_CHECKS];
const REQUIRED_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/release-acceptance.yml",
  ".github/workflows/release.yml",
];
const REQUIRED_TAG_POLICIES = ["v3.2.0-rc.1", "v3.2.0"];
const REQUIRED_ACCEPTANCE_INPUTS = [
  "ACCEPTANCE_LLAMA_SERVER_PATHS",
  "ACCEPTANCE_LLAMA_MODEL_PATH",
];
const AUDIT_OPTIONS = Object.freeze({
  candidateSha: CANDIDATE_SHA,
  candidateTag: CANDIDATE_TAG,
  repo: REPOSITORY,
  requiredChecks: REQUIRED_CHECKS,
  reviewerIds: [101],
});

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function happyRoutes() {
  const routes = new Map([
    [
      `GET /repos/${REPOSITORY}`,
      { default_branch: "main", full_name: REPOSITORY },
    ],
    [
      `GET /repos/${REPOSITORY}/compare/${CANDIDATE_SHA}...main`,
      {
        head_commit: { sha: "f".repeat(40) },
        merge_base_commit: { sha: CANDIDATE_SHA },
        status: "ahead",
      },
    ],
    [
      `GET /repos/${REPOSITORY}/environments/macos-release`,
      {
        can_admins_bypass: false,
        deployment_branch_policy: {
          custom_branch_policies: true,
          protected_branches: false,
        },
        name: "macos-release",
        protection_rules: [
          {
            prevent_self_review: false,
            reviewers: [
              { reviewer: { id: 101, login: "release-reviewer" }, type: "User" },
            ],
            type: "required_reviewers",
          },
          { type: "branch_policy" },
        ],
        wait_timer: 0,
      },
    ],
    [
      `GET /repos/${REPOSITORY}/environments/macos-release/secrets?per_page=100`,
      {
        secrets: [
          ...infrastructure.REQUIRED_ENVIRONMENT_SECRETS,
          ...REQUIRED_ACCEPTANCE_INPUTS,
        ].map((name) => ({ name, value: `must-not-leak-${name}` })),
        total_count:
          infrastructure.REQUIRED_ENVIRONMENT_SECRETS.length +
          REQUIRED_ACCEPTANCE_INPUTS.length,
      },
    ],
    [
      `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`,
      {
        branch_policies: REQUIRED_TAG_POLICIES.map((name, index) => ({
          id: index + 1,
          name,
          type: "tag",
        })),
        total_count: REQUIRED_TAG_POLICIES.length,
      },
    ],
    [
      `GET /repos/${REPOSITORY}/branches/main/protection`,
      {
        allow_deletions: { enabled: false },
        allow_force_pushes: { enabled: false },
        enforce_admins: { enabled: true },
        required_conversation_resolution: { enabled: false },
        required_pull_request_reviews: null,
        required_status_checks: {
          checks: REQUIRED_CHECKS.map((context) => ({
            app_id: infrastructure.GITHUB_ACTIONS_APP_ID,
            context,
          })),
          contexts: [],
          strict: true,
        },
        restrictions: null,
      },
    ],
    [
      `GET /repos/${REPOSITORY}/git/ref/tags/${CANDIDATE_TAG}`,
      { object: { sha: CANDIDATE_SHA, type: "commit" }, ref: `refs/tags/${CANDIDATE_TAG}` },
    ],
  ]);

  for (const workflowPath of REQUIRED_WORKFLOWS) {
    routes.set(
      `GET /repos/${REPOSITORY}/contents/${workflowPath}?ref=main`,
      { path: workflowPath, sha: "b".repeat(40), type: "file" },
    );
  }

  routes.set(
    `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`,
    {
      total_count: 1,
      workflow_runs: [
        {
          conclusion: "success",
          event: "push",
          head_branch: CANDIDATE_TAG,
          head_sha: CANDIDATE_SHA,
          id: 501,
          path: ".github/workflows/ci.yml",
          run_attempt: 1,
          status: "completed",
        },
      ],
    },
  );
  const acceptanceRuns = [
    { evidenceType: "llama-matrix", id: 601 },
    { evidenceType: "external-client", id: 602 },
  ];
  routes.set(
    `GET /repos/${REPOSITORY}/actions/workflows/release-acceptance.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`,
    {
      total_count: acceptanceRuns.length,
      workflow_runs: acceptanceRuns.map(({ id }) => ({
        conclusion: "success",
        event: "workflow_dispatch",
        head_branch: CANDIDATE_TAG,
        head_sha: CANDIDATE_SHA,
        id,
        path: ".github/workflows/release-acceptance.yml",
        run_attempt: 1,
        status: "completed",
      })),
    },
  );
  for (const { evidenceType, id } of acceptanceRuns) {
    routes.set(
      `GET /repos/${REPOSITORY}/actions/runs/${id}/artifacts?per_page=100`,
      {
        artifacts: [
          {
            expired: false,
            id: id + 1000,
            name: `evidence-${evidenceType}-${CANDIDATE_SHA}-${id}-1`,
            workflow_run: { head_sha: CANDIDATE_SHA, id },
          },
        ],
        total_count: 1,
      },
    );
  }

  return routes;
}

function createApi(routes = happyRoutes()) {
  const calls = [];
  const api = async ({ body, method = "GET", path }) => {
    calls.push({ body: structuredClone(body ?? null), method, path });
    const key = `${method} ${path}`;
    if (!routes.has(key)) {
      if (method !== "GET") return {};
      throw new Error(`Unexpected API call: ${key}`);
    }
    const response = routes.get(key);
    if (response instanceof Error) throw response;
    return structuredClone(response);
  };
  return { api, calls, routes };
}

function assertFinding(report, code, state) {
  assert.ok(
    report.findings.some((finding) => finding.code === code && finding.state === state),
    `expected ${state} finding ${code}; got ${JSON.stringify(report.findings)}`,
  );
}

test("audit reports a stable ready snapshot without secret values", async () => {
  const { api } = createApi();
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, { api });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, "release-infrastructure");
  assert.equal(report.status, "ready");
  assert.equal(report.repository.actual, REPOSITORY);
  assert.equal(report.repository.defaultBranch, "main");
  assert.equal(report.candidate.sha, CANDIDATE_SHA);
  assert.equal(report.candidate.tag, CANDIDATE_TAG);
  assert.deepEqual(report.environment.secrets.required, [
    ...infrastructure.REQUIRED_ENVIRONMENT_SECRETS,
  ]);
  assert.deepEqual(report.environment.secrets.missing, []);
  assert.deepEqual(
    report.workflows.map(({ path, state }) => ({ path, state })),
    REQUIRED_WORKFLOWS.map((path) => ({ path, state: "ready" })),
  );
  assert.deepEqual(
    report.runs.map(({ evidenceType, workflow, state }) => ({ evidenceType, workflow, state })),
    [
      { evidenceType: null, state: "ready", workflow: "ci.yml" },
      { evidenceType: "llama-matrix", state: "ready", workflow: "release-acceptance.yml" },
      { evidenceType: "external-client", state: "ready", workflow: "release-acceptance.yml" },
    ],
  );
  assert.deepEqual(report.acceptanceInputs.missing, []);
  assert.doesNotMatch(JSON.stringify(report), /must-not-leak/);
});

test("missing protected environment fails closed", async () => {
  const routes = happyRoutes();
  routes.set(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
    httpError(404),
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "missing");
  assertFinding(report, "environment:macos-release", "missing");
});

test("missing required reviewer fails closed", async () => {
  const routes = happyRoutes();
  const environment = routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  );
  environment.protection_rules[0].reviewers = [];
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "missing");
  assertFinding(report, "environment-reviewer:101", "missing");
});

test("multiple environment reviewers violate the single-maintainer policy", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  ).protection_rules[0].reviewers.push(
    { reviewer: { id: 202, login: "second-reviewer" }, type: "User" },
  );

  const report = await infrastructure.auditInfrastructure(
    { ...AUDIT_OPTIONS, reviewerIds: [] },
    createApi(routes),
  );

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "environment-reviewers:single-maintainer", "misconfigured");
  assert.equal(
    report.findings.some(({ code }) => code === "environment-reviewers"),
    false,
  );
});

test("the sole environment reviewer must be an individual user", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  ).protection_rules[0].reviewers = [
    { reviewer: { id: 101, slug: "release-team" }, type: "Team" },
  ];

  const report = await infrastructure.auditInfrastructure(
    { ...AUDIT_OPTIONS, reviewerIds: [] },
    createApi(routes),
  );

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "environment-reviewers:user", "misconfigured");
});

test("single-maintainer release environment must allow reviewer self-approval", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  ).protection_rules[0].prevent_self_review = true;

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "environment-reviewers:self-approval", "misconfigured");
});

test("release environment must prevent administrator bypass", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  ).can_admins_bypass = true;

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assert.equal(report.environment.canAdminsBypass, true);
  assertFinding(report, "environment-admin-bypass", "misconfigured");
});

test("independent PR approval requirements make single-maintainer protection misconfigured", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  ).required_pull_request_reviews = {
    bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    require_last_push_approval: true,
    required_approving_review_count: 1,
  };

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "branch-protection:reviews", "misconfigured");
});

test("review-conversation resolution must not block personal-project merges", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  ).required_conversation_resolution = { enabled: true };

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "branch-protection:conversation-resolution", "misconfigured");
});

for (const [label, mutate] of [
  [
    "wrong app",
    (checks) => { checks[0].app_id = 4242; },
  ],
  [
    "legacy unbound context",
    (checks, protection) => {
      const [{ context }] = checks.splice(0, 1);
      protection.required_status_checks.contexts.push(context);
    },
  ],
]) {
  test(`canonical status checks reject ${label}`, async () => {
    const routes = happyRoutes();
    const protection = routes.get(
      `GET /repos/${REPOSITORY}/branches/main/protection`,
    );
    mutate(protection.required_status_checks.checks, protection);

    const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

    assert.equal(report.status, "misconfigured");
    assertFinding(report, `required-status-check:${REQUIRED_CHECKS[0]}`, "misconfigured");
  });
}

test("canonical app-bound checks accept GitHub's mirrored contexts response", async () => {
  const routes = happyRoutes();
  const statusChecks = routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  ).required_status_checks;
  statusChecks.contexts = statusChecks.checks.map(({ context }) => context);

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "ready");
  assert.deepEqual(report.branchProtection.requiredChecks.missing, []);
});

test("missing exact release tag restriction fails closed", async () => {
  const routes = happyRoutes();
  routes.set(
    `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`,
    { branch_policies: [], total_count: 0 },
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "missing");
  for (const tag of REQUIRED_TAG_POLICIES) {
    assertFinding(report, `environment-tag-policy:${tag}`, "missing");
  }
});

test("unexpected wildcard deployment policy fails the exact-tag restriction", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`;
  routes.get(path).branch_policies.push({ id: 99, name: "v*", type: "tag" });
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "environment-deployment-policy:tag:v*", "misconfigured");
});

test("truncated deployment-policy pagination fails closed", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`;
  routes.get(path).total_count = 101;

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "environment-deployment-policies:pagination", "misconfigured");
});

test("missing main branch protection fails closed", async () => {
  const routes = happyRoutes();
  routes.set(`GET /repos/${REPOSITORY}/branches/main/protection`, httpError(404));
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "missing");
  assertFinding(report, "branch-protection:main", "missing");
});

test("non-strict required status checks are misconfigured", async () => {
  const routes = happyRoutes();
  routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  ).required_status_checks.strict = false;
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "required-status-checks:strict", "misconfigured");
});

test("missing required workflow on the default branch fails closed", async () => {
  const routes = happyRoutes();
  const workflow = ".github/workflows/release-acceptance.yml";
  routes.set(
    `GET /repos/${REPOSITORY}/contents/${workflow}?ref=main`,
    httpError(404),
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "missing");
  assertFinding(report, `workflow:${workflow}`, "missing");
});

test("candidate tag that does not exist is pending external work", async () => {
  const routes = happyRoutes();
  routes.set(
    `GET /repos/${REPOSITORY}/git/ref/tags/${CANDIDATE_TAG}`,
    httpError(404),
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "pending-external");
  assertFinding(report, `tag:${CANDIDATE_TAG}`, "pending-external");
});

test("candidate tag pointing at another SHA is misconfigured", async () => {
  const routes = happyRoutes();
  routes.set(
    `GET /repos/${REPOSITORY}/git/ref/tags/${CANDIDATE_TAG}`,
    { object: { sha: "c".repeat(40), type: "commit" }, ref: `refs/tags/${CANDIDATE_TAG}` },
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, `tag-sha:${CANDIDATE_TAG}`, "misconfigured");
});

for (const workflow of ["ci.yml"]) {
  test(`missing exact-SHA ${workflow} run is pending external work`, async () => {
    const routes = happyRoutes();
    routes.set(
      `GET /repos/${REPOSITORY}/actions/workflows/${workflow}/runs?head_sha=${CANDIDATE_SHA}&per_page=100`,
      { total_count: 0, workflow_runs: [] },
    );
    const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

    assert.equal(report.status, "pending-external");
    assertFinding(report, `workflow-run:${workflow}`, "pending-external");
  });
}

test("RC requires separate matrix and external-client run-bound artifacts", async () => {
  const routes = happyRoutes();
  routes.set(
    `GET /repos/${REPOSITORY}/actions/runs/602/artifacts?per_page=100`,
    { artifacts: [], total_count: 0 },
  );
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "pending-external");
  assertFinding(report, "acceptance-evidence:external-client", "pending-external");
  assert.equal(
    report.runs.find(({ evidenceType }) => evidenceType === "llama-matrix").state,
    "ready",
  );
});

test("misbound or expired acceptance artifacts are misconfigured", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/runs/602/artifacts?per_page=100`;
  routes.get(path).artifacts[0].name =
    `evidence-external-client-${"b".repeat(40)}-602-1`;
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "acceptance-artifact:external-client", "misconfigured");
});

test("final requires a clean-mac artifact in addition to matrix and external-client", async () => {
  const routes = happyRoutes();
  routes.delete(`GET /repos/${REPOSITORY}/git/ref/tags/${CANDIDATE_TAG}`);
  routes.set(
    `GET /repos/${REPOSITORY}/git/ref/tags/v3.2.0`,
    { object: { sha: CANDIDATE_SHA, type: "commit" }, ref: "refs/tags/v3.2.0" },
  );
  routes.get(
    `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`,
  ).workflow_runs.forEach((run) => { run.head_branch = "v3.2.0"; });
  routes.get(
    `GET /repos/${REPOSITORY}/actions/workflows/release-acceptance.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`,
  ).workflow_runs.forEach((run) => { run.head_branch = "v3.2.0"; });
  const report = await infrastructure.auditInfrastructure(
    { ...AUDIT_OPTIONS, candidateTag: "v3.2.0" },
    createApi(routes),
  );

  assert.equal(report.status, "pending-external");
  assertFinding(report, "acceptance-evidence:clean-mac", "pending-external");
});

test("a returned workflow run with another SHA is misconfigured", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  routes.set(path, {
    total_count: 1,
    workflow_runs: [
      {
        conclusion: "success",
        head_sha: "d".repeat(40),
        id: 503,
        run_attempt: 1,
        status: "completed",
      },
    ],
  });
  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-sha:ci.yml", "misconfigured");
});

test("a successful pull_request CI run cannot satisfy the tagged-SHA gate", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  routes.get(path).workflow_runs[0].event = "pull_request";

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-event:ci.yml", "misconfigured");
  assert.equal(report.runs.find(({ workflow }) => workflow === "ci.yml").state, "misconfigured");
});

test("a successful main push CI run cannot satisfy the selected-tag gate", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  routes.get(path).workflow_runs[0].head_branch = "main";

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-ref:ci.yml", "misconfigured");
  assert.equal(report.runs.find(({ workflow }) => workflow === "ci.yml").state, "misconfigured");
});

test("a CI run without GitHub's head_branch field fails closed", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  delete routes.get(path).workflow_runs[0].head_branch;

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-ref:ci.yml", "misconfigured");
});

test("a candidate from an unprotected side branch cannot satisfy the main-lineage gate", async () => {
  const routes = happyRoutes();
  routes.set(`GET /repos/${REPOSITORY}/compare/${CANDIDATE_SHA}...main`, {
    head_commit: { sha: "f".repeat(40) },
    merge_base_commit: { sha: "c".repeat(40) },
    status: "diverged",
  });

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "candidate-lineage:main", "misconfigured");
  assert.equal(report.repository.candidateLineage.state, "misconfigured");
});

test("a non-workflow_dispatch acceptance run cannot satisfy protected evidence", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/release-acceptance.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  routes.get(path).workflow_runs[0].event = "push";

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-event:release-acceptance.yml", "misconfigured");
});

test("acceptance evidence from the same SHA but another ref is rejected", async () => {
  const routes = happyRoutes();
  const path = `GET /repos/${REPOSITORY}/actions/workflows/release-acceptance.yml/runs?head_sha=${CANDIDATE_SHA}&per_page=100`;
  routes.get(path).workflow_runs.forEach((run) => { run.head_branch = "main"; });

  const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

  assert.equal(report.status, "misconfigured");
  assertFinding(report, "workflow-run-ref:release-acceptance.yml", "misconfigured");
  assert.equal(
    report.runs.find(({ workflow }) => workflow === "release-acceptance.yml").state,
    "misconfigured",
  );
});

for (const suppliedChecks of [[], ["attacker-only"]]) {
  test(`direct audit cannot omit canonical checks with ${JSON.stringify(suppliedChecks)}`, async () => {
    const routes = happyRoutes();
    routes.get(
      `GET /repos/${REPOSITORY}/branches/main/protection`,
    ).required_status_checks = {
      checks: [],
      contexts: [...suppliedChecks],
      strict: true,
    };

    const report = await infrastructure.auditInfrastructure(
      { ...AUDIT_OPTIONS, requiredChecks: suppliedChecks },
      createApi(routes),
    );

    assert.equal(report.status, "misconfigured");
    assertFinding(report, "required-status-check:Version and security policy", "misconfigured");
    assert.ok(
      infrastructure.DEFAULT_REQUIRED_CHECKS.every((check) =>
        report.branchProtection.requiredChecks.expected.includes(check)
      ),
    );
  });
}

for (const secretName of infrastructure.REQUIRED_ENVIRONMENT_SECRETS) {
  test(`missing environment secret name ${secretName} fails closed`, async () => {
    const routes = happyRoutes();
    const path = `GET /repos/${REPOSITORY}/environments/macos-release/secrets?per_page=100`;
    const response = routes.get(path);
    response.secrets = response.secrets.filter(({ name }) => name !== secretName);
    response.total_count = response.secrets.length;
    const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

    assert.equal(report.status, "missing");
    assertFinding(report, `environment-secret:${secretName}`, "missing");
  });
}

for (const inputName of REQUIRED_ACCEPTANCE_INPUTS) {
  test(`missing external acceptance input ${inputName} stays distinct from Apple secrets`, async () => {
    const routes = happyRoutes();
    const path = `GET /repos/${REPOSITORY}/environments/macos-release/secrets?per_page=100`;
    const response = routes.get(path);
    response.secrets = response.secrets.filter(({ name }) => name !== inputName);
    response.total_count = response.secrets.length;
    const report = await infrastructure.auditInfrastructure(AUDIT_OPTIONS, createApi(routes));

    assert.equal(report.status, "pending-external");
    assertFinding(report, `acceptance-input:${inputName}`, "pending-external");
    assert.deepEqual(report.environment.secrets.missing, []);
  });
}

test("apply requires exactly one maintainer reviewer ID and exact required check names", async () => {
  const adapter = createApi();
  await assert.rejects(
    infrastructure.applyInfrastructure(
      { ...AUDIT_OPTIONS, confirm: true, reviewerIds: [] },
      adapter,
    ),
    /--reviewer-id/,
  );
  await assert.rejects(
    infrastructure.applyInfrastructure(
      { ...AUDIT_OPTIONS, confirm: true, reviewerIds: [101, 202] },
      adapter,
    ),
    /exactly one.*--reviewer-id/i,
  );
  await assert.rejects(
    infrastructure.applyInfrastructure(
      { ...AUDIT_OPTIONS, confirm: true, requiredChecks: [] },
      adapter,
    ),
    /--required-check/,
  );
  assert.equal(adapter.calls.length, 0);
});

test("apply rejects a caller-supplied fake check that omits the canonical release gates", async () => {
  const adapter = createApi();

  await assert.rejects(
    infrastructure.applyInfrastructure(
      {
        ...AUDIT_OPTIONS,
        confirm: true,
        requiredChecks: ["attacker-only"],
      },
      adapter,
    ),
    /missing canonical required checks.*Version and security policy/i,
  );
  assert.equal(adapter.calls.length, 0);
});

test("apply without a separate confirmation only emits a safe preview", async () => {
  const routes = happyRoutes();
  const environmentPath = `GET /repos/${REPOSITORY}/environments/macos-release`;
  const environment = routes.get(environmentPath);
  environment.protection_rules[0].reviewers = [
    { reviewer: { id: 202, login: "existing-reviewer" }, type: "User" },
  ];
  const policiesPath = `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`;
  routes.get(policiesPath).branch_policies.pop();
  routes.get(policiesPath).total_count = routes.get(policiesPath).branch_policies.length;
  const protectionPath = `GET /repos/${REPOSITORY}/branches/main/protection`;
  const protection = routes.get(protectionPath);
  protection.required_status_checks = {
    checks: [],
    contexts: ["Existing protected check"],
    strict: true,
  };

  const adapter = createApi(routes);
  const result = await infrastructure.applyInfrastructure(
    { ...AUDIT_OPTIONS, confirm: false },
    adapter,
  );

  assert.equal(result.status, "confirmation-required");
  assert.equal(result.applied, false);
  assert.ok(result.preview.operations.length >= 3);
  assert.deepEqual(adapter.calls.filter(({ method }) => method !== "GET"), []);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
});

test("CLI human apply preview prints every planned mutation before confirmation", async () => {
  const routes = happyRoutes();
  const policies = routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`,
  );
  policies.branch_policies.pop();
  policies.total_count = policies.branch_policies.length;
  routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  ).required_status_checks = {
    checks: [],
    contexts: ["Existing protected check"],
    strict: true,
  };
  const adapter = createApi(routes);
  const output = [];

  const status = await infrastructure.main(
    [
      "--repo",
      REPOSITORY,
      "--sha",
      CANDIDATE_SHA,
      "--tag",
      CANDIDATE_TAG,
      "--reviewer-id",
      "101",
      "--required-check",
      REQUIRED_CHECKS[0],
      "--required-check",
      REQUIRED_CHECKS[1],
      "--apply",
    ],
    {},
    {
      api: adapter.api,
      stderr: () => {},
      stdout: (text) => output.push(text),
    },
  );

  assert.equal(status, 3);
  assert.deepEqual(adapter.calls.filter(({ method }) => method !== "GET"), []);
  const rendered = output.join("");
  assert.match(rendered, /Planned mutations \(confirmation required\):/);
  assert.match(
    rendered,
    new RegExp(
      `POST /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies`,
    ),
  );
  assert.match(
    rendered,
    new RegExp(`PUT /repos/${REPOSITORY}/branches/main/protection`),
  );
});

test("confirmed apply configures single-maintainer approval, tag rules, and branch protection", async () => {
  const routes = happyRoutes();
  const environmentPath = `GET /repos/${REPOSITORY}/environments/macos-release`;
  const environment = routes.get(environmentPath);
  environment.protection_rules[0].reviewers = [
    { reviewer: { id: 202, login: "existing-reviewer" }, type: "User" },
  ];
  environment.protection_rules.push({ type: "wait_timer", wait_timer: 45 });
  const policiesPath = `GET /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies?per_page=100`;
  routes.get(policiesPath).branch_policies = [
    { id: 1, name: "v3.2.0-rc.1", type: "tag" },
  ];
  routes.get(policiesPath).total_count = 1;
  const protectionPath = `GET /repos/${REPOSITORY}/branches/main/protection`;
  const protection = routes.get(protectionPath);
  protection.required_status_checks = {
    checks: [],
    contexts: ["Existing protected check"],
    strict: true,
  };
  protection.required_pull_request_reviews = {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    require_last_push_approval: true,
    required_approving_review_count: 3,
    dismissal_restrictions: { apps: [], teams: [], users: [] },
    bypass_pull_request_allowances: {
    apps: [],
    teams: [],
    users: [{ login: "legacy-bypass" }],
    },
  };

  const adapter = createApi(routes);
  const result = await infrastructure.applyInfrastructure(
    { ...AUDIT_OPTIONS, confirm: true },
    adapter,
  );

  assert.equal(result.applied, true);
  const mutations = adapter.calls.filter(({ method }) => method !== "GET");
  assert.deepEqual(
    new Set(mutations.map(({ method, path }) => `${method} ${path}`)),
    new Set([
      `PUT /repos/${REPOSITORY}/environments/macos-release`,
      `POST /repos/${REPOSITORY}/environments/macos-release/deployment-branch-policies`,
      `PUT /repos/${REPOSITORY}/branches/main/protection`,
    ]),
  );
  assert.ok(
    mutations.every(
      ({ path }) =>
        !path.includes("/secrets") &&
        !path.includes("/git/refs") &&
        !path.includes("/releases") &&
        !path.includes("/actions/runs"),
    ),
  );

  const environmentUpdate = mutations.find(({ path }) =>
    path.endsWith("/environments/macos-release"),
  );
  assert.deepEqual(
    environmentUpdate.body.reviewers.map(({ id }) => id).sort((a, b) => a - b),
    [101],
  );
  assert.equal(environmentUpdate.body.wait_timer, 45);
  assert.equal(environmentUpdate.body.can_admins_bypass, false);
  assert.equal(environmentUpdate.body.prevent_self_review, false);

  const protectionUpdate = mutations.find(({ path }) =>
    path.endsWith("/branches/main/protection"),
  );
  assert.deepEqual(
    new Set(protectionUpdate.body.required_status_checks.contexts),
    new Set(["Existing protected check"]),
  );
  assert.ok(
    protectionUpdate.body.required_status_checks.checks
      .filter(({ context }) => REQUIRED_CHECKS.includes(context))
      .every(({ app_id: appId }) => appId === infrastructure.GITHUB_ACTIONS_APP_ID),
  );
  assert.equal(protectionUpdate.body.required_pull_request_reviews, null);
  assert.equal(protectionUpdate.body.required_conversation_resolution, false);
  assert.deepEqual(
    new Set(
      protectionUpdate.body.required_status_checks.checks.map(({ context }) => context),
    ),
    new Set(REQUIRED_CHECKS),
  );
  assert.equal(protectionUpdate.body.restrictions, null);
});

test("apply preserves app-bound checks without duplicating them as legacy unbound contexts", async () => {
  const routes = happyRoutes();
  const protection = routes.get(
    `GET /repos/${REPOSITORY}/branches/main/protection`,
  );
  protection.required_status_checks = {
    strict: false,
    contexts: ["Legacy protected check"],
    checks: [{ context: "App-bound protected check", app_id: 4242 }],
  };
  const adapter = createApi(routes);

  await infrastructure.applyInfrastructure(
    { ...AUDIT_OPTIONS, confirm: true },
    adapter,
  );

  const protectionUpdate = adapter.calls.find(
    ({ method, path }) => method === "PUT" && path.endsWith("/branches/main/protection"),
  );
  assert.deepEqual(
    protectionUpdate.body.required_status_checks.contexts,
    ["Legacy protected check"],
  );
  assert.deepEqual(
    protectionUpdate.body.required_status_checks.checks.find(
      ({ context }) => context === "App-bound protected check",
    ),
    { context: "App-bound protected check", app_id: 4242 },
  );
  assert.equal(
    protectionUpdate.body.required_status_checks.contexts.includes(
      "App-bound protected check",
    ),
    false,
  );
});

test("apply refuses to replace protected-branch environment rules", async () => {
  const routes = happyRoutes();
  const environment = routes.get(
    `GET /repos/${REPOSITORY}/environments/macos-release`,
  );
  environment.deployment_branch_policy = {
    custom_branch_policies: false,
    protected_branches: true,
  };

  await assert.rejects(
    infrastructure.applyInfrastructure(
      { ...AUDIT_OPTIONS, confirm: true },
      createApi(routes),
    ),
    /would weaken existing protected-branch restrictions/,
  );
});

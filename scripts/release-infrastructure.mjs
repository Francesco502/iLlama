import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_ENVIRONMENT_SECRETS = Object.freeze([
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_KEYCHAIN_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "RELEASE_INFRASTRUCTURE_AUDIT_TOKEN",
]);

export const REQUIRED_ACCEPTANCE_INPUTS = Object.freeze([
  "ACCEPTANCE_LLAMA_SERVER_PATHS",
  "ACCEPTANCE_LLAMA_MODEL_PATH",
]);

export const REQUIRED_WORKFLOW_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/release-acceptance.yml",
  ".github/workflows/release.yml",
]);

export const REQUIRED_RELEASE_TAG_POLICIES = Object.freeze([
  "v3.2.0-rc.1",
  "v3.2.0",
]);

export const DEFAULT_REQUIRED_CHECKS = Object.freeze([
  "Version and security policy",
  "Frontend (ubuntu-latest)",
  "Frontend (macos-latest)",
  "Frontend (windows-latest)",
  "Browser UI and accessibility (test-only fixtures; no native runtime)",
  "Packaged Tauri WebView + IPC runtime acceptance (macOS 15)",
  "Rust unit and integration contracts (ubuntu-latest)",
  "Rust unit and integration contracts (macos-latest)",
  "Rust unit and integration contracts (windows-latest)",
]);

export const GITHUB_ACTIONS_APP_ID = 15_368;

const ENVIRONMENT_NAME = "macos-release";
const STATUS_PRIORITY = Object.freeze({
  ready: 0,
  "pending-external": 1,
  missing: 2,
  misconfigured: 3,
});

function unique(values) {
  return [...new Set(values)];
}

function finding(code, state, message) {
  return { code, message, state };
}

function statusFromFindings(findings) {
  return findings.reduce(
    (status, item) =>
      STATUS_PRIORITY[item.state] > STATUS_PRIORITY[status] ? item.state : status,
    "ready",
  );
}

function isNotFound(error) {
  return error?.status === 404;
}

async function getOrNull(api, path) {
  try {
    return await api({ method: "GET", path });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

function reviewersFromEnvironment(environment) {
  const rule = environment?.protection_rules?.find(
    (candidate) => candidate.type === "required_reviewers",
  );
  return (rule?.reviewers ?? [])
    .map((entry) => ({
      id: Number(entry.reviewer?.id),
      login: entry.reviewer?.login ?? entry.reviewer?.slug ?? null,
      type: entry.type === "Team" ? "Team" : "User",
    }))
    .filter(({ id }) => Number.isSafeInteger(id) && id > 0);
}

function reviewerRuleFromEnvironment(environment) {
  return environment?.protection_rules?.find(
    (candidate) => candidate.type === "required_reviewers",
  );
}

function waitTimerFromEnvironment(environment) {
  const timers = (environment?.protection_rules ?? [])
    .filter((candidate) => candidate.type === "wait_timer")
    .map((candidate) => Number(candidate.wait_timer ?? 0))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
  return timers.length > 0 ? Math.max(...timers) : 0;
}

function statusCheckEntries(protection) {
  const contexts = protection?.required_status_checks?.contexts ?? [];
  const checks = protection?.required_status_checks?.checks ?? [];
  return [
    ...contexts
      .filter((context) => typeof context === "string")
      .map((context) => ({ appId: null, context, source: "legacy-context" })),
    ...checks
      .filter((check) => typeof check?.context === "string")
      .map((check) => ({
        appId: Number.isSafeInteger(check.app_id) ? check.app_id : null,
        context: check.context,
        source: "check",
      })),
  ].sort((left, right) =>
    `${left.context}:${left.source}:${left.appId ?? ""}`.localeCompare(
      `${right.context}:${right.source}:${right.appId ?? ""}`,
    )
  );
}

function actorRestrictionsPresent(restrictions) {
  return restrictions !== null && ["apps", "teams", "users"].some(
    (kind) => (restrictions?.[kind]?.length ?? 0) > 0,
  );
}

function normalizeActorRestrictions(value) {
  if (!value) return null;
  return {
    apps: (value.apps ?? []).map((actor) => actor.slug).filter(Boolean),
    teams: (value.teams ?? []).map((actor) => actor.slug).filter(Boolean),
    users: (value.users ?? []).map((actor) => actor.login).filter(Boolean),
  };
}

function normalizePullRequestReviews(value) {
  if (!value) return null;
  return {
    bypass_pull_request_allowances: normalizeActorRestrictions(
      value.bypass_pull_request_allowances,
    ),
    dismissal_restrictions: normalizeActorRestrictions(value.dismissal_restrictions),
    dismiss_stale_reviews: value.dismiss_stale_reviews === true,
    require_code_owner_reviews: value.require_code_owner_reviews === true,
    require_last_push_approval: value.require_last_push_approval === true,
    required_approving_review_count: Number(value.required_approving_review_count ?? 0),
  };
}

function enabled(value) {
  return value?.enabled === true || value === true;
}

function makeEmptyReport(options) {
  return {
    schemaVersion: 1,
    kind: "release-infrastructure",
    status: "ready",
    generatedAt: new Date().toISOString(),
    repository: {
      actual: null,
      candidateLineage: {
        mainHeadSha: null,
        mergeBaseSha: null,
        state: "missing",
        status: null,
      },
      defaultBranch: null,
      requested: options.repo,
    },
    candidate: {
      sha: options.candidateSha,
      tag: options.candidateTag,
    },
    environment: {
      canAdminsBypass: null,
      deploymentPolicies: [],
      deploymentPolicyTotalCount: null,
      deploymentBranchPolicy: null,
      exists: false,
      name: ENVIRONMENT_NAME,
      preventSelfReview: false,
      reviewers: [],
      tagPolicies: [],
      secrets: {
        missing: [...REQUIRED_ENVIRONMENT_SECRETS],
        present: [],
        required: [...REQUIRED_ENVIRONMENT_SECRETS],
      },
    },
    acceptanceInputs: {
      missing: [...REQUIRED_ACCEPTANCE_INPUTS],
      present: [],
      requiredSecretNames: [...REQUIRED_ACCEPTANCE_INPUTS],
    },
    branchProtection: {
      branch: "main",
      enforceAdmins: false,
      exists: false,
      requiredChecks: {
        actual: [],
        bindings: [],
        expected: [...options.requiredChecks],
        expectedCanonicalAppId: GITHUB_ACTIONS_APP_ID,
        missing: [...options.requiredChecks],
        strict: false,
      },
      pullRequestReviews: null,
    },
    workflows: [],
    tag: {
      name: options.candidateTag,
      sha: null,
      state: "pending-external",
    },
    runs: [],
    findings: [],
  };
}

function validateAuditOptions(options) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo ?? "")) {
    throw new Error("Repository must use the owner/name form.");
  }
  if (!/^[0-9a-f]{40}$/i.test(options.candidateSha ?? "")) {
    throw new Error("Candidate SHA must be an exact 40-character Git commit SHA.");
  }
  if (!REQUIRED_RELEASE_TAG_POLICIES.includes(options.candidateTag)) {
    throw new Error("Candidate tag must be exactly v3.2.0-rc.1 or v3.2.0.");
  }
  if (!Array.isArray(options.requiredChecks)) {
    throw new Error("requiredChecks must be an array.");
  }
  if (!Array.isArray(options.reviewerIds)) {
    throw new Error("reviewerIds must be an array.");
  }
}

async function resolveTagCommit(api, repo, reference) {
  let object = reference?.object ?? null;
  for (let depth = 0; object?.type === "tag" && depth < 4; depth += 1) {
    const annotatedTag = await getOrNull(api, `/repos/${repo}/git/tags/${object.sha}`);
    if (!annotatedTag) return null;
    object = annotatedTag.object;
  }
  return object?.type === "commit" ? object.sha : null;
}

async function performAudit(options, { api }) {
  validateAuditOptions(options);
  if (typeof api !== "function") throw new Error("An API adapter is required.");
  options = {
    ...options,
    requiredChecks: unique([
      ...DEFAULT_REQUIRED_CHECKS,
      ...options.requiredChecks,
    ]),
  };

  const report = makeEmptyReport(options);
  const source = {
    branchProtection: null,
    environment: null,
  };
  const { repo } = options;

  const repository = await getOrNull(api, `/repos/${repo}`);
  if (!repository) {
    report.findings.push(
      finding(`repository:${repo}`, "missing", `Repository ${repo} was not found.`),
    );
    report.status = statusFromFindings(report.findings);
    return { report, source };
  }

  report.repository.actual = repository.full_name ?? null;
  report.repository.defaultBranch = repository.default_branch ?? null;
  if ((repository.full_name ?? "").toLowerCase() !== repo.toLowerCase()) {
    report.findings.push(
      finding(
        `repository-identity:${repo}`,
        "misconfigured",
        `GitHub resolved ${repo} as ${repository.full_name ?? "unknown"}.`,
      ),
    );
  }
  if (repository.default_branch !== "main") {
    report.findings.push(
      finding(
        "default-branch:main",
        "misconfigured",
        `Default branch is ${repository.default_branch ?? "missing"}; expected main.`,
      ),
    );
  }

  const comparison = await getOrNull(
    api,
    `/repos/${repo}/compare/${options.candidateSha}...main`,
  );
  if (comparison) {
    const comparisonStatus = comparison.status ?? null;
    const mergeBaseSha = comparison.merge_base_commit?.sha ?? null;
    const belongsToMain =
      ["ahead", "identical"].includes(comparisonStatus) &&
      mergeBaseSha === options.candidateSha;
    report.repository.candidateLineage = {
      mainHeadSha: comparison.head_commit?.sha ?? null,
      mergeBaseSha,
      state: belongsToMain ? "ready" : "misconfigured",
      status: comparisonStatus,
    };
    if (!belongsToMain) {
      report.findings.push(
        finding(
          "candidate-lineage:main",
          "misconfigured",
          `Candidate ${options.candidateSha} is not an ancestor of or identical to protected main.`,
        ),
      );
    }
  } else {
    report.findings.push(
      finding(
        "candidate-lineage:main",
        "misconfigured",
        `GitHub could not compare candidate ${options.candidateSha} with protected main.`,
      ),
    );
  }

  const environmentPath = `/repos/${repo}/environments/${ENVIRONMENT_NAME}`;
  const environment = await getOrNull(api, environmentPath);
  source.environment = environment;
  if (!environment) {
    report.findings.push(
      finding(
        `environment:${ENVIRONMENT_NAME}`,
        "missing",
        `Protected environment ${ENVIRONMENT_NAME} does not exist.`,
      ),
    );
    for (const reviewerId of options.reviewerIds) {
      report.findings.push(
        finding(
          `environment-reviewer:${reviewerId}`,
          "missing",
          `Environment reviewer ID ${reviewerId} is missing.`,
        ),
      );
    }
    for (const tag of REQUIRED_RELEASE_TAG_POLICIES) {
      report.findings.push(
        finding(
          `environment-tag-policy:${tag}`,
          "missing",
          `Exact environment tag policy ${tag} is missing.`,
        ),
      );
    }
    for (const secretName of REQUIRED_ENVIRONMENT_SECRETS) {
      report.findings.push(
        finding(
          `environment-secret:${secretName}`,
          "missing",
          `Environment secret name ${secretName} is missing.`,
        ),
      );
    }
    for (const inputName of REQUIRED_ACCEPTANCE_INPUTS) {
      report.findings.push(
        finding(
          `acceptance-input:${inputName}`,
          "pending-external",
          `External acceptance input secret name ${inputName} is missing.`,
        ),
      );
    }
  } else {
    report.environment.exists = true;
    report.environment.canAdminsBypass = environment.can_admins_bypass !== false;
    report.environment.reviewers = reviewersFromEnvironment(environment);
    const reviewerRule = reviewerRuleFromEnvironment(environment);
    report.environment.preventSelfReview = reviewerRule?.prevent_self_review === true;
    report.environment.deploymentBranchPolicy = {
      customBranchPolicies:
        environment.deployment_branch_policy?.custom_branch_policies === true,
      protectedBranches: environment.deployment_branch_policy?.protected_branches === true,
    };

    const expectedReviewerIds = options.reviewerIds.length > 0
      ? options.reviewerIds
      : report.environment.reviewers.length === 1
        ? report.environment.reviewers.map(({ id }) => id)
        : [null];
    for (const reviewerId of expectedReviewerIds) {
      const present = reviewerId === null
        ? false
        : report.environment.reviewers.some(({ id }) => id === reviewerId);
      if (!present) {
        report.findings.push(
          finding(
            reviewerId === null
              ? "environment-reviewers"
              : `environment-reviewer:${reviewerId}`,
            "missing",
            reviewerId === null
              ? "The protected environment has no required reviewer."
              : `Environment reviewer ID ${reviewerId} is missing.`,
          ),
        );
      }
    }

    if (report.environment.reviewers.length > 1) {
      report.findings.push(
        finding(
          "environment-reviewers:single-maintainer",
          "misconfigured",
          "The protected environment must have exactly one maintainer reviewer.",
        ),
      );
    }

    if (report.environment.preventSelfReview) {
      report.findings.push(
        finding(
          "environment-reviewers:self-approval",
          "misconfigured",
          "The single maintainer must be allowed to approve their own release deployment.",
        ),
      );
    }

    if (report.environment.canAdminsBypass) {
      report.findings.push(
        finding(
          "environment-admin-bypass",
          "misconfigured",
          "The protected environment must disallow administrators from bypassing deployment protection rules.",
        ),
      );
    }

    if (
      environment.deployment_branch_policy?.custom_branch_policies !== true ||
      environment.deployment_branch_policy?.protected_branches === true
    ) {
      report.findings.push(
        finding(
          "environment-deployment-policy",
          "misconfigured",
          "The environment must use custom deployment policies without protected-branch mode.",
        ),
      );
    }

    const policies = await getOrNull(
      api,
      `${environmentPath}/deployment-branch-policies?per_page=100`,
    );
    const returnedPolicies = policies?.branch_policies ?? [];
    const deploymentPolicyTotalCount = Number(policies?.total_count);
    report.environment.deploymentPolicyTotalCount = Number.isSafeInteger(
      deploymentPolicyTotalCount,
    ) ? deploymentPolicyTotalCount : null;
    if (
      !Number.isSafeInteger(deploymentPolicyTotalCount) ||
      deploymentPolicyTotalCount !== returnedPolicies.length
    ) {
      report.findings.push(
        finding(
          "environment-deployment-policies:pagination",
          "misconfigured",
          "Deployment-policy response is incomplete; audit cannot prove that no hidden wildcard or branch policy exists.",
        ),
      );
    }
    report.environment.deploymentPolicies = returnedPolicies
      .map(({ id, name, type }) => ({ id, name, type }))
      .sort((left, right) =>
        `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`)
      );
    report.environment.tagPolicies = report.environment.deploymentPolicies.filter(
      (policy) => policy.type === "tag",
    );
    for (const tag of REQUIRED_RELEASE_TAG_POLICIES) {
      if (!report.environment.tagPolicies.some((policy) => policy.name === tag)) {
        report.findings.push(
          finding(
            `environment-tag-policy:${tag}`,
            "missing",
            `Exact environment tag policy ${tag} is missing.`,
          ),
        );
      }
    }
    for (const policy of report.environment.deploymentPolicies) {
      if (
        policy.type !== "tag" ||
        !REQUIRED_RELEASE_TAG_POLICIES.includes(policy.name)
      ) {
        report.findings.push(
          finding(
            `environment-deployment-policy:${policy.type}:${policy.name}`,
            "misconfigured",
            `Unexpected deployment policy ${policy.type}:${policy.name}; only the two exact 3.2.0 release tags are allowed.`,
          ),
        );
      }
    }

    const secrets = await getOrNull(api, `${environmentPath}/secrets?per_page=100`);
    const secretNames = unique(
      (secrets?.secrets ?? [])
        .map((secret) => secret?.name)
        .filter((name) => typeof name === "string"),
    ).sort();
    report.environment.secrets.present = REQUIRED_ENVIRONMENT_SECRETS.filter((name) =>
      secretNames.includes(name)
    );
    report.environment.secrets.missing = REQUIRED_ENVIRONMENT_SECRETS.filter(
      (name) => !secretNames.includes(name),
    );
    for (const secretName of report.environment.secrets.missing) {
      report.findings.push(
        finding(
          `environment-secret:${secretName}`,
          "missing",
          `Environment secret name ${secretName} is missing.`,
        ),
      );
    }
    report.acceptanceInputs.present = REQUIRED_ACCEPTANCE_INPUTS.filter((name) =>
      secretNames.includes(name)
    );
    report.acceptanceInputs.missing = REQUIRED_ACCEPTANCE_INPUTS.filter(
      (name) => !secretNames.includes(name),
    );
    for (const inputName of report.acceptanceInputs.missing) {
      report.findings.push(
        finding(
          `acceptance-input:${inputName}`,
          "pending-external",
          `External acceptance input secret name ${inputName} is missing.`,
        ),
      );
    }
  }

  const branchProtectionPath = `/repos/${repo}/branches/main/protection`;
  const branchProtection = await getOrNull(api, branchProtectionPath);
  source.branchProtection = branchProtection;
  if (!branchProtection) {
    report.findings.push(
      finding(
        "branch-protection:main",
        "missing",
        "The main branch has no branch protection configuration.",
      ),
    );
  } else {
    report.branchProtection.exists = true;
    report.branchProtection.enforceAdmins = enabled(branchProtection.enforce_admins);
    const statusChecks = statusCheckEntries(branchProtection);
    report.branchProtection.requiredChecks.bindings = statusChecks;
    report.branchProtection.requiredChecks.actual = unique(
      statusChecks.map(({ context }) => context),
    ).sort();
    report.branchProtection.requiredChecks.missing = options.requiredChecks.filter((context) => {
      const matching = statusChecks.filter((check) => check.context === context);
      if (!DEFAULT_REQUIRED_CHECKS.includes(context)) return matching.length === 0;
      const boundChecks = matching.filter((check) => check.source === "check");
      return boundChecks.length !== 1 || boundChecks[0].appId !== GITHUB_ACTIONS_APP_ID;
    });
    report.branchProtection.requiredChecks.strict =
      branchProtection.required_status_checks?.strict === true;
    report.branchProtection.pullRequestReviews = normalizePullRequestReviews(
      branchProtection.required_pull_request_reviews,
    );

    for (const context of report.branchProtection.requiredChecks.missing) {
      report.findings.push(
        finding(
          `required-status-check:${context}`,
          "misconfigured",
          DEFAULT_REQUIRED_CHECKS.includes(context)
            ? `Required status check ${context} must appear exactly once and be bound to GitHub Actions app ${GITHUB_ACTIONS_APP_ID}.`
            : `Required status check ${context} is not protected on main.`,
        ),
      );
    }
    if (!report.branchProtection.requiredChecks.strict) {
      report.findings.push(
        finding(
          "required-status-checks:strict",
          "misconfigured",
          "Main must require branches to be up to date before merging.",
        ),
      );
    }
    if (!report.branchProtection.enforceAdmins) {
      report.findings.push(
        finding(
          "branch-protection:admins",
          "misconfigured",
          "Main branch protection must include administrators.",
        ),
      );
    }
    const reviews = report.branchProtection.pullRequestReviews;
    if (reviews) {
      report.findings.push(
        finding(
          "branch-protection:reviews",
          "misconfigured",
          "Single-maintainer main protection must rely on strict required checks without an independent PR approval requirement.",
        ),
      );
    }
    if (reviews && actorRestrictionsPresent(reviews.bypass_pull_request_allowances)) {
      report.findings.push(
        finding(
          "branch-protection:review-bypass",
          "misconfigured",
          "Main pull-request reviews must not allow user, team, or app bypass actors.",
        ),
      );
    }
    if (enabled(branchProtection.allow_force_pushes) || enabled(branchProtection.allow_deletions)) {
      report.findings.push(
        finding(
          "branch-protection:destructive-updates",
          "misconfigured",
          "Main must reject force pushes and branch deletion.",
        ),
      );
    }
    if (!enabled(branchProtection.required_conversation_resolution)) {
      report.findings.push(
        finding(
          "branch-protection:conversation-resolution",
          "misconfigured",
          "Main must require conversation resolution before merging.",
        ),
      );
    }
  }

  const defaultBranch = report.repository.defaultBranch ?? "main";
  for (const workflowPath of REQUIRED_WORKFLOW_PATHS) {
    const content = await getOrNull(
      api,
      `/repos/${repo}/contents/${workflowPath}?ref=${encodeURIComponent(defaultBranch)}`,
    );
    const state = content?.type === "file" ? "ready" : "missing";
    report.workflows.push({ path: workflowPath, sha: content?.sha ?? null, state });
    if (state !== "ready") {
      report.findings.push(
        finding(
          `workflow:${workflowPath}`,
          "missing",
          `${workflowPath} is missing from ${defaultBranch}.`,
        ),
      );
    }
  }

  const tagReference = await getOrNull(
    api,
    `/repos/${repo}/git/ref/tags/${encodeURIComponent(options.candidateTag)}`,
  );
  if (!tagReference) {
    report.findings.push(
      finding(
        `tag:${options.candidateTag}`,
        "pending-external",
        `Candidate tag ${options.candidateTag} has not been created.`,
      ),
    );
  } else {
    const tagSha = await resolveTagCommit(api, repo, tagReference);
    report.tag.sha = tagSha;
    if (tagSha === options.candidateSha) {
      report.tag.state = "ready";
    } else {
      report.tag.state = "misconfigured";
      report.findings.push(
        finding(
          `tag-sha:${options.candidateTag}`,
          "misconfigured",
          `Candidate tag resolves to ${tagSha ?? "a non-commit object"}, not ${options.candidateSha}.`,
        ),
      );
    }
  }

  const ciWorkflow = "ci.yml";
  const ciRunsResponse = await getOrNull(
    api,
    `/repos/${repo}/actions/workflows/${ciWorkflow}/runs?head_sha=${options.candidateSha}&per_page=100`,
  );
  const ciRuns = ciRunsResponse?.workflow_runs ?? [];
  const exactCiRuns = ciRuns.filter((run) => run.head_sha === options.candidateSha);
  const successfulCi = exactCiRuns.find(
    (run) =>
      run.event === "push" &&
      run.head_branch === options.candidateTag &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
  let ciState = "pending-external";
  const selectedCi = successfulCi ?? exactCiRuns[0] ?? ciRuns[0] ?? null;
  if (successfulCi) {
    ciState = "ready";
  } else if (ciRuns.some((run) => run.head_sha !== options.candidateSha)) {
    ciState = "misconfigured";
    report.findings.push(
      finding(
        `workflow-run-sha:${ciWorkflow}`,
        "misconfigured",
        `${ciWorkflow} returned a run for a different SHA.`,
      ),
    );
  } else if (
    exactCiRuns.some(
      (run) =>
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.event === "push" &&
        run.head_branch !== options.candidateTag,
    )
  ) {
    ciState = "misconfigured";
    report.findings.push(
      finding(
        `workflow-run-ref:${ciWorkflow}`,
        "misconfigured",
        `${ciWorkflow} has a successful candidate-SHA push run, but its head_branch is not ${options.candidateTag}.`,
      ),
    );
  } else if (
    exactCiRuns.some(
      (run) =>
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.event !== "push",
    )
  ) {
    ciState = "misconfigured";
    report.findings.push(
      finding(
        `workflow-run-event:${ciWorkflow}`,
        "misconfigured",
        `${ciWorkflow} has a successful candidate-SHA run, but its event is not push.`,
      ),
    );
  } else if (exactCiRuns.some((run) => run.status === "completed")) {
    ciState = "misconfigured";
    report.findings.push(
      finding(
        `workflow-run:${ciWorkflow}`,
        "misconfigured",
        `${ciWorkflow} completed for the candidate SHA without success.`,
      ),
    );
  } else {
    report.findings.push(
      finding(
        `workflow-run:${ciWorkflow}`,
        "pending-external",
        `${ciWorkflow} has no successful completed run for the candidate SHA.`,
      ),
    );
  }
  report.runs.push({
    artifactId: null,
    artifactName: null,
    conclusion: selectedCi?.conclusion ?? null,
    event: selectedCi?.event ?? null,
    evidenceType: null,
    headSha: selectedCi?.head_sha ?? null,
    headBranch: selectedCi?.head_branch ?? null,
    runAttempt: selectedCi?.run_attempt ?? null,
    runId: selectedCi?.id ?? null,
    state: ciState,
    status: selectedCi?.status ?? null,
    workflow: ciWorkflow,
  });

  const acceptanceWorkflow = "release-acceptance.yml";
  const acceptanceRunsResponse = await getOrNull(
    api,
    `/repos/${repo}/actions/workflows/${acceptanceWorkflow}/runs?head_sha=${options.candidateSha}&per_page=100`,
  );
  const acceptanceRuns = acceptanceRunsResponse?.workflow_runs ?? [];
  const exactAcceptanceRuns = acceptanceRuns.filter(
    (run) => run.head_sha === options.candidateSha,
  );
  const successfulAcceptanceRuns = exactAcceptanceRuns.filter(
    (run) =>
      run.event === "workflow_dispatch" &&
      run.head_branch === options.candidateTag &&
      run.status === "completed" &&
      run.conclusion === "success",
  );
  if (acceptanceRuns.some((run) => run.head_sha !== options.candidateSha)) {
    report.findings.push(
      finding(
        `workflow-run-sha:${acceptanceWorkflow}`,
        "misconfigured",
        `${acceptanceWorkflow} returned a run for a different SHA.`,
      ),
    );
  }
  if (
    exactAcceptanceRuns.some(
      (run) =>
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.event !== "workflow_dispatch",
    )
  ) {
    report.findings.push(
      finding(
        `workflow-run-event:${acceptanceWorkflow}`,
        "misconfigured",
        `${acceptanceWorkflow} has a successful candidate-SHA run whose event is not workflow_dispatch.`,
      ),
    );
  }
  if (
    exactAcceptanceRuns.some(
      (run) =>
        run.status === "completed" &&
        run.conclusion === "success" &&
        run.event === "workflow_dispatch" &&
        run.head_branch !== options.candidateTag,
    )
  ) {
    report.findings.push(
      finding(
        `workflow-run-ref:${acceptanceWorkflow}`,
        "misconfigured",
        `${acceptanceWorkflow} has a successful candidate-SHA dispatch run, but its head_branch is not ${options.candidateTag}.`,
      ),
    );
  }

  const artifactsByRun = new Map();
  for (const run of successfulAcceptanceRuns) {
    const response = await getOrNull(
      api,
      `/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    artifactsByRun.set(run.id, response?.artifacts ?? []);
  }
  const requiredEvidenceTypes = options.candidateTag === "v3.2.0"
    ? ["llama-matrix", "external-client", "clean-mac"]
    : ["llama-matrix", "external-client"];
  for (const evidenceType of requiredEvidenceTypes) {
    let accepted = null;
    const suspicious = [];
    for (const run of successfulAcceptanceRuns) {
      const expectedArtifactName =
        `evidence-${evidenceType}-${options.candidateSha}-${run.id}-${run.run_attempt}`;
      for (const artifact of artifactsByRun.get(run.id) ?? []) {
        if (artifact.name?.startsWith(`evidence-${evidenceType}-`)) {
          suspicious.push({ artifact, expectedArtifactName, run });
        }
        if (
          artifact.name === expectedArtifactName &&
          artifact.expired !== true &&
          artifact.workflow_run?.id === run.id &&
          artifact.workflow_run?.head_sha === options.candidateSha
        ) {
          accepted = { artifact, run };
        }
      }
    }

    let evidenceState;
    if (accepted) {
      evidenceState = "ready";
    } else if (suspicious.length > 0) {
      evidenceState = "misconfigured";
      report.findings.push(
        finding(
          `acceptance-artifact:${evidenceType}`,
          "misconfigured",
          `${evidenceType} artifacts are expired or not bound to the exact SHA, run ID, and run attempt.`,
        ),
      );
    } else if (
      exactAcceptanceRuns.length > 0 &&
      successfulAcceptanceRuns.length === 0 &&
      exactAcceptanceRuns.every((run) => run.status === "completed")
    ) {
      evidenceState = "misconfigured";
      report.findings.push(
        finding(
          `acceptance-run:${evidenceType}`,
          "misconfigured",
          `${evidenceType} has only failed completed runs for the candidate SHA.`,
        ),
      );
    } else {
      evidenceState = "pending-external";
      report.findings.push(
        finding(
          `acceptance-evidence:${evidenceType}`,
          "pending-external",
          `${evidenceType} has no successful exact-SHA run-bound artifact.`,
        ),
      );
    }

    const selected = accepted?.run ?? successfulAcceptanceRuns[0] ?? exactAcceptanceRuns[0] ?? null;
    report.runs.push({
      artifactId: accepted?.artifact.id ?? null,
      artifactName: accepted?.artifact.name ?? null,
      conclusion: selected?.conclusion ?? null,
      event: selected?.event ?? null,
      evidenceType,
      headSha: selected?.head_sha ?? null,
      headBranch: selected?.head_branch ?? null,
      runAttempt: selected?.run_attempt ?? null,
      runId: selected?.id ?? null,
      state: evidenceState,
      status: selected?.status ?? null,
      workflow: acceptanceWorkflow,
    });
  }

  report.status = statusFromFindings(report.findings);
  return { report, source };
}

export async function auditInfrastructure(options, adapters) {
  return (await performAudit(options, adapters)).report;
}

function mergeActorRestrictions(current) {
  return current
    ? {
        apps: (current.apps ?? []).map((actor) => actor.slug).filter(Boolean),
        teams: (current.teams ?? []).map((actor) => actor.slug).filter(Boolean),
        users: (current.users ?? []).map((actor) => actor.login).filter(Boolean),
      }
    : { apps: [], teams: [], users: [] };
}

function branchProtectionPayload(current, requiredChecks) {
  const contexts = unique(
    (current?.required_status_checks?.contexts ?? [])
      .filter(
        (context) =>
          typeof context === "string" &&
          !DEFAULT_REQUIRED_CHECKS.includes(context),
      ),
  ).sort();
  const checks = (current?.required_status_checks?.checks ?? [])
    .filter(
      (check) =>
        typeof check?.context === "string" &&
        !DEFAULT_REQUIRED_CHECKS.includes(check.context),
    )
    .map((check) => ({
      ...(check.app_id === undefined ? {} : { app_id: check.app_id }),
      context: check.context,
    }));
  const represented = new Set([
    ...contexts,
    ...checks.map(({ context }) => context),
  ]);
  for (const context of DEFAULT_REQUIRED_CHECKS) {
    checks.push({ app_id: GITHUB_ACTIONS_APP_ID, context });
    represented.add(context);
  }
  for (const context of requiredChecks) {
    if (represented.has(context)) continue;
    checks.push({ context });
    represented.add(context);
  }
  checks.sort((left, right) => left.context.localeCompare(right.context));

  return {
    allow_deletions: false,
    allow_force_pushes: false,
    allow_fork_syncing: enabled(current?.allow_fork_syncing),
    block_creations: enabled(current?.block_creations),
    enforce_admins: true,
    lock_branch: enabled(current?.lock_branch),
    required_conversation_resolution: true,
    required_linear_history: enabled(current?.required_linear_history),
    required_pull_request_reviews: null,
    required_status_checks: {
      checks,
      contexts,
      strict: true,
    },
    restrictions: current?.restrictions
      ? mergeActorRestrictions(current.restrictions)
      : null,
  };
}

function validateApplyOptions(options) {
  if (!Array.isArray(options.reviewerIds) || options.reviewerIds.length !== 1) {
    throw new Error("--apply requires exactly one explicit --reviewer-id for the maintainer.");
  }
  if (!Array.isArray(options.requiredChecks) || options.requiredChecks.length === 0) {
    throw new Error("--apply requires explicit --required-check names.");
  }
  const missingCanonicalChecks = DEFAULT_REQUIRED_CHECKS.filter(
    (context) => !options.requiredChecks.includes(context),
  );
  if (missingCanonicalChecks.length > 0) {
    throw new Error(
      `--apply is missing canonical required checks: ${missingCanonicalChecks.join(", ")}`,
    );
  }
}

function planApply(options, report, source) {
  const operations = [];
  const environment = source.environment;
  if (
    report.findings.some(
      ({ code }) => code === "environment-deployment-policies:pagination",
    )
  ) {
    throw new Error(
      "Refusing --apply because the deployment-policy response was incomplete.",
    );
  }
  if (environment?.deployment_branch_policy?.protected_branches === true) {
    throw new Error(
      "Refusing --apply because replacing protected-branch environment rules would weaken existing protected-branch restrictions.",
    );
  }

  const existingReviewerIds = reviewersFromEnvironment(environment)
    .map(({ id }) => id)
    .sort((left, right) => left - right);
  const desiredReviewers = options.reviewerIds.map((id) => ({ id, type: "User" }));
  const desiredReviewerIds = desiredReviewers.map(({ id }) => id);
  const needsEnvironmentUpdate =
    !environment ||
    environment.can_admins_bypass !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true ||
    reviewerRuleFromEnvironment(environment)?.prevent_self_review !== false ||
    JSON.stringify(existingReviewerIds) !== JSON.stringify(desiredReviewerIds);
  if (needsEnvironmentUpdate) {
    operations.push({
      body: {
        can_admins_bypass: false,
        deployment_branch_policy: {
          custom_branch_policies: true,
          protected_branches: false,
        },
        prevent_self_review: false,
        reviewers: desiredReviewers,
        wait_timer: waitTimerFromEnvironment(environment),
      },
      method: "PUT",
      path: `/repos/${options.repo}/environments/${ENVIRONMENT_NAME}`,
      reason: "Create or strengthen the protected release environment.",
    });
  }

  for (const tag of REQUIRED_RELEASE_TAG_POLICIES) {
    if (!report.environment.tagPolicies.some((policy) => policy.name === tag)) {
      operations.push({
        body: { name: tag, type: "tag" },
        method: "POST",
        path: `/repos/${options.repo}/environments/${ENVIRONMENT_NAME}/deployment-branch-policies`,
        reason: `Add exact release tag restriction ${tag}.`,
      });
    }
  }

  const protection = source.branchProtection;
  const needsProtectionUpdate =
    !protection ||
    report.branchProtection.requiredChecks.missing.length > 0 ||
    !report.branchProtection.requiredChecks.strict ||
    !report.branchProtection.enforceAdmins ||
    report.findings.some(({ code }) => code.startsWith("branch-protection:"));
  if (needsProtectionUpdate) {
    operations.push({
      body: branchProtectionPayload(protection, options.requiredChecks),
      method: "PUT",
      path: `/repos/${options.repo}/branches/main/protection`,
      reason: "Create or strengthen main branch protection.",
    });
  }

  return {
    schemaVersion: 1,
    kind: "release-infrastructure-apply-preview",
    operations,
  };
}

function assertAllowedMutation(operation, repo) {
  const allowed = new Set([
    `PUT /repos/${repo}/environments/${ENVIRONMENT_NAME}`,
    `POST /repos/${repo}/environments/${ENVIRONMENT_NAME}/deployment-branch-policies`,
    `PUT /repos/${repo}/branches/main/protection`,
  ]);
  if (!allowed.has(`${operation.method} ${operation.path}`)) {
    throw new Error(`Unsafe infrastructure mutation rejected: ${operation.method} ${operation.path}`);
  }
}

export async function applyInfrastructure(options, { api }) {
  validateApplyOptions(options);
  const { report, source } = await performAudit(options, { api });
  const preview = planApply(options, report, source);
  if (options.confirm !== true) {
    return {
      schemaVersion: 1,
      kind: "release-infrastructure-apply",
      status: "confirmation-required",
      applied: false,
      audit: report,
      preview,
    };
  }

  for (const operation of preview.operations) {
    assertAllowedMutation(operation, options.repo);
    await api(operation);
  }

  return {
    schemaVersion: 1,
    kind: "release-infrastructure-apply",
    status: preview.operations.length === 0 ? report.status : "pending-external",
    applied: true,
    audit: report,
    preview,
  };
}

export function createGhApi({ spawn = spawnSync } = {}) {
  return async ({ body, method = "GET", path }) => {
    const args = ["api", "--method", method, path];
    const input = body === undefined ? undefined : JSON.stringify(body);
    if (input !== undefined) args.push("--input", "-");
    const result = spawn("gh", args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      const statusMatch = `${result.stderr ?? ""}`.match(/(?:HTTP|status(?: code)?)[^0-9]*(\d{3})/i);
      const error = new Error(`gh api ${method} ${path} failed with exit ${result.status ?? 1}.`);
      if (statusMatch) error.status = Number(statusMatch[1]);
      throw error;
    }
    const output = `${result.stdout ?? ""}`.trim();
    return output === "" ? {} : JSON.parse(output);
  };
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv, env = process.env) {
  const options = {
    apply: false,
    candidateSha: env.GITHUB_SHA ?? null,
    candidateTag: env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME ?? null : null,
    confirm: false,
    help: false,
    json: false,
    repo: env.GITHUB_REPOSITORY ?? null,
    repoExplicit: false,
    requiredChecks: [],
    reviewerIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") options.apply = true;
    else if (argument === "--confirm-apply") options.confirm = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--repo") {
      options.repo = takeValue(argv, index, argument);
      options.repoExplicit = true;
      index += 1;
    } else if (argument === "--sha") {
      options.candidateSha = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--tag") {
      options.candidateTag = takeValue(argv, index, argument);
      index += 1;
    } else if (argument === "--reviewer-id") {
      const reviewerId = Number(takeValue(argv, index, argument));
      if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0) {
        throw new Error("--reviewer-id must be a positive integer GitHub user ID.");
      }
      options.reviewerIds.push(reviewerId);
      index += 1;
    } else if (argument === "--required-check") {
      options.requiredChecks.push(takeValue(argv, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  options.reviewerIds = unique(options.reviewerIds);
  options.requiredChecks = unique(options.requiredChecks);
  return options;
}

function inputFailure(code, message) {
  return {
    status: "missing",
    findings: [finding(code, "missing", message)],
  };
}

function renderHuman(report) {
  const audit = report.audit ?? report;
  const lines = [
    `Release infrastructure: ${report.status}`,
    audit.repository?.actual
      ? `Repository: ${audit.repository.actual} (default: ${audit.repository.defaultBranch})`
      : null,
    audit.candidate?.sha
      ? `Candidate: ${audit.candidate.tag} @ ${audit.candidate.sha}`
      : null,
  ].filter(Boolean);
  if (audit.findings?.length > 0) {
    lines.push("Findings:");
    for (const item of audit.findings) {
      lines.push(`- [${item.state}] ${item.code}: ${item.message}`);
    }
  }
  if (report.preview) {
    lines.push(
      report.applied
        ? "Applied mutations:"
        : "Planned mutations (confirmation required):",
    );
    if (report.preview.operations.length === 0) lines.push("- none");
    for (const operation of report.preview.operations) {
      lines.push(`- ${operation.method} ${operation.path}: ${operation.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function helpText() {
  return [
    "Usage: node scripts/release-infrastructure.mjs --repo owner/name --sha <40-hex> --tag <v3.2.0-rc.1|v3.2.0> [options]",
    "",
    "Default mode performs a read-only gh api audit.",
    "  --json                    Emit a stable JSON report",
    "  --reviewer-id <id>        Sole maintainer GitHub user ID (exactly one for apply)",
    "  --required-check <name>   Additional protected check; canonical CI checks are always required",
    "  --apply                   Preview safe environment/protection changes",
    "  --confirm-apply           Execute the --apply preview",
    "",
    "Audit uses a read-only GH_TOKEN. Apply requires a separately supplied GH_TOKEN with repository Administration write permission.",
    "Secret values are never read or printed. Missing values must be supplied separately with gh secret set --env macos-release.",
  ].join("\n");
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  {
    api = createGhApi(),
    stderr = (text) => process.stderr.write(text),
    stdout = (text) => process.stdout.write(text),
  } = {},
) {
  let options;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    const report = inputFailure("invalid-arguments", error.message);
    stdout(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }

  if (options.help) {
    stdout(`${helpText()}\n`);
    return 0;
  }
  if (!options.repo) {
    const report = inputFailure(
      "repository-required",
      "Pass --repo owner/name or set GITHUB_REPOSITORY.",
    );
    stdout(`${JSON.stringify(report, null, options.json ? 2 : 0)}\n`);
    return 2;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) {
    const report = inputFailure("repository-invalid", "Repository must use owner/name form.");
    stdout(`${JSON.stringify(report, null, options.json ? 2 : 0)}\n`);
    return 2;
  }
  if (options.apply && !options.repoExplicit) {
    const report = inputFailure(
      "apply-repository-required",
      "--apply requires an explicit --repo owner/name argument.",
    );
    stdout(`${JSON.stringify(report, null, options.json ? 2 : 0)}\n`);
    return 2;
  }
  if (!options.candidateSha) {
    const report = inputFailure(
      "candidate-sha-required",
      "Pass --sha with the exact 40-character candidate commit SHA or set GITHUB_SHA.",
    );
    stdout(`${JSON.stringify(report, null, options.json ? 2 : 0)}\n`);
    return 2;
  }
  if (!options.candidateTag) {
    const report = inputFailure(
      "candidate-tag-required",
      "Pass --tag v3.2.0-rc.1 or --tag v3.2.0 (or run on that GitHub tag).",
    );
    stdout(`${JSON.stringify(report, null, options.json ? 2 : 0)}\n`);
    return 2;
  }

  options.requiredChecks = unique([
    ...DEFAULT_REQUIRED_CHECKS,
    ...options.requiredChecks,
  ]);

  try {
    const report = options.apply
      ? await applyInfrastructure(options, { api })
      : await auditInfrastructure(options, { api });
    stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderHuman(report));
    if (report.status === "ready") return 0;
    if (report.status === "confirmation-required") return 3;
    return 1;
  } catch (error) {
    const report = {
      status: "misconfigured",
      findings: [
        finding(
          "infrastructure-audit-error",
          "misconfigured",
          error instanceof Error ? error.message : "Infrastructure audit failed.",
        ),
      ],
    };
    const output = options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderHuman(report);
    stdout(output);
    if (!options.json) stderr("Infrastructure audit failed closed.\n");
    return 2;
  }
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (isMain) {
  process.exitCode = await main();
}

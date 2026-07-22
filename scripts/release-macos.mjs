import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packageSignedMacRelease } from "./lib/macos-release-chain.mjs";

const cwd = process.cwd();
const packageJson = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
const version = packageJson.version;
const cargoPath = `${join(homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}`;
const appPath = join(cwd, "src-tauri/target/release/bundle/macos/iLlama.app");
const dmgPath = join(cwd, `src-tauri/target/release/bundle/dmg/iLlama_${version}_aarch64.dmg`);
const checksumPath = `${dmgPath}.sha256`;
const binariesDir = join(cwd, "src-tauri/binaries");
const notaryProfile = process.env.APPLE_NOTARY_PROFILE ?? "illama-notary";
const unsignedRelease =
  process.env.ILLAMA_UNSIGNED_RELEASE === "1" || process.env.ILLLAMA_UNSIGNED_RELEASE === "1";

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, PATH: cargoPath, ...(options.env ?? {}) },
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit status ${result.status ?? "unknown"}`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, PATH: cargoPath, ...(options.env ?? {}) },
    encoding: "utf8",
    ...options,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}

function ensureExternalLlamaServerStrategy() {
  if (!existsSync(binariesDir)) {
    return;
  }

  const bundledCandidates = readdirSync(binariesDir).filter((name) => name !== ".gitkeep");
  if (bundledCandidates.length > 0) {
    console.error(
      [
        "Refusing to build a public release with bundled llama-server files.",
        `The v${version} macOS release strategy is external llama-server only.`,
        `Remove these files or update docs/release-strategy.md first: ${bundledCandidates.join(", ")}`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

function ensureAppleSiliconBuildHost() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    console.error(
      `iLlama v${version} release artifacts must be built on macOS Apple Silicon; found ${process.platform}/${process.arch}.`,
    );
    process.exit(1);
  }
}

function generateAndVerifyChecksum() {
  run("node", ["scripts/lib/portable-checksum.mjs", "create", dmgPath, checksumPath]);
  run("node", ["scripts/lib/portable-checksum.mjs", "verify", checksumPath]);
}

function resolveDeveloperIdIdentity() {
  const identities = capture("security", ["find-identity", "-v", "-p", "codesigning"]);
  const requested = process.env.APPLE_SIGNING_IDENTITY;

  if (requested) {
    if (!identities.output.includes(requested)) {
      console.error(`APPLE_SIGNING_IDENTITY was set, but it was not found in the keychain: ${requested}`);
      console.error(identities.output.trim());
      process.exit(1);
    }
    return requested;
  }

  const match = identities.output.match(/"Developer ID Application: [^"]+"/);
  if (!match) {
    console.error(
      [
        "No Developer ID Application identity was found in the keychain.",
        "Install the certificate or set APPLE_SIGNING_IDENTITY to an installed Developer ID identity.",
        "",
        identities.output.trim(),
      ].join("\n"),
    );
    process.exit(1);
  }

  return match[0].slice(1, -1);
}

function ensureNotaryProfile() {
  const history = capture("xcrun", ["notarytool", "history", "--keychain-profile", notaryProfile]);
  if (!history.ok) {
    console.error(
      [
        `Notary profile is not available or not valid: ${notaryProfile}`,
        "Create it with:",
        `xcrun notarytool store-credentials ${notaryProfile} --apple-id <apple-id> --team-id <team-id> --password <app-specific-password>`,
        "",
        history.output.trim(),
      ].join("\n"),
    );
    process.exit(history.status ?? 1);
  }
}

ensureAppleSiliconBuildHost();
ensureExternalLlamaServerStrategy();
const signingIdentity = unsignedRelease ? null : resolveDeveloperIdIdentity();
const teamId = unsignedRelease ? null : process.env.APPLE_TEAM_ID;
if (!unsignedRelease) {
  if (!teamId) {
    console.error("APPLE_TEAM_ID is required to verify the signed app TeamIdentifier.");
    process.exit(1);
  }
  ensureNotaryProfile();
}

run("npm", ["test"]);
run("npm", ["run", "lint"]);
run("npm", ["run", "build"]);
run("npm", ["run", "test:ui"]);
run("cargo", ["test"], { cwd: join(cwd, "src-tauri") });
run("cargo", ["fmt", "--all", "--", "--check"], { cwd: join(cwd, "src-tauri") });
run("cargo", ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"], {
  cwd: join(cwd, "src-tauri"),
});

if (unsignedRelease) {
  console.warn(
    [
      "",
      "Building an explicit unsigned macOS artifact because ILLAMA_UNSIGNED_RELEASE=1 is set.",
      "The resulting DMG is a workflow artifact only; it must never be attached to a GitHub Release.",
      "",
    ].join("\n"),
  );
  const adHocSigningConfigPath = join(tmpdir(), "illama-tauri-ad-hoc-signing-config.json");
  writeFileSync(
    adHocSigningConfigPath,
    JSON.stringify(
      {
        bundle: {
          macOS: {
            signingIdentity: "-",
            hardenedRuntime: false,
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    run("npx", ["tauri", "build", "--ci", "--config", adHocSigningConfigPath]);
  } finally {
    rmSync(adHocSigningConfigPath, { force: true });
  }
} else {
  const signingConfigPath = join(tmpdir(), "illama-tauri-signing-config.json");
  writeFileSync(
    signingConfigPath,
    JSON.stringify(
      {
        bundle: {
          macOS: {
            signingIdentity,
            hardenedRuntime: true,
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    run("npx", [
      "tauri",
      "build",
      "--ci",
      "--bundles",
      "app",
      "--config",
      signingConfigPath,
    ]);
  } finally {
    rmSync(signingConfigPath, { force: true });
  }
}

if (unsignedRelease) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const assessment = capture("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
  if (assessment.ok) {
    console.warn("Gatekeeper assessment unexpectedly passed for the unsigned release.");
  } else {
    console.warn("Gatekeeper assessment failed as expected for the unsigned/unnotarized release:");
    console.warn(assessment.output.trim());
  }
  console.warn(`Unsigned DMG built at: ${dmgPath}`);
} else {
  packageSignedMacRelease({
    appPath,
    dmgPath,
    signingIdentity,
    teamId,
    notaryProfile,
    volumeName: "iLlama",
    dmgIdentifier: "com.illama.mac.dmg",
    run,
    capture,
  });
}

generateAndVerifyChecksum();

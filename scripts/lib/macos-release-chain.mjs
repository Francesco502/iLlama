import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export function packageSignedMacRelease(options = {}) {
  const appPath = requiredString(options.appPath, "appPath");
  const dmgPath = requiredString(options.dmgPath, "dmgPath");
  const signingIdentity = requiredString(options.signingIdentity, "signingIdentity");
  const teamId = requiredString(options.teamId, "teamId");
  const notaryProfile = requiredString(options.notaryProfile, "notaryProfile");
  const volumeName = requiredString(options.volumeName, "volumeName");
  const dmgIdentifier = requiredString(options.dmgIdentifier, "dmgIdentifier");
  const run = requiredFunction(options.run, "run");
  const capture = requiredFunction(options.capture, "capture");
  if (!appPath.endsWith(".app") || !existsSync(appPath) || !statSync(appPath).isDirectory()) {
    throw new Error(`signed release app bundle is missing: ${appPath}`);
  }
  if (!signingIdentity.startsWith("Developer ID Application: ")) {
    throw new Error("signed release requires a Developer ID Application identity");
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("signed release APPLE_TEAM_ID must be exactly 10 uppercase letters/digits");
  }

  const temporary = mkdtempSync(join(tmpdir(), "illama-signed-release-"));
  const appArchive = join(temporary, `${basename(appPath, ".app")}.zip`);
  const imageRoot = join(temporary, "dmg-root");
  const stagedApp = join(imageRoot, basename(appPath));
  try {
    verifySignedApp({ appPath, signingIdentity, teamId, run, capture });
    run("ditto", ["-c", "-k", "--keepParent", appPath, appArchive]);
    run("xcrun", [
      "notarytool",
      "submit",
      appArchive,
      "--keychain-profile",
      notaryProfile,
      "--wait",
    ]);
    run("xcrun", ["stapler", "staple", appPath]);
    run("xcrun", ["stapler", "validate", appPath]);
    verifySignedApp({ appPath, signingIdentity, teamId, run, capture });
    run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);

    mkdirSync(imageRoot, { recursive: true });
    run("ditto", [appPath, stagedApp]);
    run("xcrun", ["stapler", "validate", stagedApp]);
    verifySignedApp({ appPath: stagedApp, signingIdentity, teamId, run, capture });
    symlinkSync("/Applications", join(imageRoot, "Applications"), "dir");
    mkdirSync(dirname(dmgPath), { recursive: true });
    rmSync(dmgPath, { force: true });
    run("hdiutil", [
      "create",
      "-volname",
      volumeName,
      "-srcfolder",
      imageRoot,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ]);
    if (!existsSync(dmgPath) || !statSync(dmgPath).isFile()) {
      throw new Error(`hdiutil did not create the expected DMG: ${dmgPath}`);
    }
    run("codesign", [
      "--force",
      "--timestamp",
      "--sign",
      signingIdentity,
      "--identifier",
      dmgIdentifier,
      dmgPath,
    ]);
    run("codesign", ["--verify", "--verbose=2", dmgPath]);
    run("xcrun", [
      "notarytool",
      "submit",
      dmgPath,
      "--keychain-profile",
      notaryProfile,
      "--wait",
    ]);
    run("xcrun", ["stapler", "staple", dmgPath]);
    run("xcrun", ["stapler", "validate", dmgPath]);
    run("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmgPath,
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function verifySignedApp({ appPath, signingIdentity, teamId, run, capture }) {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  const details = capture("codesign", ["--display", "--verbose=4", appPath]);
  if (!details?.ok) throw new Error("unable to read signed app codesign details");
  const lines = String(details.output ?? "").split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(`Authority=${signingIdentity}`)) {
    throw new Error("signed app Developer ID authority does not match the selected identity");
  }
  if (!lines.includes(`TeamIdentifier=${teamId}`)) {
    throw new Error("signed app TeamIdentifier does not match APPLE_TEAM_ID");
  }
  if (!lines.some((line) => /^flags=.*\bruntime\b/.test(line))) {
    throw new Error("signed app does not have hardened runtime enabled");
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
  return value;
}

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} must be a function`);
  return value;
}

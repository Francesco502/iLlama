#!/usr/bin/env node
/**
 * Smoke several llama-server binaries locally (version / help exit).
 * Usage:
 *   LLAMA_SERVER_PATHS="/path/a/llama-server:/path/b/llama-server" node scripts/real-smoke-matrix.mjs
 * Or pass paths as CLI args:
 *   node scripts/real-smoke-matrix.mjs /opt/llama/bin/llama-server ~/build/llama-server
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const fromEnv = process.env.LLAMA_SERVER_PATHS?.split(/[:;]/).map((s) => s.trim()).filter(Boolean) ?? [];
const fromArgv = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
const paths = fromArgv.length > 0 ? fromArgv : fromEnv;

if (paths.length === 0) {
  console.error(
    "请设置 LLAMA_SERVER_PATHS（冒号分隔的绝对路径）或传入参数：\n" +
      "  LLAMA_SERVER_PATHS=/a/llama-server:/b/llama-server node scripts/real-smoke-matrix.mjs\n" +
      "  node scripts/real-smoke-matrix.mjs /path/to/llama-server",
  );
  process.exit(2);
}

let failed = 0;
for (const bin of paths) {
  if (!existsSync(bin)) {
    console.error(`[missing] ${bin}`);
    failed += 1;
    continue;
  }
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
  const ok = r.status === 0;
  if (ok) {
    const head = (r.stdout || r.stderr || "").split("\n")[0]?.trim() || "(no output)";
    console.log(`[ok] ${bin}\n      ${head}`);
  } else {
    const r2 = spawnSync(bin, ["-h"], { encoding: "utf8", timeout: 15_000 });
    const ok2 = r2.status === 0 || r2.status === 1;
    if (ok2) {
      console.log(`[ok] ${bin} (--version failed, -h exit ${r2.status})`);
    } else {
      console.error(`[fail] ${bin} status=${r.status} stderr=${(r.stderr || "").slice(0, 200)}`);
      failed += 1;
    }
  }
}

process.exit(failed > 0 ? 1 : 0);

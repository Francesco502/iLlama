import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [, , source, targetTriple] = process.argv;

if (!source || !targetTriple) {
  console.error("Usage: npm run prepare:sidecar -- <path-to-llama-server> <target-triple>");
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`Binary does not exist: ${source}`);
  process.exit(1);
}

const binaryName = basename(source).replace(/(\.exe)?$/, `-${targetTriple}$1`);
const outputDir = resolve("src-tauri/binaries");
mkdirSync(outputDir, { recursive: true });
copyFileSync(source, join(outputDir, binaryName));
console.log(`Prepared sidecar: ${join(outputDir, binaryName)}`);

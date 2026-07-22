import { writeFile } from "node:fs/promises";

const GGUF_STRING = 8;
const GGUF_UINT32 = 4;
const DEFAULT_ALIGNMENT = 32;

export function minimalGgufFixture() {
  const chunks = [];
  chunks.push(Buffer.from("GGUF", "ascii"));
  chunks.push(u32(3));
  chunks.push(u64(1));
  chunks.push(u64(4));
  chunks.push(metadataString("general.architecture", "llama"));
  chunks.push(metadataU32("general.file_type", 0));
  chunks.push(metadataU32("llama.context_length", 2048));
  chunks.push(metadataString("general.size_label", "fixture"));

  chunks.push(ggufString("weight"));
  chunks.push(u32(1));
  chunks.push(u64(2));
  chunks.push(u32(0));
  chunks.push(u64(0));

  const tensorInfo = Buffer.concat(chunks);
  const padding = (DEFAULT_ALIGNMENT - (tensorInfo.length % DEFAULT_ALIGNMENT)) % DEFAULT_ALIGNMENT;
  return Buffer.concat([tensorInfo, Buffer.alloc(padding), Buffer.alloc(8)]);
}

export async function writeMinimalGgufFixture(path) {
  await writeFile(path, minimalGgufFixture());
  return path;
}

function metadataString(key, value) {
  return Buffer.concat([ggufString(key), u32(GGUF_STRING), ggufString(value)]);
}

function metadataU32(key, value) {
  return Buffer.concat([ggufString(key), u32(GGUF_UINT32), u32(value)]);
}

function ggufString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u64(bytes.length), bytes]);
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function u64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

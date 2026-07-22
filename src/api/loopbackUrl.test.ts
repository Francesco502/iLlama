import { describe, expect, it } from "vitest";
import { buildLoopbackHttpUrl } from "./loopbackUrl";

describe("buildLoopbackHttpUrl", () => {
  it("builds only a concrete 127.0.0.1 endpoint", () => {
    expect(buildLoopbackHttpUrl("127.0.0.1", 8080, "/v1/models")).toBe(
      "http://127.0.0.1:8080/v1/models",
    );
  });

  it("rejects remote hosts, invalid ports, and authority-like paths", () => {
    expect(() => buildLoopbackHttpUrl("api.example", 8080, "/v1/models")).toThrow(
      /Only 127\.0\.0\.1/,
    );
    expect(() => buildLoopbackHttpUrl("127.0.0.1", 0, "/v1/models")).toThrow(/port/);
    expect(() =>
      buildLoopbackHttpUrl("127.0.0.1", 8080, "//api.example/v1"),
    ).toThrow(/local path/);
  });
});

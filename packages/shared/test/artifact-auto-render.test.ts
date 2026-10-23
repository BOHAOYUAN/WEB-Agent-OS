import { describe, expect, it } from "vitest";
import { artifactSignature, isTurnSettled, selectAutoRenderArtifact } from "../src/artifacts/auto-render.js";
import type { Artifact } from "../src/types/artifacts.js";
import type { EndReason, SensorEvent } from "../src/types/events.js";

function artifact(index: number, language: string, code: string, kind: Artifact["kind"] = "render"): Artifact {
  return {
    id: `artifact-${index}`,
    index,
    language,
    code,
    kind,
    runtime: language === "jsx" || language === "tsx" ? "react" : "html",
  };
}

describe("selectAutoRenderArtifact", () => {
  it("picks the last renderable artifact", () => {
    const list = [artifact(0, "jsx", "a"), artifact(1, "python", "b", "code"), artifact(2, "html", "c")];
    expect(selectAutoRenderArtifact(list)?.index).toBe(2);
  });

  it("returns null when nothing is renderable", () => {
    expect(selectAutoRenderArtifact([])).toBeNull();
    expect(selectAutoRenderArtifact([artifact(0, "python", "b", "code")])).toBeNull();
  });

  it("skips trailing code blocks and picks the last renderable one", () => {
    const list = [artifact(0, "svg", "<svg/>"), artifact(1, "bash", "ls", "code")];
    expect(selectAutoRenderArtifact(list)?.index).toBe(0);
  });
});

describe("artifactSignature", () => {
  it("is stable for identical content", () => {
    expect(artifactSignature(artifact(0, "jsx", "const a = 1;"))).toBe(
      artifactSignature(artifact(9, "jsx", "const a = 1;")),
    );
  });

  it("changes when the code changes", () => {
    expect(artifactSignature(artifact(0, "jsx", "const a = 1;"))).not.toBe(
      artifactSignature(artifact(0, "jsx", "const a = 2;"))
    );
  });

  it("changes when only the language changes", () => {
    expect(artifactSignature(artifact(0, "jsx", "x"))).not.toBe(
      artifactSignature(artifact(0, "tsx", "x"))
    );
  });

  it("distinguishes same-length different content (hash, not just length)", () => {
    expect(artifactSignature(artifact(0, "jsx", "aaaa"))).not.toBe(
      artifactSignature(artifact(0, "jsx", "bbbb"))
    );
  });

  it("stays short for huge artifacts", () => {
    const big = artifact(0, "html", "x".repeat(200_000));
    expect(artifactSignature(big).length).toBeLessThan(80);
  });
});

describe("isTurnSettled", () => {
  const end = (reason: EndReason): SensorEvent =>
    ({ type: "sensor.stream.end", requestId: "r1", reason, ts: 0 });

  it("accepts finished and incomplete streams", () => {
    expect(isTurnSettled(end("finished"))).toBe(true);
    expect(isTurnSettled(end("incomplete"))).toBe(true);
  });

  it("rejects aborted, transport-closed and error streams", () => {
    expect(isTurnSettled(end("aborted"))).toBe(false);
    expect(isTurnSettled(end("transport-closed"))).toBe(false);
    expect(isTurnSettled(end("error"))).toBe(false);
  });

  it("rejects every non-end event", () => {
    expect(
      isTurnSettled({ type: "sensor.text.delta", requestId: "r1", channel: "answer", text: "x" }),
    ).toBe(false);
    expect(isTurnSettled({ type: "sensor.user.prompt", requestId: "r1", text: "x", ts: 0 })).toBe(false);
  });
});

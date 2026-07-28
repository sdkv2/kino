import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { clearCaptureBuffers, takeCaptureBuffer, ensureRenderServer } from "../src/render/native/server.js";

describe("capture POST endpoint", () => {
  let url: string;

  beforeAll(async () => {
    clearCaptureBuffers();
    const r = await ensureRenderServer({
      publicDir: "/tmp",
      framesDir: "/tmp",
      pageJs: "",
      renderConfigJson: "{}",
    });
    url = r.url;
  });

  afterAll(() => {
    clearCaptureBuffers();
  });

  it("stores raw JPEG bytes per worker slot", async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
    const res = await fetch(`${url}/__capture/2`, { method: "POST", body });
    expect(res.status).toBe(204);
    expect(takeCaptureBuffer(2)?.equals(body)).toBe(true);
    expect(takeCaptureBuffer(2)).toBeUndefined();
  });
});

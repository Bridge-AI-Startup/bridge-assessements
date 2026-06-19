import { describe, expect, it } from "vitest";
import { Readable, Writable } from "stream";

import { streamVideoResponse } from "../../src/utils/streamVideoResponse.js";

function createMockRes() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as Writable & {
    statusCode: number;
    headers: Record<string, string | number>;
    status: (code: number) => typeof res;
    setHeader: (k: string, v: string | number) => typeof res;
    getBody: () => Buffer;
  };

  res.statusCode = 200;
  res.headers = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (k: string, v: string | number) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.getBody = () => Buffer.concat(chunks);
  return res;
}

describe("streamVideoResponse", () => {
  const payload = Buffer.from("0123456789abcdef");

  it("streams full file with Accept-Ranges on 200", async () => {
    const req = { headers: {} } as any;
    const res = createMockRes();

    await streamVideoResponse(req, res as any, {
      totalSize: payload.length,
      openStream: async () => Readable.from(payload),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe(String(payload.length));
    expect(res.getBody().equals(payload)).toBe(true);
  });

  it("streams partial content with 206 for Range requests", async () => {
    const req = { headers: { range: "bytes=4-7" } } as any;
    const res = createMockRes();

    await streamVideoResponse(req, res as any, {
      totalSize: payload.length,
      openStream: async (range) => {
        expect(range).toEqual({ start: 4, end: 7 });
        return Readable.from(payload.subarray(range!.start, range!.end + 1));
      },
    });

    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe(`bytes 4-7/${payload.length}`);
    expect(res.headers["content-length"]).toBe("4");
    expect(res.getBody().toString()).toBe("4567");
  });
});

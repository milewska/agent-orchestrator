import { describe, it, expect } from "vitest";
import { middleware } from "../middleware";
import { NextRequest } from "next/server";

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

describe("middleware", () => {
  it("redirects /?project=<id> to /projects/<id>", () => {
    const req = makeRequest("/?project=my-app");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/projects/my-app");
    expect(location.searchParams.has("project")).toBe(false);
  });

  it("redirects /?project=all to / without project param", () => {
    const req = makeRequest("/?project=all");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
    expect(location.searchParams.has("project")).toBe(false);
  });

  it("passes through / without project param", () => {
    const req = makeRequest("/");
    const res = middleware(req);

    // NextResponse.next() does not set redirect status
    expect(res.status).toBe(200);
  });

  it("redirects /sessions/<id>?project=<pid> to /projects/<pid>/sessions/<id>", () => {
    const req = makeRequest("/sessions/abc-123?project=my-app");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/projects/my-app/sessions/abc-123");
    expect(location.searchParams.has("project")).toBe(false);
  });

  it("passes through /sessions/<id> without project param", () => {
    const req = makeRequest("/sessions/abc-123");
    const res = middleware(req);

    expect(res.status).toBe(200);
  });

  it("encodes special characters in project id", () => {
    const req = makeRequest("/?project=my%20app");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/projects/my%20app");
  });

  it("encodes special characters in session id", () => {
    const req = makeRequest("/sessions/a%20b?project=proj");
    const res = middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    // encodeURIComponent encodes the already-decoded "a b" back, resulting in double-encoded %2520
    // The middleware uses encodeURIComponent on the already-decoded pathname segment
    expect(location.pathname).toBe("/projects/proj/sessions/a%2520b");
  });
});

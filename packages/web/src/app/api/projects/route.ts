import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAllProjects } from "@/lib/project-name";
import { getPortfolioServices } from "@/lib/portfolio-services";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const scope = request.nextUrl.searchParams.get("scope");

    if (scope === "portfolio") {
      const { portfolio } = getPortfolioServices();
      // Strip sensitive paths before returning to the client
      const sanitized = portfolio.map((p) => ({
        id: p.id,
        name: p.name,
        repo: p.repo,
        defaultBranch: p.defaultBranch,
        sessionPrefix: p.sessionPrefix,
        source: p.source,
        enabled: p.enabled,
        pinned: p.pinned,
        lastSeenAt: p.lastSeenAt,
        degraded: p.degraded,
        degradedReason: p.degradedReason,
      }));
      return NextResponse.json({ projects: sanitized });
    }

    const projects = getAllProjects();
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load projects" },
      { status: 500 },
    );
  }
}

import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { loadConfig, resolveProjectConfig } from "@composio/ao-core";
import { PortfolioPage } from "@/components/PortfolioPage";
import { getPortfolioServices, listPortfolioSessions } from "@/lib/portfolio-services";
import { sessionToDashboard, enrichSessionPR } from "@/lib/serialize";
import { getServices, getSCM } from "@/lib/services";
import {
  getAttentionLevel,
  getTriageRank,
  type PortfolioActionItem,
  type PortfolioProjectSummary,
  type AttentionLevel,
} from "@/lib/types";

export const metadata: Metadata = {
  title: { absolute: "ao | Portfolio" },
};

export default async function Home() {
  let actionItems: PortfolioActionItem[] = [];
  let projectSummaries: PortfolioProjectSummary[] = [];

  // --- Single-project redirect (runs before the heavy portfolio build) ---
  try {
    const { portfolio } = getPortfolioServices();

    // Single-project optimization: skip portfolio view, go straight to project dashboard
    if (portfolio.length === 1) {
      redirect(`/projects/${encodeURIComponent(portfolio[0].id)}`);
    }

    // If portfolio is empty, try loading config directly and redirect to first project
    if (portfolio.length === 0) {
      try {
        const config = loadConfig();
        const firstKey = Object.keys(config.projects)[0];
        if (firstKey) {
          redirect(`/projects/${encodeURIComponent(firstKey)}`);
        }
      } catch {
        // No config available — fall through to empty portfolio
      }
    }

    // --- Multi-project: build portfolio data ---
    const portfolioSessions = await listPortfolioSessions(portfolio);

    // Build action items
    for (const ps of portfolioSessions) {
      const dashSession = sessionToDashboard(ps.session);
      const level = getAttentionLevel(dashSession);
      actionItems.push({
        session: dashSession,
        projectId: ps.project.id,
        projectName: ps.project.name,
        attentionLevel: level,
        triageRank: getTriageRank(level),
      });
    }

    // Sort by triage rank, then recency
    actionItems.sort((a, b) => {
      if (a.triageRank !== b.triageRank) return a.triageRank - b.triageRank;
      return new Date(b.session.lastActivityAt).getTime() - new Date(a.session.lastActivityAt).getTime();
    });

    // Enrich PR data for portfolio sessions (needed for accurate attention levels)
    const { registry } = await getServices().catch(() => ({ registry: null }));
    if (registry) {
      const enrichPromises: Promise<void>[] = [];
      for (const item of actionItems) {
        const ps = portfolioSessions.find(s => s.session.id === item.session.id);
        if (!ps || !ps.session.pr) continue;

        const resolved = resolveProjectConfig(ps.project);
        if (!resolved) continue;

        const scm = getSCM(registry, resolved.project);
        if (!scm) continue;

        enrichPromises.push(
          enrichSessionPR(item.session, scm, ps.session.pr).then(() => {}),
        );
      }

      const enrichTimeout = new Promise<void>((resolve) => setTimeout(resolve, 4_000));
      await Promise.race([Promise.allSettled(enrichPromises), enrichTimeout]);

      // Recompute attention levels after enrichment
      for (const item of actionItems) {
        item.attentionLevel = getAttentionLevel(item.session);
        item.triageRank = getTriageRank(item.attentionLevel);
      }

      // Re-sort after recomputed levels
      actionItems.sort((a, b) => {
        if (a.triageRank !== b.triageRank) return a.triageRank - b.triageRank;
        return new Date(b.session.lastActivityAt).getTime() - new Date(a.session.lastActivityAt).getTime();
      });
    }

    // Build project summaries
    const attentionLevels: AttentionLevel[] = ["merge", "respond", "review", "pending", "working", "done"];
    for (const project of portfolio) {
      const projectItems = actionItems.filter(item => item.projectId === project.id);
      const counts = {} as Record<AttentionLevel, number>;
      for (const level of attentionLevels) counts[level] = 0;
      for (const item of projectItems) counts[item.attentionLevel]++;

      projectSummaries.push({
        id: project.id,
        name: project.name,
        sessionCount: projectItems.length,
        activeCount: projectItems.filter(i => i.attentionLevel !== "done").length,
        attentionCounts: counts,
        degraded: project.degraded,
      });
    }
  } catch (err: unknown) {
    // Re-throw Next.js redirect — redirect() works by throwing a sentinel error
    if (
      err != null &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as Record<string, unknown>).digest === "string" &&
      ((err as Record<string, unknown>).digest as string).startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    // Portfolio services unavailable — render empty state
  }

  return (
    <PortfolioPage
      actionItems={actionItems}
      projectSummaries={projectSummaries}
    />
  );
}

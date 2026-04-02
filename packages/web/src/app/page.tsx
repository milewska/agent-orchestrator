import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { DashboardShell } from "@/components/DashboardShell";
import { PortfolioPage } from "@/components/PortfolioPage";
import { getDefaultCloneLocation } from "@/lib/default-location";
import { loadPortfolioPageData } from "@/lib/portfolio-page-data";

export const metadata: Metadata = {
  title: { absolute: "ao | Agent Orchestrator" },
};

export default async function Home() {
  const { projectSummaries } = await loadPortfolioPageData();

  return (
    <DashboardShell
      projects={projectSummaries}
      defaultLocation={getDefaultCloneLocation()}
    >
      <PortfolioPage projectSummaries={projectSummaries} />
    </DashboardShell>
  );
}

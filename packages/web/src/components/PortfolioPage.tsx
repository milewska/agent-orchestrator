"use client";

import { useState, useMemo } from "react";
import type { PortfolioActionItem, PortfolioProjectSummary } from "@/lib/types";
import { usePortfolioEvents } from "@/hooks/usePortfolioEvents";
import { ProjectRail } from "./ProjectRail";
import { ActionQueue } from "./ActionQueue";
import { ContextPane } from "./ContextPane";

interface PortfolioPageProps {
  actionItems: PortfolioActionItem[];
  projectSummaries: PortfolioProjectSummary[];
}

export function PortfolioPage({ actionItems: initialActionItems, projectSummaries: initialProjectSummaries }: PortfolioPageProps) {
  const { actionItems, projectSummaries } = usePortfolioEvents(initialActionItems, initialProjectSummaries);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    if (!selectedProjectId) return actionItems;
    return actionItems.filter(item => item.projectId === selectedProjectId);
  }, [actionItems, selectedProjectId]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return actionItems.find(item => item.session.id === selectedItemId) ?? null;
  }, [actionItems, selectedItemId]);

  const isCalmState = actionItems.every(item => item.attentionLevel === "working" || item.attentionLevel === "done");
  const totalActive = actionItems.filter(i => i.attentionLevel !== "done").length;
  const totalProjects = projectSummaries.length;

  return (
    <div className="flex h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)]">
      {/* Left: Project Rail */}
      <ProjectRail
        projects={projectSummaries}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />

      {/* Center: Action Queue */}
      <div className="flex-1 overflow-y-auto border-r border-[var(--color-border)]">
        {isCalmState && actionItems.length > 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-[15px] font-medium text-[var(--color-text-secondary)]">All clear</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
                {totalActive} agent{totalActive !== 1 ? "s" : ""} running across {totalProjects} project{totalProjects !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        ) : actionItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-[15px] font-medium text-[var(--color-text-secondary)]">No projects found</p>
              <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
                Run <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[12px]">ao start</code> in a project to get started
              </p>
            </div>
          </div>
        ) : (
          <ActionQueue
            items={filteredItems}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
          />
        )}
      </div>

      {/* Right: Context Pane */}
      {selectedItem && (
        <ContextPane item={selectedItem} />
      )}
    </div>
  );
}

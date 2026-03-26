"use client";

import type { PortfolioProjectSummary } from "@/lib/types";

interface ProjectRailProps {
  projects: PortfolioProjectSummary[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
}

export function ProjectRail({ projects, selectedProjectId, onSelectProject }: ProjectRailProps) {
  const totalAttention = projects.reduce((sum, p) =>
    sum + (p.attentionCounts.respond || 0) + (p.attentionCounts.review || 0) + (p.attentionCounts.merge || 0), 0);

  return (
    <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="p-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Projects
        </h2>
      </div>

      {/* All projects filter */}
      <button
        onClick={() => onSelectProject(null)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
          selectedProjectId === null
            ? "bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)]"
        }`}
      >
        <span className="flex-1 truncate">All Projects</span>
        {totalAttention > 0 && (
          <span className="rounded-full bg-[var(--color-status-error)] px-1.5 py-0.5 text-[10px] font-medium text-white">
            {totalAttention}
          </span>
        )}
      </button>

      {/* Individual projects */}
      {projects.map((project) => {
        const attention = (project.attentionCounts.respond || 0) + (project.attentionCounts.review || 0) + (project.attentionCounts.merge || 0);
        return (
          <button
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
              selectedProjectId === project.id
                ? "bg-[var(--color-bg-base)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-base)]"
            }`}
          >
            {/* Health dot */}
            <span className={`h-2 w-2 shrink-0 rounded-full ${
              project.degraded
                ? "bg-[var(--color-status-error)]"
                : project.activeCount > 0
                  ? "bg-[var(--color-status-success)]"
                  : "bg-[var(--color-text-tertiary)]"
            }`} />
            <span className="flex-1 truncate">{project.name}</span>
            {attention > 0 && (
              <span className="rounded-full bg-[var(--color-status-error)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                {attention}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

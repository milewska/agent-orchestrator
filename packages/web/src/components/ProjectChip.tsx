import { getProjectColorIndex } from "@/lib/project-color";

interface ProjectChipProps {
  projectId: string;
  projectName: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}

const SIZE_CLASSES = {
  xs: "text-[10px] py-[2px] pl-[8px] pr-[6px]",
  sm: "text-[11px] py-[2px] pl-[10px] pr-[8px]",
  md: "text-[13px] py-[4px] pl-[12px] pr-[10px]",
} as const;

export function ProjectChip({ projectId, projectName, size = "sm", className = "" }: ProjectChipProps) {
  return (
    <span
      className={`project-chip inline-flex items-center font-mono tabular-nums tracking-tight bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] border-l-2 ${SIZE_CLASSES[size]} ${className}`}
      data-project-color={getProjectColorIndex(projectId)}
      title={projectName}
    >
      {projectName}
    </span>
  );
}

"use client";

interface EmptyProjectStateProps {
  onAddProject: () => void;
}

export function EmptyProjectState({ onAddProject }: EmptyProjectStateProps) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-base)] px-10 py-12 text-center">
        <svg
          width="40"
          height="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          className="text-[var(--color-text-tertiary)]"
          aria-hidden="true"
        >
          <path d="M4.75 7.75A2.25 2.25 0 0 1 7 5.5h3.4l1.55 1.75H17a2.25 2.25 0 0 1 2.25 2.25v6.75A2.25 2.25 0 0 1 17 18.5H7a2.25 2.25 0 0 1-2.25-2.25Z" />
        </svg>
        <h2 className="mt-4 text-[17px] font-medium text-[var(--color-text-primary)]">
          No projects yet
        </h2>
        <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          Add a folder or paste a Git URL to start spawning agents.
        </p>
        <button
          type="button"
          onClick={onAddProject}
          className="mt-6 inline-flex items-center gap-2 rounded-[5px] border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-dim)] px-4 py-2 text-[12px] font-semibold text-[var(--color-accent-amber)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent-amber)_20%,transparent)]"
          style={{ minHeight: 40 }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add project
          <kbd className="ml-1 font-mono text-[10px] opacity-70">⌘N</kbd>
        </button>
      </div>
    </div>
  );
}

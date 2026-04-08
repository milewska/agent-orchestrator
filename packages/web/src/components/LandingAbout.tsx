export function LandingAbout() {
  return (
    <div className="bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.02)_0%,transparent_70%)]">
      <section className="landing-reveal py-[120px] px-6 max-w-[72rem] mx-auto">
        <div className="text-xs tracking-[0.15em] uppercase text-[var(--landing-muted)] opacity-60 mb-6">
          About
        </div>
        <h2 className="[font-family:var(--font-instrument-serif,serif)] font-normal text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05] tracking-[-1.5px] mb-6">
          Orchestrating{" "}
          <em className="italic text-[var(--landing-muted)]">intelligence</em>{" "}
          for teams that ship,{" "}
          <em className="italic text-[var(--landing-muted)]">build,</em> and{" "}
          <em className="italic text-[var(--landing-muted)]">scale.</em>
        </h2>
        <p className="text-[clamp(1rem,2vw,1.125rem)] text-[var(--landing-muted)] leading-[1.8] max-w-[48rem]">
          Agent Orchestrator is the open-source platform for running parallel AI
          coding agents. Assign issues, watch agents spawn in isolated git
          worktrees, and see PRs land automatically. Agents fix CI failures,
          address review comments, and manage the full PR lifecycle. No more
          babysitting browser tabs.
        </p>
      </section>
    </div>
  );
}

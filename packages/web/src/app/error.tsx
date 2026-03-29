"use client";

import { useRouter } from "next/navigation";
import { ErrorDisplay } from "@/components/ErrorDisplay";

/**
 * Route-level error boundary — catches errors in all pages except the root layout.
 * Renders within the existing layout (preserves sidebar/nav).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  const handleReset = () => {
    reset();
    router.refresh(); // Re-fetches server data (critical for recovering from stale state)
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-base)]">
      <ErrorDisplay
        title="Something went wrong"
        message="The dashboard encountered an error. Try again to reload the page data."
        icon="warning"
        showReset
        onReset={handleReset}
        showBackLink
        error={error}
      />
    </div>
  );
}

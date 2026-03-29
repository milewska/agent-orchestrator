"use client";

import { useRouter } from "next/navigation";
import { ErrorDisplay } from "@/components/ErrorDisplay";

/**
 * Session-specific error boundary — catches errors when loading a single session.
 * Renders within the existing layout.
 */
export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  const handleReset = () => {
    reset();
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-base)]">
      <ErrorDisplay
        title="Failed to load session"
        message="Something went wrong while loading this session. It may have been deleted or the server may be unavailable."
        icon="error"
        showReset
        onReset={handleReset}
        showBackLink
        error={error}
      />
    </div>
  );
}

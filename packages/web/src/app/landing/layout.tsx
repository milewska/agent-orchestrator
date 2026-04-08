import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
  weight: ["400"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Agent Orchestrator — Run 30 AI Agents in Parallel",
  description:
    "The open-source platform for spawning and managing parallel AI coding agents. One dashboard. Zero babysitting.",
};

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`landing-page min-h-screen ${instrumentSerif.variable}`}>
      {children}
    </div>
  );
}

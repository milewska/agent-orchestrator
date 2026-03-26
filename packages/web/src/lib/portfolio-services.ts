import { cache } from "react";
import {
  getPortfolio,
  listPortfolioSessions,
  getPortfolioSessionCounts,
  type PortfolioProject,
  type PortfolioPreferences,
  type PortfolioSession,
  loadPreferences,
} from "@composio/ao-core";

export interface PortfolioServices {
  portfolio: PortfolioProject[];
  preferences: PortfolioPreferences;
}

/** Get portfolio services (cached per request via React cache). */
export const getPortfolioServices = cache((): PortfolioServices => {
  const portfolio = getPortfolio();
  const preferences = loadPreferences();
  return { portfolio, preferences };
});

export { listPortfolioSessions, getPortfolioSessionCounts };
export type { PortfolioProject, PortfolioSession };

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Instrument_Serif: () => ({
    variable: "mock-instrument-serif",
  }),
}));

import LandingLayout from "../layout";

describe("LandingLayout", () => {
  it("renders children inside landing-page wrapper", () => {
    const { container } = render(
      <LandingLayout>
        <div>Child content</div>
      </LandingLayout>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("landing-page");
  });
});

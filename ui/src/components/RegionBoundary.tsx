"use client";

import { Component, type ReactNode } from "react";

/** One per live region: a component that throws takes down only its region. */
export class RegionBoundary extends Component<
  { name: string; children: ReactNode; surface?: "paper" | "platen" },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[trisara] ${this.props.name} failed to render`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const platen = this.props.surface === "platen";
    return (
      <div className={`border px-4 py-3 text-[14px] ${platen ? "border-platen-rule text-platen-text" : "border-rule text-ink"}`}>
        <p>
          The {this.props.name} panel stopped rendering: <span className="font-mono">{this.state.error.message}</span>. The
          rest of the page keeps working.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className={`tap mt-2 rounded-[6px] border px-3 py-1 font-mono text-[12px] ${platen ? "border-platen-dim" : "border-ink-3"}`}
        >
          Render it again
        </button>
      </div>
    );
  }
}

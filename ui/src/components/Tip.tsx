"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * Tooltip that shows on hover and keyboard focus. By default the trigger is
 * wrapped in a focusable span. With focusable={false} the child must be
 * focusable itself (a button or link) and receives aria-describedby.
 */
export function Tip({
  content,
  children,
  side = "top",
  align = "start",
  focusable = true,
  className = "",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end";
  focusable?: boolean;
  className?: string;
}) {
  const id = useId();
  const trigger =
    !focusable && isValidElement(children) ? (
      cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id })
    ) : (
      <span tabIndex={0} aria-describedby={id}>
        {children}
      </span>
    );
  return (
    <span className={`tip ${className}`}>
      {trigger}
      <span role="tooltip" id={id} className="tip-body" data-side={side} data-align={align}>
        {content}
      </span>
    </span>
  );
}

"use client";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Odometer-style digit roll for a formatted number ("133,513,130"). Digits
 * roll to their new value on change; separators are static. The full value is
 * exposed as text for assistive tech.
 */
export function Odometer({ value, className = "" }: { value: string; className?: string }) {
  const chars = [...value];
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {chars.map((ch, i) => {
          const d = DIGITS.indexOf(ch);
          // Key by position from the right so digits keep their column as the number grows.
          const key = chars.length - i;
          if (d < 0) {
            return (
              <span key={`s${key}`} className="inline-block">
                {ch}
              </span>
            );
          }
          return (
            <span key={`d${key}`} className="odo-digit">
              <span className="odo-strip" style={{ transform: `translateY(-${d * 1.5}em)` }}>
                {DIGITS.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

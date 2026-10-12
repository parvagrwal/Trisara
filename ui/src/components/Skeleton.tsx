// Static placeholders with the final column widths. No numbers, no animation.

export function Skel({ w = "6ch", className = "" }: { w?: string; className?: string }) {
  return <span data-skeleton="" aria-hidden="true" className={`skel ${className}`} style={{ width: w }} />;
}

/** A skeleton table row: one cell per width. */
export function SkelRow({ widths, className = "" }: { widths: string[]; className?: string }) {
  return (
    <tr data-skeleton="" className={className}>
      {widths.map((w, i) => (
        <td key={i} className="px-3 py-2">
          <Skel w={w} />
        </td>
      ))}
    </tr>
  );
}

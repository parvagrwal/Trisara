import { REPO_URL, repoFile } from "@/lib/config";
import { column } from "@/lib/styles";

export function Footer() {
  return (
    <footer className="border-t border-ink py-6">
      <p className={`${column} text-[14px] text-ink-2`}>
        Testnet software. Not audited. Not investment advice. This site is read-only and never asks for a wallet or a key.{" "}
        <a href={repoFile("LICENSE")}>MIT</a> <a href={REPO_URL}>GitHub</a>
      </p>
    </footer>
  );
}

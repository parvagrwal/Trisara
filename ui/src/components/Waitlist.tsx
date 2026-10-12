"use client";

import { useState, type FormEvent } from "react";
import { REPO_URL, WAITLIST_ENDPOINT } from "@/lib/config";
import { column, primaryButton, secondaryButton } from "@/lib/styles";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Form({ endpoint }: { endpoint: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed" | "invalid">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setState("invalid");
      return;
    }
    setState("sending");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setState(res.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="text-[17px]">
        You&apos;re on the list.
      </p>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="max-w-[560px] space-y-2">
      <label htmlFor="waitlist-email" className="block font-mono text-[13px] text-ink-2 [font-stretch:87.5%]">
        email
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="waitlist-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "invalid" || state === "failed") setState("idle");
          }}
          aria-invalid={state === "invalid"}
          aria-describedby="waitlist-msg"
          className="tap h-10 min-w-0 flex-1 rounded-[6px] border border-ink bg-fanfold px-3 text-[16px] text-ink"
        />
        <button type="submit" disabled={state === "sending"} className={primaryButton}>
          {state === "sending" ? "Sending" : "Notify me"}
        </button>
      </div>
      <p id="waitlist-msg" role="status" className={`min-h-6 text-[14px] ${state === "invalid" || state === "failed" ? "text-halt" : "text-ink-2"}`}>
        {state === "invalid"
          ? "Enter an email like name@example.com."
          : state === "failed"
            ? "The form service didn't respond, so your email wasn't saved. Try again in a minute."
            : ""}
      </p>
    </form>
  );
}

export function Waitlist() {
  return (
    <section id="waitlist" aria-labelledby="waitlist-title" className="border-t border-rule py-12 md:py-[72px]">
      <div className={`${column} space-y-6`}>
        <h2 id="waitlist-title">Hear when Trisara goes beyond testnet.</h2>
        {WAITLIST_ENDPOINT ? (
          <Form endpoint={WAITLIST_ENDPOINT} />
        ) : (
          <a href={REPO_URL} className={secondaryButton}>
            Read the contracts
          </a>
        )}
      </div>
    </section>
  );
}

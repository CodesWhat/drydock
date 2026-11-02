"use client";

import { useState } from "react";
import { faqItems } from "@/app/data/faq";
import { SectionHeading } from "@/components/section-heading";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="website-section website-section--split">
      <div className="website-wrap website-section-grid">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          subtitle="Common questions about how Drydock works and how it fits into your stack."
        />
        <div className="website-section-main">
          <div className="overflow-hidden rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]">
            {faqItems.map((item, i) => {
              const isOpen = openIndex === i;
              const answerId = `faq-answer-${i}`;
              return (
                <div
                  key={item.question}
                  className={[
                    "border-b border-[var(--dd-border-strong)] last:border-0",
                    i % 2 === 1 ? "bg-[var(--dd-bg-sidebar)]" : "",
                  ].join(" ")}
                >
                  <h2>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={answerId}
                      onClick={() => setOpenIndex(isOpen ? null : i)}
                      className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-4 text-left text-sm font-medium text-[var(--dd-text)] hover:bg-[var(--dd-hover-overlay)] dark:text-[var(--dd-text)]"
                    >
                      <span>{item.question}</span>
                      <span
                        aria-hidden="true"
                        className={[
                          "ml-2 shrink-0 font-mono text-lg font-light text-[var(--tx-sec)] transition-transform dark:text-[var(--tx-sec)]",
                          isOpen ? "rotate-45" : "",
                        ].join(" ")}
                      >
                        +
                      </span>
                    </button>
                  </h2>
                  {/* Always rendered so the answer is in the server HTML and
                      aria-controls resolves; collapsed answers are hidden. */}
                  <p
                    id={answerId}
                    hidden={!isOpen}
                    className="px-6 pb-5 pt-1 text-sm leading-relaxed text-[var(--tx-sec)] dark:text-[var(--tx-sec)]"
                  >
                    {item.answer}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

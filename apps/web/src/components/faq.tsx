"use client";

import { useState } from "react";
import { faqItems } from "@/app/data/faq";
import { SectionHeading } from "@/components/section-heading";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="border-t border-border/60 px-4 py-16">
      <div className="mx-auto max-w-3xl px-4">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          subtitle="Common questions about how Drydock works and how it fits into your stack."
        />

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
          {faqItems.map((item, i) => {
            const isOpen = openIndex === i;
            const answerId = `faq-answer-${i}`;
            return (
              <div
                key={item.question}
                className={[
                  "border-b border-neutral-100 last:border-0 dark:border-neutral-800/60",
                  i % 2 === 1 ? "bg-neutral-50/30 dark:bg-neutral-800/10" : "",
                ].join(" ")}
              >
                <h2>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-4 text-left text-sm font-medium text-neutral-900 hover:bg-neutral-50 dark:text-neutral-100 dark:hover:bg-neutral-900/50"
                  >
                    <span>{item.question}</span>
                    <span
                      aria-hidden="true"
                      className={[
                        "ml-2 shrink-0 font-mono text-lg font-light text-neutral-400 transition-transform dark:text-neutral-500",
                        isOpen ? "rotate-45" : "",
                      ].join(" ")}
                    >
                      +
                    </span>
                  </button>
                </h2>
                {isOpen && (
                  <p
                    id={answerId}
                    className="px-6 pb-5 pt-1 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
                  >
                    {item.answer}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

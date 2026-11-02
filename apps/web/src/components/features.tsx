"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { categoryLabels, type FeatureCategory, features } from "@/lib/site-content";

const categoryOrder: FeatureCategory[] = ["core", "security", "integrations", "operations"];

export function Features() {
  const [query, setQuery] = useState("");
  const search = query.toLowerCase().trim();
  const filtered = features.filter((feature) =>
    `${feature.title} ${feature.description} ${feature.category}`.toLowerCase().includes(search),
  );
  const groups = categoryOrder
    .map((category) => ({
      category,
      items: filtered.filter((feature) => feature.category === category),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section id="features" className="website-section">
      <div className="website-wrap website-section-grid">
        <SectionHeading
          eyebrow="Batteries included"
          title="See it, check it, then update it"
          subtitle="Watch, scan, approve, back up, roll back. All of it ships in the MIT image, with no paid tier."
        />
        <div className="website-palette">
          <div className="website-palette-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder="Search capabilities…"
              aria-label="Search capabilities"
              autoComplete="off"
            />
          </div>
          <ul className="website-capabilities">
            {groups.map((group) => (
              <li key={group.category}>
                <p className="website-capability-category">
                  {categoryLabels[group.category].label}
                </p>
                <ul>
                  {group.items.map((feature) => (
                    <li
                      key={feature.title}
                      className="website-capability"
                      data-category={group.category}
                    >
                      <span className="website-capability-icon">
                        <feature.icon size={18} aria-hidden="true" />
                      </span>
                      <div>
                        <b>{feature.title}</b>
                        <p>{feature.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? (
            <p className="website-capability-empty">No capabilities match “{query}”.</p>
          ) : null}
          <p className="website-capability-count" aria-live="polite">
            {filtered.length} of {features.length} capabilities
          </p>
        </div>
      </div>
    </section>
  );
}

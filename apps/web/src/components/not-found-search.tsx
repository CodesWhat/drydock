"use client";

import { useSearchContext } from "fumadocs-ui/contexts/search";
import { Search } from "lucide-react";

/** Docs search trigger for the 404 page, with a label that says what it searches. */
export function NotFoundSearch() {
  const { enabled, hotKey, setOpenSearch } = useSearchContext();
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="website-not-found-search"
      data-search-full=""
      aria-label="Search the Drydock docs"
      onClick={() => setOpenSearch(true)}
    >
      <Search size={16} aria-hidden="true" />
      <span>Search the Drydock docs…</span>
      <span className="website-kbd-group" aria-hidden="true">
        {hotKey.map((key, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the hotkey list is static and has no stable id.
          <kbd key={index}>{key.display}</kbd>
        ))}
      </span>
    </button>
  );
}

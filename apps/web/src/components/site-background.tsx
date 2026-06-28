export function SiteBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base */}
      <div className="absolute inset-0 bg-neutral-50 dark:bg-neutral-950" />

      {/* Aurora mesh — colors from the active [data-bg] palette, masked to fade below ~70vh */}
      <div
        className="absolute inset-x-0 top-0 h-[110vh] aurora-mesh"
        style={{
          maskImage: "linear-gradient(to bottom, black 0%, black 40%, transparent 75%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 40%, transparent 75%)",
        }}
      />

      {/* Film grain overlay — fixed, mix-blend soft-light, ~3.5% opacity */}
      <div
        className="absolute inset-0 aurora-grain opacity-[0.035] mix-blend-soft-light"
        style={{ backgroundRepeat: "repeat", backgroundSize: "200px 200px" }}
      />
    </div>
  );
}

import type { ComparisonRouteConfig } from "@/lib/comparison-route";
import { highlightsFromPipeTable, rowsFromPipeTable } from "@/lib/comparison-route";
import type { ComparisonRouteRawConfig } from "@/lib/comparison-route-data/types";
import { diunComparisonRouteData } from "./comparison-route-data/diun";
import { dockgeComparisonRouteData } from "./comparison-route-data/dockge";
import { dockhandComparisonRouteData } from "./comparison-route-data/dockhand";
import { dozzleComparisonRouteData } from "./comparison-route-data/dozzle";
import { komodoComparisonRouteData } from "./comparison-route-data/komodo";
import { ouroborosComparisonRouteData } from "./comparison-route-data/ouroboros";
import { portainerComparisonRouteData } from "./comparison-route-data/portainer";
import { watchtowerComparisonRouteData } from "./comparison-route-data/watchtower";
import { wudComparisonRouteData } from "./comparison-route-data/wud";

const comparisonRouteDataBySlug = {
  komodo: komodoComparisonRouteData,
  portainer: portainerComparisonRouteData,
  watchtower: watchtowerComparisonRouteData,
  ouroboros: ouroborosComparisonRouteData,
  dozzle: dozzleComparisonRouteData,
  wud: wudComparisonRouteData,
  dockhand: dockhandComparisonRouteData,
  diun: diunComparisonRouteData,
  dockge: dockgeComparisonRouteData,
} satisfies Record<string, ComparisonRouteRawConfig>;

export type ComparisonRouteSlug = keyof typeof comparisonRouteDataBySlug;

function resolveComparisonRouteConfig(routeData: ComparisonRouteRawConfig): ComparisonRouteConfig {
  const { comparisonTable, highlightsTable, highlightIconMap, ...config } = routeData;

  return {
    ...config,
    comparisonData: rowsFromPipeTable(comparisonTable),
    highlights: highlightsFromPipeTable(highlightsTable, highlightIconMap),
  };
}

export function getComparisonRouteConfig(slug: ComparisonRouteSlug): ComparisonRouteConfig;
export function getComparisonRouteConfig(slug: string): ComparisonRouteConfig | undefined;
export function getComparisonRouteConfig(slug: string): ComparisonRouteConfig | undefined {
  const routeData = comparisonRouteDataBySlug[slug as ComparisonRouteSlug];
  if (!routeData) {
    return undefined;
  }

  return resolveComparisonRouteConfig(routeData);
}

export function getComparisonRouteSlugs(): ComparisonRouteSlug[] {
  return Object.keys(comparisonRouteDataBySlug) as ComparisonRouteSlug[];
}

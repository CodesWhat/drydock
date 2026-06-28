import { createComparisonRoute } from "@/lib/comparison-route";
import { getComparisonRouteConfig } from "@/lib/comparison-route-data";

const { metadata, RoutePage } = createComparisonRoute(getComparisonRouteConfig("dockhand"));

export { metadata };
export default RoutePage;

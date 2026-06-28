import { createComparisonRoute } from "@/lib/comparison-route";
import { getComparisonRouteConfig } from "@/lib/comparison-route-data";

const { metadata, RoutePage } = createComparisonRoute(getComparisonRouteConfig("watchtower"));

export { metadata };
export default RoutePage;

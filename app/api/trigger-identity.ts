interface TriggerIdentity {
  type?: string;
  name?: string;
  agent?: string;
}

/**
 * A registry key is `[agent.]type.name`, and dots are legal inside the type and
 * name path segments, so one key can be reached through several different
 * route shapes (`edge1.docker/update` vs `docker/update/edge1`). The resolved
 * component's own identity is the only trustworthy answer to what was run, so
 * a lookup counts only when it matches the route parameters exactly. An absent
 * agent is the empty string, which is what a local route carries.
 */
export function doesTriggerMatchRoute(
  component: TriggerIdentity,
  route: { type: string; name: string; agent: string },
): boolean {
  return (
    component.type === route.type &&
    component.name === route.name &&
    (component.agent ?? '') === route.agent
  );
}

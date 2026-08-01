/**
 * Tear down controller-side components before removing agents from the manager.
 *
 * Edge disconnect cleanup is identity guarded so a late close from an old socket
 * cannot delete a reconnect replacement. Fleet cleanup removes that identity
 * immediately, so it must explicitly stop component-owned timers and servers
 * first.
 */
export async function cleanupFleetAgents({
  agents,
  deregisterAgentComponents,
  removeAgent,
  onError = () => {},
}) {
  for (const agent of agents) {
    try {
      await deregisterAgentComponents(agent.name);
    } catch (error) {
      onError(agent.name, error);
    }

    try {
      agent.edgeAdapter?.ws?.close(1001, 'fleet soak complete');
    } catch {
      // best effort
    }
    removeAgent(agent.name);
  }
}

import { defineComponent } from 'vue';
import ConfigurationItem from '@/components/ConfigurationItem.vue';
import agentService from '@/services/agent';

export default defineComponent({
  data() {
    return {
      agents: [] as any[],
      rawAgents: [] as any[],
    };
  },
  components: {
    ConfigurationItem,
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const agents = await agentService.getAgents();
      const formattedAgents = agents.map((agent: any) => ({
        type: 'agent',
        name: agent.name,
        agent: agent.name,
        connected: agent.connected,
        icon: agent.connected ? 'fas fa-network-wired' : 'fas fa-plug-circle-xmark',
        iconColor: agent.connected ? '#10B981' : '#EF4444',
        configuration: {
          host: agent.host,
          port: agent.port,
          status: agent.connected ? 'Connected' : 'Disconnected',
        },
      }));
      next((vm: any) => {
        vm.agents = formattedAgents;
        vm.rawAgents = agents;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit('notify', `Error when trying to load the agents (${e.message})`, 'error');
      });
    }
  },
});

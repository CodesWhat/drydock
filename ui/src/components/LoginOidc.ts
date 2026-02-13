import { defineComponent } from 'vue';
import { getOidcRedirection } from '@/services/auth';

export default defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    dark: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {};
  },

  methods: {
    /**
     * Perform login.
     * @returns {Promise<void>}
     */
    async redirect() {
      const redirection = await getOidcRedirection(this.name);
      globalThis.location.href = redirection.url;
    },
  },
});

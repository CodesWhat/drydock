import { defineComponent } from 'vue';
import { loginBasic } from '@/services/auth';

export default defineComponent({
  props: {
    dark: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      username: '',
      password: '',
      rules: {
        required: (value: any) => !!value || 'Required',
      },
    };
  },

  computed: {
    /**
     * Is form valid?
     * @returns {boolean}
     */
    valid() {
      return this.username !== '' && this.password !== '';
    },
  },

  methods: {
    /**
     * Perform login.
     * @returns {Promise<void>}
     */
    async login() {
      if (this.valid) {
        try {
          await loginBasic(this.username, this.password);
          this.$emit('authentication-success');
        } catch (e: any) {
          this.$eventBus.emit('notify', e?.message || 'Username or password error', 'error');
        }
      }
    },
  },
});

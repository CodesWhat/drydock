import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    icon: {
      type: String,
      required: true,
    },
    size: {
      type: [String, Number],
      default: 24,
    },
    marginRight: {
      type: [String, Number],
      default: 8,
    },
  },

  computed: {
    normalizedIcon() {
      if (!this.icon) return '';
      return this.icon
        .replace('mdi:', 'mdi-')
        .replace('fa:', 'fa-')
        .replace('fab:', 'fab-')
        .replace('far:', 'far-')
        .replace('fas:', 'fas-')
        .replace('si:', 'si-');
    },

    isHomarrIcon() {
      return this.icon && (this.icon.startsWith('hl-') || this.icon.startsWith('hl:'));
    },

    isSelfhstIcon() {
      return this.icon && (this.icon.startsWith('sh-') || this.icon.startsWith('sh:'));
    },

    isSimpleIcon() {
      return this.normalizedIcon && this.normalizedIcon.startsWith('si-');
    },

    isCustomIconUrl() {
      if (!this.icon) return false;
      try {
        const iconUrl = new URL(this.icon);
        return iconUrl.protocol === 'http:' || iconUrl.protocol === 'https:';
      } catch {
        return false;
      }
    },

    homarrIconUrl() {
      const iconName = this.icon.replace('hl-', '').replace('hl:', '');
      return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${iconName}.png`;
    },

    selfhstIconUrl() {
      const iconName = this.icon.replace('sh-', '').replace('sh:', '');
      return `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${iconName}.png`;
    },

    simpleIconUrl() {
      const iconName = this.normalizedIcon.replace('si-', '');
      return `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${iconName}.svg`;
    },

    customIconUrl() {
      return this.icon;
    },

    iconStyle() {
      return {
        width: `${this.size}px`,
        height: `${this.size}px`,
        marginRight: `${this.marginRight}px`,
      };
    },
  },
});

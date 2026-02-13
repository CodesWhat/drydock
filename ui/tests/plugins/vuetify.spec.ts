import { createVuetify } from '@/plugins/vuetify';

describe('vuetify plugin', () => {
  it('creates a vuetify instance with configured defaults', () => {
    const vuetify = createVuetify();
    expect(vuetify).toBeTruthy();
  });
});

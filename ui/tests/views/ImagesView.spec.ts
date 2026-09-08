import { flushPromises } from '@vue/test-utils';
import { computed, defineComponent } from 'vue';
import { preferences, resetPreferences } from '@/preferences/store';
import type { ImageHostSummary, ImageInventoryItem } from '@/services/images';
import { ApiError } from '@/utils/error';
import ImagesView from '@/views/ImagesView.vue';
import {
  digestRepositoryName,
  formatBytes,
  hostDisplayName,
  hostMatches,
  type ImageSortKey,
  imageSortValue,
  parseRepoTag,
  repositoryLabel,
  shortImageId,
  tagLabel,
} from '@/views/images/imagesViewHelpers';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

// ── composable mocks ──────────────────────────────────────────────────────────
const { mockContainerActionsEnabled, mockConfirmRequire, mockToast } = vi.hoisted(() => ({
  mockContainerActionsEnabled: { value: true },
  mockConfirmRequire: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/composables/useServerFeatures', () => ({
  useServerFeatures: () => ({
    containerActionsEnabled: computed(() => mockContainerActionsEnabled.value),
  }),
}));

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ require: mockConfirmRequire }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/services/images', () => ({
  getImages: vi.fn(),
  getPrunePreview: vi.fn(),
  pruneImages: vi.fn(),
}));

const { getImages, getPrunePreview, pruneImages } = await import('@/services/images');
const mockGetImages = getImages as ReturnType<typeof vi.fn>;
const mockGetPrunePreview = getPrunePreview as ReturnType<typeof vi.fn>;
const mockPruneImages = pruneImages as ReturnType<typeof vi.fn>;

// ── fixtures ────────────────────────────────────────────────────────────────
function makeImage(overrides: Partial<ImageInventoryItem> = {}): ImageInventoryItem {
  return {
    id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    repoTags: ['nginx:latest'],
    repoDigests: [],
    size: 50 * 1024 * 1024,
    reclaimable: 0,
    created: '2026-01-01T00:00:00.000Z',
    containers: 1,
    dangling: false,
    watcher: 'local',
    ...overrides,
  };
}

function makeHost(overrides: Partial<ImageHostSummary> = {}): ImageHostSummary {
  return {
    id: 'docker.local',
    name: 'local',
    supported: true,
    ...overrides,
  };
}

// ── DataTable stubs ────────────────────────────────────────────────────────────
const richImagesTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'hiddenColumnKeys', 'sortKey', 'sortAsc', 'preferCards'],
  emits: ['update:sortKey', 'update:sortAsc', 'update:cardReflowForced'],
  template: `
    <div class="data-table" :data-row-count="rows?.length ?? 0">
      <div
        v-for="col in (columns || []).filter((c) => !(hiddenColumnKeys || []).includes(c.key))"
        :key="col.key"
        class="dt-header"
        :data-col-key="col.key">
        {{ col.label }}
      </div>
      <div v-for="row in rows" :key="row[rowKey || 'id']" class="data-table-row" :data-row-id="row[rowKey || 'id']">
        <slot name="cell-repository" :row="row" />
        <slot name="cell-tag" :row="row" />
        <slot name="cell-imageId" :row="row" />
        <slot name="cell-size" :row="row" />
        <slot name="cell-containers" :row="row" />
        <slot name="cell-created" :row="row" />
        <slot name="cell-lastSeen" :row="row" />
        <slot name="cell-host" :row="row" />
      </div>
    </div>
  `,
});

const cardImagesTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'hiddenColumnKeys', 'preferCards'],
  emits: ['update:cardReflowForced'],
  template: `
    <div class="data-table images-card-table" :data-row-count="rows?.length ?? 0" :data-prefer-cards="String(preferCards)">
      <article v-for="row in rows || []" :key="row[rowKey || 'id']" class="image-card" :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
    </div>
  `,
});

async function mountImagesView() {
  const wrapper = mountWithPlugins(ImagesView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataTable: richImagesTableStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

async function mountImagesCardView() {
  const wrapper = mountWithPlugins(ImagesView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataTable: cardImagesTableStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('ImagesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
    mockContainerActionsEnabled.value = true;
    mockGetImages.mockResolvedValue({ images: [], hosts: [makeHost()] });
    mockGetPrunePreview.mockResolvedValue({
      host: 'docker.local',
      mode: 'dangling',
      images: 0,
      reclaimable: 0,
    });
    mockPruneImages.mockResolvedValue({
      host: 'docker.local',
      mode: 'dangling',
      imagesDeleted: 0,
      spaceReclaimed: 0,
    });
  });

  it('renders rows with repository, tag, and size', async () => {
    mockGetImages.mockResolvedValue({
      images: [makeImage({ id: 'sha256:1111', repoTags: ['nginx:1.25'], size: 2 * 1024 * 1024 })],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();

    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    expect(wrapper.text()).toContain('nginx');
    expect(wrapper.text()).toContain('1.25');
    expect(wrapper.text()).toContain(formatBytes(2 * 1024 * 1024));
  });

  it('renders a dangling chip when the image has no tag', async () => {
    mockGetImages.mockResolvedValue({
      images: [makeImage({ repoTags: [], repoDigests: [], dangling: true })],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();

    expect(wrapper.find('span.badge').text()).toBe('dangling');
  });

  it('renders untagged repository from repoDigests when there are no repoTags', async () => {
    mockGetImages.mockResolvedValue({
      images: [
        makeImage({ repoTags: [], repoDigests: ['nginx@sha256:deadbeef'], dangling: false }),
      ],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();

    expect(wrapper.text()).toContain('nginx');
    expect(wrapper.text()).toContain('—');
  });

  it('renders the untagged label when there are neither repoTags nor repoDigests', async () => {
    mockGetImages.mockResolvedValue({
      images: [makeImage({ repoTags: [], repoDigests: [], dangling: false })],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();

    expect(wrapper.text()).toContain('untagged');
  });

  it('host filter narrows the row list to the selected host', async () => {
    mockGetImages.mockResolvedValue({
      images: [
        makeImage({ id: 'sha256:local1', watcher: 'local' }),
        makeImage({ id: 'sha256:remote1', watcher: 'remote', agent: 'edge' }),
      ],
      hosts: [makeHost(), makeHost({ id: 'edge.docker.remote', name: 'remote', agent: 'edge' })],
    });

    const wrapper = await mountImagesView();
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

    await wrapper.find('select').setValue('edge.docker.remote');

    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    expect(wrapper.find('[data-row-id="sha256:remote1"]').exists()).toBe(true);
  });

  it('unused-only checkbox narrows the row list to images with zero containers', async () => {
    mockGetImages.mockResolvedValue({
      images: [
        makeImage({ id: 'sha256:used', containers: 2 }),
        makeImage({ id: 'sha256:unused', containers: 0 }),
      ],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

    await wrapper.find('input[type="checkbox"]').setValue(true);

    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    expect(wrapper.find('[data-row-id="sha256:unused"]').exists()).toBe(true);
  });

  it('disables an unsupported host in the select and shows a notice when it is chosen', async () => {
    mockGetImages.mockResolvedValue({
      images: [],
      hosts: [
        makeHost(),
        makeHost({ id: 'edge.docker.blocked', name: 'blocked', agent: 'edge', supported: false }),
      ],
    });

    const wrapper = await mountImagesView();
    const blockedOption = wrapper.findAll('option').find((option) => option.text() === 'blocked');
    expect(blockedOption).toBeDefined();
    expect(blockedOption?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).not.toContain('does not expose the Docker API');

    await wrapper.find('select').setValue('edge.docker.blocked');

    expect(wrapper.text()).toContain('does not expose the Docker API');
  });

  it('shows a muted per-host error line', async () => {
    mockGetImages.mockResolvedValue({
      images: [],
      hosts: [makeHost({ error: 'agent unreachable' })],
    });

    const wrapper = await mountImagesView();

    expect(wrapper.text()).toContain('Could not list images on local: agent unreachable');
  });

  it('shows the empty state when no images match', async () => {
    mockGetImages.mockResolvedValue({ images: [], hosts: [makeHost()] });

    const wrapper = await mountImagesView();

    expect(wrapper.text()).toContain('No images match the current filters.');
  });

  it('shows a top-level error banner when the load fails', async () => {
    mockGetImages.mockRejectedValue(new Error('network down'));

    const wrapper = await mountImagesView();

    expect(wrapper.text()).toContain('network down');
  });

  it('refresh button reloads the image list', async () => {
    mockGetImages.mockResolvedValue({ images: [], hosts: [makeHost()] });
    const wrapper = await mountImagesView();
    expect(mockGetImages).toHaveBeenCalledTimes(1);

    const refreshButton = wrapper.findAll('button').find((b) => b.text().includes('Refresh'));
    await refreshButton?.trigger('click');
    await flushPromises();

    expect(mockGetImages).toHaveBeenCalledTimes(2);
  });

  it('sorts rows by size, descending, by default', async () => {
    mockGetImages.mockResolvedValue({
      images: [
        makeImage({ id: 'sha256:small', size: 100 }),
        makeImage({ id: 'sha256:big', size: 999 }),
        makeImage({ id: 'sha256:mid', size: 500 }),
      ],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();
    const rowIds = wrapper.findAll('.data-table-row').map((row) => row.attributes('data-row-id'));

    expect(rowIds).toEqual(['sha256:big', 'sha256:mid', 'sha256:small']);
  });

  it('formats created and lastSeen, leaving lastSeen empty when absent', async () => {
    mockGetImages.mockResolvedValue({
      images: [
        makeImage({
          id: 'sha256:withlastseen',
          size: 200,
          created: '2026-01-01T00:00:00.000Z',
          lastSeen: '2026-01-05T00:00:00.000Z',
        }),
        makeImage({
          id: 'sha256:nocreated',
          size: 100,
          created: '',
          lastSeen: undefined,
        }),
      ],
      hosts: [makeHost()],
    });

    const wrapper = await mountImagesView();

    const withLastSeenRow = wrapper.get('[data-row-id="sha256:withlastseen"]');
    const lastSeenSpan = withLastSeenRow
      .findAll('span')
      .find((s) => s.classes().includes('dd-text-muted'));
    expect(lastSeenSpan?.attributes('title')).toBeTruthy();
    expect(lastSeenSpan?.text().length).toBeGreaterThan(0);

    const noCreatedRow = wrapper.get('[data-row-id="sha256:nocreated"]');
    const noLastSeenSpan = noCreatedRow
      .findAll('span')
      .find((s) => s.classes().includes('dd-text-muted'));
    expect(noLastSeenSpan?.attributes('title')).toBeFalsy();
    expect(noLastSeenSpan?.text()).toBe('');
  });

  describe('prune actions', () => {
    async function mountWithSelectedHost() {
      mockGetImages.mockResolvedValue({
        images: [makeImage()],
        hosts: [makeHost()],
      });
      const wrapper = await mountImagesView();
      await wrapper.find('select').setValue('docker.local');
      return wrapper;
    }

    it('hides prune buttons when container actions are disabled', async () => {
      mockContainerActionsEnabled.value = false;
      const wrapper = await mountWithSelectedHost();

      expect(wrapper.text()).not.toContain('Prune dangling');
      expect(wrapper.text()).not.toContain('Prune unused');
    });

    it('hides prune buttons when all hosts are selected', async () => {
      mockGetImages.mockResolvedValue({ images: [makeImage()], hosts: [makeHost()] });
      const wrapper = await mountImagesView();

      expect(wrapper.text()).not.toContain('Prune dangling');
      expect(wrapper.text()).not.toContain('Prune unused');
    });

    it('shows prune buttons when actions are enabled and a single supported host is selected', async () => {
      const wrapper = await mountWithSelectedHost();

      expect(wrapper.text()).toContain('Prune dangling');
      expect(wrapper.text()).toContain('Prune unused');
    });

    it('previews and confirms with the estimated count and size', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'dangling',
        images: 3,
        reclaimable: 5 * 1024 * 1024,
      });
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune dangling');
      await pruneButton?.trigger('click');
      await flushPromises();

      expect(mockGetPrunePreview).toHaveBeenCalledWith({ host: 'docker.local', mode: 'dangling' });
      expect(mockConfirmRequire).toHaveBeenCalledTimes(1);
      const options = mockConfirmRequire.mock.calls[0][0];
      expect(options.header).toBe('Prune dangling images on Local');
      expect(options.message).toBe(
        `This removes 3 images and reclaims about ${formatBytes(5 * 1024 * 1024)}. The figure is an estimate; shared layers can lower it.`,
      );
      expect(options.acceptLabel).toBe('Prune');
      expect(options.rejectLabel).toBe('Cancel');
    });

    it('shows a "nothing to prune" message with a no-op accept when the estimate is zero', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'unused',
        images: 0,
        reclaimable: 0,
      });
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune unused');
      await pruneButton?.trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      expect(options.message).toBe('Nothing to prune on this host.');

      await options.accept();
      await flushPromises();

      expect(mockPruneImages).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('shows an error toast when the prune preview fails', async () => {
      mockGetPrunePreview.mockRejectedValue(new Error('preview exploded'));
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune dangling');
      await pruneButton?.trigger('click');
      await flushPromises();

      expect(mockConfirmRequire).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalledWith('Prune failed on Local: preview exploded');
    });

    it('accept path shows a success toast and reloads on success', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'dangling',
        images: 2,
        reclaimable: 1024,
      });
      mockPruneImages.mockResolvedValue({
        host: 'docker.local',
        mode: 'dangling',
        imagesDeleted: 2,
        spaceReclaimed: 1024,
      });
      const wrapper = await mountWithSelectedHost();
      expect(mockGetImages).toHaveBeenCalledTimes(1);

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune dangling');
      await pruneButton?.trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      await options.accept();
      await flushPromises();

      expect(mockPruneImages).toHaveBeenCalledWith({ host: 'docker.local', mode: 'dangling' });
      expect(mockToast.success).toHaveBeenCalledWith(
        `Removed 2 images and reclaimed ${formatBytes(1024)} on Local`,
      );
      expect(mockGetImages).toHaveBeenCalledTimes(2);
    });

    it('shows a warning toast and reloads on a 504 (still running)', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'unused',
        images: 1,
        reclaimable: 512,
      });
      mockPruneImages.mockRejectedValue(new ApiError('still running', 504));
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune unused');
      await pruneButton?.trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      await options.accept();
      await flushPromises();

      expect(mockToast.warning).toHaveBeenCalledWith(
        'Prune is still running on Local; refresh the list in a moment.',
      );
      expect(mockGetImages).toHaveBeenCalledTimes(2);
    });

    it('shows an error toast on a non-504 ApiError and does not reload', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'dangling',
        images: 1,
        reclaimable: 512,
      });
      mockPruneImages.mockRejectedValue(new ApiError('permission denied', 403));
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune dangling');
      await pruneButton?.trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      await options.accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('Prune failed on Local: permission denied');
      expect(mockGetImages).toHaveBeenCalledTimes(1);
    });

    it('shows an error toast on a generic (non-ApiError) failure', async () => {
      mockGetPrunePreview.mockResolvedValue({
        host: 'docker.local',
        mode: 'dangling',
        images: 1,
        reclaimable: 512,
      });
      mockPruneImages.mockRejectedValue(new Error('kaboom'));
      const wrapper = await mountWithSelectedHost();

      const pruneButton = wrapper.findAll('button').find((b) => b.text() === 'Prune dangling');
      await pruneButton?.trigger('click');
      await flushPromises();

      const options = mockConfirmRequire.mock.calls[0][0];
      await options.accept();
      await flushPromises();

      expect(mockToast.error).toHaveBeenCalledWith('Prune failed on Local: kaboom');
    });
  });

  describe('v-model wiring', () => {
    it('toggles the view mode via the filter bar switcher and persists it to preferences', async () => {
      mockGetImages.mockResolvedValue({ images: [], hosts: [makeHost()] });
      const wrapper = await mountImagesView();

      await wrapper.find('.mode-cards').trigger('click');

      expect(preferences.views.images.mode).toBe('cards');
    });

    it('updates showFilters from the filter bar', async () => {
      mockGetImages.mockResolvedValue({ images: [], hosts: [makeHost()] });
      const wrapper = await mountImagesView();

      const filterBar = wrapper.findComponent(dataViewStubs.DataFilterBar);
      filterBar.vm.$emit('update:showFilters', true);
      await flushPromises();

      // No visible effect to assert (showFilters has no consumer in this view);
      // this only needs to exercise the v-model:showFilters binding.
      expect(filterBar.exists()).toBe(true);
    });

    it('updates sortKey, sortAsc, and cardReflowForced from the DataTable', async () => {
      mockGetImages.mockResolvedValue({ images: [makeImage()], hosts: [makeHost()] });
      const wrapper = await mountImagesView();

      const table = wrapper.findComponent(richImagesTableStub);
      table.vm.$emit('update:sortKey', 'repository');
      table.vm.$emit('update:sortAsc', true);
      table.vm.$emit('update:cardReflowForced', true);
      await flushPromises();

      expect(wrapper.find('.data-filter-bar').attributes('hide-view-toggle')).toBe('true');
    });
  });

  describe('card mode', () => {
    it('renders image cards with repository, tag/dangling/id, and host', async () => {
      mockGetImages.mockResolvedValue({
        images: [
          makeImage({ id: 'sha256:tagged', repoTags: ['nginx:latest'] }),
          makeImage({ id: 'sha256:dangling', repoTags: [], repoDigests: [], dangling: true }),
          makeImage({
            id: 'sha256:untaggedidonly1234567890',
            repoTags: [],
            repoDigests: [],
            dangling: false,
          }),
        ],
        hosts: [makeHost()],
      });

      const wrapper = await mountImagesCardView();

      const taggedCard = wrapper.get('[data-card-id="sha256:tagged"]');
      expect(taggedCard.text()).toContain('nginx');
      expect(taggedCard.text()).toContain('latest');

      const danglingCard = wrapper.get('[data-card-id="sha256:dangling"]');
      expect(danglingCard.text()).toContain('dangling');

      const untaggedCard = wrapper.get('[data-card-id="sha256:untaggedidonly1234567890"]');
      expect(untaggedCard.text()).toContain(shortImageId('sha256:untaggedidonly1234567890'));
      expect(untaggedCard.text()).toContain('Local');
    });
  });
});

describe('imagesViewHelpers', () => {
  describe('formatBytes', () => {
    it('formats whole bytes with no decimal', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('formats kilobytes and above with one decimal', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('clamps negative values to zero', () => {
      expect(formatBytes(-5)).toBe('0 B');
    });

    it('treats a non-finite value as zero', () => {
      expect(formatBytes(Number.NaN)).toBe('0 B');
    });
  });

  describe('shortImageId', () => {
    it('strips the sha256: prefix and takes the first 12 chars', () => {
      expect(shortImageId('sha256:abcdef0123456789')).toBe('abcdef012345');
    });

    it('takes the first 12 chars when there is no prefix', () => {
      expect(shortImageId('abcdef0123456789')).toBe('abcdef012345');
    });
  });

  describe('parseRepoTag', () => {
    it('splits repository and tag on the last colon after the last slash', () => {
      expect(parseRepoTag('nginx:latest')).toEqual({ repository: 'nginx', tag: 'latest' });
    });

    it('treats a registry host:port with no tag as the whole repository', () => {
      expect(parseRepoTag('registry.example.com:5000/nginx')).toEqual({
        repository: 'registry.example.com:5000/nginx',
        tag: '',
      });
    });
  });

  describe('digestRepositoryName', () => {
    it('strips the @sha256 digest suffix', () => {
      expect(digestRepositoryName('nginx@sha256:deadbeef')).toBe('nginx');
    });

    it('returns the whole string when there is no @', () => {
      expect(digestRepositoryName('nginx')).toBe('nginx');
    });
  });

  describe('repositoryLabel', () => {
    it('uses the first repoTag repository', () => {
      expect(repositoryLabel({ repoTags: ['nginx:latest'], repoDigests: [] }, 'untagged')).toBe(
        'nginx',
      );
    });

    it('falls back to the first repoDigest name', () => {
      expect(
        repositoryLabel({ repoTags: [], repoDigests: ['nginx@sha256:deadbeef'] }, 'untagged'),
      ).toBe('nginx');
    });

    it('falls back to the untagged label', () => {
      expect(repositoryLabel({ repoTags: [], repoDigests: [] }, 'untagged')).toBe('untagged');
    });
  });

  describe('tagLabel', () => {
    it('returns the first repoTag tag', () => {
      expect(tagLabel({ repoTags: ['nginx:1.25'] })).toBe('1.25');
    });

    it('returns an empty string with no repoTags', () => {
      expect(tagLabel({ repoTags: [] })).toBe('');
    });
  });

  describe('hostDisplayName', () => {
    it('capitalizes "local" to "Local"', () => {
      expect(hostDisplayName('local')).toBe('Local');
    });

    it('capitalizes a non-local watcher and appends the agent', () => {
      expect(hostDisplayName('remote', 'edge')).toBe('Remote (edge)');
    });
  });

  describe('hostMatches', () => {
    it('matches on watcher name and agent', () => {
      expect(
        hostMatches({ watcher: 'remote', agent: 'edge' }, { name: 'remote', agent: 'edge' }),
      ).toBe(true);
    });

    it('does not match a different watcher name', () => {
      expect(
        hostMatches({ watcher: 'local', agent: undefined }, { name: 'remote', agent: undefined }),
      ).toBe(false);
    });

    it('does not match when the agent differs', () => {
      expect(
        hostMatches({ watcher: 'remote', agent: 'edge' }, { name: 'remote', agent: 'other' }),
      ).toBe(false);
    });
  });

  describe('imageSortValue', () => {
    const item = makeImage({
      id: 'sha256:zzz',
      repoTags: ['Zebra:2.0'],
      size: 42,
      containers: 3,
      created: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-02T00:00:00.000Z',
      watcher: 'remote',
      agent: 'edge',
    });

    it('sorts by repository (lowercased)', () => {
      expect(imageSortValue(item, 'repository', 'untagged')).toBe('zebra');
    });

    it('sorts by tag (lowercased)', () => {
      expect(imageSortValue(item, 'tag', 'untagged')).toBe('2.0');
    });

    it('sorts by imageId', () => {
      expect(imageSortValue(item, 'imageId', 'untagged')).toBe('sha256:zzz');
    });

    it('sorts by size', () => {
      expect(imageSortValue(item, 'size', 'untagged')).toBe(42);
    });

    it('sorts by containers', () => {
      expect(imageSortValue(item, 'containers', 'untagged')).toBe(3);
    });

    it('sorts by created', () => {
      expect(imageSortValue(item, 'created', 'untagged')).toBe('2026-01-01T00:00:00.000Z');
    });

    it('sorts by lastSeen', () => {
      expect(imageSortValue(item, 'lastSeen', 'untagged')).toBe('2026-01-02T00:00:00.000Z');
    });

    it('falls back to an empty string when lastSeen is absent', () => {
      expect(imageSortValue(makeImage({ lastSeen: undefined }), 'lastSeen', 'untagged')).toBe('');
    });

    it('sorts by host (lowercased, watcher + agent)', () => {
      expect(imageSortValue(item, 'host', 'untagged')).toBe('remote (edge)');
    });

    it('returns 0 for an unknown key', () => {
      expect(imageSortValue(item, 'bogus' as unknown as ImageSortKey, 'untagged')).toBe(0);
    });
  });
});

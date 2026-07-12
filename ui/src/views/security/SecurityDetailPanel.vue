<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '../../components/AppBadge.vue';
import ProjectLink from '../../components/containers/ProjectLink.vue';
import ReleaseNotesLink from '../../components/containers/ReleaseNotesLink.vue';
import type { ImageSummary } from '../../composables/useVulnerabilities';
import type { SbomFormat, SbomState, Vulnerability } from './securityViewTypes';
import {
  formatTimestamp,
  severityColor,
  severityIcon,
  type VulnExportFormat,
} from './securityViewUtils';

type VulnerabilityWithSafeUrl = Vulnerability & {
  safePrimaryUrl: string | null;
};

const props = defineProps<{
  open: boolean;
  isMobile: boolean;
  selectedImage: ImageSummary | null;
  selectedImageUpdateBlocked: boolean;
  updatesAllowed: boolean;
  selectedImageVulns: Vulnerability[];
  selectedImageVulnsWithSafeUrl: VulnerabilityWithSafeUrl[];
  sbomState: SbomState;
  selectedVulnExportFormat: VulnExportFormat;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  'update:selectedSbomFormat': [format: SbomFormat];
  'update:selectedVulnExportFormat': [format: VulnExportFormat];
  'update:showSbomDocument': [show: boolean];
  downloadDetailSbom: [];
  downloadVulnReport: [];
  loadDetailSbom: [];
  navigateToContainerUpdate: [];
  openUpdate: [];
}>();

const { t } = useI18n();

const selectedSbomFormatModel = computed({
  get: () => props.sbomState.selectedFormat,
  set: (format: SbomFormat) => emit('update:selectedSbomFormat', format),
});

const selectedVulnExportFormatModel = computed({
  get: () => props.selectedVulnExportFormat,
  set: (format: VulnExportFormat) => emit('update:selectedVulnExportFormat', format),
});

const showSbomDocumentModel = computed({
  get: () => props.sbomState.showDocument,
  set: (show: boolean) => emit('update:showSbomDocument', show),
});
</script>

<template>
  <DetailPanel
    :open="open"
    :is-mobile="isMobile"
    :show-size-controls="false"
    :show-full-page="false"
    @update:open="emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2.5 min-w-0">
        <AppIcon name="security" :size="14" class="shrink-0 dd-text-secondary" />
        <span class="text-sm font-bold truncate dd-text">{{ selectedImage?.image }}</span>
      </div>
    </template>

    <template #subtitle>
      <div class="flex items-center gap-2 flex-wrap">
        <AppBadge v-if="selectedImage?.critical" tone="danger" size="xs">
          {{ selectedImage.critical }} {{ t('securityView.badge.critical') }}
        </AppBadge>
        <AppBadge v-if="selectedImage?.high" tone="warning" size="xs">
          {{ selectedImage.high }} {{ t('securityView.badge.high') }}
        </AppBadge>
        <AppBadge v-if="selectedImage?.medium" tone="caution" size="xs">
          {{ selectedImage.medium }} {{ t('securityView.badge.medium') }}
        </AppBadge>
        <AppBadge v-if="selectedImage?.low" tone="info" size="xs">
          {{ selectedImage.low }} {{ t('securityView.badge.low') }}
        </AppBadge>
        <span class="text-2xs dd-text-muted ml-auto">{{ selectedImage?.total }} {{ t('securityView.card.total') }}</span>
      </div>
      <div v-if="selectedImage && (selectedImage.hasUpdate || selectedImage.releaseNotes || selectedImage.currentReleaseNotes || selectedImage.releaseLink || selectedImage.sourceRepo)"
           class="mt-2 flex items-center gap-2 flex-wrap">
        <template v-if="selectedImage.hasUpdate">
          <AppButton
            v-if="updatesAllowed"
            size="xs"
            variant="secondary"
            class="inline-flex items-center gap-1.5"
            :disabled="selectedImageUpdateBlocked"
            data-test="security-detail-update-btn"
            @click="emit('openUpdate')">
            <AppIcon :name="selectedImageUpdateBlocked ? 'lock' : 'cloud-download'" :size="10" />
            {{ t('securityView.update') }}
          </AppButton>
          <AppButton
            size="xs"
            variant="text-secondary"
            weight="medium"
            class="inline-flex items-center underline hover:no-underline"
            data-test="security-detail-containers-link"
            @click="emit('navigateToContainerUpdate')">
            {{ t('securityView.viewInContainers') }}
          </AppButton>
        </template>
        <ReleaseNotesLink
          v-if="selectedImage.releaseNotes || selectedImage.currentReleaseNotes || selectedImage.releaseLink"
          :release-notes="selectedImage.releaseNotes"
          :current-release-notes="selectedImage.currentReleaseNotes"
          :release-link="selectedImage.releaseLink"
          data-test="security-detail-release-notes" />
        <ProjectLink
          :source-repo="selectedImage.sourceRepo"
          data-test="security-detail-project-link" />
      </div>
    </template>

    <template v-if="selectedImage" #default>
      <div class="px-4 py-3 space-y-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">{{ t('securityView.export.label') }}</span>
          <select v-model="selectedVulnExportFormatModel"
                  class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <AppButton size="xs" variant="secondary" :disabled="selectedImageVulns.length === 0"
                  @click="emit('downloadVulnReport')">
            {{ t('securityView.export.downloadReport') }}
          </AppButton>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-2xs font-semibold uppercase tracking-wide dd-text-muted">{{ t('securityView.sbom.label') }}</span>
          <select v-model="selectedSbomFormatModel"
                  class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
                  @change="emit('loadDetailSbom')">
            <option value="spdx-json">spdx-json</option>
            <option value="cyclonedx-json">cyclonedx-json</option>
          </select>
          <AppButton size="xs" variant="secondary" :disabled="sbomState.loading"
                  @click="emit('loadDetailSbom')">
            {{ sbomState.loading ? t('securityView.sbom.loadingButton') : t('securityView.sbom.refresh') }}
          </AppButton>
          <AppButton size="xs" variant="secondary" :disabled="!sbomState.document"
                  @click="showSbomDocumentModel = !showSbomDocumentModel">
            {{ showSbomDocumentModel ? t('securityView.sbom.hide') : t('securityView.sbom.view') }}
          </AppButton>
          <AppButton size="xs" variant="secondary" :disabled="!sbomState.document"
                  @click="emit('downloadDetailSbom')">
            {{ t('securityView.sbom.download') }}
          </AppButton>
        </div>

        <div v-if="sbomState.error"
             class="px-2.5 py-1.5 dd-rounded text-2xs-plus"
             :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
          {{ sbomState.error }}
        </div>
        <div v-else-if="sbomState.loading"
             class="px-2.5 py-1.5 dd-rounded text-2xs-plus dd-text-muted"
             :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          {{ t('securityView.sbom.loading') }}
        </div>
        <div v-else-if="sbomState.document"
             class="px-2.5 py-1.5 dd-rounded text-2xs space-y-0.5"
             :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <div class="dd-text-muted">
            {{ t('securityView.sbom.format') }}
            <span class="dd-text font-mono">{{ sbomState.selectedFormat }}</span>
          </div>
          <div v-if="typeof sbomState.componentCount === 'number'" class="dd-text-muted">
            {{ t('securityView.sbom.components') }}
            <span class="dd-text">{{ sbomState.componentCount }}</span>
          </div>
          <div v-if="sbomState.generatedAt" class="dd-text-muted">
            {{ t('securityView.sbom.generated') }}
            <span class="dd-text">{{ formatTimestamp(sbomState.generatedAt) }}</span>
          </div>
        </div>

        <pre v-if="sbomState.showDocument && sbomState.documentJson"
             class="p-2 dd-rounded text-2xs overflow-auto max-h-64 font-mono"
             :style="{ backgroundColor: 'var(--dd-bg-code)' }">{{ sbomState.documentJson }}</pre>
      </div>

      <div class="divide-y" :style="{ borderColor: 'var(--dd-border)' }">
        <div v-for="vuln in selectedImageVulnsWithSafeUrl" :key="vuln.id + vuln.package"
             class="px-4 py-3 hover:dd-bg-hover transition-colors">
          <div class="flex items-start gap-2 mb-1.5">
            <AppIcon :name="severityIcon(vuln.severity)" :size="12"
                     class="mt-0.5 shrink-0"
                     :style="{ color: severityColor(vuln.severity).text }" />
            <AppBadge :custom="{ bg: severityColor(vuln.severity).bg, text: severityColor(vuln.severity).text }" size="xs" class="mt-0.5 shrink-0 px-1.5 py-0">
              {{ vuln.severity }}
            </AppBadge>
            <span class="min-w-0 font-mono text-2xs-plus font-semibold dd-text truncate">{{ vuln.id }}</span>
          </div>
          <div class="flex items-start gap-2 text-2xs-plus ml-5 min-w-0">
            <span class="font-medium dd-text">{{ vuln.package }}</span>
            <span class="dd-text-muted">{{ vuln.version }}</span>
            <AppBadge v-if="vuln.fixedIn" tone="success" size="xs" class="ml-auto mt-0.5 shrink-0 px-1.5 py-0">
              <AppIcon name="check" :size="9" class="mr-0.5 shrink-0" />
              {{ vuln.fixedIn }}
            </AppBadge>
            <span v-else class="ml-auto mt-0.5 shrink-0 text-2xs dd-text-muted">{{ t('securityView.vuln.noFix') }}</span>
          </div>
          <div
            v-if="vuln.title || vuln.target || vuln.safePrimaryUrl"
            class="ml-5 mt-1.5 space-y-1"
          >
            <div v-if="vuln.title" class="text-2xs dd-text">
              {{ vuln.title }}
            </div>
            <div v-if="vuln.target" class="text-2xs dd-text-muted">
              {{ t('securityView.vuln.target') }}
              <span class="font-mono dd-text">{{ vuln.target }}</span>
            </div>
            <a
              v-if="vuln.safePrimaryUrl"
              :href="vuln.safePrimaryUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex text-2xs underline hover:no-underline break-all"
              style="color: var(--dd-info);"
            >
              {{ vuln.primaryUrl }}
            </a>
          </div>
        </div>
      </div>
    </template>
  </DetailPanel>
</template>

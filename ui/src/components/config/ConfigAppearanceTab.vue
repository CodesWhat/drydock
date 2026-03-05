<script setup lang="ts">
interface ThemeFamilyOption {
  id: string;
  label: string;
  description: string;
  swatchLight: string;
  swatchDark: string;
  accent: string;
}

interface FontOption {
  id: string;
  label: string;
  family: string;
  bundled?: boolean;
}

const props = withDefaults(
  defineProps<{
    themeFamilies: ThemeFamilyOption[];
    themeFamily?: string;
    isDark?: boolean;
    themeVariant?: string;
    activeFont?: string;
    fontLoading?: boolean;
    fontOptions: FontOption[];
    isFontLoaded: (fontId: string) => boolean;
    iconLibrary?: string;
    libraryLabels: Record<string, string>;
    iconMap: Record<string, Record<string, string>>;
    iconScale?: number;
    onSelectThemeFamily: (familyId: string, event: Event) => void;
    onSelectFont: (fontId: string) => void;
    onSelectIconLibrary: (library: string) => void;
    onChangeIconScale: (value: number) => void;
  }>(),
  {
    themeFamily: '',
    isDark: false,
    themeVariant: 'system',
    activeFont: '',
    fontLoading: false,
    iconLibrary: '',
    iconScale: 1,
  },
);

function handleIconScaleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  props.onChangeIconScale(Number.parseFloat(target.value));
}
</script>

<template>
  <div class="space-y-6">
    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="flex items-center gap-2 px-5 py-3" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Color Theme</h2>
      </div>
      <div class="p-4">
        <div class="grid grid-cols-2 gap-3">
          <button
            v-for="fam in props.themeFamilies"
            :key="fam.id"
            class="dd-rounded p-3 text-left transition-[color,background-color,border-color,opacity,transform,box-shadow]"
            :style="{
              backgroundColor: props.themeFamily === fam.id
                ? 'color-mix(in srgb, var(--dd-primary) 25%, var(--dd-bg-inset))'
                : 'var(--dd-bg-inset)',
              border: props.themeFamily === fam.id
                ? '2px solid var(--dd-primary)'
                : '1px solid var(--dd-border-strong)',
            }"
            @click="props.onSelectThemeFamily(fam.id, $event)"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span
                class="w-4 h-4 rounded-full border-2"
                :style="{
                  backgroundColor: props.isDark ? fam.swatchDark : fam.swatchLight,
                  borderColor: fam.accent,
                }"
              />
              <span
                class="text-[12px] font-semibold"
                :class="props.themeFamily === fam.id ? 'text-drydock-secondary' : 'dd-text'"
              >
                {{ fam.label }}
              </span>
            </div>
            <div class="text-[10px] dd-text-muted">
              {{ fam.description }}
            </div>
          </button>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="px-5 py-3.5 flex items-center gap-2" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon :name="props.themeVariant === 'system' ? 'monitor' : props.isDark ? 'moon' : 'sun'" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Theme</h2>
      </div>
      <div class="p-5 flex items-center gap-4">
        <ThemeToggle size="md" />
        <span class="text-[12px] font-semibold dd-text-secondary capitalize">{{ props.themeVariant }}</span>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="px-5 py-3.5 flex items-center gap-2" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="terminal" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Font Family</h2>
      </div>
      <div class="p-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            v-for="font in props.fontOptions"
            :key="font.id"
            class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors"
            :class="[
              props.fontLoading ? 'pointer-events-none' : '',
            ]"
            :style="{
              backgroundColor: props.activeFont === font.id
                ? 'color-mix(in srgb, var(--dd-primary) 25%, var(--dd-bg-inset))'
                : 'var(--dd-bg-inset)',
              border: props.activeFont === font.id
                ? '2px solid var(--dd-primary)'
                : '1px solid var(--dd-border-strong)',
            }"
            @click="props.onSelectFont(font.id)"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span
                  class="text-[13px] font-semibold truncate"
                  :style="props.isFontLoaded(font.id) ? { fontFamily: font.family } : {}"
                  :class="props.activeFont === font.id ? 'text-drydock-secondary' : 'dd-text'"
                >
                  {{ font.label }}
                </span>
                <span
                  v-if="font.bundled"
                  class="text-[8px] font-bold uppercase tracking-wider dd-text-muted px-1 py-0.5 dd-rounded-sm"
                  :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
                >
                  default
                </span>
              </div>
              <div
                class="text-[10px] mt-0.5 truncate dd-text-muted"
                :style="props.isFontLoaded(font.id) ? { fontFamily: font.family } : {}"
              >
                The quick brown fox jumps over the lazy dog
              </div>
            </div>
            <AppIcon
              v-if="props.activeFont === font.id"
              name="check"
              :size="14"
              class="text-drydock-secondary shrink-0"
            />
          </button>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="px-5 py-3.5 flex items-center gap-2" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="dashboard" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Icon Library</h2>
      </div>
      <div class="p-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <button
            v-for="(label, lib) in props.libraryLabels"
            :key="lib"
            class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors"
            :style="{
              backgroundColor: props.iconLibrary === lib
                ? 'color-mix(in srgb, var(--dd-primary) 25%, var(--dd-bg-inset))'
                : 'var(--dd-bg-inset)',
              border: props.iconLibrary === lib
                ? '2px solid var(--dd-primary)'
                : '1px solid var(--dd-border-strong)',
            }"
            @click="props.onSelectIconLibrary(lib)"
          >
            <div
              class="w-8 h-8 dd-rounded flex items-center justify-center"
              :style="{
                backgroundColor: props.iconLibrary === lib ? 'color-mix(in srgb, var(--dd-primary) 20%, var(--dd-bg-elevated))' : 'var(--dd-bg-elevated)',
              }"
            >
              <iconify-icon
                :icon="props.iconMap.dashboard?.[lib]"
                width="18"
                height="18"
                :class="props.iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text-secondary'"
              />
            </div>
            <div class="min-w-0">
              <div class="text-[12px] font-semibold" :class="props.iconLibrary === lib ? 'text-drydock-secondary' : 'dd-text'">
                {{ label }}
              </div>
              <div class="text-[10px] dd-text-muted">
                {{ lib }}
              </div>
            </div>
            <div v-if="props.iconLibrary === lib" class="ml-auto shrink-0">
              <AppIcon name="check" :size="14" class="text-drydock-secondary" />
            </div>
          </button>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="px-5 py-3.5 flex items-center gap-2" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Icon Size</h2>
      </div>
      <div class="p-5">
        <div class="flex items-center gap-4">
          <AppIcon name="dashboard" :size="10" class="dd-text-muted" />
          <input
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            :value="props.iconScale"
            class="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
            :style="{ background: 'var(--dd-border-strong)', accentColor: 'var(--dd-primary)' }"
            @input="handleIconScaleInput"
          />
          <AppIcon name="dashboard" :size="20" class="dd-text-muted" />
        </div>
        <div class="text-center mt-2 text-[11px] dd-text-muted">
          {{ Math.round(props.iconScale * 100) }}%
        </div>
      </div>
    </div>
  </div>
</template>

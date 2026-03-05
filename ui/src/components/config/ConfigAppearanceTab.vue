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

interface RadiusPreset {
  id: string;
  label: string;
  sm: number;
  md: number;
  lg: number;
}

const props = withDefaults(
  defineProps<{
    themeFamilies: ThemeFamilyOption[];
    themeFamily?: string;
    isDark?: boolean;
    activeFont?: string;
    fontLoading?: boolean;
    fontOptions: FontOption[];
    isFontLoaded: (fontId: string) => boolean;
    iconLibrary?: string;
    libraryLabels: Record<string, string>;
    iconMap: Record<string, Record<string, string>>;
    iconScale?: number;
    activeRadius?: string;
    radiusPresets: RadiusPreset[];
    onSelectThemeFamily: (familyId: string, event: Event) => void;
    onSelectFont: (fontId: string) => void;
    onSelectIconLibrary: (library: string) => void;
    onChangeIconScale: (value: number) => void;
    onSelectRadius: (id: string) => void;
  }>(),
  {
    themeFamily: '',
    isDark: false,
    activeFont: '',
    fontLoading: false,
    iconLibrary: '',
    iconScale: 1,
    activeRadius: 'sharp',
  },
);

function handleIconScaleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  props.onChangeIconScale(Number.parseFloat(target.value));
}
</script>

<template>
  <div class="space-y-6">
    <!-- Color Theme -->
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
            class="dd-rounded p-3 text-left transition-[color,background-color,border-color,opacity,transform,box-shadow] border"
            :class="props.themeFamily === fam.id ? 'ring-2 ring-drydock-secondary' : ''"
            :style="{
              backgroundColor: props.themeFamily === fam.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
              border: props.themeFamily === fam.id ? '1px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
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

    <!-- Font Family -->
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
            class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors border"
            :class="[
              props.activeFont === font.id ? 'ring-2 ring-drydock-secondary' : '',
              props.fontLoading ? 'pointer-events-none' : '',
            ]"
            :style="{
              backgroundColor: props.activeFont === font.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
              border: props.activeFont === font.id ? '1px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
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

    <!-- Icon Library -->
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
            class="flex items-center gap-3 px-4 py-3 dd-rounded text-left transition-colors border"
            :class="props.iconLibrary === lib ? 'ring-2 ring-drydock-secondary' : ''"
            :style="{
              backgroundColor: props.iconLibrary === lib ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
              border: props.iconLibrary === lib ? '1px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
            }"
            @click="props.onSelectIconLibrary(lib)"
          >
            <div
              class="w-8 h-8 dd-rounded flex items-center justify-center"
              :style="{
                backgroundColor: props.iconLibrary === lib ? 'var(--dd-primary-muted)' : 'var(--dd-bg-elevated)',
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

    <!-- Icon Size -->
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

    <!-- Border Radius -->
    <div
      class="dd-rounded overflow-hidden"
      :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
        :style="{ borderBottom: '1px solid var(--dd-border-strong)' }"
      >
        <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
        <h2 class="text-sm font-semibold dd-text">Border Radius</h2>
      </div>
      <div class="p-5">
        <div class="grid grid-cols-5 gap-2">
          <button
            v-for="p in props.radiusPresets"
            :key="p.id"
            class="flex flex-col items-center gap-2 px-3 py-3 dd-rounded transition-colors"
            :class="props.activeRadius === p.id ? 'ring-2 ring-drydock-secondary' : ''"
            :style="{
              backgroundColor: props.activeRadius === p.id ? 'var(--dd-primary-muted)' : 'var(--dd-bg-inset)',
              border: props.activeRadius === p.id ? '1.5px solid var(--dd-primary)' : '1px solid var(--dd-border-strong)',
            }"
            @click="props.onSelectRadius(p.id)"
          >
            <div
              class="w-10 h-7 border-2 transition-[color,background-color,border-color,opacity,transform,box-shadow]"
              :class="props.activeRadius === p.id ? 'border-drydock-secondary/60' : 'dd-border-strong'"
              :style="{ borderRadius: p.md + 'px', backgroundColor: props.activeRadius === p.id ? 'var(--dd-primary-muted)' : 'transparent' }"
            />
            <div
              class="text-[11px] font-semibold"
              :class="props.activeRadius === p.id ? 'text-drydock-secondary' : 'dd-text'"
            >
              {{ p.label }}
            </div>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

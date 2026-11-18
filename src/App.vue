<script setup lang="ts">
import { onMounted, onUnmounted, ref, watchEffect } from "vue";
import ShaderBackground from "./components/ShaderBackground.vue";
import type { ShaderBackground as ShaderBackgroundClass } from "./three/ShaderBackground";

const bgVue = ref<InstanceType<typeof ShaderBackground> | null>(null);
const activeSection = ref(0);
const incomingSection = ref<number | null>(null);
const wipeDirection = ref<1 | -1>(1);
const sectionCount = 3;

let accum = 0;

function getBg(): ShaderBackgroundClass | null {
  return bgVue.value?.background ?? null;
}

function goTo(
  index: number,
  direction: 1 | -1,
  mode: "wheel" | "time" = "time",
) {
  const bg = getBg();
  if (!bg) return;
  if (index < 0 || index >= sectionCount || index === activeSection.value)
    return;

  if (bg.startTransition(index, direction, { mode })) {
    incomingSection.value = index;
    wipeDirection.value = direction;
  }
}

function onWheel(e: WheelEvent) {
  const bg = getBg();
  if (!bg) return;

  const clampedDelta = Math.max(-90, Math.min(90, e.deltaY));

  if (bg.isTransitioning) {
    const directedDelta = (clampedDelta * wipeDirection.value) / 950;
    bg.stepWheelTransition(directedDelta);
    return;
  }

  accum += clampedDelta;
  if (Math.abs(accum) < 45) return;
  const direction: 1 | -1 = accum > 0 ? 1 : -1;
  accum = 0;
  goTo(activeSection.value + direction, direction, "wheel");
}

function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "PageDown")
    goTo(activeSection.value + 1, 1, "time");
  if (e.key === "ArrowUp" || e.key === "PageUp")
    goTo(activeSection.value - 1, -1, "time");
}

watchEffect(() => {
  const bg = getBg();
  if (!bg) return;
  bg.onProgress = (_progress, dir, fromIdx, toIdx) => {
    wipeDirection.value = dir;

    if (!bg.isTransitioning && incomingSection.value !== null) {
      activeSection.value = bg.currentSectionIndex;
      incomingSection.value = null;
      accum = 0;
    } else if (bg.isTransitioning) {
      activeSection.value = fromIdx;
      incomingSection.value = toIdx;
    }
  };
});

let cleanup: (() => void) | null = null;

onMounted(() => {
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("keydown", onKey);
  cleanup = () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
});

onUnmounted(() => cleanup?.());
</script>

<template>
  <ShaderBackground ref="bgVue" />

  <nav class="dots" aria-label="Sections">
    <button
      v-for="i in sectionCount"
      :key="i"
      class="dot"
      :class="{ active: (incomingSection ?? activeSection) === i - 1 }"
      :aria-label="`Section ${i}`"
      @click="goTo(i - 1, i - 1 > activeSection ? 1 : -1, 'time')"
    />
  </nav>
</template>

<style scoped>
.dots {
  position: fixed;
  right: 1.5rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  z-index: 2;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: transparent;
  padding: 0;
  cursor: pointer;
  transition: background 0.3s;
}

.dot.active {
  background: rgba(255, 255, 255, 0.9);
}
</style>

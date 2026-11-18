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
    // Wheel-to-progress scale; smaller = fewer mouse notches per transition.
    // 600 => each notch adds ~0.15 directly; the engine's post-release
    // glide tops each notch up to ~0.25 effective => 4 notches per change.
    bg.stepWheelTransition((clampedDelta * wipeDirection.value) / 600);
    return;
  }

  accum += clampedDelta;
  if (Math.abs(accum) < 45) return;
  const direction: 1 | -1 = accum > 0 ? 1 : -1;
  accum = 0;
  goTo(activeSection.value + direction, direction, "wheel");
  // The notch that crosses the threshold must not be swallowed: it starts
  // the change and visibly drives the wave in the same gesture.
  if (bg.isTransitioning)
    bg.stepWheelTransition((clampedDelta * direction) / 600);
}

// A touch swipe moves the wave the same deterministic way the wheel does:
// each swipe is exactly one 0.25 chunk of progress toward the neighbour
// section (or a scrub-back when it opposes an active transition). The
// wheel's commit/hold/rollback thresholds apply on mobile too.
let touchStartX = 0;
let touchStartY: number | null = null;
const SWIPE_THRESHOLD = 36;
const SWIPE_CHUNK = 0.25;

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) {
    touchStartY = null;
    return;
  }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function onTouchEnd(e: TouchEvent) {
  if (touchStartY === null) return;
  const t = e.changedTouches[0];
  const dy = touchStartY - t.clientY; // positive = swipe up = next section
  const dx = Math.abs(touchStartX - t.clientX);
  touchStartY = null;

  if (Math.abs(dy) < SWIPE_THRESHOLD || Math.abs(dy) < dx) return;

  const bg = getBg();
  if (!bg) return;

  const swipeSign: 1 | -1 = dy > 0 ? 1 : -1;

  if (!bg.isTransitioning) {
    goTo(activeSection.value + swipeSign, swipeSign, "wheel");
    if (!bg.isTransitioning) return; // start was guarded, ignore this swipe
  }

  // Signed chunk: aligned with the active direction it pushes forward,
  // against it the swipe scrubs the wave back. The engine's decaying
  // velocity gives every input the same eased stop.
  bg.stepWheelTransition(swipeSign * wipeDirection.value * SWIPE_CHUNK);
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
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("keydown", onKey);
  cleanup = () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchend", onTouchEnd);
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

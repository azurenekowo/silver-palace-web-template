<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

// Decorative hero-art drift only (never wraps text content): a Lissajous sway
// with different periods for x/y, blended with the live pointer position, per
// the source site's home-parallax. depth 8 -> max ~26px x / ~58px y offset.
const props = defineProps<{ depth: number }>()

const el = ref<HTMLElement | null>(null)
let raf = 0
let t = 0
const mouse = { x: 0.5, y: 0.5 }

function loop() {
  t += 0.02
  const swayX = Math.sin(t) * 0.06 * 3.2 * props.depth + (mouse.x - 0.5) * 8
  const swayY = Math.cos(t * 0.8) * 0.04 * 1.8 * props.depth + (0.5 - mouse.y) * 5
  if (el.value) {
    el.value.style.transform = `translate3d(${swayX}px, ${swayY}px, 0)`
  }
  raf = requestAnimationFrame(loop)
}

function onMove(e: PointerEvent) {
  mouse.x = e.clientX / window.innerWidth
  mouse.y = e.clientY / window.innerHeight
}

onMounted(() => {
  window.addEventListener('pointermove', onMove)
  raf = requestAnimationFrame(loop)
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onMove)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div ref="el" class="parallax-layer">
    <slot />
  </div>
</template>

<style scoped>
.parallax-layer {
  will-change: transform;
}
</style>

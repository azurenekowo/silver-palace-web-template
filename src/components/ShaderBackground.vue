<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from "vue";
import { ShaderBackground } from "../three/ShaderBackground";

const canvasRef = shallowRef<HTMLCanvasElement | null>(null);
const background = shallowRef<ShaderBackground | null>(null);

function onMouseMove(e: MouseEvent) {
  background.value?.setMouse(
    e.clientX / window.innerWidth,
    1 - e.clientY / window.innerHeight,
  );
}

onMounted(() => {
  if (!canvasRef.value) return;
  background.value = new ShaderBackground(canvasRef.value);
  window.addEventListener("mousemove", onMouseMove, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  background.value?.dispose();
  background.value = null;
});

defineExpose({ background });
</script>

<template>
  <canvas ref="canvasRef" class="shader-canvas" />
</template>

<style scoped>
.shader-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  z-index: 0;
}
</style>

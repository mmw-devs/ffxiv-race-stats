<template>
  <div class="broadcast-module">
    <h3>合作转播台</h3>
    <div v-for="b in broadcasters" :key="b.id" class="broadcast-item">
      <div class="broadcast-avatar">▶</div>
      <div class="broadcast-info">
        <div class="broadcast-name">{{ b.name }}</div>
        <div class="broadcast-meta">{{ b.platform }} · {{ b.note }}</div>
      </div>
      <a class="broadcast-link" :href="b.url" target="_blank" rel="noopener">进入</a>
    </div>
  </div>
</template>

<script setup>
defineProps({ broadcasters: Array })
</script>

<style scoped>
.broadcast-module {
  flex: 0 0 260px;
  border: 2px solid var(--border);
  padding: 16px;
}
.broadcast-module h3 {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 14px;
}
.broadcast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 2px solid var(--border);
}
.broadcast-item:last-child { border-bottom: none; }
.broadcast-avatar {
  width: 36px; height: 36px;
  background: var(--crt-bg);
  color: var(--crt-fg);
  display: grid;
  place-items: center;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.broadcast-info { flex: 1; min-width: 0; }
.broadcast-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}
.broadcast-meta {
  font-size: 10px;
  color: var(--muted);
  letter-spacing: 0.04em;
  margin-top: 1px;
}
.broadcast-link {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-decoration: none;
  color: var(--bg);
  background: var(--fg);
  padding: 5px 10px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.broadcast-link:hover { background: var(--accent); color: var(--bg); }
@media (max-width: 680px) { .broadcast-module { flex: 1 1 100%; } }
</style>

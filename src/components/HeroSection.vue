<template>
  <section class="hero">
    <div class="hero-body">
      <h1>{{ meta.eventName }}<span v-if="meta.status === 'live'" class="live-pulse">LIVE</span></h1>
      <div class="hero-row">
        <NoticeCard :notices="notices" />
        <div class="hero-actions">
          <a href="#register" class="btn btn-accent">立即报名</a>
        </div>
      </div>
    </div>
    <BroadcastModule :broadcasters="broadcasters" />
  </section>
</template>

<script setup>
import NoticeCard from './NoticeCard.vue'
import BroadcastModule from './BroadcastModule.vue'
defineProps({ meta: Object, notices: Array, broadcasters: Array })
</script>

<style scoped>
.hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 40px;
  flex-wrap: wrap;
}
.hero-body { flex: 1 1 520px; min-width: 0; }
.hero h1 {
  margin-bottom: 12px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(48px, 6vw, 96px);
  line-height: 1.05;
  letter-spacing: -0.025em;
}
.hero-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 8px;
  max-width: 72ch;
}
.hero-actions {
  flex-shrink: 0;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.live-pulse {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent);
  color: var(--bg);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  padding: 3px 10px;
  margin-left: 12px;
  vertical-align: middle;
}
.live-pulse::before {
  content: "";
  width: 8px; height: 8px;
  background: var(--bg);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  letter-spacing: 0.06em;
  text-decoration: none;
  padding: 12px 24px;
  border: 2px solid var(--fg);
  background: var(--fg);
  color: var(--bg);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.btn:hover { background: var(--bg); color: var(--fg); }
.btn-accent { background: var(--accent); border-color: var(--accent); }
</style>

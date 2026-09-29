<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download, Upload } from '@element-plus/icons-vue';
import { seedIfEmpty } from './utils/seed';
import { downloadText, exportBackupJson, importBackup } from './utils/export';
import { useBoardStore } from './stores/boardStore';
import { useChamberStore } from './stores/chamberStore';
import { useLacquerStore } from './stores/lacquerStore';
import { useStringingStore } from './stores/stringingStore';
import { useReworkStore } from './stores/reworkStore';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const reworkStore = useReworkStore();
const ready = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function hydrateAll() {
  await Promise.all([
    boardStore.hydrate(),
    chamberStore.hydrate(),
    lacquerStore.hydrate(),
    stringingStore.hydrate(),
    reworkStore.hydrate(),
  ]);
}

onMounted(async () => {
  try {
    await seedIfEmpty();
    await hydrateAll();
  } catch (error) {
    ElMessage.error(`本地数据装载失败：${(error as Error).message}`);
  } finally {
    ready.value = true;
  }
});

async function handleExport() {
  const json = await exportBackupJson();
  downloadText(`gbguqin-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
  ElMessage.success('已导出 IndexedDB 全量 JSON 备份');
}

function pickRestoreFile() {
  fileInput.value?.click();
}

async function handleRestore(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const counts = await importBackup(text);
    await hydrateAll();
    const note = counts.legacy
      ? `旧备份已恢复（板材 ${counts.boards} / 槽腹 ${counts.chambers} / 髹漆 ${counts.lacquers} / 上弦 ${counts.stringings}），无返工表，按未返工处理，现有返工关联保留`
      : `已恢复备份（板材 ${counts.boards} / 槽腹 ${counts.chambers} / 髹漆 ${counts.lacquers} / 上弦 ${counts.stringings} / 返工 ${counts.reworks}）`;
    ElMessage.success(note);
  } catch (error) {
    ElMessage.error(`恢复失败（数据未改动）：${(error as Error).message}`);
  }
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="208px" class="app-aside">
      <div class="brand">
        <div class="brand-title">古琴斫制工序记录台</div>
        <div class="brand-sub">gbguqin · 纯前端本地存储</div>
      </div>
      <el-menu :default-active="route.path" router class="app-menu" background-color="#4a3728" text-color="#f0e6d8" active-text-color="#ffd591">
        <el-menu-item index="/">琴坯进度</el-menu-item>
        <el-menu-item index="/boards">板材登记</el-menu-item>
        <el-menu-item index="/chambers">槽腹尺寸</el-menu-item>
        <el-menu-item index="/lacquer">灰胎髹漆</el-menu-item>
        <el-menu-item index="/stringing">上弦评价</el-menu-item>
        <el-menu-item index="/rework">返工处置</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <span class="header-title">{{ (route.meta?.title as string) ?? '古琴斫制工序记录台' }}</span>
        <span class="header-actions">
          <el-button :icon="Upload" @click="pickRestoreFile">恢复备份</el-button>
          <el-button :icon="Download" type="primary" @click="handleExport">导出备份</el-button>
          <input ref="fileInput" type="file" accept="application/json,.json" class="hidden-file" @change="handleRestore" />
        </span>
      </el-header>
      <el-main v-loading="!ready" element-loading-text="正在装载本地工序档案…" class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer">数据保存在浏览器 IndexedDB（gbguqin-db），不依赖后端服务</el-footer>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-aside {
  background: #4a3728;
  color: #f0e6d8;
}
.brand {
  padding: 16px 16px 8px;
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
}
.brand-sub {
  font-size: 12px;
  color: #cbb79f;
}
.app-menu {
  border-right: none;
}
.app-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ece0cf;
}
.header-title {
  font-weight: 600;
  color: #4a3728;
}
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.hidden-file {
  display: none;
}
.app-main {
  background: #f7f3ed;
  min-height: 60vh;
}
.app-footer {
  text-align: center;
  color: #a3968a;
  font-size: 12px;
  line-height: 48px;
}
</style>

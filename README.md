# 古琴斫制工序记录台（gbguqin）

面向斫琴师与琴坊档案员：把面板底板材、槽腹尺寸、灰胎髹漆遍次与上弦记录串成可回溯的工序档案；音色评价只用文字填写，不做音频文件与波形处理。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21810>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（6 条业务路由 + 404） |
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore / reworkStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21810
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing（+ ui.ts）
│       ├── stores/            # boardStore / chamberStore / lacquerStore / stringingStore
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── hooks/             # useGuqinFilter / useStageProgress
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer.ts / db.ts / export.ts（+ wood.ts / seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 琴坯进度 | 选材/掏膛/灰胎/上弦四阶段统计、推进比、缺失项与工序动态 |
| `/boards` | 板材登记与配对 | 面板底板配对、含水率回显、厚度差、槽腹剖面标注 |
| `/chambers` | 槽腹尺寸记录 | 纳音/龙池/凤沼三处厚度、槽腹深度、天地柱与龙池凤沼尺寸，SVG 剖面标注 |
| `/lacquer` | 灰胎髹漆遍次 | 按遍次累加厚度、荫房温湿度窗口校验、层积条与养护天数 |
| `/stringing` | 上弦与音色评价 | 散音/按音/泛音三段纯文本评语、九德简述、缺陷标记与版本对照 |
| `/rework` | 返工处置单 | 选琴号/问题工序/责任师傅，留存原值快照并关联髹漆或上弦；复核人填结论后完成，草稿可改 |

## 返工处置规则

- 登记返工单时选择**琴号、问题工序（选材/掏膛/灰胎/上弦）、责任师傅**；确认后对应工序的原值以**快照**留存（不改动原档案），并**关联一条髹漆遍次或上弦记录**（该琴两类记录都不存在时允许不关联）。
- 登记动作（读原值 → 解析关联 → 写返工单）在**同一个 Dexie 事务**内完成，任一环节失败整体回滚，不留下半套档案。
- 登记后返工单为「待复核」：琴坯进度表对应工序标红、显示待复核；**复核人填写结论后返工单才算完成**，此前为草稿、仍可修改责任师傅/问题描述/关联。
- **琴号存在待复核返工时，上弦页不接受该琴的评价**（新增与修改均拒收，页面与 store 双层拦截）。
- 旧备份（无返工表）恢复后原数据照常打开并按**未返工**处理；恢复旧备份**不会清空或覆盖**已有的返工关联。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`reworks`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`db.version(3)` 新增 `reworks` 返工处置单表（只增表、不动旧数据，旧库按未返工处理）。升级前可用顶栏「导出备份」导出全量 JSON。
- 顶栏「恢复备份」可导入 JSON：旧备份（无 `reworks` 字段）只恢复原四表且保留现有返工关联；新备份连返工单整体恢复。
- 首次打开且表为空时写入一批示例工序档案（`src/utils/seed.ts`）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

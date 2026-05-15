# TikTok 数据监控首轮采集报告

采集时间：2026-05-09  
采集方式：Chrome 插件复用当前 TikTok 登录态  
飞书链路：`lark-cli` / 飞书 CLI bot 私信已验证  
数据目录：`monitoring_data/chrome_52_incremental/`，该目录已被 git ignore

## 本轮结论

- 本轮从飞书 wiki 导入 52 条 TikTok 视频 seed。
- 52 条 seed 全部完成真实页面采集并落库。
- 因多个短链跳转到同一个公开视频，去重后得到 27 个唯一视频。
- 已从视频页回填 17 个 TikTok 账号。
- 另有 1 条短链已采到互动数据，但当前公开 DOM 未暴露账号 handle，暂列为 `unknown`。
- 当前公开视频页未稳定暴露播放量字段，所以 `views` 暂记为 `0`；本轮优先使用点赞、评论、分享作为热度参考。
- 本轮最高点赞：164200。
- 本轮最高分享：92900。
- 本轮已通过飞书 CLI 发送采集摘要私信。

## 账号汇总

| 账号 | 视频数 | 点赞合计 | 评论合计 | 分享合计 | 主页 |
|---|---:|---:|---:|---:|---|
| dhdh156ih | 4 | 266700 | 1676 | 61325 | https://www.tiktok.com/@dhdh156ih |
| dhfj2427 | 3 | 50786 | 623 | 20688 | https://www.tiktok.com/@dhfj2427 |
| lptzuju | 3 | 81238 | 570 | 18125 | https://www.tiktok.com/@lptzuju |
| jfkdg142 | 2 | 190300 | 1959 | 133800 | https://www.tiktok.com/@jfkdg142 |
| luoyucm666 | 2 | 112800 | 1140 | 29200 | https://www.tiktok.com/@luoyucm666 |
| bohonry35 | 1 | 2167 | 97 | 1751 | https://www.tiktok.com/@bohonry35 |
| filskoube1 | 1 | 39900 | 264 | 8095 | https://www.tiktok.com/@filskoube1 |
| gareaijbr1 | 1 | 12400 | 206 | 1613 | https://www.tiktok.com/@gareaijbr1 |
| hoyoserik44 | 1 | 5598 | 83 | 399 | https://www.tiktok.com/@hoyoserik44 |
| mveeyy | 1 | 43200 | 257 | 7885 | https://www.tiktok.com/@mveeyy |
| skylark3733 | 1 | 61700 | 341 | 18400 | https://www.tiktok.com/@skylark3733 |
| sshuchu1519 | 1 | 81200 | 397 | 12000 | https://www.tiktok.com/@sshuchu1519 |
| user1485235158504 | 1 | 92800 | 726 | 40200 | https://www.tiktok.com/@user1485235158504 |
| user4403712169529 | 1 | 64600 | 694 | 16600 | https://www.tiktok.com/@user4403712169529 |
| user4902091125876 | 1 | 13000 | 213 | 3402 | https://www.tiktok.com/@user4902091125876 |
| user5457920938123 | 1 | 4115 | 85 | 525 | https://www.tiktok.com/@user5457920938123 |
| user772961973731 | 1 | 41600 | 402 | 4592 | https://www.tiktok.com/@user772961973731 |
| unknown | 1 | 112400 | 483 | 13400 | 待二次解析 |

## 视频明细

| 排名 | 账号 | 视频 | 点赞 | 评论 | 分享 |
|---:|---|---|---:|---:|---:|
| 1 | dhdh156ih | https://www.tiktok.com/@dhdh156ih/video/7621472014431194382 | 164200 | 1008 | 39900 |
| 2 | unknown | https://www.tiktok.com/t/ZTk7HKaYa | 112400 | 483 | 13400 |
| 3 | jfkdg142 | https://www.tiktok.com/@jfkdg142/video/7615957873037724942 | 99900 | 1369 | 92900 |
| 4 | user1485235158504 | https://www.tiktok.com/@user1485235158504/video/7637716663382592781 | 92800 | 726 | 40200 |
| 5 | jfkdg142 | https://www.tiktok.com/@jfkdg142/video/7615240146257988877 | 90400 | 590 | 40900 |
| 6 | sshuchu1519 | https://www.tiktok.com/@sshuchu1519/video/7616676617892498701 | 81200 | 397 | 12000 |
| 7 | lptzuju | https://www.tiktok.com/@lptzuju/video/7611013245649898766 | 68800 | 397 | 12300 |
| 8 | user4403712169529 | https://www.tiktok.com/@user4403712169529/video/7637669034942631182 | 64600 | 694 | 16600 |
| 9 | luoyucm666 | https://www.tiktok.com/@luoyucm666/video/7637717793424559374 | 62000 | 602 | 18600 |
| 10 | skylark3733 | https://www.tiktok.com/@skylark3733/video/7629320944359689486 | 61700 | 341 | 18400 |
| 11 | dhdh156ih | https://www.tiktok.com/@dhdh156ih/video/7622616911242661133 | 52400 | 226 | 7985 |
| 12 | luoyucm666 | https://www.tiktok.com/@luoyucm666/video/7636112054373321998 | 50800 | 538 | 10600 |
| 13 | mveeyy | https://www.tiktok.com/@mveeyy/video/7634082176471960839 | 43200 | 257 | 7885 |
| 14 | dhfj2427 | https://www.tiktok.com/@dhfj2427/video/7619784592651816206 | 41700 | 569 | 17300 |
| 15 | user772961973731 | https://www.tiktok.com/@user772961973731/video/7637669522857643278 | 41600 | 402 | 4592 |
| 16 | filskoube1 | https://www.tiktok.com/@filskoube1/video/7633554432621432085 | 39900 | 264 | 8095 |
| 17 | dhdh156ih | https://www.tiktok.com/@dhdh156ih/video/7605602654894525709 | 26100 | 187 | 4168 |
| 18 | dhdh156ih | https://www.tiktok.com/@dhdh156ih/video/7624535892379618574 | 24000 | 255 | 9272 |
| 19 | user4902091125876 | https://www.tiktok.com/@user4902091125876/video/7637668769279642893 | 13000 | 213 | 3402 |
| 20 | gareaijbr1 | https://www.tiktok.com/@gareaijbr1/video/7636476293357325581 | 12400 | 206 | 1613 |
| 21 | lptzuju | https://www.tiktok.com/@lptzuju/video/7610407382857927949 | 9210 | 132 | 5080 |
| 22 | dhfj2427 | https://www.tiktok.com/@dhfj2427/video/7624225426008722702 | 6317 | 49 | 3264 |
| 23 | hoyoserik44 | https://www.tiktok.com/@hoyoserik44/video/7632739703682239761 | 5598 | 83 | 399 |
| 24 | user5457920938123 | https://www.tiktok.com/@user5457920938123/video/7637424519824542989 | 4115 | 85 | 525 |
| 25 | lptzuju | https://www.tiktok.com/@lptzuju/video/7604849358521027854 | 3228 | 41 | 745 |
| 26 | dhfj2427 | https://www.tiktok.com/@dhfj2427/video/7611954888947322125 | 2769 | 5 | 124 |
| 27 | bohonry35 | https://www.tiktok.com/@bohonry35/video/7614123985097313566 | 2167 | 97 | 1751 |

## 高优先级观察

1. `jfkdg142` 值得优先监控：仅 2 条视频合计分享 133800，说明转发扩散强。
2. `dhdh156ih` 值得纳入账号级高频采集：本轮有 4 条不同视频，合计点赞 266700。
3. `luoyucm666`、`lptzuju`、`dhfj2427` 也有多条视频命中，适合作为第一批账号监控对象。
4. `unknown` 短链虽然账号未解析，但互动数据很高，需做二次解析或人工打开确认。
5. 播放量字段目前未稳定出现在公开视频 DOM，需要暂时用点赞、评论、分享做热度评分；后续如果页面结构或登录态可见播放量，再加入播放增长阈值。

## 本轮问题与处理

### 超时原因

最初尝试 12 条一批时，单次 Chrome 插件调用超过工具约 120 秒上限。采集器此前是整批结束后一次性写入快照，所以超时后没有落盘。

### 解决方式

- 改为 4 条一批采集，每批结束即写入快照。
- 对 Chrome extension 真实采集不调用 `nameSession()`，避免触发当前窗口不支持的 tab grouping。
- 单条短链导航超时后不影响整批，后续单独重试。

### 标签页管理

- 每批最多使用 2 个采集页签。
- 采集页签由 ledger 管理和清理。
- 未关闭用户原本已打开的标签页。

## 后续规划

### 阶段 1：同等级账号池

- 本轮回填的 17 个账号全部按同等级监控，不再分 P0/P1/P2。
- 所有 `enabled=true` 且非 stale 的账号每 3 小时采集一次。
- 每个账号默认尽量采集最近 60 条公开视频；实际数量受 TikTok 页面公开可见和滚动加载限制。
- 超过 60 天未更新账号标记 `stale`，不进入高频采集。

### 阶段 2：两本书关键词发现

- 第一版只扩展两本书相关账号：`People Skills` 和 `Raise Children Street Smart`。
- 搜索关键词固定为 6 个：
  - `People Skills book`
  - `people skills connection success`
  - `master people skill master your life`
  - `Raise Children Street Smart`
  - `Street Smart children book`
  - `children street smart book`
- 发现结果先写入 `monitoring_data/seeds/account_candidates.json`，状态为候选；确认后再进入正式账号池。
- Chrome 搜索发现已加单关键词硬超时，避免一个关键词卡住导致整批断开。

### 阶段 3：增长监控

- 同一视频至少有两次快照后计算增量。
- 播放量优先：
  - 3 小时播放增量 >= 3000
  - 24 小时播放增量 >= 10000
- 播放量缺失时使用互动兜底：
  - 3 小时点赞增量 >= 3000
  - 3 小时分享增量 >= 500
  - 3 小时评论增量 >= 100
- 同一视频 24 小时只提醒一次，除非评分等级升高。

### 阶段 4：店铺和商品监控

- 从视频详情页、商品锚点、橱窗入口解析 `productRefs`、`shopUrl`、`productUrl`。
- 发现店铺后写入 `monitoring_data/seeds/shops.json`。
- 公开页可读时采集商品标题、价格、销量、评论数、评分。
- 当前这一轮未从公开视频 DOM 中解析到可用商品/店铺链接，所以店铺商品表暂为空。

### 阶段 5：飞书看板和提醒

- 已创建飞书 Base 看板：[TikTok 图书素材监控看板](https://gah4srxbgfr.feishu.cn/base/LMjpbWd5vaKYGvsSYbTcOycunY7)。
- 已创建表：`账号池`、`视频快照`、`增长信号`、`店铺商品`。
- 已同步本轮数据：17 个账号、27 个唯一视频。
- 视图已创建并配置基础筛选：`正在跟踪账号`、`待确认账号候选`、`今日突增视频`、`发现的店铺/商品`、`已发送提醒`。
- 测试期飞书提醒继续只私发给你，群组提醒暂不启用。

### 阶段 6：接入素材生产链路

- 高分视频写入 `monitoring_data/leads/`。
- lead 中保存原视频链接、账号、指标快照、增长原因和建议拆解方向。
- 后续把 lead 转成现有内容生产流程输入：脚本收集、分镜拆解、图像 prompt、视频 prompt、CapCut 手动导入资产包。

## 当前阻塞和下一步

1. Chrome extension 插件会话在第二批搜索发现中出现过临时超时/旧标签句柄问题；后续按“临时调用失败”处理，不再中断整轮任务。
2. 已完成代码侧防护：每个搜索关键词独立超时并记录 failure，不再让整批任务卡到工具 120 秒上限。
3. 继续按单关键词或每批 1-2 个关键词跑搜索发现。
4. 发现候选账号后同步到飞书 Base 的 `待确认账号候选` 视图，再按规则合并进正式账号池。

## 2026-05-09 补充采集：账号主页 grid 扩展

采集方式：Chrome 插件，单标签页顺序采集账号主页公开视频 grid。

目的：先扩大每个账号的视频覆盖面，不只记录 wiki 里的少量 seed 视频；详情页互动数据后续再对高分/突增视频补采。

结果：

- 覆盖正式账号：17 个。
- 本轮新增主页 grid 快照：521 条唯一视频。
- 飞书 Base `视频快照` 表已批量写入 497 条新视频；加上首轮详情采集，当前视频表合计 524 条。
- 飞书 Base `账号池` 的 `最近视频数` 已更新为本轮主页覆盖数量。
- 两本书 6 个搜索关键词均已跑完，暂未发现满足“书相关 + 带货线索”的新账号候选。

账号主页覆盖数量：

| 账号 | 主页视频数 |
|---|---:|
| gareaijbr1 | 37 |
| skylark3733 | 37 |
| bohonry35 | 36 |
| dhdh156ih | 36 |
| dhfj2427 | 35 |
| luoyucm666 | 35 |
| user1485235158504 | 35 |
| user4403712169529 | 35 |
| user4902091125876 | 35 |
| user5457920938123 | 35 |
| user772961973731 | 35 |
| hoyoserik44 | 31 |
| lptzuju | 26 |
| filskoube1 | 25 |
| sshuchu1519 | 20 |
| mveeyy | 17 |
| jfkdg142 | 11 |

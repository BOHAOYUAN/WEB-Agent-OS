/**
 * A/B fixtures for the Brain `denoise` task.
 *
 * Denoising is a much easier task than memory summarization: the model only
 * has to DELETE boilerplate, not decide what is a confirmed fact versus a
 * plan. That is exactly why it is worth measuring separately — a model that
 * fails the memory gate can still be perfectly good here.
 *
 * Fixtures are SYNTHETIC pages written to resemble real captures (nav chrome,
 * recommendation rails, comment sections, legal footers). Not scraped data.
 */

export interface DenoiseFixture {
  id: string;
  title: string;
  /** Noisy page text, as a content-script extractor would see it. */
  input: string;
  expected: {
    /** Keywords that must survive into `body`. */
    keep: string[];
    /** Noise keywords that must NOT survive into `body`. */
    drop: string[];
  };
}

export const DENOISE_FIXTURES: DenoiseFixture[] = [
  {
    id: "d01-webgpu-blog",
    title: "技术博客：WebGPU 入门",
    input: `首页 分类专栏 会员 下载 直播 搜索 登录 注册
WebGPU 开发 > 正文

【免费直播】大模型时代的前端性能优化，点击报名
广告 · 本机 GPU 云主机首年 1 折

在浏览器里跑 Transformer：WebGPU 实战笔记

作者：某某某  发布于 2026-03-11  阅读量 3.2 万  收藏 128  点赞 45

WebGPU 是 WebGL 的继任者，它直接暴露现代图形 API 的能力。本文记录我在 Chrome 133 上把一个 1.5B 模型搬到浏览器里跑通的全过程。

第一步是探测后端。navigator.gpu.requestAdapter() 返回的 adapter 可能为 null，这时必须回退到 WASM，否则页面会直接白屏。

第二步是着色器编译。首次编译大概需要 200 毫秒到 2 秒，取决于模型大小。实测在核显上比独显慢 3 到 5 倍。

第三步是权重加载。1.5B 的 q4 量化权重约 1GB，第一次必须下载，之后缓存进 IndexedDB。这里有个坑：MV3 的 CSP 会阻止从 CDN 动态加载脚本，所以运行时文件必须打包进扩展。

结论：WebGPU 在独显上比 WASM 快 10 到 100 倍，但必须有回退路径。

相关推荐
- 前端性能优化的 10 个技巧
- 大模型推理成本优化指南
- 2026 年前端框架排行榜
热门榜单
1. 某框架源码解析
2. 某厂面试八股文
3. 某工具链配置教程

评论区（328 条）
用户A：写得很好，收藏了
用户B：求源码
用户C：核显能跑吗？我试了一下很卡
用户D：广告能不能少一点

© 2026 某技术社区 版权所有 京 ICP 备 12345678 号
关于我们 招聘 广告合作 联系我们 隐私政策 用户协议`,
    expected: {
      keep: ["WebGPU", "requestAdapter", "WASM", "IndexedDB", "CSP", "1GB"],
      drop: ["版权所有", "相关推荐", "评论区", "广告", "登录", "热门榜单", "ICP"],
    },
  },
  {
    id: "d02-orders-page",
    title: "电商后台：订单列表页",
    input: `某电商平台 卖家中心
首页 | 商品管理 | 交易管理 | 客服 | 数据 | 设置  你好，商家_8823  退出
消息(12)  充值  帮助中心

订单管理 > 全部订单

筛选：下单时间 [2026-09-01 至 2026-09-30]  订单状态 [全部]  关键字搜索 [搜索]
[查询] [重置] [导出报表]

共 1286 条订单，当前第 1 页，共 26 页

订单号 | 商品 | 数量 | 金额 | 状态 | 操作
20260901001 | 机械键盘 87 键 | 2 | ¥458.00 | 已完成 | 详情
20260901002 | 无线鼠标 | 1 | ¥129.00 | 已发货 | 详情
20260901003 | 显示器支架 | 1 | ¥299.00 | 待发货 | 详情
20260902004 | USB-C 扩展坞 | 3 | ¥537.00 | 已完成 | 详情
20260902005 | 人体工学椅 | 1 | ¥1899.00 | 已退款 | 详情

上一页 1 2 3 4 5 ... 26 下一页

温馨提示：批量导出每次最多 5000 条，超过请分次操作。导出文件 30 天后自动清理。
系统公告：10 月 1 日至 10 月 7 日结算延迟，请提前安排资金。
促销活动：参加双十一报名，流量扶持最高 50%！立即报名

客服热线 400-000-0000  在线客服  意见反馈
© 2026 某电商平台 版权所有  营业执照  网络文化经营许可证`,
    expected: {
      keep: ["1286", "26", "20260901001", "机械键盘", "458", "5000"],
      drop: ["版权所有", "系统公告", "促销活动", "客服热线", "退出", "营业执照"],
    },
  },
  {
    id: "d03-docs-page",
    title: "文档页：Chrome 扩展 Offscreen Document",
    input: `Chrome 开发者文档
搜索文档  English  登录

扩展开发 > Manifest V3 > API 参考

Offscreen documents

版本要求：Chrome 109 及以上

离屏文档让扩展可以在不干扰用户的情况下使用 DOM 或需要窗口的 API。Service worker 没有 DOM，因此无法直接使用这些 API。

创建方法：
const existingContexts = await chrome.runtime.getContexts({});
const offscreenDocument = existingContexts.find((c) => c.contextType === 'OFFSCREEN_DOCUMENT');
if (!offscreenDocument) {
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'reason for needing the document',
  });
}

限制：
- reasons 必须是合法枚举值，否则创建会被拒绝
- 每次只能有一个离屏文档
- 离屏文档的生命周期由扩展控制，用完应当关闭

本页面对您有帮助吗？ [是] [否]

相关文档
- Service worker 生命周期
- 消息传递
- 内容脚本

贡献者：A、B、C
最后更新：2026-07-22
本作品采用知识共享署名 4.0 国际许可协议许可  |  隐私权  |  使用条款`,
    expected: {
      keep: ["109", "createDocument", "reasons", "OFFSCREEN_DOCUMENT", "Service worker"],
      drop: ["本页面对您有帮助吗", "相关文档", "贡献者", "许可协议", "隐私权", "使用条款", "登录"],
    },
  },
  {
    id: "d04-forum-thread",
    title: "论坛帖：MV3 迁移踩坑",
    input: `开发者论坛 > 浏览器扩展 > 全部主题
[发帖] [我的帖子] [精华区]  搜索  通知(3)  用户中心  退出登录

[置顶] 版规：发帖前请先搜索，重复帖将删除
[公告] 论坛将于下周二维护，届时无法访问

MV3 迁移踩坑记录，附解决方案

楼主 发表于 2026-05-04 最后回复 2026-05-20 · 42 回复

背景：我们的扩展从 MV2 迁到 MV3，service worker 会在 30 秒空闲后被卸载，导致内存里的状态全部丢失。

坑一：定时器不可靠。setTimeout 在 worker 被卸载后不会触发。解决方案是用 chrome.alarms，最小间隔 30 秒。

坑二：无法使用 DOM。需要解析 HTML 时改用 DOMParser（在 offscreen 里）或者退化到正则。

坑三：远程代码被禁。所有依赖必须打包进扩展，不能从 CDN 加载。这一条最折腾，我们把一个 3MB 的库换成了 200KB 的替代品。

坑四：请求拦截必须用 declarativeNetRequest，webRequest 的阻塞式监听没了。

[回复 1] 感谢分享，坑三我们也遇到了
[回复 2] chrome.alarms 最小间隔不是 30 秒吗？
[回复 3] 同问，我们最后改成了常驻 offscreen
[广告位] 云服务器 2 折，限时抢购

上一页 1 2 3 下一页  跳转到第 [ ] 页
版权所有 © 2026 开发者论坛  备案号  联系我们  手机版`,
    expected: {
      keep: ["30 秒", "chrome.alarms", "DOMParser", "CDN", "declarativeNetRequest"],
      drop: ["版规", "公告", "广告位", "上一页", "版权所有", "备案号", "退出登录"],
    },
  },
];

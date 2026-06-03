import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDokobotProfileVideosText,
  parseDokobotVideoDetailText
} from "../src/monitor/dokobot-local.mjs";

test("parseDokobotProfileVideosText extracts profile video urls and mapped view counts from Dokobot text", () => {
  const text = `# TikTok - Make Your Day
> https://www.tiktok.com/@kwokm6554

[3]
**0 [4]**
---
[5]
**3 [6]**
---
[7]
**1 [8]**

[4] https://www.tiktok.com/@kwokm6554/video/7645606630582668557
[6] https://www.tiktok.com/@kwokm6554/video/7645591248262171917
[8] https://www.tiktok.com/@kwokm6554/video/7645311457604766990`;

  assert.deepEqual(parseDokobotProfileVideosText(text), [
    {
      videoUrl: "https://www.tiktok.com/@kwokm6554/video/7645606630582668557",
      views: 0
    },
    {
      videoUrl: "https://www.tiktok.com/@kwokm6554/video/7645591248262171917",
      views: 3
    },
    {
      videoUrl: "https://www.tiktok.com/@kwokm6554/video/7645311457604766990",
      views: 1
    }
  ]);
});

test("parseDokobotVideoDetailText extracts current detail metrics and falls back to provided defaults for missing values", () => {
  const text = `# TikTok - Make Your Day
> https://www.tiktok.com/@user9011549045811/video/7645359494922259725

---
**点赞视频** **0 个赞**
**阅读或添加评论** **0 条评论**
**添加到收藏**
**分享**
---
user9011549045811 [7]
> · 17 小时前

Lost in sales? The secrets top closers will **更多**never share are all in Masterful Conversation`;

  assert.deepEqual(
    parseDokobotVideoDetailText(text, {
      videoUrl: "https://www.tiktok.com/@user9011549045811/video/7645359494922259725",
      accountHandle: "user9011549045811",
      defaultViews: 4800,
      defaultCaption: "previous caption",
      defaultProductRefs: []
    }),
    {
      status: "ok",
      video: {
        accountHandle: "user9011549045811",
        videoUrl: "https://www.tiktok.com/@user9011549045811/video/7645359494922259725",
        views: 4800,
        likes: 0,
        comments: 0,
        shares: 0,
        caption: "previous caption",
        postedAt: undefined,
        productRefs: []
      }
    }
  );
});

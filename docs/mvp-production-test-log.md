# MVP Production Test Log

## 2026-05-10

- Issue: GPT accepted a plain script but stopped after text-only storyboard and prompts.
  Fix: GPT Instructions now require ChatGPT image generation inside the same conversation before asking the operator to continue.

- Issue: Generating four hook first frames in one request produced multi-panel/storyboard images with text.
  Fix: Hook image generation now starts with exactly one standalone 9:16 image; only after a single image passes review can GPT continue one by one.

- Issue: The first selected hotel shot repeatedly drifted into readable hotel signage, robe text, and breakfast balcony imagery.
  Fix: Do not skip S001. Keep script order because the first 5 seconds matter, but rewrite S001 as a stronger graphic-novel money hook: luxury hotel lobby, cash rain/flying money, shocked hotel staff and guests, chandelier/marble floor, no readable text.

- Reference lesson: A separate successful operations conversation showed that batch work can be high quality when GPT first preserves/splits the original copy, defines unified characters, and uses structured prompt fields for each shot.
  Fix: GPT now supports script-dependent small-batch ChatGPT image generation from S001 onward. Batch count is chosen per script, not fixed at 3; every batch must request separate standalone image outputs and fall back to S001 single-image retry if the provider returns a collage/storyboard page.

- Reference lesson: The same operations conversation sometimes shows many generated images in a grid-like page layout. This can mean either multiple independent ChatGPT image outputs shown as thumbnails, or a single image that contains many small storyboard cells.
  Fix: Treat independent image outputs as valid batch generation. Treat a single internal multi-panel image as preview-only: useful for checking style, character consistency, and shot sequence, but not acceptable as Dreamina image-to-video first-frame material. Good preview cells must be regenerated as standalone 9:16 images.

- Formal test issue: The clean GPT accepted a plain script and correctly started from S001, but the first 3-image batch and later S001 retries kept producing one internal multi-panel storyboard image with drawn shot labels. GPT correctly stopped instead of accepting bad material, but it carried planning context and shot IDs into the image tool too strongly.
  Fix: New-script formal generation now starts with a clean standalone S001 image call before any batch. The creative prompt sent to ChatGPT image generation must omit shot IDs, workflow text, long storyboard context, and references such as "left-top preview"; labels may appear only in assistant text outside the image prompt. Batching resumes only after S001 produces a valid independent image.

- Formal retest issue: S001 succeeded as an independent hotel-lobby cash-rain image, but S002 failed after GPT printed the full image prompt into the chat and packed too many hotel-service ideas into one visual. ChatGPT then generated a text-heavy storyboard/table and later a multi-panel labeled image.
  Fix: GPT must invoke image generation with a hidden clean creative prompt first, then output the prompt for records only after self-review. Non-S001 single images should contain one scene and one core action, with only a few supporting props; amenity lists such as breakfast, cleaning, steam, towels, parking, utilities, and service must be split across separate shots instead of compressed into one image.

- Formal retest result after hidden prompt fix: S001 now works reliably enough for the hook gate. GPT accepted only the script, did not print the full prompt before generation, and produced an independent vertical hotel-lobby cash-rain image with no labels or multi-panel layout.
  Remaining blocker: continuing in the same long-script GPT conversation still caused the next image to become a text-heavy multi-panel storyboard page, and the retry entered an unstable/long-running generation state. The same-conversation GPT-only path is therefore not ready for full production beyond the first hook image. The next design decision is required: either isolate ChatGPT image generation into clean per-shot image contexts via automation, or accept manual clean-context image generation for non-S001 shots. Do not tell operators the full auto image workflow is ready until a clean S002/S003 continuation passes.

- Revised diagnosis: the blocker is probably not the single ChatGPT conversation itself. Earlier successful runs used one conversation and still generated useful batches. The stronger cause is prompt contamination: after S001, GPT said it would "拆分全片分镜" and then sent prompts that mixed planning language, continuation status, shot IDs, and overloaded hotel-service details. This made the image tool render a storyboard/table.
  Fix direction: GPT should maintain an internal prompt bank. After "继续", it automatically uses only the next `image_prompt_clean` values for generation. The full prompt bank, shot IDs, Dreamina video prompts, naming list, and review notes are shown only after images pass. The first continuation test should target S001-S003: S001 hotel cash-rain hook, S002 hotel-suite breakfast service, S003 housekeeping/clean-sheets service, each as one continuous scene.

## 2026-05-11

- Formal retest result after internal prompt bank / clean prompt fix: the GPT accepted only the raw script, did not require technical instructions from the operator, and began with the expected short status: "已识别脚本，先生成首段钩子第 1 张正式图。" It generated S001 as "豪华酒店中的钱雨" instead of printing a full storyboard or prompt bank first.
  Status: S001 gate behavior is fixed at the workflow level.

- Continuation retest result: after the operator sent only "继续", GPT did not output "全片拆分", a full prompt bank, a numbered storyboard table, or Dreamina records first. It generated the next formal image as "豪华酒店早餐时光", then continued generating another formal image.
  Status: the main continuation prompt-contamination issue is significantly improved.

- New observation: during continuation, ChatGPT returned multiple images/variants with repeated titles such as "豪华酒店早餐时光" and "阳光下的豪华酒店房间". This may be independent image variants rather than a single internal multi-panel image, but it weakens the "one script beat per image" discipline and should be tightened before full production.
  Fix direction: update GPT rules so each continuation batch can contain multiple images only when each image is a distinct next script beat. Do not ask for repeated variants of the same beat unless the previous image failed review or the operator explicitly asks for alternatives.

- Tooling issue: after several image generations, the Codex Chrome plugin could still list/claim the ChatGPT tab, but DOM and screenshot reads repeatedly timed out. `npm run chrome:ready` successfully restarted the extension host, but the busy generated-image page still timed out on deep DOM/screenshot reads.
  Operational impact: this does not prove GPT failed, but Codex supervision cannot reliably inspect the page once the image-heavy conversation becomes busy. Keep the live ChatGPT tab open for human visual review, and treat Codex's current verification as workflow-level rather than final visual acceptance.

- Rule update: added a hard continuation rule to local docs and the live GPT Instructions: after "继续", batch images must advance different next script beats in order. GPT must not generate several variants of the same beat just to satisfy a batch size; variants are only for failed review or explicit operator requests.
  Verification: editor page shows the new rules in GPT Instructions and the GPT update was saved.

- Fresh retest after rule update: a new GPT conversation with only the raw script again produced the expected short status and S001 image title "豪华大堂中的财经风暴" without exposing full storyboard or prompt bank.
  Remaining verification gap: the next "继续" run could not be read to completion because the Chrome plugin timed out on the image-heavy page. This is a supervision tooling gap, not yet a confirmed GPT content failure. Human visual review of the live tab is still required before declaring full S001-S003 visual pass.

- Browser supervision fix: kept the official Codex Chrome plugin path but changed the execution contract to `codex-chrome-short-step-dom-first-v1`. The policy is now written into ChatGPT session/task manifests, provider task manifests, App run logs, and `npm run chrome:ready` output.
  Operational rule: use short DOM/media reads before screenshots, avoid full-page screenshots and long polling loops on image-heavy pages, recover with `npm run chrome:ready` after a timeout, and keep the live tab for human review when Codex cannot inspect it reliably.

- TikTok monitoring alignment: the TikTok monitoring plan must use the same short-step policy. It should checkpoint after each page/tab state transition and must not monitor by repeated screenshots or one long browser loop.

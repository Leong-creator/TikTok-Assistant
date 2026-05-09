# Prompt Presets

## Base Style

All presets inherit:

> American semi-realistic comic illustration, modern graphic novel look, cinematic everyday lighting, warm soft side light, clean bold ink lines, realistic body proportions, sharp 4K detail.

## Presets

### `american-comic-realistic`

Default story style for reference-video-like TikTok clips. Use for general scenes when the product category is unclear.

### `business-storyboard`

Use for hotel, office, restaurant, car, rent, debt, cash, contract, and business-model stories.

### `parenting-book`

Use for parenting and education books, especially reference-video style street-smart family stories. Scenes should start with adult home conflict or mentor advice when the script is about boundaries, then transition into children learning practical judgment and book/product shots.

### `people-skill-drama`

Use for social intelligence, office politics, public interactions, awkward conflict, and relationship strategy.

### `money-contrast`

Use for debt pain, money contrast, wealth dream, systems thinking, and business opportunity stories.

### `stick-figure-info`

Fallback stable style for fast, low-risk information scenes.

## Review Rules

Each prompt must preserve:

- 9:16 vertical layout.
- Single coherent scene.
- No collage panels.
- No visible text in any language in generated images.
- Clear adult character action or clear object/symbol focus.
- Full-frame composition with no provider-requested caption or bottom space.

## ChatGPT Web Image Prompt Contract

Use this contract for ChatGPT web image generation. It is different from Dreamina prompts because ChatGPT is also a conversational model; if the request looks like a planning task, it may answer with text instead of generating images.

Before sending any prompt built from this contract, explicitly select ChatGPT's image-generation tool in the Codex Chrome plugin session. Plain chat mode is not acceptable for this provider.

### Single Image Template

```text
Create one image now.

Output: one standalone 9:16 vertical full-frame image. Do not create a collage, storyboard page, split screen, panel grid, picture-in-picture, or sequence.
Style: American semi-realistic graphic novel / premium TikTok story-ad illustration, cinematic warm light, realistic adult proportions, high-detail 4K look, clean stable composition.
Subject type: <person | object | person_and_object>.
Shot intent: <one sentence explaining what the viewer must understand without audio>.
Camera/composition: <shot size, angle, foreground/midground/background, motion feel for later Ken Burns>.
Characters: <fixed character identities and appearance needed for this shot>.
Action/relationship: <what each main subject is doing and where they are placed>.
Micro-expression: <emotion and tension that creates curiosity/conflict>.
Background: <US-local scene details and relevant props>.
Lighting/dynamics: <light direction, mood, visible movement or money/status contrast>.
Negative constraints: no visible words, letters, numbers, captions, speech bubbles, logos, watermarks, subtitles, blank bottom band, extra limbs, distorted faces, or unrelated scenes.
```

### Batch Template

Only batch after the single-image template has produced clean standalone images in the same conversation. Start with 2-3 images. Increase to 5/10 only after the page returns separate image outputs consistently.

```text
Create <N> separate images now, one image per item below.

Global output rules: each item must be a separate standalone 9:16 vertical image. Do not combine the images into one storyboard page, collage, grid, split screen, panel page, or sequence. Do not draw item labels or shot IDs inside the image.
Global style: <same fixed style block>.
Global characters: <fixed character identities used across this batch>.

Image 1:
Subject type: ...
Shot intent: ...
Camera/composition: ...
Action/relationship: ...
Micro-expression: ...
Background: ...
Lighting/dynamics: ...
Negative constraints: ...

Image 2:
...
```

### Lessons From The ChatGPT Web Test

- "Use ChatGPT web image generation" is too indirect. Start with `Create one image now` or `Create N separate images now`.
- Do not put review policy, tool policy, provider notes, or long script context in the generation prompt. Keep those in Codex logs and manifests.
- Batch prompts that list several shot IDs can make ChatGPT produce one combined storyboard page. Use `Image 1`, `Image 2`, etc. in the creative prompt and keep shot IDs outside the image body.
- The useful structure from the reference conversation is: fixed character bible first, then per-shot fields for subject, camera, action, micro-expression, setting, dynamics, and style. That structure should be compiled before generation, not improvised in the browser.
- If the page answers with prompt analysis instead of images, the provider step failed. Retry with the image tool selected and a shorter single-image prompt before expanding the batch.

## Dreamina 4.0 Prompt Rule

Use a Chinese-only provider prompt for Dreamina `4.0`. Avoid English, numbers, shot labels, and wording that sounds like a poster, cover, ad layout, comic page, speech bubble, or interface. The tested stable direction is closer to "vertical single-frame cinematic illustrated still" than "comic/storyboard".

## Hook Strength Lessons

- Money/business opening images must be scroll-stopping, not merely accurate. Prefer flying cash, shocked reactions, dramatic luxury contrast, commission checks, contracts, expensive cars, high-status rooms, or clear before/after status shifts.
- A calm hotel lobby or comfortable suite can explain the story but may be weaker than a cash/status/conflict image for the first shot. Use calm lifestyle frames later after the hook is established.
- If the original or reference video uses a stronger lure such as cash rain, a generated image that only shows a calm luxury setting should fail review even if it matches the sentence literally.
- Broad money keywords need semantic routing. "Commission" can mean real estate, luxury-car sales, referral kickback, or family negotiation; choose the visual business context before choosing props.
- Do not reserve blank bottom areas for subtitles. Later editing places subtitles over the image, so generated stills should stay visually complete from top to bottom.
- When a generated image fails, preserve the reusable lesson in the review log and update this preset document if it affects future scripts.

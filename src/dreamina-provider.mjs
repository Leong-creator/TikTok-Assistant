export function buildDreaminaText2ImageArgs({ prompt, dreamina }) {
  const args = [
    "text2image",
    `--prompt=${prompt}`,
    `--ratio=${dreamina.ratio}`,
    `--resolution_type=${dreamina.resolutionType}`,
    `--poll=${dreamina.pollSeconds}`
  ];
  if (dreamina.modelVersion) {
    args.push(`--model_version=${dreamina.modelVersion}`);
  }
  if (dreamina.sessionId) {
    args.push(`--session=${dreamina.sessionId}`);
  }
  return args;
}

export async function runDreaminaQueue({ items, concurrency = 1, worker }) {
  const safeConcurrency = Math.max(1, Math.trunc(Number(concurrency) || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      try {
        const value = await worker(item, index);
        results[index] = { status: "fulfilled", item, value };
      } catch (error) {
        results[index] = {
          status: "rejected",
          item,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  const workers = [];
  for (let index = 0; index < Math.min(safeConcurrency, items.length); index += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

export function nextDreaminaConcurrency({ current, error }) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/timeout|timed out|429|rate|too many|限流|超时/i.test(message)) {
    return 1;
  }
  return Math.max(1, Math.trunc(Number(current) || 1));
}

export function extractDreaminaSessionId(output) {
  const text = String(output ?? "");
  const jsonId = text.match(/"id"\s*:\s*(\d+)/i);
  if (jsonId) return jsonId[1];
  const labeledId = text.match(/(?:session[_\s-]*id|id)["'\s:=]+(\d+)/i);
  if (labeledId) return labeledId[1];
  const firstNumber = text.match(/\b\d{3,}\b/);
  return firstNumber ? firstNumber[0] : "";
}

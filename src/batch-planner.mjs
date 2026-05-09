export function createBatchPlanner(options = {}) {
  const initialSize = clampBatchSize(options.initialSize ?? 3);
  const maxSize = clampBatchSize(options.maxSize ?? 10);
  let currentSize = Math.min(initialSize, maxSize);

  return {
    nextBatchSize() {
      return currentSize;
    },
    recordBatchResult(result) {
      const requested = Number(result?.requested ?? currentSize);
      const accepted = Number(result?.accepted ?? 0);
      const qualityOk = Boolean(result?.qualityOk);
      if (!qualityOk || accepted < requested) {
        currentSize = 1;
        return;
      }
      if (currentSize === 1) {
        currentSize = Math.min(initialSize, maxSize);
        return;
      }
      if (currentSize < 5 && maxSize >= 5) {
        currentSize = 5;
        return;
      }
      currentSize = maxSize;
    }
  };
}

function clampBatchSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(Math.trunc(number), 10);
}

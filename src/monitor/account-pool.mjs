export function mergeCompetitorAccounts({ accounts = [], accountCandidates = [] } = {}) {
  const byHandle = new Map();

  for (const source of [accounts, accountCandidates]) {
    for (const account of source) {
      const handle = String(account?.handle ?? "").trim();
      if (!handle) continue;
      const current = byHandle.get(handle);
      byHandle.set(handle, mergeAccountRecord(current, account));
    }
  }

  return [...byHandle.values()].sort((left, right) => left.handle.localeCompare(right.handle));
}

function mergeAccountRecord(current, incoming) {
  const firstDiscoveredAt = earliestTimestamp(current?.firstDiscoveredAt, incoming?.firstDiscoveredAt);
  const lastDiscoveredAt = latestTimestamp(current?.lastDiscoveredAt, incoming?.lastDiscoveredAt);
  return {
    id: current?.id ?? incoming?.id,
    handle: incoming.handle ?? current?.handle,
    profileUrl: current?.profileUrl ?? incoming?.profileUrl,
    enabled: current?.enabled !== false || incoming?.enabled !== false,
    sourceQueries: mergeUniqueStrings(current?.sourceQueries ?? [current?.sourceQuery], incoming?.sourceQueries ?? [incoming?.sourceQuery]),
    relatedBooks: mergeUniqueStrings(current?.relatedBooks, incoming?.relatedBooks),
    hasCommerce: Boolean(current?.hasCommerce || incoming?.hasCommerce),
    evidenceUrls: mergeUniqueStrings(current?.evidenceUrls, incoming?.evidenceUrls),
    firstDiscoveredAt,
    lastDiscoveredAt
  };
}

function mergeUniqueStrings(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function earliestTimestamp(...values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (!timestamps.length) return values.find(Boolean);
  return new Date(Math.min(...timestamps)).toISOString();
}

function latestTimestamp(...values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (!timestamps.length) return values.find(Boolean);
  return new Date(Math.max(...timestamps)).toISOString();
}

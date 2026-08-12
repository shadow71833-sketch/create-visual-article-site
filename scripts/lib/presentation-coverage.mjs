function factIdSet(groups) {
  return new Set(groups.flatMap((group) => Array.isArray(group) ? group : []));
}

function coverage(matched, total) {
  if (total === 0) return 1;
  return Number((matched / total).toFixed(6));
}

export function auditPresentationCoverage(articlePackage) {
  const requiredFactIds = new Set((articlePackage?.facts ?? []).map((fact) => fact?.id).filter(Boolean));
  const panelsById = new Map((articlePackage?.comic?.panels ?? []).map((panel) => [panel?.id, panel]));
  const onePageFactIds = factIdSet([
    ...(articlePackage?.onePage?.metrics ?? []).map((metric) => metric?.factIds),
    ...(articlePackage?.onePage?.modules ?? []).flatMap((module) => (module?.items ?? []).map((item) => item?.factIds)),
  ]);
  const comicFactIds = factIdSet((articlePackage?.comic?.pages ?? []).flatMap((page) => {
    if (page?.format === "editorial") {
      return (page.rows ?? []).flatMap((row) => (row?.panelIds ?? []).map((panelId) => panelsById.get(panelId)?.factIds));
    }
    return (page?.subtitles ?? []).map((subtitle) => subtitle?.factIds);
  }));
  const missingOnePageFactIds = [...requiredFactIds].filter((factId) => !onePageFactIds.has(factId));
  const missingComicFactIds = [...requiredFactIds].filter((factId) => !comicFactIds.has(factId));

  return {
    requiredFactCount: requiredFactIds.size,
    onePageFactCoverage: coverage(requiredFactIds.size - missingOnePageFactIds.length, requiredFactIds.size),
    comicFactCoverage: coverage(requiredFactIds.size - missingComicFactIds.length, requiredFactIds.size),
    missingOnePageFactIds,
    missingComicFactIds,
  };
}

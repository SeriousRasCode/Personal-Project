export function scrollMetrics(
  top: number,
  viewport: number,
  content: number,
  track: number,
) {
  const range = Math.max(0, content - viewport);
  const progress = range ? Math.min(1, Math.max(0, top / range)) : 0;
  const thumb = Math.min(
    track,
    Math.max(36, content ? (track * viewport) / content : track),
  );
  return {
    progress,
    thumb,
    offset: progress * Math.max(0, track - thumb),
    range,
  };
}

export type PanelWheelEvent = {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  preventDefault(): void;
  stopPropagation(): void;
};

export type PanelScrollTarget = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

export type PanelOverflowStyle = {
  overflowX: string;
  overflowY: string;
};

function normalizedWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) return delta * 40;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

function overflowAcceptsWheel(value: string) {
  return value === "auto" || value === "scroll" || value === "overlay";
}

export function panelScrollTargetCanConsumeWheel(
  event: Pick<PanelWheelEvent, "deltaX" | "deltaY">,
  target: PanelScrollTarget,
  style: PanelOverflowStyle,
) {
  return (
    (event.deltaY !== 0 &&
      overflowAcceptsWheel(style.overflowY) &&
      target.scrollHeight > target.clientHeight + 1) ||
    (event.deltaX !== 0 &&
      overflowAcceptsWheel(style.overflowX) &&
      target.scrollWidth > target.clientWidth + 1)
  );
}

export function containWheelInPanel(event: PanelWheelEvent, target: PanelScrollTarget) {
  event.preventDefault();
  event.stopPropagation();

  if (target.scrollWidth > target.clientWidth + 1) {
    target.scrollLeft += normalizedWheelDelta(event.deltaX, event.deltaMode, target.clientWidth);
  }
  if (target.scrollHeight > target.clientHeight + 1) {
    target.scrollTop += normalizedWheelDelta(event.deltaY, event.deltaMode, target.clientHeight);
  }
}

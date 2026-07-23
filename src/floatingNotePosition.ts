export type FloatingNoteAnchorRect = {
  bottom: number;
  targetBottom: number;
  targetX: number;
};

export type FloatingNoteViewportRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type AnchoredFloatingNoteGeometry = {
  connector: {
    angle: number;
    left: number;
    top: number;
    width: number;
  };
  left: number;
  placement: "below";
  top: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function anchoredFloatingNoteGeometry({
  anchorRect,
  cardWidth,
  connectorGap = 18,
  viewportMargin,
  viewportRect,
}: {
  anchorRect: FloatingNoteAnchorRect;
  cardWidth: number;
  connectorGap?: number;
  viewportMargin: number;
  viewportRect: FloatingNoteViewportRect;
}): AnchoredFloatingNoteGeometry {
  const maxPanelLeft = viewportRect.right - viewportMargin - cardWidth;
  const minPanelLeft = viewportRect.left + viewportMargin;
  const preferredLeft = clamp(
    anchorRect.targetX - cardWidth / 2,
    minPanelLeft,
    maxPanelLeft,
  );
  const left = maxPanelLeft >= minPanelLeft ? preferredLeft : minPanelLeft;
  const right = left + cardWidth;
  const top = anchorRect.bottom + connectorGap;
  const sourceX = clamp(anchorRect.targetX, left, right);
  const connectorDeltaX = sourceX - anchorRect.targetX;
  const connectorDeltaY = top - anchorRect.bottom;

  return {
    connector: {
      angle:
        Math.round(Math.atan2(connectorDeltaY, connectorDeltaX) * (180 / Math.PI) * 100) /
        100,
      left: Math.round(anchorRect.targetX),
      top: Math.round(anchorRect.bottom),
      width: Math.round(
        Math.sqrt(
          connectorDeltaX * connectorDeltaX + connectorDeltaY * connectorDeltaY,
        ),
      ),
    },
    left,
    placement: "below",
    top,
  };
}

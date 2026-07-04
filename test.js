const targetX = 200;
const cardWidth = 300;
const viewportMargin = 32;
const viewportWidth = 820;
const preferredLeft = Math.max(viewportMargin, Math.min(targetX - cardWidth / 2, viewportWidth - viewportMargin - cardWidth));
console.log({ preferredLeft });

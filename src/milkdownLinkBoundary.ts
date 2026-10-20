import type { Ctx } from "@milkdown/kit/ctx";
import { linkSchema } from "@milkdown/kit/preset/commonmark";

export function configureLinkBoundary(ctx: Ctx) {
  // The boundary must stay plain after caret movement, reload and undo/redo too.
  ctx.update(linkSchema.key, (previousSchema) => (schemaCtx) => ({
    ...previousSchema(schemaCtx),
    inclusive: false,
  }));
}

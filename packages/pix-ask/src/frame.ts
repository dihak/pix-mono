// Re-export shared modal primitives from pix-pretty.
// pix-ask was the original home of frameLines/modalWidth; moved to pix-pretty
// so gate-overlay and confirm can share the same rounded frame style.

export type { FrameOptions } from "@xynogen/pix-pretty/modal-frame";
export { frameLines, modalWidth } from "@xynogen/pix-pretty/modal-frame";

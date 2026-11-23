import type { Fit } from './pictureFit';

/**
 * The Dim and Blur sliders while they're being dragged, and the picture while it's moved or zoomed:
 * the layout draws the picture with these until they're saved, so the change shows as you go.
 */
export const backgroundPreview = $state<{ dim: number | null; blur: number | null; fit: Fit | null }>({ dim: null, blur: null, fit: null });

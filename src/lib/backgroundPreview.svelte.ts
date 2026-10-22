/**
 * The Dim and Blur sliders while they're being dragged: the layout draws the picture with these
 * until they're saved, so the change shows as you move them.
 */
export const backgroundPreview = $state<{ dim: number | null; blur: number | null }>({ dim: null, blur: null });

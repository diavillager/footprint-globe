declare const __MAPTILER_KEY__: string;
// Browser map keys are public. Configure allowed origins in MapTiler Cloud.
export const mapTilerKey = __MAPTILER_KEY__;
declare const __GEOAPIFY_KEY__: string;
// Explicit public-browser key only; never expose the preview server's GEOAPIFY_API_KEY.
export const geoapifyKey = __GEOAPIFY_KEY__;

/**
 * Optional build-time Gemini API key for static demos (Netlify / Vercel).
 *
 * SECURITY NOTE: Anything placed in frontend code is visible in the browser's DevTools
 * and network tab. If you set a key here, restrict it by HTTP referrer in Google AI Studio /
 * Google Cloud Console and keep tight quota limits.
 *
 * Leave empty ('') to start in offline Demo mode and allow entering a Gemini API key
 * directly in the UI (stored only in the presenter's browser localStorage).
 */
export const DEFAULT_GEMINI_API_KEY = '';

/**
 * Gemini model to use, or 'auto' to pick the best available Flash model for your API key
 * via Google's ListModels endpoint (recommended so deprecated model IDs never break).
 */
export const GEMINI_MODEL = 'auto';

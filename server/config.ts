export type Mode = 'mock' | 'openrouter';

export interface Config {
  mode: Mode;
  port: number;
  openrouterKey: string;
  openrouterBaseUrl: string;
  /** Small, fast model used for classifying prompts and judging answers in openrouter mode. */
  routerModel: string;
}

/** Reads the UNIFIED_AI_* and OPENROUTER_* variables. Never throws: bad values fall back to mock mode with a warning. */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): {
  config: Config;
  warnings: string[];
} {
  const warnings: string[] = [];
  const requested = (env['UNIFIED_AI_MODE'] || 'mock').trim().toLowerCase();
  const key = (env['OPENROUTER_API_KEY'] || '').trim();

  let mode: Mode = 'mock';
  if (requested === 'openrouter') {
    if (key) mode = 'openrouter';
    else
      warnings.push(
        'UNIFIED_AI_MODE=openrouter but OPENROUTER_API_KEY is empty. Falling back to mock mode.',
      );
  } else if (requested !== 'mock') {
    warnings.push(
      `Unknown UNIFIED_AI_MODE "${requested}" (use "mock" or "openrouter"). Falling back to mock mode.`,
    );
  }

  return {
    config: {
      mode,
      port: Number(env['PORT'] || 3000),
      openrouterKey: key,
      openrouterBaseUrl: (env['OPENROUTER_BASE_URL'] || 'https://openrouter.ai/api/v1').replace(
        /\/+$/,
        '',
      ),
      routerModel: env['UNIFIED_AI_ROUTER_MODEL'] || 'google/gemini-2.5-flash',
    },
    warnings,
  };
}

// Pure data, safe to import from client components.
// Every model call in the app speaks the OpenAI chat-completions dialect, so a
// student's own key works as long as their provider offers that endpoint —
// which OpenAI, Anthropic, Google, OpenRouter and most gateways all do. The
// presets only prefill the base URL; any other endpoint can be typed in.
export const LLM_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelHint: "gpt-5-mini", keyHint: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelHint: "claude-haiku-4-5", keyHint: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelHint: "gemini-2.5-flash", keyHint: "AIza…", keysUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", modelHint: "openai/gpt-5-mini", keyHint: "sk-or-…", keysUrl: "https://openrouter.ai/keys" },
] as const;

export function presetFor(baseUrl: string | null | undefined): string {
  const clean = (baseUrl ?? "").replace(/\/+$/, "");
  return LLM_PRESETS.find((p) => p.baseUrl === clean)?.id ?? "custom";
}

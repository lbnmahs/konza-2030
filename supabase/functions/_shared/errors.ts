/** Business error returned to the LLM as {"error": code, "message": ...}. */
export class ToolError extends Error {
  constructor(public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

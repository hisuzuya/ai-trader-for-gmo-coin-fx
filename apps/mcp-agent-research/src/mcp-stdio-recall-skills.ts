export function extractSkills(result: unknown): unknown[] | undefined {
  if (
    isRecord(result) &&
    isRecord(result.structuredContent) &&
    "result" in result.structuredContent
  ) {
    const toolResult = result.structuredContent.result;
    if (Array.isArray(toolResult)) {
      return toolResult;
    }

    if (isRecord(toolResult) && Array.isArray(toolResult.skills)) {
      return toolResult.skills;
    }
  }

  if (isRecord(result) && Array.isArray(result.content)) {
    for (const entry of result.content) {
      if (!isRecord(entry) || entry.type !== "text" || typeof entry.text !== "string") {
        continue;
      }

      try {
        const parsed = JSON.parse(entry.text);
        if (Array.isArray(parsed)) {
          return parsed;
        }

        if (isRecord(parsed) && Array.isArray(parsed.skills)) {
          return parsed.skills;
        }
      } catch {}
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

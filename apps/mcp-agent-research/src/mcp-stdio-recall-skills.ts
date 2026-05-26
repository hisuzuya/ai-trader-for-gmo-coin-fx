export function extractSkills(result: unknown): unknown[] | undefined {
  return findSkills(result, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSkills(value: unknown, depth: number): unknown[] | undefined {
  if (depth > 6) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return findSkills(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    if (isContentArray(value)) {
      for (const entry of value) {
        const found = findSkills(entry, depth + 1);
        if (found) {
          return found;
        }
      }

      return undefined;
    }

    if (isSkillArray(value)) {
      return value;
    }

    for (const entry of value) {
      const found = findSkills(entry, depth + 1);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (Array.isArray(value.skills) && isSkillArray(value.skills)) {
    return value.skills;
  }

  for (const entry of Object.values(value)) {
    const found = findSkills(entry, depth + 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isSkillArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    !isContentArray(value) &&
    (value.length === 0 ||
      value.every(
        (entry) =>
          isRecord(entry) &&
          typeof entry.id === "string" &&
          (typeof entry.scope === "string" || typeof entry.agentId === "string"),
      ))
  );
}

function isContentArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        isRecord(entry) && typeof entry.type === "string" && typeof entry.text === "string",
    )
  );
}

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

  if (isSkillArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return findSkills(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
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
  if (!Array.isArray(value)) {
    return false;
  }

  if (value.length === 0) {
    return true;
  }

  return value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.scope === "string" &&
      typeof entry.title === "string",
  );
}

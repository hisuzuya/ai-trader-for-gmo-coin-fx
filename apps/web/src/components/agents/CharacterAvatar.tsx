import type { AgentCharacter } from "@ai-trade/domain/ai-agents/characters";
import Image from "next/image";

type Size = "xs" | "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = {
  xs: 24,
  sm: 40,
  md: 64,
  lg: 96,
};

export function CharacterAvatar({
  character,
  size = "sm",
  ariaLabel,
}: {
  character: AgentCharacter | null;
  size?: Size;
  ariaLabel?: string;
}) {
  const pixels = SIZE_PX[size];

  if (!character) {
    return (
      <span
        className={`character-avatar size-${size} placeholder`}
        role="img"
        aria-label={ariaLabel ?? "Unassigned character"}
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={`character-avatar size-${size} character-theme-${character.id}`}
      role="img"
      aria-label={ariaLabel ?? `${character.name} avatar`}
      data-character-id={character.id}
    >
      <span className="character-avatar-initial" aria-hidden>
        {character.codename.slice(0, 2)}
      </span>
      <Image
        src={character.avatarPath}
        alt=""
        width={pixels}
        height={pixels}
        className="character-avatar-image"
        unoptimized
      />
    </span>
  );
}

/** Expand bare A/B/C/D replies into the full option text from the prior assistant menu. */

export type LetterChoiceOption = {
  letter: string;
  text: string;
};

const LETTER_OPTION_LINE =
  /^(?:[-*•]\s*)?(?:\*\*)?([A-Ha-h])(?:\*\*)?\s*[:：.、)）]\s*(.+?)\s*$/u;

const BARE_LETTER_CHOICE =
  /^(?:选(?:择)?|选项)?\s*([A-Ha-h])(?:\s*[选项]|项)?\s*[。.、，,]?$/u;

const REPEAT_MENU_COMPLAINT =
  /为什么.*(还是|又是|重复)|还是这[几个些]?问题|又[给端列]?(出|了)?这[几个些]?选项|不要再选|别再问|绕回|循环/u;

export function extractLetterChoiceOptions(content: string): LetterChoiceOption[] {
  const options: LetterChoiceOption[] = [];
  const seen = new Set<string>();
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = LETTER_OPTION_LINE.exec(line);
    if (!match) continue;
    const letter = match[1]!.toUpperCase();
    const text = match[2]!.replace(/\s+/g, " ").trim();
    if (!text || seen.has(letter)) continue;
    seen.add(letter);
    options.push({ letter, text });
  }
  return options;
}

export function matchBareLetterChoice(request: string): string | null {
  const text = String(request || "")
    .trim()
    .replace(/^[“"‘'「『]+|[”"'’」』]+$/gu, "");
  const match = BARE_LETTER_CHOICE.exec(text);
  return match ? match[1]!.toUpperCase() : null;
}

export function isRepeatMenuComplaint(request: string) {
  return REPEAT_MENU_COMPLAINT.test(String(request || "").trim());
}

export function findLetterChoiceMenu(
  messages: readonly { role?: string; content?: string }[],
  letter?: string | null
): LetterChoiceOption[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const options = extractLetterChoiceOptions(String(message.content || ""));
    if (options.length < 2) continue;
    if (letter && !options.some((option) => option.letter === letter)) continue;
    return options;
  }
  return [];
}

export function findLastUserLetterChoice(
  messages: readonly { role?: string; content?: string }[]
): { letter: string; options: LetterChoiceOption[] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const letter = matchBareLetterChoice(String(message.content || ""));
    if (!letter) continue;
    const options = findLetterChoiceMenu(messages.slice(0, index), letter);
    if (!options.length) continue;
    return { letter, options };
  }
  return null;
}

export type ExpandedLetterChoice = {
  request: string;
  expanded: boolean;
  letter?: string;
  optionText?: string;
};

/** Rewrite short letter replies (and repeat-menu complaints) into executable instructions. */
export function expandLetterChoiceRequest(
  request: string,
  messages: readonly { role?: string; content?: string }[] = []
): ExpandedLetterChoice {
  const raw = String(request || "");
  const letter = matchBareLetterChoice(raw);
  if (letter) {
    const options = findLetterChoiceMenu(messages, letter);
    const selected = options.find((option) => option.letter === letter);
    if (selected) {
      return {
        request: [
          `用户选择：${selected.letter} — ${selected.text}`,
          "请立刻执行该选项对应的交付物，不要再列出上一轮相同的 A/B/C/D（或同类）菜单，也不要重新复述整份方案后再让用户重选。"
        ].join("\n"),
        expanded: true,
        letter,
        optionText: selected.text
      };
    }
  }

  if (isRepeatMenuComplaint(raw)) {
    const prior = findLastUserLetterChoice(messages);
    if (prior) {
      const selected = prior.options.find((option) => option.letter === prior.letter);
      if (selected) {
        return {
          request: [
            raw.trim(),
            `用户此前已明确选择：${selected.letter} — ${selected.text}`,
            "请按该选择继续推进实质性交付；禁止再次给出相同或近似的多选菜单。"
          ].join("\n"),
          expanded: true,
          letter: prior.letter,
          optionText: selected.text
        };
      }
    }
    return {
      request: [
        raw.trim(),
        "用户在抱怨重复选项/循环提问。请基于当前已完成进度直接推进下一步实质工作，禁止再列出相同的选择菜单。"
      ].join("\n"),
      expanded: true
    };
  }

  return { request: raw, expanded: false };
}

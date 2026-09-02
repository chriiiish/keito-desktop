import { describe, expect, it } from "vitest";
import { rankRecents } from "./ranking.js";

const NOW = new Date("2026-09-02T10:00:00Z");
/** Today, as a workspace-local calendar date — what rankRecents actually compares against. */
const TODAY = "2026-09-02";

/** `count` entries against one pair, all logged `daysAgo` before NOW. */
function entries(projectId: string, taskId: string, daysAgo: number, count: number) {
  const day = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return Array.from({ length: count }, () => ({
    project_id: projectId,
    task_id: taskId,
    spent_date: day,
  }));
}

describe("rankRecents", () => {
  it("ranks a pair used a lot today above one used once today", () => {
    const ranked = rankRecents(
      [...entries("p_rare", "t_a", 0, 1), ...entries("p_often", "t_a", 0, 4)],
      TODAY,
    );

    expect(ranked).toEqual(["p_often:t_a", "p_rare:t_a"]);
  });

  it("lets recency beat raw frequency, so last month's habit does not crowd out this week's", () => {
    // Half-life is 7 days. Stale: 5 uses 20 days ago -> 5 * 0.5^(20/7) = 0.69.
    // Fresh: 2 uses yesterday -> 2 * 0.5^(1/7) = 1.81. Fresh wins.
    const ranked = rankRecents(
      [...entries("p_stale", "t_a", 20, 5), ...entries("p_fresh", "t_a", 1, 2)],
      TODAY,
    );

    expect(ranked).toEqual(["p_fresh:t_a", "p_stale:t_a"]);
  });

  it("ignores entries older than the 30-day window", () => {
    const ranked = rankRecents(
      [...entries("p_ancient", "t_a", 31, 50), ...entries("p_recent", "t_a", 29, 1)],
      TODAY,
    );

    expect(ranked).toEqual(["p_recent:t_a"]);
  });

  it("has nothing to suggest on a fresh account", () => {
    expect(rankRecents([], TODAY)).toEqual([]);
  });
});

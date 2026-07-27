import { describe, expect, it, vi } from "vitest";
import { lazyValue } from "./lazy-value.ts";

describe("lazyValue", () => {
  it("最初の参照まで評価せず、評価結果がundefinedでも一度だけ実行する", () => {
    const evaluate = vi.fn(() => undefined);
    const value = lazyValue(evaluate);

    expect(evaluate).not.toHaveBeenCalled();
    expect(value()).toBeUndefined();
    expect(value()).toBeUndefined();
    expect(evaluate).toHaveBeenCalledOnce();
  });
});

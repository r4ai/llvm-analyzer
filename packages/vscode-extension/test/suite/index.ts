import Mocha from "mocha";
import path from "node:path";

/**
 * VSCode Extension Host から呼ばれる E2E テスト runner。
 *
 * @returns テスト完了を表す Promise。
 */
export const run = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const mocha = new Mocha({ color: true, ui: "tdd" });
    mocha.addFile(path.resolve(__dirname, "extension.test.js"));
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} 件の E2E テストが失敗しました`));
      else resolve();
    });
  });

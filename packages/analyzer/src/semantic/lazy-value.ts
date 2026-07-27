/**
 * 計算を最初の参照まで遅らせ、結果を一度だけ記憶する。
 *
 * @param evaluate 遅延して実行する純粋な計算。
 * @returns 同じ結果を返す引数なし関数。
 *
 * @remarks
 * `undefined`も評価済みの結果として記憶する。
 * 呼び出し側は、未評価と`undefined`を区別する状態を追加で持たなくてよい。
 */
export const lazyValue = <T>(evaluate: () => T): (() => T) => {
  let evaluated = false;
  let value: T;
  return () => {
    if (!evaluated) {
      value = evaluate();
      evaluated = true;
    }
    return value;
  };
};

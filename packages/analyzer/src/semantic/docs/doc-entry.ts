/**
 * Hover や補完で使う短いドキュメント項目。
 *
 * @remarks
 * `label` は補完候補や hover 見出しに出す短い名前。
 * `markdown` は LSP の MarkupContent へ渡す本文として使う。
 *
 * @public
 */
export interface DocEntry {
  /** 表示名。LLVM IR 上のキーワードやオペコードをそのまま保持する。 */
  readonly label: string;
  /** ユーザーへ表示する説明文。 */
  readonly markdown: string;
}

interface DocMarkdownOptions {
  readonly summary: string;
  readonly usage: string;
  readonly pseudo: string;
  readonly example: string;
  readonly reference: string;
}

/**
 * LLVM LangRef の指定アンカーへのリンク URL を組み立てる。
 *
 * @param anchor - LangRef ページ内のアンカー名
 * @returns LangRef の絶対 URL
 */
export const langRef = (anchor: string): string => `https://llvm.org/docs/LangRef.html#${anchor}`;

/**
 * hover / 補完で表示する Markdown 本文を共通フォーマットで組み立てる。
 *
 * @remarks
 * 概要・用法・擬似コード付きの例・LangRef へのリンクを定型の順序で並べる。
 */
export const docMarkdown = ({
  summary,
  usage,
  pseudo,
  example,
  reference,
}: DocMarkdownOptions): string =>
  [
    summary,
    "",
    usage,
    "",
    "Example:",
    "```llvm",
    `; ${pseudo}`,
    example,
    "```",
    "",
    `[LLVM LangRef](${reference})`,
  ].join("\n");

/**
 * 属性辞書用に `[ラベル, DocEntry]` のエントリを組み立てる。
 *
 * @param label - 属性名。`DocEntry.label` と Map のキーの双方に使う
 * @param options - {@link docMarkdown} へ渡す本文の構成要素
 * @returns Map のコンストラクタへ渡せるエントリタプル
 */
export const attributeDoc = (
  label: string,
  options: DocMarkdownOptions,
): readonly [string, DocEntry] => [
  label,
  {
    label,
    markdown: docMarkdown(options),
  },
];

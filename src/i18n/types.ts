import type zh from "./locales/zh-CN";
export type MessageKey = keyof typeof zh;
export type Messages = Record<MessageKey, string>;
type Slots<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Slots<Rest>
  : never;
export type TranslationArgs<K extends MessageKey> = [
  Slots<(typeof zh)[K]>,
] extends [never]
  ? [params?: never]
  : [params: Record<Slots<(typeof zh)[K]>, string | number>];
export type Translate = <K extends MessageKey>(
  key: K,
  ...args: TranslationArgs<K>
) => string;

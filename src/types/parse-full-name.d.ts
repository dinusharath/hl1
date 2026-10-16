// `parse-full-name` ships no types; this is the slice of its API we use.
declare module "parse-full-name" {
  interface ParsedName {
    title: string;
    first: string;
    middle: string;
    last: string;
    nick: string;
    suffix: string;
    error: string[];
  }
  export function parseFullName(name: string): ParsedName;
}

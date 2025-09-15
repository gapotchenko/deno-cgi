// deno-cgi
//
// Copyright © Gapotchenko and Contributors
//
// File introduced by: Oleksiy Gapotchenko
// Year of introduction: 2025

export function startsWithU8(
  haystack: Uint8Array,
  needle: Uint8Array,
): boolean {
  if (needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (haystack[i] !== needle[i]) return false;
  }
  return true;
}

export function getPrefixedStream(
  prefix: Uint8Array,
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.length) controller.enqueue(prefix);
    },

    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        if (value?.length) controller.enqueue(value);
      } catch (err) {
        controller.error(err);
        reader.releaseLock();
      }
    },

    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
}

export function equalsOrStartsWith(
  haystack: string,
  needles: Set<string>,
  needlePrefixes: string[],
): boolean {
  // Exact matches
  if (needles.has(haystack)) {
    return true;
  }

  // Prefix-based checks
  for (const prefix of needlePrefixes) {
    if (haystack.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

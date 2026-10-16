/**
 * URL validation utility for the Video Downloader application.
 *
 * Uses the native `URL` constructor (available in all modern browsers and
 * Node.js) to validate URL structure, then confirms the protocol is HTTP or
 * HTTPS.  No regex required — the constructor itself handles parsing edge cases.
 */

/**
 * Validates whether `input` is a well-formed HTTP or HTTPS URL.
 *
 * @param input - The raw string entered by the user.
 * @returns `true` if `input` is a valid `http:` or `https:` URL; `false` otherwise.
 *
 * @example
 * validateUrl("https://www.youtube.com/watch?v=abc123") // true
 * validateUrl("http://example.com")                      // true
 * validateUrl("ftp://example.com")                       // false (unsupported protocol)
 * validateUrl("not a url")                               // false
 * validateUrl("")                                        // false
 */
export function validateUrl(input: string): boolean {
  if (!input || input.trim() === "") {
    return false;
  }

  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    // URL constructor throws a TypeError for malformed URLs
    return false;
  }
}

// deno-cgi
//
// Copyright © Gapotchenko and Contributors
//
// File introduced by: Oleksiy Gapotchenko
// Year of introduction: 2025

import { Buffer } from "@std/streams/buffer";
import {
  equalsOrStartsWith,
  getPrefixedStream,
  startsWithU8,
} from "./utils.ts";

/** Defines possible network protocols for CGI. */
export type CgiNetworkProtocol = "http" | "https";

/** Defines possible server protocols for CGI. */
export type CgiServerProtocol = "HTTP/1.0" | "HTTP/1.1" | "HTTP/2" | "HTTP/3";

/** Defines CGI execution options. */
export type CgiExecutionOptions = {
  /**
   * Instructs whether to use streaming mode for a CGI response.
   *
   * When this option is undefined, the default value is `false`.
   */
  streaming?: boolean;

  /** Environment variables to pass to the CGI process. */
  env?: Record<string, string>;

  /**
   *  A value to use for `SERVER_SOFTWARE` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to `deno-cgi` value.
   */
  serverSoftware?: string;

  /**
   *  A value to use for `SERVER_PROTOCOL` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to `HTTP/1.1` value.
   */
  serverProtocol?: CgiServerProtocol;

  /**
   *  A value to use for `SERVER_PORT` environment variable of CGI process.
   *
   *  When this option is undefined, the server port is automatically detected from a request.
   */
  serverPort?: string;

  /**
   *  A value to use for `REMOTE_ADDR` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to an empty value.
   */
  remoteAddr?: string;

  /**
   *  A value to use for `REMOTE_HOST` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to an empty value.
   */
  remoteHost?: string;

  /**
   *  A value to use for `SCRIPT_NAME` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to an empty value.
   */
  scriptName?: string;

  /**
   *  A value to use for `PATH_INFO` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to an empty value.
   */
  pathInfo?: string;

  /**
   *  A value to use for `PATH_TRANSLATED` environment variable of CGI process.
   *
   *  When this option is undefined, the environment variable is set to an empty value.
   */
  pathTranslated?: string;

  /**
   * A value to use for autodetecting the value of `SERVER_PORT` environment variable for CGI process.
   *
   * When this option is undefined, the network protocol is automatically detected from a request.
   */
  networkProtocol?: CgiNetworkProtocol;
};

/**
 * Executes a CGI request.
 * @param request The web request to execute.
 * @param command The CGI command to execute.
 * @param commandArgs The CGI command arguments.
 * @param options The options.
 * @returns A web response formed from a response of the CGI command.
 */
export async function executeCgi(
  request: Request,
  command: string,
  commandArgs: string[],
  options: CgiExecutionOptions = {},
): Promise<Response> {
  const url = new URL(request.url);

  // ---- Build CGI environment  --------------------------------------------

  const networkProtocol = options?.networkProtocol ?? getNetworkProtocol(url);
  const hostHeader = request.headers.get("host") ?? "";
  const [serverName, portMaybe] = hostHeader.split(":");
  const serverPort = options.serverPort ?? portMaybe ??
    (networkProtocol === "https"
      ? "443"
      : networkProtocol === "http"
      ? "80"
      : "");

  const env: Record<string, string> = {
    // Standard (RFC 3875)
    GATEWAY_INTERFACE: "CGI/1.1",
    PATH_INFO: options.pathInfo ?? "",
    PATH_TRANSLATED: options.pathTranslated ?? "",
    QUERY_STRING: url.search.length > 1 ? url.search.slice(1) : "",
    REMOTE_ADDR: options.remoteAddr ?? "", // Request doesn't expose remote address
    REMOTE_HOST: options.remoteHost ?? "", // Request doesn't expose remote host
    REQUEST_METHOD: request.method,
    REQUEST_URI: url.pathname + (url.search ?? ""),
    SCRIPT_NAME: options.scriptName ?? "",
    SERVER_NAME: serverName ?? "",
    SERVER_PORT: serverPort,
    SERVER_PROTOCOL: options.serverProtocol ?? "HTTP/1.1", // Request doesn't expose the exact version
    SERVER_SOFTWARE: options.serverSoftware ?? "deno-cgi",
  };

  // Forward common incoming headers as CGI vars (HTTP_*), plus content headers
  for (const [k, v] of request.headers) {
    const upper = k.toUpperCase().replace("-", "_");
    if (upper === "CONTENT_TYPE") {
      env["CONTENT_TYPE"] = v;
    } else if (upper === "CONTENT_LENGTH") {
      env["CONTENT_LENGTH"] = v;
    } else {
      env[`HTTP_${upper}`] = v;
    }
  }

  // ---- Spawn CGI shell ---------------------------------------------------

  const streaming = options.streaming ?? false;

  const cmd = new Deno.Command(command, {
    args: commandArgs,
    stdin: "piped",
    stdout: "piped",
    stderr: streaming ? "null" : "piped",
    env: { ...options.env, ...env },
  });

  const child = cmd.spawn();

  // ---- Stream request body to stdin --------------------------------------
  (async () => {
    try {
      if (request.body) {
        await request.body.pipeTo(child.stdin);
      } else {
        child.stdin?.close();
      }
    } catch {
      // ignore broken pipe etc.
      try {
        child.stdin?.close();
      } catch {
        /* ignore */
      }
    }
  })();

  return await (streaming
    ? getStreamingCgiResponse(child)
    : getCgiResponse(child));
}

async function getCgiResponse(child: Deno.ChildProcess): Promise<Response> {
  // Collect outputs
  const [{ stdout, stderr, code: exitCode }] = await Promise.all([
    child.output(),
  ]);

  // Try to parse CGI response from stdout
  const { headers, status, body } = parseCgiResponse(stdout);

  // If headers are empty (malformed CGI), return 500 unless body looks usable
  if (headers.size === 0) {
    const message = stderr.length > 0
      ? new TextDecoder().decode(stderr)
      : "Malformed CGI response (no headers).";
    // Include exit code & stderr in headers for diagnostics (not body).
    return new Response(
      body.length ? body : new TextEncoder().encode(message),
      {
        status: exitCode === 0 && body.length ? 200 : 500,
        headers: {
          "Content-Type": body.length
            ? "application/octet-stream"
            : "text/plain; charset=utf-8",
          "X-CGI-Exit-Code": exitCode.toString(),
        },
      },
    );
  }

  // Build Response with parsed headers and body
  const denoHeaders = new Headers();
  setCgiHeaders(denoHeaders, headers);
  if (exitCode) {
    denoHeaders.set("X-CGI-Exit-Code", exitCode.toString());
  }
  if (stderr.length) {
    denoHeaders.set(
      "X-CGI-StdErr",
      safeHeaderValue(new TextDecoder().decode(stderr)),
    );
  }

  if (!denoHeaders.has("Content-Length")) {
    denoHeaders.set("Content-Length", body.length.toString());
  }

  return new Response(body, { status, headers: denoHeaders });

  // ----------------------------------------------

  /** Parse CGI stdout into headers, status, body. Supports LF and CRLF, and "Status:" header. */
  function parseCgiResponse(stdout: Uint8Array): {
    headers: Map<string, string>;
    status: number;
    body: Uint8Array;
  } {
    // Handle a rare case where a script prints a full HTTP response line:
    // e.g., "HTTP/1.1 200 OK\r\nHeader: v\r\n\r\nBody"
    // We still treat it like CGI: ignore the first status line and parse headers.
    const sepIdx = findHeaderBodySeparator(stdout);
    if (sepIdx < 0) {
      return { headers: new Map<string, string>(), status: 200, body: stdout };
    } else {
      const headBytes = stdout.subarray(0, sepIdx);
      const { headers, status } = parseCgiHead(headBytes);
      const body = stdout.subarray(sepIdx);
      return { headers, status, body };
    }
  }

  /** Sanitize header value (single line, strip control chars). */
  function safeHeaderValue(s: string): string {
    return s.replace(/[\r\n]+/g, " ").slice(0, 1024);
  }
}

async function getStreamingCgiResponse(
  child: Deno.ChildProcess,
): Promise<Response> {
  // https://docs.deno.com/examples/http_server_streaming/

  // Bug: Deno 2.4.5 has a memory leak in streaming mode
  // https://github.com/denoland/deno/issues/30298

  // ---- Parse CGI headers from stdout, then stream remainder ----------------
  const stdout = child.stdout;

  // Wait for child process exit in the background
  child.status.catch(() => {});

  // Accumulate until we find header/body separator
  const headBuf = new Buffer();
  let sepIndex = -1;

  // Read until header/body separator or stream end
  headBuf.grow(1024); // pre-reserve to minimize reallocs
  const headReader = stdout.getReader();
  const headWriter = headBuf.writable.getWriter();
  try {
    while (true) {
      const { value, done } = await headReader.read();
      if (done) break;
      if (value && value.length) {
        headWriter.write(value);
        sepIndex = findHeaderBodySeparator(headBuf.bytes({ copy: false }));
        if (sepIndex >= 0 || sepIndex === -2) break;
      }
      if (headBuf.length > 16384) break; // give up on headers
    }
  } finally {
    headReader.releaseLock();
    headWriter.releaseLock();
  }

  let headBytes = headBuf.bytes({ copy: false }); // may be empty or contain the whole output

  // console.log("HTTP sepIndex: " + sepIndex);

  if (sepIndex < 0) {
    // No headers detected within the scan limit -> stream with defaults

    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");

    // Start streaming: first what we've already read, then the rest as it arrives
    const bodyStream = getPrefixedStream(headBytes, stdout);

    return new Response(bodyStream, { status: 200, headers });
  } else {
    // Headers found -> parse and stream remainder + the rest

    const remainder = headBytes.subarray(sepIndex);
    headBytes = headBytes.subarray(0, sepIndex);

    const { headers, status } = parseCgiHead(headBytes);

    const resHeaders = new Headers();
    setCgiHeaders(resHeaders, headers);

    // Start streaming: first what we've already read, then the rest as it arrives
    const bodyStream = getPrefixedStream(remainder, stdout);
    return new Response(bodyStream, {
      status,
      headers: resHeaders,
    });
  }
}

/** Find CRLF CRLF or LF LF boundary. Returns index where body starts, or negative value if not found. */
function findHeaderBodySeparator(bytes: Uint8Array): number {
  // Look for HTTP prolog
  if (bytes.length < httpProlog.length) return -1; // not enough data
  if (!startsWithU8(bytes, httpProlog)) return -2; // bad prolog

  // Look for \r\n\r\n
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (
      bytes[i] === 13 && bytes[i + 1] === 10 &&
      bytes[i + 2] === 13 && bytes[i + 3] === 10
    ) {
      return i + 4;
    }
  }
  // Look for \n\n
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      return i + 2;
    }
  }

  return -3; // no headers
}

const httpProlog = new Uint8Array([72, 84, 84, 80, 47]); // "HTTP/"

/** Parse the CGI header block (no trailing CRLFCRLF/LFLF), return headers + status. */
function parseCgiHead(
  headBytes: Uint8Array,
): { headers: Map<string, string>; status: number } {
  const text = new TextDecoder().decode(headBytes).replace(/\r\n/g, "\n");
  const lines = text.split("\n").filter((l) => l.length > 0);

  const headers = new Map<string, string>();
  let status = 200;

  // If first line starts with HTTP/, treat it as a status line and skip it.
  let startAt = 0;
  if (lines[0]?.startsWith("HTTP/")) {
    const m = lines[0].match(/^HTTP\/\d+\.\d+\s+(\d{3})/i);
    if (m?.[1]) status = parseInt(m[1], 10);
    startAt = 1;
  }

  for (let i = startAt; i < lines.length; i++) {
    const line = lines[i]!;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const name = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();

    if (/^status$/i.test(name)) {
      const m = value.match(/^(\d{3})/);
      if (m?.[1]) {
        status = parseInt(m[1], 10);
      }
      // Do not inject "Status" as a regular header.
      continue;
    }

    // Combine duplicate headers by comma, per HTTP semantics
    const key = name;
    if (headers.has(key)) {
      headers.set(key, headers.get(key)! + ", " + value);
    } else {
      headers.set(key, value);
    }
  }

  return { headers, status };
}

function setCgiHeaders(
  headers: Headers,
  cgiHeaders: Map<string, string>,
): void {
  for (const [k, v] of cgiHeaders) {
    // Filter hop-by-hop or unsafe headers if needed (minimal set here)
    if (!/^(connection|transfer-encoding)$/i.test(k)) {
      headers.set(k, v);
    }
  }

  // If script didn't specify a Content-Type, default to binary/octet-stream
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }
}

// --------------------------------------------------------------------------

/**
 * Gets a value indicating whether the specified environment variable name is
 * reserved for CGI.
 * @param name The environment variable name.
 * @returns `true` when the specified environment variable name is reserved
 * for CGI; otherwise, `false`.
 */
export function isReservedCgiEnvVar(name: string): boolean {
  return equalsOrStartsWith(
    name.toUpperCase(),
    reservedEnvNames,
    reservedEnvPrefixes,
  );
}

const reservedEnvNames = new Set([
  // Standard (RFC 3875)
  "AUTH_TYPE",
  "CONTENT_TYPE",
  "CONTENT_LENGTH",
  "GATEWAY_INTERFACE",
  "PATH_INFO",
  "PATH_TRANSLATED",
  "QUERY_STRING",
  "REMOTE_ADDR",
  "REMOTE_HOST",
  "REMOTE_IDENT",
  "REMOTE_USER",
  "REQUEST_METHOD",
  "REQUEST_URI",
  "SCRIPT_NAME",
  "SERVER_NAME",
  "SERVER_PORT",
  "SERVER_PROTOCOL",
  "SERVER_SOFTWARE",
]);

const reservedEnvPrefixes = [
  "HTTP_",
];

// --------------------------------------------------------------------------

/** Gets CGI network protocol from the specified URL. */
function getNetworkProtocol(
  url: URL,
): CgiNetworkProtocol | undefined {
  if (url.protocol === "https:") {
    return "https";
  }

  if (url.protocol === "http:") {
    return "http";
  }

  return undefined;
}

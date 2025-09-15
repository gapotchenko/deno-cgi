# deno-cgi

`deno-cgi` provides an embeddable
[Common Gateway Interface (CGI)](https://www.rfc-editor.org/rfc/rfc3875)
implementation for [Deno](https://deno.com/).

It allows you to run shell scripts, CGI programs, or other executables directly
from a Deno HTTP server.

## Example

```ts
import { executeCgi } from "jsr:@gapotchenko/deno-cgi";

const script = `echo "$SERVER_PROTOCOL 200 OK"
echo "Content-Type: text/plain;charset=UTF-8"
echo
echo "Hello CGI"`;

Deno.serve(async (request) =>
  await executeCgi(request, "/bin/sh", ["-c", script])
);
```

Start the server with `deno run` and visit `http://localhost:8000` to see the
CGI output.

## Modes of Operation

### Batch mode (default)

By default, `deno-cgi` runs the CGI program to completion, buffers its output,
and then sends the entire response at once. This is a simple mode that works
well for short responses.

### Streaming mode

For long-running scripts or continuous output, you can enable streaming mode.

The streaming mode allows to stream a CGI command response in chunks as soon as
they arrive. To accomplish that, the options object should be passed to
`executeCgi` function with `streaming` property set to `true`:

```ts
await executeCgi(
  request,
  "/bin/sh",
  ["-c", script],
  { streaming: true },
);
```

This reduces latency and allows having extremely large responses without wasting
RAM.

## Features

- Implements the
  [CGI/1.1 spec (RFC 3875)](https://www.rfc-editor.org/rfc/rfc3875)
- Compatible with any executable: shell scripts, compiled binaries, or
  interpreters
- Automatically sets CGI environment variables (e.g. `REQUEST_METHOD`,
  `QUERY_STRING`, `SERVER_PROTOCOL`)
- Supports both **batch** and **streaming** response modes

## When to Use

- Embedding legacy CGI scripts into a modern Deno server
- Running shell commands as HTTP endpoints (with proper sandboxing!)
- Prototyping HTTP services quickly without a full web framework

## Security Note

Running arbitrary shell commands or executables in response to HTTP requests can
be dangerous. Make sure to:

- Validate and sanitize any user input passed to scripts
- Restrict access where appropriate
- Consider sandboxing (e.g. using
  [bwrap](https://github.com/containers/bubblewrap) or containers)

To assist with script validation, the module provides `isReservedCgiEnvVar`
function.

## Packages

You can use `deno-cgi` from:

- [JSR Package Registry](https://jsr.io/@gapotchenko/deno-cgi)

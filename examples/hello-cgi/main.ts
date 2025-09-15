import { executeCgi } from "jsr:@gapotchenko/deno-cgi";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    const cgiScript = `echo "$SERVER_PROTOCOL 200 OK"
echo "Content-Type: text/plain;charset=UTF-8"
echo
echo "Hello CGI"`;

    let cgiShellCommand = "/bin/sh";
    let cgiShellArgs = ["-e", "-c"];

    if (Deno.build.os === "windows") {
      // https://github.com/gapotchenko/gnu-tk
      cgiShellArgs = ["-l", cgiShellCommand, ...cgiShellArgs];
      cgiShellCommand = "gnu-tk";
    }

    return await executeCgi(req, cgiShellCommand, [...cgiShellArgs, cgiScript]);
  } else {
    return new Response("404 Not Found", { status: 404 });
  }
}

Deno.serve(handler);

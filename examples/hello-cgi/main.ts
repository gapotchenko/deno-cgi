import { executeCgi } from "@gapotchenko/deno-cgi";

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    return await handleCgi(req);
  } else {
    return new Response("404 Not Found", { status: 404 });
  }
}

async function handleCgi(req: Request): Promise<Response> {
  const script = `echo "$SERVER_PROTOCOL 200 OK"
echo "Content-Type: text/plain;charset=UTF-8"
echo
echo "Hello CGI"`;

  let shellCommand = "/bin/sh";
  let shellArgs = ["-e", "-c"];

  if (Deno.build.os === "windows") {
    // https://github.com/gapotchenko/gnu-tk
    shellArgs = ["-l", shellCommand, ...shellArgs];
    shellCommand = "gnu-tk";
  }

  return await executeCgi(req, shellCommand, [...shellArgs, script]);
}

Deno.serve(handler);

# hello-cgi

This example shows how to serve a basic CGI script:

```sh
echo "$SERVER_PROTOCOL 200 OK"
echo "Content-Type: text/plain;charset=UTF-8"
echo
echo "Hello CGI"
```

The script emits a CGI response conforming to the specification, consisting of
HTTP headers followed by a plain-text body.

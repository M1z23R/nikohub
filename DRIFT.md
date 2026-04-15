# Drift Web Framework

Go HTTP framework inspired by Gin/Express. Zero external dependencies, radix tree routing, context pooling.

```
go get github.com/m1z23r/drift/pkg/drift
go get github.com/m1z23r/drift/pkg/middleware
go get github.com/m1z23r/drift/pkg/websocket
```

## Quick Start

```go
app := drift.New()
app.Use(middleware.CORS(), middleware.BodyParser(), middleware.Recovery())

app.Get("/", func(c *drift.Context) {
    c.JSON(200, map[string]string{"message": "Hello"})
})

app.Run(":8080")          // HTTP
app.RunTLS(":443", c, k)  // HTTPS
```

## Routing

```go
// All HTTP methods
app.Get("/path", handler)
app.Post("/path", handler)
app.Put("/path", handler)
app.Patch("/path", handler)
app.Delete("/path", handler)
app.Options("/path", handler)
app.Head("/path", handler)
app.Any("/path", handler)         // all methods

// URL params and catch-all
app.Get("/users/:id", handler)        // c.Param("id")
app.Get("/files/*filepath", handler)  // c.Param("filepath") - greedy

// Groups with prefix + middleware
api := app.Group("/api")
api.Use(authMiddleware)
v1 := api.Group("/v1")
v1.Get("/users", handler)  // /api/v1/users

// Per-route middleware (variadic)
app.Post("/admin", authMW, rateMW, handler)

// Static files
app.Static("/public", "./static")

// Custom 404/405
app.NoRoute(handler)
app.NoMethod(handler)
```

## Context - Request

```go
c.Param("id")                          // URL param
c.QueryParam("key")                    // query string
c.DefaultQuery("page", "1")            // with fallback
c.GetHeader("Authorization")           // request header
c.Cookie("session")                    // cookie value
c.ClientIP()                           // X-Forwarded-For > X-Real-IP > RemoteAddr
c.Method()                             // HTTP method
c.Path()                               // request path
c.FullPath()                           // matched route pattern

// Body parsing
c.BindJSON(&struct{})                  // JSON -> struct
c.PostForm("field")                    // form field
c.DefaultPostForm("field", "default")
file, _ := c.FormFile("upload")       // file upload
c.SaveUploadedFile(file, "./dest")
form, _ := c.MultipartForm()
```

## Context - Response

```go
c.JSON(200, data)                      // JSON
c.String(200, "Hello %s", name)        // text
c.HTML(200, "<h1>Hi</h1>")            // HTML
c.Redirect(302, "/login")             // redirect
c.Status(204)                          // status only

// Files & streaming
c.File("/path/to/file")               // serve file (streamed)
c.FileAttachment("/path", "name.pdf") // force download
c.Stream(200, "video/mp4", reader)    // io.Reader
c.StreamBytes(200, "image/png", buf)  // []byte, efficient
c.Data(200, "application/pdf", buf)   // raw bytes
```

## Context - Data Passing

```go
c.Set("user_id", "123")               // store
val, exists := c.Get("key")           // retrieve
c.GetString("key")                     // typed getters
c.GetInt("key")
c.GetBool("key")
c.MustGet("key")                       // panics if missing
```

## Context - Flow Control

```go
c.Next()                               // call next handler
c.Abort()                              // stop chain
c.AbortWithStatus(401)
c.AbortWithStatusJSON(403, data)
c.IsAborted()
```

## Error Helpers

All abort the chain and return JSON `{"code": N, "message": "..."}`. Empty message uses standard HTTP text.

```go
c.BadRequest("msg")          // 400    c.TooManyRequests("msg")     // 429
c.Unauthorized("msg")        // 401    c.InternalServerError("msg") // 500
c.Forbidden("msg")           // 403    c.NotImplemented("msg")      // 501
c.NotFound("msg")            // 404    c.BadGateway("msg")          // 502
c.MethodNotAllowed("msg")    // 405    c.ServiceUnavailable("msg")  // 503
c.Conflict("msg")            // 409    c.GatewayTimeout("msg")      // 504
c.UnprocessableEntity("msg") // 422

c.Error(418, "I'm a teapot")                  // custom code
c.ErrorWithData(422, map[string]any{...})      // custom body
```

## Built-in Middleware

### CORS
```go
app.Use(middleware.CORS())   // permissive defaults
app.Use(middleware.CORSWithConfig(middleware.CORSConfig{
    AllowOrigins: []string{"http://localhost:3000"},
    AllowMethods: []string{"GET", "POST", "PUT", "DELETE"},
    AllowHeaders: []string{"Origin", "Content-Type", "Authorization"},
    AllowCredentials: true,
    MaxAge: 3600,
}))
```

### Body Parser
Parses JSON, form-data, URL-encoded. Access via `c.Get("body")` and `c.Get("_bodyRaw")`.
```go
app.Use(middleware.BodyParser())
app.Use(middleware.BodyParserWithConfig(middleware.BodyParserConfig{MaxBodySize: 100 << 20}))
```

### Rate Limiter
Token bucket, default 100 req/min per IP.
```go
app.Use(middleware.RateLimiter())
app.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
    Max: 1000, Window: time.Hour,
    KeyFunc: func(c *drift.Context) string { return c.GetHeader("Authorization") },
}))
app.Get("/expensive", middleware.PerRouteRateLimiter(10, time.Minute), handler)
```

### CSRF
Double-submit cookie pattern. TokenLookup format: `"source:key"` (header, form, query, cookie).
```go
app.Use(middleware.CSRF())
app.Use(middleware.CSRFWithConfig(middleware.CSRFConfig{
    TokenLookup: "header:X-CSRF-Token",
    CookieSecure: true, CookieHTTPOnly: true,
}))
// Token available as c.GetString("csrf_token")
```

### Security Headers
```go
app.Use(middleware.Secure())       // sensible defaults
app.Use(middleware.StrictSecure()) // strict mode
app.Use(middleware.SecureWithConfig(middleware.SecurityConfig{
    XFrameOptions: "DENY", ContentSecurityPolicy: "default-src 'self'",
    HSTSMaxAge: 31536000, HSTSPreload: true,
}))
```

### Recovery
```go
app.Use(middleware.Recovery())
app.Use(middleware.RecoveryWithHandler(func(c *drift.Context, err any) {
    c.JSON(500, map[string]string{"error": "Internal Server Error"})
}))
```

### Compression
gzip/deflate, auto-selects from Accept-Encoding.
```go
app.Use(middleware.Compress())
app.Use(middleware.CompressWithConfig(middleware.CompressionConfig{
    Level: 6, MinLength: 1024,
    ExcludedExtensions: []string{".png", ".mp4"},
}))
app.Get("/ws", middleware.SkipCompression(), wsHandler)  // skip for WS/SSE
```

### Timeout
```go
app.Use(middleware.Timeout())                        // 30s default
app.Use(middleware.TimeoutWithDuration(5 * time.Second))
app.Get("/slow", middleware.TimeoutWithDuration(60*time.Second), handler)
```

## Server-Sent Events

```go
app.Get("/events", func(c *drift.Context) {
    sse := c.SSE()
    sse.Send("data", "event-type", "id")
    sse.SendJSON(map[string]any{"key": "val"}, "event", "id")
    sse.SendComment("keepalive")
})
```

## WebSockets

RFC 6455 compliant. Always use `middleware.SkipCompression()` with global compression.

```go
import "github.com/m1z23r/drift/pkg/websocket"

app.Get("/ws", middleware.SkipCompression(), func(c *drift.Context) {
    conn, err := websocket.Upgrade(c)
    if err != nil { return }
    defer conn.Close(websocket.CloseNormalClosure, "bye")

    for {
        msgType, data, err := conn.ReadMessage()
        if err != nil { break }
        conn.WriteMessage(msgType, data)  // echo
    }
})

// Reading/Writing
conn.ReadMessage()                        // (type, []byte, error)
conn.ReadJSON(&msg)
conn.WriteText("hello")
conn.WriteBinary(data)
conn.WriteJSON(obj)
conn.Ping([]byte("ping"))

// Custom upgrader
upgrader := &websocket.Upgrader{
    ReadBufferSize: 4096, WriteBufferSize: 4096,
    ReadLimit: 64 << 20,
    CheckOrigin: func(r *http.Request) bool { return true },
    Subprotocols: []string{"graphql-ws"},
}
conn, err := upgrader.Upgrade(c)
```

## Modes

```go
app.SetMode(drift.DebugMode)    // logs routes, requests, startup
app.SetMode(drift.ReleaseMode)  // silent
app.IsDebug()
```

## Project Structure

```
pkg/drift/       - Engine, Context, Router (public API)
pkg/middleware/  - 8 built-in middleware
pkg/websocket/   - WebSocket implementation
internal/router/ - Radix tree (not importable)
```

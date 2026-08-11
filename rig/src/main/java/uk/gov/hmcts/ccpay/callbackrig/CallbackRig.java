package uk.gov.hmcts.ccpay.callbackrig;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A minimal in-cluster HTTP receiver used by the ccpay-callback-function functional tests.
 *
 * It accepts the callback {@code PUT} issued by the function (after S2S authentication and
 * callback-URL allow-list validation) and records the request so the functional test can assert
 * that the callback was delivered with the expected body and {@code ServiceAuthorization} header.
 *
 * Endpoints:
 * <ul>
 *   <li>{@code GET /ready} - liveness used to wait for the rig to come up before publishing a message</li>
 *   <li>{@code PUT /callback} - receives the callback; stores the request; returns 200</li>
 *   <li>{@code GET /results} - returns the most recently recorded callback as JSON</li>
 *   <li>{@code GET /health} - same as /ready</li>
 * </ul>
 */
public final class CallbackRig {

    private static final AtomicReference<CallbackResult> LAST_RESULT = new AtomicReference<>();

    private CallbackRig() {
    }

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        server.createContext("/callback", new CallbackHandler());
        server.createContext("/results", new ResultsHandler());
        server.createContext("/ready", new ReadyHandler());
        server.createContext("/health", new ReadyHandler());

        server.start();
        System.out.println("CallbackRig listening on port " + port);
    }

    private static final class CallbackHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"PUT".equalsIgnoreCase(exchange.getRequestMethod())) {
                respond(exchange, 405, "{\"error\":\"method not allowed\"}");
                return;
            }
            String body = readBody(exchange);
            Map<String, String> headers = new LinkedHashMap<>();
            exchange.getRequestHeaders().forEach((name, values) ->
                headers.put(name, String.join(", ", values)));
            LAST_RESULT.set(new CallbackResult(true, headers, body));
            respond(exchange, 200, "{\"ok\":true}");
        }
    }

    private static final class ResultsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            CallbackResult result = LAST_RESULT.get();
            String json = result == null
                ? "{\"received\":false}"
                : "{\"received\":true,\"headers\":" + toJson(result.headers) + ",\"body\":" + result.body + "}";
            respond(exchange, 200, json);
        }
    }

    private static final class ReadyHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            respond(exchange, 200, "{\"status\":\"UP\"}");
        }
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream in = exchange.getRequestBody()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    private static String toJson(Map<String, String> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (!first) {
                sb.append(",");
            }
            first = false;
            sb.append(quote(entry.getKey())).append(":").append(quote(entry.getValue()));
        }
        sb.append("}");
        return sb.toString();
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static final class CallbackResult {
        private final boolean received;
        private final Map<String, String> headers;
        private final String body;

        CallbackResult(boolean received, Map<String, String> headers, String body) {
            this.received = received;
            this.headers = headers;
            this.body = body;
        }
    }
}

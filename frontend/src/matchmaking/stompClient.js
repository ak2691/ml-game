import { API_BASE_URL, websocketUrl } from "../config/api";
import { ensureCsrfHeaders } from "../security/csrf";

function frame(command, headers = {}, body = "") {
    const headerLines = Object.entries(headers).map(([key, value]) => `${key}:${value}`);
    return `${command}\n${headerLines.join("\n")}\n\n${body}\0`;
}

function parseFrame(rawFrame) {
    const [head, body = ""] = rawFrame.split("\n\n");
    const [command, ...headerLines] = head.split("\n");
    const headers = Object.fromEntries(
        headerLines
            .filter(Boolean)
            .map((line) => {
                const separator = line.indexOf(":");
                return [line.slice(0, separator), line.slice(separator + 1)];
            })
    );

    return { command, headers, body };
}

export function createMatchmakingClient({ onEvent, onStatus }) {
    let socket = null;
    let connected = false;
    let subscriptionId = 0;
    const websocketHost = new URL(websocketUrl()).host;

    const sendFrame = (command, headers = {}, body = "") => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(frame(command, headers, body));
    };

    return {
        async connect() {
            onStatus?.("CONNECTING");

            let csrfHeaders;
            try {
                csrfHeaders = await ensureCsrfHeaders("POST", API_BASE_URL);
            } catch {
                onStatus?.("ERROR");
                return;
            }

            socket = new WebSocket(websocketUrl());

            socket.addEventListener("open", () => {
                sendFrame("CONNECT", {
                    "accept-version": "1.2",
                    host: websocketHost,
                    "heart-beat": "0,0",
                    ...csrfHeaders,
                });
            });

            socket.addEventListener("message", (message) => {
                const frames = String(message.data).split("\0").filter(Boolean);
                for (const rawFrame of frames) {
                    const parsed = parseFrame(rawFrame);
                    if (parsed.command === "CONNECTED") {
                        connected = true;
                        onStatus?.("CONNECTED");
                        sendFrame("SUBSCRIBE", {
                            id: `matchmaking-${subscriptionId++}`,
                            destination: "/user/queue/matchmaking",
                        });
                    }
                    if (parsed.command === "MESSAGE") {
                        onEvent?.(JSON.parse(parsed.body));
                    }
                    if (parsed.command === "ERROR") {
                        onStatus?.("ERROR");
                        socket?.close();
                    }
                }
            });

            socket.addEventListener("close", () => {
                connected = false;
                onStatus?.("CLOSED");
            });
        },
        joinQueue() {
            if (!connected) return;
            sendFrame("SEND", { destination: "/app/matchmaking.join" }, "{}");
        },
        leaveQueue() {
            if (!connected) return;
            sendFrame("SEND", { destination: "/app/matchmaking.leave" }, "{}");
        },
        finish(modelSubmissionId) {
            if (!connected) return;
            sendFrame(
                "SEND",
                { destination: "/app/matchmaking.finish", "content-type": "application/json" },
                JSON.stringify({ modelSubmissionId })
            );
        },
        selectClass(selectedClass) {
            if (!connected) return;
            sendFrame(
                "SEND",
                { destination: "/app/matchmaking.selectClass", "content-type": "application/json" },
                JSON.stringify({ selectedClass })
            );
        },
        placeObjects(objects) {
            if (!connected) return;
            sendFrame(
                "SEND",
                { destination: "/app/matchmaking.placeObjects", "content-type": "application/json" },
                JSON.stringify({ objects })
            );
        },
        surrender() {
            if (!connected) return;
            sendFrame("SEND", { destination: "/app/matchmaking.surrender" }, "{}");
        },
        disconnect() {
            if (!socket) return;
            if (connected) {
                sendFrame("DISCONNECT", { receipt: "disconnect" });
            }
            socket.close();
        },
    };
}

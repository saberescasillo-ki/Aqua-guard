"""
Aqua Guard · Litium — Simulador de los 2 ESP32 (para probar la app sin hardware)

Uso:
    python tools/simulador_esp32.py

Luego, en la app (pestaña Conexión) escribe:
    IP ESP32 Cisterna: localhost:8081
    IP ESP32 Bomba:    localhost:8082
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

state = {"cisterna": 80.0, "tinaco": 60.0, "bomba": False, "modo": "auto"}
lock = threading.Lock()


def fisica():
    """Simula consumo de agua y el control automático de la bomba."""
    while True:
        with lock:
            state["tinaco"] = max(0.0, state["tinaco"] - 0.8)  # consumo en casa
            if state["modo"] == "auto":
                if state["tinaco"] <= 25 and state["cisterna"] > 15:
                    state["bomba"] = True
                if state["tinaco"] >= 95 or state["cisterna"] <= 15:
                    state["bomba"] = False
            if state["bomba"]:
                state["tinaco"] = min(100.0, state["tinaco"] + 3)
                state["cisterna"] = max(0.0, state["cisterna"] - 1.5)
            else:
                state["cisterna"] = min(100.0, state["cisterna"] + 0.3)  # llenado de la red
        time.sleep(1)


def make_handler(device):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, data, code=200):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            with lock:
                if device == "bomba" and url.path == "/api/bomba":
                    modo = parse_qs(url.query).get("modo", [""])[0]
                    if modo in ("on", "off"):
                        state["modo"], state["bomba"] = "manual", modo == "on"
                    elif modo == "auto":
                        state["modo"] = "auto"
                    else:
                        return self._json({"error": "modo invalido"}, 400)
                if url.path not in ("/api/status", "/api/bomba"):
                    return self._json({"error": "no encontrado"}, 404)
                if device == "cisterna":
                    nivel = state["cisterna"]
                    return self._json({"device": "cisterna", "nivel": round(nivel, 1),
                                       "distancia_cm": round(180 - nivel * 1.6, 1), "rssi": -55,
                                       "uptime": int(time.monotonic())})
                return self._json({"device": "bomba", "bomba": state["bomba"], "modo": state["modo"],
                                   "nivel_tinaco": round(state["tinaco"], 1),
                                   "nivel_cisterna": round(state["cisterna"], 1), "rssi": -61,
                                   "uptime": int(time.monotonic())})

        def log_message(self, *args):
            pass

    return Handler


if __name__ == "__main__":
    threading.Thread(target=fisica, daemon=True).start()
    for device, port in (("cisterna", 8081), ("bomba", 8082)):
        server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(device))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"ESP32 {device} simulado en http://localhost:{port}/api/status")
    print("Ctrl+C para detener.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass

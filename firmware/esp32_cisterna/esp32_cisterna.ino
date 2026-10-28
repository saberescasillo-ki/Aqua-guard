/*
  Aqua Guard · Litium — ESP32 CISTERNA
  ------------------------------------
  Mide el nivel de la cisterna con un sensor ultrasónico (HC-SR04 / JSN-SR04T)
  y lo publica por WiFi para la app y para el ESP32 Bomba.

  Endpoint:
    GET /api/status  ->  {"device":"cisterna","nivel":72.5,"distancia_cm":41.3,"rssi":-58,"uptime":1234}

  Si no logra conectarse a tu WiFi, crea su propia red "AquaGuard-Cisterna"
  (contraseña: aquaguard) y queda en la IP 192.168.4.1.
*/
#include <WiFi.h>
#include <WebServer.h>

// ---------- CONFIGURA AQUÍ ----------
const char* WIFI_SSID     = "TU_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD";

const int PIN_TRIG = 5;
const int PIN_ECHO = 18;   // usa divisor de voltaje si tu sensor es de 5 V

// Medidas de tu cisterna (cm), desde el sensor:
const float DIST_LLENO = 20.0;    // distancia al agua cuando está llena
const float DIST_VACIO = 180.0;   // distancia al fondo cuando está vacía
// ------------------------------------

WebServer server(80);
float distanciaCm = -1;
float nivel = 0;

float medirDistancia() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long dur = pulseIn(PIN_ECHO, HIGH, 30000);  // timeout ~5 m
  if (dur == 0) return -1;                    // sin eco
  return dur * 0.0343 / 2.0;
}

void actualizarNivel() {
  float d = medirDistancia();
  if (d < 0) return;  // conserva la última lectura válida
  distanciaCm = d;
  nivel = (DIST_VACIO - d) / (DIST_VACIO - DIST_LLENO) * 100.0;
  nivel = constrain(nivel, 0, 100);
}

void handleStatus() {
  String json = "{\"device\":\"cisterna\"";
  json += ",\"nivel\":" + String(nivel, 1);
  json += ",\"distancia_cm\":" + String(distanciaCm, 1);
  json += ",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
  json += ",\"uptime\":" + String(millis() / 1000);
  json += "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");  // permite que la app lea los datos
  server.send(200, "application/json", json);
}

void conectarWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Conectando a WiFi");
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nConectado. IP para la app: ");
    Serial.println(WiFi.localIP());
  } else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("AquaGuard-Cisterna", "aquaguard");
    Serial.print("\nSin WiFi. Red propia creada. IP: ");
    Serial.println(WiFi.softAPIP());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  conectarWiFi();
  server.on("/api/status", handleStatus);
  server.begin();
}

void loop() {
  static unsigned long ultimo = 0;
  if (millis() - ultimo > 1000) {
    ultimo = millis();
    actualizarNivel();
  }
  server.handleClient();
}

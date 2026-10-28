/*
  Aqua Guard · Litium — ESP32 BOMBA
  ---------------------------------
  Controla la bomba con un relé, mide el tinaco con un sensor ultrasónico
  y consulta al ESP32 Cisterna para no encender la bomba en seco.

  Endpoints:
    GET /api/status            -> {"device":"bomba","bomba":true,"modo":"auto","nivel_tinaco":40.0,...}
    GET /api/bomba?modo=on     -> enciende (manual)
    GET /api/bomba?modo=off    -> apaga (manual)
    GET /api/bomba?modo=auto   -> automático por niveles

  Si no logra conectarse a tu WiFi, crea su propia red "AquaGuard-Bomba"
  (contraseña: aquaguard) y queda en la IP 192.168.4.1.
*/
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>

// ---------- CONFIGURA AQUÍ ----------
const char* WIFI_SSID     = "TU_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD";

// IP del ESP32 Cisterna (déjala vacía "" si no quieres protección contra marcha en seco)
const char* IP_CISTERNA = "192.168.1.50";

const int PIN_RELE = 26;
const bool RELE_ACTIVO_BAJO = true;  // la mayoría de módulos de relé se activan con LOW
const int PIN_TRIG = 5;
const int PIN_ECHO = 18;

const float DIST_LLENO = 15.0;   // cm del sensor al agua con el tinaco lleno
const float DIST_VACIO = 120.0;  // cm del sensor al fondo del tinaco

const float ENCENDER_BAJO = 25;  // % del tinaco para encender la bomba
const float APAGAR_ALTO   = 95;  // % del tinaco para apagarla
const float CISTERNA_MIN  = 15;  // % mínimo en cisterna para poder bombear
// ------------------------------------

WebServer server(80);
String modo = "auto";
bool bombaOn = false;
float distanciaCm = -1;
float nivelTinaco = 0;
float nivelCisterna = -1;  // -1 = desconocido

float medirDistancia() {
  digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long dur = pulseIn(PIN_ECHO, HIGH, 30000);
  if (dur == 0) return -1;
  return dur * 0.0343 / 2.0;
}

void setBomba(bool on) {
  bombaOn = on;
  digitalWrite(PIN_RELE, (on ^ RELE_ACTIVO_BAJO) ? HIGH : LOW);
}

void leerCisterna() {
  if (strlen(IP_CISTERNA) == 0 || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setTimeout(800);
  http.begin(String("http://") + IP_CISTERNA + "/api/status");
  if (http.GET() == 200) {
    String body = http.getString();
    int i = body.indexOf("\"nivel\":");
    if (i >= 0) nivelCisterna = body.substring(i + 8).toFloat();
  } else {
    nivelCisterna = -1;
  }
  http.end();
}

void controlAutomatico() {
  bool cisternaOk = nivelCisterna < 0 || nivelCisterna > CISTERNA_MIN;
  if (!cisternaOk) { setBomba(false); return; }  // protección marcha en seco
  if (modo != "auto") return;
  if (!bombaOn && nivelTinaco <= ENCENDER_BAJO) setBomba(true);
  if (bombaOn && nivelTinaco >= APAGAR_ALTO)    setBomba(false);
}

void enviarCORS() { server.sendHeader("Access-Control-Allow-Origin", "*"); }

void handleStatus() {
  String json = "{\"device\":\"bomba\"";
  json += ",\"bomba\":" + String(bombaOn ? "true" : "false");
  json += ",\"modo\":\"" + modo + "\"";
  json += ",\"nivel_tinaco\":" + String(nivelTinaco, 1);
  json += ",\"distancia_cm\":" + String(distanciaCm, 1);
  json += ",\"nivel_cisterna\":" + String(nivelCisterna, 1);
  json += ",\"rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
  json += ",\"uptime\":" + String(millis() / 1000);
  json += "}";
  enviarCORS();
  server.send(200, "application/json", json);
}

void handleBomba() {
  String m = server.arg("modo");
  if (m == "on")        { modo = "manual"; setBomba(true); }
  else if (m == "off")  { modo = "manual"; setBomba(false); }
  else if (m == "auto") { modo = "auto"; }
  else { enviarCORS(); server.send(400, "application/json", "{\"error\":\"modo invalido\"}"); return; }
  handleStatus();
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
    WiFi.softAP("AquaGuard-Bomba", "aquaguard");
    Serial.print("\nSin WiFi. Red propia creada. IP: ");
    Serial.println(WiFi.softAPIP());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELE, OUTPUT);
  setBomba(false);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  conectarWiFi();
  server.on("/api/status", handleStatus);
  server.on("/api/bomba", handleBomba);
  server.begin();
}

void loop() {
  static unsigned long ultimoSensor = 0, ultimaCisterna = 0;
  if (millis() - ultimoSensor > 1000) {
    ultimoSensor = millis();
    float d = medirDistancia();
    if (d >= 0) {
      distanciaCm = d;
      nivelTinaco = constrain((DIST_VACIO - d) / (DIST_VACIO - DIST_LLENO) * 100.0, 0, 100);
    }
    controlAutomatico();
  }
  if (millis() - ultimaCisterna > 3000) {
    ultimaCisterna = millis();
    leerCisterna();
  }
  server.handleClient();
}
